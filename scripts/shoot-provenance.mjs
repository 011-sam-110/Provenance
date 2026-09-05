// Visual evidence for the provenance chip on Source Catalog signal rows.
//
// Run against an ALREADY-RUNNING dev server on its own port + TN_DIST_DIR:
//   TN_DIST_DIR=.next-provdev npx next dev -p 3097
//   PROV_PORT=3097 node scripts/shoot-provenance.mjs
//
// Never assumes :3000 — a parallel session's dev server usually owns that, and two
// Next servers sharing a .next corrupts it.
//
// The rail is not on screen at load: SourceCatalog mounts inside a collapsed left
// "SOURCES" drawer, and its signal rows sit behind a second collapsed disclosure
// (`.tn-signals-header`). Both have to be opened before a chip exists to shoot.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const PORT = process.env.PROV_PORT || "3097";
const OUT = "persona-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1200 },
  deviceScaleFactor: 2,
});

await page.goto(`http://localhost:${PORT}/app`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(9000); // dev-mode first compile + store hydration

await page.locator("text=SOURCES").first().click({ force: true }).catch(() => {});
await page.waitForTimeout(1800);

const header = page.locator(".tn-signals-header").first();
await header.scrollIntoViewIfNeeded().catch(() => {});
await header.click().catch((e) => console.log("signals-header click failed:", e.message));

await page.waitForSelector(".tn-layer-prov", { timeout: 30_000 });
await page.waitForTimeout(1200);

const chips = await page.$$eval(".tn-layer-prov", (els) =>
  els.map((e) => ({
    cls: e.textContent?.trim(),
    layer: e.closest(".tn-layer-row")?.querySelector(".tn-layer-name")?.textContent?.trim(),
  })),
);
const byClass = {};
for (const c of chips) byClass[c.cls] = (byClass[c.cls] || 0) + 1;
console.log(`chips rendered: ${chips.length}`);
console.log("by class:", JSON.stringify(byClass));
console.log("military row:", JSON.stringify(chips.find((c) => /milit/i.test(c.layer || ""))));

await page.screenshot({ path: `${OUT}/provenance-app.png` });

const rail = await page.$(".tn-signals-body");
const box = rail && (await rail.boundingBox());
if (box) {
  await page.screenshot({
    path: `${OUT}/provenance-rail.png`,
    clip: {
      x: Math.max(0, box.x - 10),
      y: Math.max(0, box.y - 40),
      width: Math.min(560, box.width + 20),
      height: Math.min(1000, page.viewportSize().height - Math.max(0, box.y - 40)),
    },
  });
  console.log(`wrote ${OUT}/provenance-rail.png`);
}

// A second shot centred on the military-air row: the fix in situ, beside layers
// of other classes, which is the only way to see that the chip discriminates.
const milRow = page.locator(".tn-layer-row", { hasText: "Military flights" }).first();
if (await milRow.count()) {
  await milRow.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(600);
  const mb = await milRow.boundingBox();
  if (mb) {
    const vh = page.viewportSize().height;
    const top = Math.max(0, Math.min(mb.y - 320, vh - 820));
    await page.screenshot({
      path: `${OUT}/provenance-military.png`,
      clip: { x: Math.max(0, mb.x - 10), y: top, width: 560, height: Math.min(820, vh - top) },
    });
    console.log(`wrote ${OUT}/provenance-military.png`);
  }
}

await browser.close();
