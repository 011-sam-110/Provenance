// lib/cinematic/screenshot.mjs
// Captures the trimmed /demo-cinematic evidence shots for Sam (1440×900, 1× DPI):
//
//   persona-shots/cinematic-trim-1.png   orbit, early (~2.6 s in)
//   persona-shots/cinematic-trim-2.png   orbit, later (~4.8 s in)
//
// Usage (from the repo root, dev server on 4174):
//   node lib/cinematic/screenshot.mjs
//
// Dormant-safe: if CelesTrak is down the page shows its graceful empty state, the
// script times out waiting for readiness, captures whatever is visible as
// persona-shots/cinematic-error.png, and exits 1 with the reason — it never
// fabricates the motion shots.
//
// Playwright resolution mirrors scripts/playwright.mjs (documented there): the
// worktree's node_modules may be a junction, so the package is resolved relative
// to the process cwd through explicit candidates.

import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const BASE_URL = "http://localhost:4174/demo-cinematic";
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: "no-preference", // the flourishes must be ON for the shots
  });
  const page = await context.newPage();
  try {
    console.log(`[screenshot] opening ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // data-ready flips to 1 only when the map has loaded, settled, AND the
    // stations TLEs are in — the page's own definition of "ready to fly".
    console.log("[screenshot] waiting for map idle + CelesTrak stations…");
    await page.waitForSelector('[data-demo-root][data-ready="1"]', { timeout: 120_000 });
    await page.waitForTimeout(1500); // let the last tiles settle

    // ── Orbit (the only motion the trimmed page keeps) ───────────────────────
    console.log("[screenshot] Orbit ISS");
    await page.click("#btn-orbit");
    await page.waitForTimeout(2600);
    await shoot(page, "cinematic-trim-1.png");
    await page.waitForTimeout(2200);
    await shoot(page, "cinematic-trim-2.png");
    console.log("[screenshot] done");
  } catch (err) {
    // Dormant-safe failure: leave Sam the honest picture of whatever the page
    // showed, and fail loudly with the reason.
    try {
      await shoot(page, "cinematic-error.png");
      console.error(`[screenshot] FAILED after ${err.message} — captured persona-shots/cinematic-error.png`);
    } catch {
      console.error(`[screenshot] FAILED and could not capture the page: ${err.message}`);
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
