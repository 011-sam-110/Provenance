// Evidence for the camera-wall conditions overlay: the road/ground claim, the weather
// chip and the local clock, burned into the bottom-right of every tile on Streets.
//
// WHY TWO WIDTHS THAT LOOK LIKE THE SAME LAYOUT. Sam browses at about 80% zoom, so a
// 1440x900 window gives him 1800x1125 CSS pixels and renders 10.5px type at roughly
// 8.4 device pixels. The overlay's whole legibility argument lives at that size, not at
// the nominal one, so shooting only 1440x900 would test a screen nobody is using.
//
// VIEWPORT SHOTS, NEVER fullPage. A fullPage capture of this console re-lays-out the
// stage and catches camera images mid-load; the viewport shot is what a person sees.
//
//   node scripts/shoot-conditions.mjs [baseUrl] [outDir]

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const baseUrl = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3210";
const outDir = process.argv[3] ?? "persona-shots/conditions";

// Both overlays that own the screen on a first visit. Same envelope shape, different
// keys; see tests/e2e/console.spec.ts for why the tour version is seeded far above the
// current one rather than at it.
const SUPPRESS = () => {
  window.localStorage.setItem("tn.tour.v1", JSON.stringify({ v: 1, d: { seenVersion: 99 } }));
  window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
};

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900, note: "nominal desktop" },
  { name: "1800x1125-at-80pct", width: 1800, height: 1125, note: "what Sam actually sees at 80% zoom" },
  { name: "390x844", width: 390, height: 844, note: "mobile; stage falls back to 16:9" },
];

async function openStreets(page) {
  await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
  // The board tabs are the console's top nav. Match on the accessible name rather than
  // a nth-child, so a reordered nav fails loudly instead of shooting the wrong board.
  const tab = page.getByRole("button", { name: /streets/i }).first();
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await tab.click();
  // Camera tiles are remote images on 60-600s cadences. Give them a real chance to
  // paint, or the evidence shows empty stages and proves nothing about an overlay that
  // sits on top of them.
  await page.waitForTimeout(9_000);
}

const run = async () => {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const results = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    await ctx.addInitScript(SUPPRESS);
    const page = await ctx.newPage();
    try {
      await openStreets(page);

      // Report what the overlay actually claims, per tile, so the run is checkable
      // without opening the pictures — and so a silently-absent overlay cannot pass as
      // a successful screenshot.
      const claims = await page.$$eval(".tn-cscond", (nodes) =>
        nodes.map((n) => ({
          tier: n.getAttribute("data-tier"),
          density: n.getAttribute("data-density"),
          text: (n.textContent || "").replace(/\s+/g, " ").trim(),
        })),
      );
      const path = `${outDir}/streets-${vp.name}.png`;
      await page.screenshot({ path });
      results.push({ viewport: vp.name, note: vp.note, overlays: claims.length, claims, path });
      console.log(`\n=== ${vp.name} (${vp.note}) ===`);
      console.log(`overlays found: ${claims.length}`);
      for (const c of claims) console.log(`  [${c.tier}/${c.density}] ${c.text}`);
      console.log(`shot: ${path}`);
    } catch (err) {
      console.error(`FAILED at ${vp.name}:`, err.message);
      results.push({ viewport: vp.name, error: err.message });
    } finally {
      await ctx.close();
    }
  }

  await browser.close();

  const total = results.reduce((n, r) => n + (r.overlays ?? 0), 0);
  if (total === 0) {
    console.error("\nNO OVERLAYS FOUND IN ANY VIEWPORT. The shots are not evidence of anything.");
    process.exit(1);
  }
  console.log(`\nOK: ${total} overlay instances across ${VIEWPORTS.length} viewports.`);
};

run();
