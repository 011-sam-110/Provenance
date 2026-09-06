// Visual evidence for M1 (card anatomy) and M2 (the expanded view).
//
// Run against an ALREADY-RUNNING dev server on its own port + TN_DIST_DIR:
//   TN_DIST_DIR=.next-widgetdev npx next dev -p 3131
//   WA_PORT=3131 node scripts/shoot-widget-anatomy.mjs
//
// Never assumes :3000 — a parallel session's dev server usually owns that, and two
// Next servers sharing a .next corrupts it.
//
// WHY THIS SEEDS A BOARD. Neither shipped preset shows a signal widget: "Globe" is
// deliberately empty (a bare rotating globe) and "Streets" is four camslot camera
// tiles. The header, the status pill and the row primitive this milestone changes
// are therefore not reachable from any default board, so the script writes a layout
// straight into the store's localStorage key before the app boots. That is the same
// key `?c=` share links restore into, not a test-only backdoor.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const PORT = process.env.WA_PORT || "3131";
const OUT = "persona-shots";
mkdirSync(OUT, { recursive: true });

/** Real registered types: `signal:<id>` for each source in lib/signals/registry.ts. */
// Measured on origin/main: 70 registered types, 46 with a bespoke *.detail.tsx
// (the generic signal widgets all share signals.detail.tsx through the
// registration loop) and 24 falling back to GenericDetail — 17 category rollups,
// the 6 recon tools and livecams-brazil. The third pick is deliberately one of
// those 24, because the expanded view is where they had the least and gain the
// most, and shooting only a widget that already had a bespoke detail would prove
// nothing about M2.
const PICKS = [
  ["signal:earthquakes", 300],
  ["signal:cloud-status", 260],
  ["rollup:Natural hazards", 240],
];

const layout = {
  segments: {
    left: { size: 460, collapsed: false },
    right: { size: 0, collapsed: true },
    bottom: { size: 0, collapsed: true },
  },
  stage: "map2d",
  focusedWidgetId: null,
  mode: "rails",
  widgets: PICKS.map(([type, height], i) => ({
    id: `wa-${i}`,
    type,
    segment: "left",
    order: i,
    height,
    collapsed: false,
    config: {},
  })),
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 2,
});

// Seed BEFORE the app's first render: addInitScript runs on every navigation in
// this context, ahead of page scripts, so the store hydrates from it rather than
// racing it. Writing after goto() would make the board flash empty and then swap.
// The VERSION ENVELOPE is not optional. lib/shell/persist.ts stores every value as
// `{ v, d }` and loadPersisted returns null on a version mismatch — so a bare layout
// object here is not a crash, it is a silent miss that boots the default empty board
// and leaves you shooting a blank rail wondering why.
await page.addInitScript((l) => {
  try { window.localStorage.setItem("tn.console.v1", JSON.stringify({ v: 1, d: l })); } catch { /* ignore */ }
}, layout);

await page.goto(`http://localhost:${PORT}/app`, { waitUntil: "domcontentloaded", timeout: 120_000 });

// Dev-mode first compile is slow and the widgets then fetch live upstreams. Wait for
// a card to exist, then for at least one row inside one — a header with an empty body
// is a screenshot of a loading state, not of the row primitive.
await page.waitForSelector(".tn-cw", { timeout: 120_000 });
await page.waitForSelector(".tn-cw .tn-w-list li, .tn-cw .tn-w-table tr", { timeout: 120_000 }).catch(() => {
  console.warn("no rows rendered — upstreams may be empty; shooting anyway and saying so");
});
await page.waitForTimeout(4000);

// The rail's container class is resolved from the DOM rather than hardcoded: this
// shell has been through a grid → rails → terminal rewrite and `.tn-cw-col-left`
// (the obvious guess, and the class globals.css still styles) is not what wraps a
// card on the board today. Walking up from a real card cannot go stale.
const railSel = await page.evaluate(() => {
  let e = document.querySelector(".tn-cw")?.parentElement;
  while (e && e !== document.body) {
    const cls = typeof e.className === "string" ? e.className.trim().split(/\s+/) : [];
    // The first ancestor that holds ALL the cards is the rail.
    if (cls.length && e.querySelectorAll(".tn-cw").length >= 2) return "." + cls[0];
    e = e.parentElement;
  }
  return null;
});
console.log("rail container:", railSel ?? "(none — shooting the viewport instead)");

// 1. The rail as it sits: quiet headers, status pills, the row primitive.
if (railSel) await page.locator(railSel).first().screenshot({ path: `${OUT}/widget-anatomy-rail.png` });
else await page.screenshot({ path: `${OUT}/widget-anatomy-rail.png` });

// 2. One card close up.
await page.locator(".tn-cw").first().screenshot({ path: `${OUT}/widget-anatomy-card.png` });

// 3. The ... menu open — this is the evidence that ? and the bell survived the
//    header, since they are its first two entries.
await page.locator(".tn-cw").first().locator(".tn-cw-menu").click();
await page.waitForSelector(".tn-cw-menu-pop", { timeout: 10_000 });
await page.waitForTimeout(400);
await page.locator(".tn-cw").first().screenshot({ path: `${OUT}/widget-anatomy-menu.png` });

// 4. Hover the card so the move grip and the bottom-edge resize bar are both in
//    their revealed state — at rest they are invisible by design, so a shot of the
//    card at rest cannot show whether they render at all.
await page.keyboard.press("Escape");
await page.locator(".tn-cw").first().hover();
await page.waitForTimeout(300);
await page.locator(".tn-cw").first().screenshot({ path: `${OUT}/widget-anatomy-hover.png` });

// 5. The expanded view. This is the M2 evidence and the reason it is worth
//    shooting a widget with NO bespoke *.detail.tsx: 24 of the 70 registered
//    types land on GenericDetail, and what they used to get was the card body at
//    full width with no masthead, no figure and no provenance line.
await page.locator(".tn-cw").nth(2).locator(".tn-cw-expand").click();
await page.waitForSelector(".tn-detail", { timeout: 30_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/widget-anatomy-fullscreen.png` });

const fs = await page.evaluate(() => {
  const d = document.querySelector(".tn-detail");
  const t = (s) => d?.querySelector(s)?.textContent?.trim() ?? null;
  return {
    masthead: !!d?.querySelector(".tn-detail-head"),
    title: t(".tn-detail-title"),
    figure: t(".tn-detail-fig"),
    provenance: t(".tn-detail-prov"),
    notifySwitch: d?.querySelector(".tn-detail-notify")?.getAttribute("aria-checked") ?? null,
    exportButtons: d?.querySelectorAll(".tn-detail-act").length ?? 0,
    usesBespokeDetail: !!d?.querySelector(".tn-sd"),
  };
});
console.log("FULLSCREEN:", JSON.stringify(fs, null, 2));

await page.locator(".tn-detail-back").click();
await page.waitForTimeout(600);

const report = await page.evaluate(() => {
  const card = document.querySelector(".tn-cw");
  const head = card?.querySelector(".tn-cw-head");
  const pill = card?.querySelector(".tn-cw-fresh");
  return {
    cards: document.querySelectorAll(".tn-cw").length,
    headerChildren: head ? head.children.length : null,
    headerHeight: head ? Math.round(head.getBoundingClientRect().height) : null,
    buttons: card ? card.querySelectorAll(".tn-cw-head .tn-cw-btn").length : null,
    buttonBox: card
      ? (() => { const b = card.querySelector(".tn-cw-head .tn-cw-btn")?.getBoundingClientRect();
                 return b ? `${Math.round(b.width)}x${Math.round(b.height)}` : null; })()
      : null,
    pillText: pill ? pill.textContent.trim() : null,
    pillClass: pill ? pill.className : null,
    rows: card ? card.querySelectorAll(".tn-w-list li").length : 0,
    rowHeight: (() => { const r = card?.querySelector(".tn-w-list li")?.getBoundingClientRect();
                        return r ? Math.round(r.height) : null; })(),
    resizeBar: card ? card.querySelectorAll(".tn-cw-rz").length : 0,
  };
});
console.log("MEASURED:", JSON.stringify(report, null, 2));

await browser.close();
