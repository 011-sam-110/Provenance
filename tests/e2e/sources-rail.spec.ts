import { test, expect } from "@playwright/test";

// The Sources rail: its two keyboard doors, and the first-visit hint on its tab.
//
// WHY E2E AND NOT A UNIT TEST. The rule about when the hint fires is pure and lives
// in tests/unit/sources-rail.test.ts. What cannot be tested there is everything that
// makes it real: vitest here is `environment: "node"`, so there is no keydown to
// dispatch, no CSS to resolve an animation from, and no localStorage round trip
// across a reload. All three are the substance of this feature.
//
// The two localStorage stamps are copied from map-rail.spec.ts for the reason stated
// there: the guided tour and the launch sequence are each a `position:fixed; inset:0`
// layer, and without them a click lands on an overlay instead of the control under it.
async function stampSeen(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.tour.v1", JSON.stringify({ v: 1, d: { seenVersion: 99 } }));
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
}

const FAB = ".tn-rail-fab";
const RAIL = ".tn-rail";

test("⌘K opens Sources — NOT the command palette", async ({ page }) => {
  // The binding this change exists for. ⌘K is the command-palette convention almost
  // everywhere, so the assertion that the palette stays SHUT is the important half:
  // without it this passes on a build where both open and the palette covers the rail.
  await stampSeen(page);
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);

  await expect(page.locator(RAIL)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");

  await expect(page.locator(RAIL)).toBeVisible();
  await expect(page.locator(".tn-palette-root")).toHaveCount(0);

  // Toggle, not open-only. A key that cannot close what it opened is a dead key the
  // second time it is pressed, and ⌘K toggled the palette before this change.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(RAIL)).toHaveCount(0);
});

test("Ctrl+Space is the second door, and it is the same door", async ({ page }) => {
  await stampSeen(page);
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);

  await page.keyboard.press("Control+Space");
  await expect(page.locator(RAIL)).toBeVisible();

  // Opened by one chord, closed by the other — they drive one store, not two states.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(RAIL)).toHaveCount(0);
});

test("the SHORTCUTS button still opens the palette, now that ⌘K does not", async ({ page }) => {
  // The palette did not lose its door, it lost its chord. If this ever fails, the
  // palette is unreachable and the tour's OPEN_PALETTE action is broken with it.
  await stampSeen(page);
  await page.goto("/app");
  await page.locator(".tn-palette-trigger").click();
  await expect(page.locator(".tn-palette-root")).toBeVisible();
});

test("the tab bounces on a first visit, and never again after the rail is opened", async ({ page }) => {
  // THE HINT, END TO END: it is armed with clean storage, it is a FINITE animation,
  // opening the rail earns it out, and the flag survives a reload.
  await stampSeen(page);
  await page.goto("/app");

  const fab = page.locator(FAB);
  await expect(fab).toHaveAttribute("data-hint", "");

  // Finite, not infinite. A control that never stops moving reads as a fault rather
  // than as a hint, and it would pull the eye off the map for the whole session.
  const iterations = await fab.evaluate((el) => getComputedStyle(el).animationIterationCount);
  expect(iterations).not.toBe("infinite");
  expect(Number(iterations)).toBeGreaterThan(0);

  await fab.click();
  await expect(page.locator(RAIL)).toBeVisible();

  // Earned out, and it stays earned out across a reload — this is a first-visit hint,
  // not a per-load one.
  await page.reload();
  await expect(page.locator(FAB)).not.toHaveAttribute("data-hint", "");
});

test("opening by keyboard earns the hint out too, not just clicking the tab", async ({ page }) => {
  // The flag is written in the store's setOpen, so every door earns it out. If it
  // were written in the tab's onClick instead, a ⌘K user would be nagged forever.
  await stampSeen(page);
  await page.goto("/app");
  await expect(page.locator(FAB)).toHaveAttribute("data-hint", "");

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(RAIL)).toBeVisible();

  await page.reload();
  await expect(page.locator(FAB)).not.toHaveAttribute("data-hint", "");
});
