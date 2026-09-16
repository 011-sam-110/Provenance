// lib/cinematic/integration-shots.mjs
// Console integration evidence for Sam (1440×900, 1× DPI). Drives the REAL UI —
// no store injection — so every shot shows what a user actually gets:
//
//   persona-shots/app-settings-1.png  Map settings top (View/Basemap/Surface/HUD)
//   persona-shots/app-settings-2.png  Map settings scrolled to the ISS orbit section
//   persona-shots/app-hud-1.png       /app with the HUD overlay enabled
//   persona-shots/app-orbit-1.png     /app with the ISS orbit running (early)
//   persona-shots/app-orbit-2.png     /app with the ISS orbit running (later)
//   persona-shots/hud-trim-1.png      trimmed /demo-hud (no flap strip)
//
// Usage (from the repo root, dev server on 4174):
//   node lib/cinematic/integration-shots.mjs
//
// The rail flow mirrors tests/e2e/inspector-rail.spec.ts (boot stamp, Ctrl+K,
// Inspector tab). ONE rail session for everything: toggling the rail closed and
// re-opening it re-derives panel state, so the shots keep the rail open — the
// HUD and the orbit are what the shots are for, and the rail is normal console
// chrome.

import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const APP_URL = "http://localhost:4174/app";
const OUT_DIR = path.resolve("persona-shots");
const VIEWPORT = { width: 1440, height: 900 };

const PLAYWRIGHT_CANDIDATES = [
  "node_modules/playwright/index.js",
  "node_modules/playwright-core/index.js",
  "node_modules/@playwright/test/index.js",
];

async function loadPlaywright() {
  for (const rel of PLAYWRIGHT_CANDIDATES) {
    try {
      const mod = await import(pathToFileURL(path.resolve(rel)).href);
      const ns = mod.chromium ? mod : mod.default;
      if (ns?.chromium) return ns;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("playwright not resolvable — run from the repo root");
}

const shoot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, name) });

async function waitForApp(page) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  // The console renders the map canvas once WorldMap mounts (the repo's canvas
  // class, per the e2e suite).
  await page.waitForSelector(".map-canvas", { timeout: 120_000 });
  // Live layers keep the network warm; give the first paint a settle window.
  await page.waitForTimeout(9000);
}

async function openMapSettings(page) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.waitForSelector(".tn-rail", { state: "visible", timeout: 15_000 });
  await page.click("#tn-rail-tab-inspector");
  await page.waitForSelector("#inspector-rail", { state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "Map settings" }).click();
  await page.waitForTimeout(1000);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  // The launch sequence is a fixed overlay; stamp the boot as seen so the
  // console's own controls are clickable (same stamp the e2e suite uses).
  await context.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
  const page = await context.newPage();
  try {
    console.log("[integration-shots] opening /app");
    await waitForApp(page);

    // ONE rail session — the rail stays open for every console shot.
    await openMapSettings(page);

    // 1 — settings, top (View / Basemap / Surface / HUD).
    await shoot(page, "app-settings-1.png");

    // 2 — settings, scrolled down to the ISS orbit section.
    const orbitSwitch = page.getByRole("switch", { name: "Follow the ISS" });
    await orbitSwitch.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await shoot(page, "app-settings-2.png");

    // 3 — HUD on, over the console map (rail open — it is normal chrome).
    const hudSwitch = page.getByRole("switch", { name: "HUD overlay" });
    await hudSwitch.scrollIntoViewIfNeeded();
    if ((await hudSwitch.getAttribute("aria-checked")) !== "true") {
      await hudSwitch.click();
      await page.waitForTimeout(500);
    }
    await page.waitForSelector("[data-tn-hud]", { timeout: 15_000 });
    await page.waitForTimeout(1200);
    await shoot(page, "app-hud-1.png");

    // 4 — ISS orbit on, mid-motion (two frames).
    if ((await orbitSwitch.getAttribute("aria-checked")) !== "true") {
      await orbitSwitch.click();
      await page.waitForTimeout(500);
    }
    await page.waitForSelector('.map-canvas[data-tn-orbit="1"]', { timeout: 30_000 });
    await page.waitForTimeout(3000);
    await shoot(page, "app-orbit-1.png");
    await page.waitForTimeout(3000);
    await shoot(page, "app-orbit-2.png");

    // 5 — trimmed HUD demo.
    console.log("[integration-shots] trimmed /demo-hud");
    await page.goto("http://localhost:4174/demo-hud", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector(".map-canvas", { timeout: 120_000 });
    await page.waitForTimeout(6000);
    await shoot(page, "hud-trim-1.png");

    console.log("[integration-shots] done");
  } catch (err) {
    try {
      await shoot(page, "integration-error.png");
      console.error(`[integration-shots] FAILED after ${err.message} — captured persona-shots/integration-error.png`);
    } catch {
      console.error(`[integration-shots] FAILED and could not capture the page: ${err.message}`);
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
