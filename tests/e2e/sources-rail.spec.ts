import { test, expect } from "@playwright/test";

// The Sources rail: its two keyboard doors, and the fresh-launch hint on its tab.
//
// WHY E2E AND NOT A UNIT TEST. The rule about when the hint fires is pure and lives
// in tests/unit/sources-rail.test.ts. What cannot be tested there is everything that
// makes it real: vitest here is `environment: "node"`, so there is no keydown to
// dispatch, no CSS to resolve an animation from, and no second launch. The third one
// is the whole point of this file now — the hint's scope is one visit, and a suite
// that never reloads cannot tell that apart from a hint that never comes back.
//
// The localStorage stamp is copied from map-rail.spec.ts for the reason stated there:
// the launch sequence is a `position:fixed; inset:0` layer, and without it a click
// lands on the plate instead of the control under it.
async function stampSeen(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
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

test("Ctrl+Space is SEARCH now, and it does not touch the rail", async ({ page }) => {
  // Ctrl+Space opened Sources in the first cut of this feature. The keymap gave every
  // action one job, and the half of that worth pinning is the NEGATIVE: a chord that
  // still opened the rail as a side effect would be a second door nobody documented.
  await stampSeen(page);
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);

  await page.keyboard.press("Control+Space");
  await expect(page.locator("#stage-search input")).toBeFocused();
  await expect(page.locator(RAIL)).toHaveCount(0);
});

test("the SHORTCUTS button still opens the palette, now that ⌘K does not", async ({ page }) => {
  // The palette did not lose its door, it lost its chord. If this ever fails, the
  // palette is unreachable from anywhere.
  await stampSeen(page);
  await page.goto("/app");
  await page.locator(".tn-palette-trigger").click();
  await expect(page.locator(".tn-palette-root")).toBeVisible();
});

test("the tab jumps on a fresh launch, stops once opened, and IS BACK NEXT LAUNCH", async ({ page }) => {
  // THE HINT, END TO END: armed on arrival, actually animating, ended by opening the
  // rail, and armed again on the next launch.
  await stampSeen(page);
  await page.goto("/app");

  const fab = page.locator(FAB);
  await expect(fab).toHaveAttribute("data-hint", "");

  // That the attribute is set is not evidence that anything moves. The CSS hangs off
  // `.tn-terminal .tn-cw-shell > .tn-rail-fab[data-hint]`, a DIRECT-child selector, so
  // any future wrapper around the tab silently kills the animation while leaving the
  // attribute and every unit test green. Resolving the animation is what catches that.
  const anim = await fab.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, iterations: cs.animationIterationCount };
  });
  expect(anim.name).not.toBe("none");
  // Finite, not infinite. A control that never stops moving reads as a fault rather
  // than as a hint, and it would pull the eye off the map for the whole session.
  expect(anim.iterations).not.toBe("infinite");
  expect(Number(anim.iterations)).toBeGreaterThan(0);

  await fab.click();
  await expect(page.locator(RAIL)).toBeVisible();

  // Ended for the rest of THIS visit. Closing the rail again does not bring it back:
  // someone who opened Sources and shut it has found the control.
  //
  // The collapse button, not Escape. Escape was the obvious guess and it does not
  // close this rail — ConsoleShell sequences Escape for picking mode and the current
  // selection, and the rail is not in that ladder. Written down because the failure
  // looks nothing like the cause: the rail stays open, so the tab never re-renders,
  // so the assertion below fails with "element not found" rather than with a hint
  // that would not go away.
  await page.getByRole("button", { name: "Collapse sources" }).click();
  await expect(page.locator(FAB)).not.toHaveAttribute("data-hint", "");

  // AND BACK ON THE NEXT LAUNCH. This assertion is the inverse of the one it replaces,
  // which read "it stays earned out across a reload — this is a first-visit hint, not
  // a per-load one". That rule was the reported bug: the flag lived in localStorage, so
  // opening Sources once, ever, retired the hint on every later launch and the console
  // then looked exactly like one where the hint had never been built.
  await page.reload();
  await expect(page.locator(FAB)).toHaveAttribute("data-hint", "");
});

test("opening by keyboard ends the hint too, not just clicking the tab", async ({ page }) => {
  // The flag is set in the store's setOpen, so every door ends it. If it were set in
  // the tab's onClick instead, a Ctrl+K user would be nagged for the whole visit.
  await stampSeen(page);
  await page.goto("/app");
  await expect(page.locator(FAB)).toHaveAttribute("data-hint", "");

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(RAIL)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(RAIL)).toHaveCount(0);
  await expect(page.locator(FAB)).not.toHaveAttribute("data-hint", "");
});
