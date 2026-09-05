import { test, expect } from "@playwright/test";

// Both stamps are copied from tests/e2e/console.spec.ts, and for the reason given
// there: the launch sequence is a `position:fixed; inset:0` layer, so without this
// a click lands on the plate instead of the control under it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
});

test("the Brief board's camera wall opens empty, and offers both ways to fill it", async ({ page }) => {
  // `/app`, not `/`. CLAUDE.md is explicit that `/` is the marketing site and `/app`
  // is the console, and `/` only forwards when it carries `?v=` or `?c=`. Several
  // older specs in this directory still open `/` and assert console selectors —
  // console.spec.ts:32 was checked against this build and fails there for exactly
  // that reason, on origin/main and independently of this branch. It is reported
  // rather than fixed here: the fix is theirs to make, and globe.spec.ts opening `/`
  // is CORRECT since the hero globe genuinely lives on the landing page.
  await page.goto("/app");

  // Scoped to the camera wall by widget type rather than to whichever frame happens
  // to render first. WidgetFrame stamps data-widget-type on every tile, so this
  // fails loudly if the Brief board stops carrying a camslot at all — which is the
  // regression this file exists to catch. A `.tn-cw` first() would have passed
  // happily on a board that had lost the wall entirely.
  const wall = page.locator('.tn-cw[data-widget-type="camslot"]').first();
  await expect(wall).toBeVisible();

  // Empty is a DECISION, not an oversight: the landing board ships with nothing in
  // the slot so the first thing a visitor does is choose a camera. See §7.2 of
  // docs/superpowers/specs/2026-09-03-cameras-widget-retirement-design.md.
  const empty = wall.locator(".tn-cs-empty");
  await expect(empty).toBeVisible();

  // Both routes, not one. The picker is the obvious path; "pick on the map" is the
  // one an empty slot most needs, and it is absent from the header controls until a
  // slot already holds something — so an empty tile is the only place it can appear.
  await expect(empty.getByRole("button", { name: /Add a camera/ })).toBeVisible();
  await expect(empty.getByRole("button", { name: /Pick cameras on the map/ })).toBeVisible();

  // A viewport shot, not fullPage: the map behind the board animates, and a fullPage
  // capture reframes the page to catch it mid-flight.
  await page.screenshot({ path: "persona-shots/camslot-brief-empty.png" });
});
