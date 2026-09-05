// Visual evidence for the provenance chip on Source Catalog signal rows.
//
// Run against an ALREADY-RUNNING dev server on its own port + TN_DIST_DIR:
//   TN_DIST_DIR=.next-provdev npx next dev -p 3097
//   PROV_PORT=3097 node scripts/shoot-provenance.mjs
//
// Never assumes :3000 — a parallel session's dev server usually owns that, and two
// Next servers sharing a .next corrupts it.
//
// The rail is not on screen at load: SourceCatalog mounts collapsed as the
// "≡ Sources" launcher (`.tn-rail-fab`) and only renders its <aside> once that is
// clicked. Once open, all six sections (Ground, Air & space, …) render straight
// away — the reskin (components/shell/sources/SourceSection.tsx) replaced the old
// single collapsed "Global signals" disclosure with always-open sections, so there
// is nothing left to expand. What DID move behind a gesture is the per-row detail:
// the provenance chip and attribution text now live in a hover/focus popover
// (`.tn-src-pop`, components/shell/sources/SourceRow.tsx) that only exists in the
// DOM while that row is hovered or its label has focus, so a row has to be
// hovered before its "adsb.lol" attribution is actually on screen to shoot.

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

// NO TOUR SKIP HERE ANY MORE. #161 pointed this at `.tn-tour-skip` to stop a bare
// text=Skip locator hitting the a11y "Skip to the map" link. That fix was right for
// main and is dead on this branch: the guided tour is removed entirely, TourOverlay.tsx
// is gone, and `.tn-tour-skip` can never be in the DOM. A `if (await skip.count())`
// guard would have made it silently no-op forever, which is worse than absent -- the
// next person to debug this script would read it as a step that runs.

// `text=SOURCES` used to open the rail but is now ambiguous post-reskin: the
// literal text "SOURCES" is also the bottom-bar freshness ticker's label
// (components/shell/FreshnessTicker.tsx), which sits in the DOM alongside the
// real launcher. The button that actually opens the rail carries no visible
// "SOURCES" text at all — its label is "Sources" beside a ≡ glyph and its title
// is "Show sources" — so target its dedicated class instead:
// `.tn-rail-fab` (components/shell/SourceCatalog.tsx).
await page.locator(".tn-rail-fab").first().click({ force: true }).catch(() => {});
await page.waitForTimeout(1200);

// Rows are keyed by catalog id via `data-source-row` (SourceRow.tsx), which
// survives any relabeling — unlike matching on visible text, and unlike the old
// `.tn-layer-row` wrapper this script used to search for, which the reskin
// removed entirely (every row is `.tn-src-row` now).
await page.waitForSelector('[data-source-row="planes"]', { timeout: 30_000 });

// Hover the Planes row so its popover — and the "adsb.lol" attribution inside
// it — is actually rendered for this first, full-page shot.
const planesRow = page.locator('[data-source-row="planes"]').first();
await planesRow.scrollIntoViewIfNeeded().catch(() => {});
await planesRow.hover().catch(() => {});
await planesRow.locator(".tn-src-pop").waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(300);

await page.screenshot({ path: `${OUT}/provenance-app.png` });

// "Global signals" no longer exists as a single section; the closest analogue
// in the six-section rail (lib/console/sources/sections.ts) is "Air & space",
// which is where both Planes (Aviation group) and Military flights (Military
// group) now live. The mouse has not moved since the hover above, so Planes'
// popover is still open for this crop.
const airSpaceSection = page.locator('.tn-src-sec[data-section="air-space"]');
const secBox = await airSpaceSection.boundingBox();
if (secBox) {
  await page.screenshot({
    path: `${OUT}/provenance-rail.png`,
    clip: {
      x: Math.max(0, secBox.x - 10),
      y: Math.max(0, secBox.y - 10),
      width: Math.min(620, secBox.width + 20),
      height: Math.min(750, page.viewportSize().height - Math.max(0, secBox.y - 10)),
    },
  });
  console.log(`wrote ${OUT}/provenance-rail.png`);
}

// A second shot centred on the military-air row itself: the fix in situ, beside
// layers of other classes, which is the only way to see that the chip
// discriminates. Hovering it closes Planes' popover (leaving that row closes
// it) and opens this row's own.
const milRow = page.locator('[data-source-row="military-air"]').first();
if (await milRow.count()) {
  await milRow.scrollIntoViewIfNeeded().catch(() => {});
  await milRow.hover().catch(() => {});
  await milRow.locator(".tn-src-pop").waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(300);
  const mb = await milRow.boundingBox();
  if (mb) {
    const vh = page.viewportSize().height;
    // The popover renders BELOW the row (`.tn-src-pop { top: calc(100% - 2px) }`
    // in globals.css), so the crop needs headroom under the row, not above it.
    const top = Math.max(0, mb.y - 20);
    const height = Math.min(300, vh - top);
    await page.screenshot({
      path: `${OUT}/provenance-military.png`,
      clip: { x: Math.max(0, mb.x - 10), y: top, width: 560, height },
    });
    console.log(`wrote ${OUT}/provenance-military.png`);
  }
}

await browser.close();
