import { test, expect } from "@playwright/test";

// The Sources panel: its two keyboard doors, and the fresh-launch hint on its row.
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

const WRAP = ".tn-sidebar";
const ROW = 'nav[data-rail="console"] [data-rail-entry="sources"]';
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

test("Ctrl+Space is SEARCH now, and it does not touch the panel", async ({ page }) => {
  // Ctrl+Space opened Sources in the first cut of this feature. The keymap gave every
  // action one job, and the half of that worth pinning is the NEGATIVE: a chord that
  // still opened the panel as a side effect would be a second door nobody documented.
  await stampSeen(page);
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);

  await page.keyboard.press("Control+Space");
  await expect(page.locator("#tn-map-search")).toBeFocused();
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

test("the row hops on a fresh launch, stops once opened, and IS BACK NEXT LAUNCH", async ({ page }) => {
  // THE HINT, END TO END: armed on arrival, actually animating, ended by opening the
  // panel, and armed again on the next launch.
  await stampSeen(page);
  await page.goto("/app");

  await expect(page.locator(WRAP)).toHaveAttribute("data-hint", "");

  // That the attribute is set is not evidence that anything moves. The CSS hangs off a
  // selector across two components, so a future change to either silently kills the
  // animation while leaving the attribute and every unit test green. Resolving the
  // animation is what catches that.
  const anim = await page.locator(ROW).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, iterations: cs.animationIterationCount };
  });
  expect(anim.name).not.toBe("none");
  // Finite, not infinite. A control that never stops moving reads as a fault rather
  // than as a hint, and it would pull the eye off the map for the whole session.
  expect(anim.iterations).not.toBe("infinite");
  expect(Number(anim.iterations)).toBeGreaterThan(0);

  await page.locator(ROW).click();
  await expect(page.locator(RAIL)).toBeVisible();
  await expect(page.locator(WRAP)).not.toHaveAttribute("data-hint", "");

  // Ended for the rest of THIS visit. Closing the panel again does not bring it back:
  // someone who opened Sources and shut it has found the control.
  await page.getByRole("button", { name: "Close sources" }).click();
  await expect(page.locator(RAIL)).toHaveCount(0);
  await expect(page.locator(WRAP)).not.toHaveAttribute("data-hint", "");

  // AND BACK ON THE NEXT LAUNCH. This assertion is the inverse of the one it replaces,
  // which read "it stays earned out across a reload — this is a first-visit hint, not
  // a per-load one". That rule was the reported bug: the flag lived in localStorage, so
  // opening Sources once, ever, retired the hint on every later launch and the console
  // then looked exactly like one where the hint had never been built.
  await page.reload();
  await expect(page.locator(WRAP)).toHaveAttribute("data-hint", "");
});

test("a person who asks for reduced motion gets the colour and no movement", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await stampSeen(page);
  await page.goto("/app");
  await expect(page.locator(WRAP)).toHaveAttribute("data-hint", "");
  const anim = await page.locator(ROW).evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe("none");
  // The part of the hint that does not move stays.
  const ring = await page.locator(ROW).evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring).not.toBe("none");
  await context.close();
});

test("opening by keyboard ends the hint too, not just clicking the row", async ({ page }) => {
  // The flag is set in the store's setOpen, so every door ends it. If it were set in
  // the row's onClick instead, a Ctrl+K user would be nagged for the whole visit.
  await stampSeen(page);
  await page.goto("/app");
  await expect(page.locator(WRAP)).toHaveAttribute("data-hint", "");

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(RAIL)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(RAIL)).toHaveCount(0);
  await expect(page.locator(WRAP)).not.toHaveAttribute("data-hint", "");
});

test("on a phone the ☰ hops instead, because the row is inside a closed sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stampSeen(page);
  await page.goto("/app");
  await expect(page.locator(WRAP)).toHaveAttribute("data-hint", "");
  const menu = await page.locator('nav[data-rail="console"] [data-rail-menu]').evaluate((el) => getComputedStyle(el).animationName);
  expect(menu).not.toBe("none");
  const row = await page.locator(ROW).evaluate((el) => getComputedStyle(el).animationName);
  expect(row).toBe("none");
});
