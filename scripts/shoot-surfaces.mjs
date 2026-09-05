// Capture the console with each of its hidden surfaces open, so a reviewer can
// enumerate every pressable control from pictures alone.
//
// Nothing else in the repo proves that nothing on screen is left unexplained. The
// guided tour used to be a partial answer, and its verifier walked the steps the
// tour pointed at — but that only ever looked where the tour looked, and the tour
// is gone. These shots are the app as a user meets it, every drawer and popover
// open in turn.
//
//   node scripts/shoot-surfaces.mjs [baseUrl] <outDir>

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const baseUrl = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3210";
const outDir = process.argv[3] ?? "persona-shots/surfaces";

const shots = [
  {
    name: "01-default-board",
    note: "The console as it loads: header, feed health, stage, widgets, footer.",
    act: async () => {},
  },
  {
    name: "02-rail-open",
    note: "Source Catalog rail, core layers.",
    act: async (p) => { await p.click(".tn-rail-fab"); await p.waitForTimeout(700); },
  },
  {
    name: "03-rail-signals",
    note: "Rail with Global signals expanded.",
    act: async (p) => {
      await p.click(".tn-rail-fab"); await p.waitForTimeout(500);
      await p.click(".tn-signals-header"); await p.waitForTimeout(700);
    },
  },
  {
    name: "04-rail-camera-filters",
    note: "Rail with the Cameras row expanded (feed + region filters).",
    act: async (p) => {
      await p.click(".tn-rail-fab"); await p.waitForTimeout(500);
      await p.locator(".tn-layer-head").first().click(); await p.waitForTimeout(600);
    },
  },
  {
    name: "05-widget-help",
    note: "A widget's ? popover — the trust card.",
    act: async (p) => { await p.locator(".tn-cw-help").first().click(); await p.waitForTimeout(500); },
  },
  {
    name: "06-widget-notify",
    note: "A widget's notify popover — channels + threshold.",
    act: async (p) => { await p.locator(".tn-cw-bell").first().click(); await p.waitForTimeout(500); },
  },
  {
    name: "07-widget-menu",
    note: "A widget's menu — move, size, duplicate, alerts, export, remove.",
    act: async (p) => { await p.locator(".tn-cw-menu").first().click(); await p.waitForTimeout(500); },
  },
  {
    name: "08-command-palette",
    note: "The command palette.",
    act: async (p) => { await p.keyboard.press("Control+k"); await p.waitForTimeout(800); },
  },
  {
    name: "09-settings",
    note: "The settings drawer.",
    act: async (p) => { await p.click(".tn-settings-trigger"); await p.waitForTimeout(700); },
  },
  {
    name: "10-profile",
    note: "The profile popover.",
    act: async (p) => { await p.click(".tn-profile-avatar"); await p.waitForTimeout(500); },
  },
  {
    name: "11-coverage",
    note: "The Coverage panel.",
    act: async (p) => {
      await p.click(".tn-rail-fab"); await p.waitForTimeout(500);
      await p.locator(".tn-coverage-open").first().click(); await p.waitForTimeout(1400);
    },
  },
  {
    name: "12-markets",
    note: "The Markets panel.",
    act: async (p) => {
      await p.click(".tn-rail-fab"); await p.waitForTimeout(500);
      await p.locator(".tn-coverage-open").nth(1).click(); await p.waitForTimeout(1400);
    },
  },
  {
    name: "13-watchlist",
    note: "The Saved / watchlist panel.",
    act: async (p) => {
      await p.click(".tn-rail-fab"); await p.waitForTimeout(500);
      await p.locator(".tn-coverage-open").nth(2).click(); await p.waitForTimeout(900);
    },
  },
  {
    name: "14-wall-mode",
    note: "WALL layout mode.",
    act: async (p) => { await p.click(".tnx-hdr-mode-btn:nth-child(2)"); await p.waitForTimeout(1200); },
  },
  {
    name: "15-globe-3d",
    note: "The 3D globe projection.",
    act: async (p) => {
      const btn = p.locator(".tn-stage-switch button").first();
      await btn.click(); await p.waitForTimeout(2500);
    },
  },
  {
    name: "16-light-skin",
    note: "The light skin.",
    act: async (p) => { await p.click(".tnx-hdr-skin"); await p.waitForTimeout(2000); },
  },
  {
    name: "17-board-conflict",
    note: "A different board (Conflict), to show boards swap widgets AND layers.",
    act: async (p) => { await p.locator(".tnx-hdr-board").nth(1).click(); await p.waitForTimeout(2500); },
  },
];

const run = async () => {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();

  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: 1512, height: 945 } });
    // Suppress the launch plate: these shots are of the product, not of its
    // onboarding, and the plate would sit over every control being catalogued.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 99 } }));
      } catch { /* private mode */ }
    });
    await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".tn-cw-stage", { timeout: 60_000 });
    // Let the seeded widgets fetch, so the shots show real data rather than spinners.
    await page.waitForTimeout(7000);

    try {
      await shot.act(page);
    } catch (err) {
      console.log(`  ! ${shot.name}: ${err.message.split("\n")[0]}`);
    }
    await page.screenshot({ path: `${outDir}/${shot.name}.png` });
    console.log(`${shot.name} — ${shot.note}`);
    await page.close();
  }

  await browser.close();
};

run().catch((e) => { console.error(e); process.exit(1); });
