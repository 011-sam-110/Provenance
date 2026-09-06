import { test, expect } from "@playwright/test";

// The keymap, from the keyboard rather than from the store.
//
// tests/unit/keymap.test.ts owns every rule about chords — folding ⌘ into Ctrl, moving
// a binding rather than sharing it, falling back when storage is empty. None of that
// needs a browser. What needs one is the part those tests cannot reach: that a real
// keydown arrives at the shell's handler, that the text-field guard keeps a printable
// binding out of an input, and that a rebind made in Settings survives a reload.

async function stampSeen(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
}

const SEARCH_INPUT = "#stage-search input";
const RAIL = ".tn-rail";

/** The keymap lives on the Shortcuts tab now, and the drawer always opens on Main. */
async function openShortcuts(page: import("@playwright/test").Page) {
  await page.locator(".tn-settings-trigger").click();
  await page.getByRole("tab", { name: "Shortcuts" }).click();
}

/** Copied from map-rail.spec.ts: `startDraw` refuses while the style is still
 *  loading, so a Ctrl+Q fired before the tiles land arms nothing and looks like a
 *  broken binding. The credit line is not enough on its own — that was measured
 *  there, and this test reproduced it on its first run. */
async function mapReady(page: import("@playwright/test").Page) {
  await expect(page.locator(".maplibregl-ctrl-attrib-inner")).toContainText(/\S/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

test("; opens search, with no modifier at all", async ({ page }) => {
  await stampSeen(page);
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);

  await page.keyboard.press(";");
  await expect(page.locator(SEARCH_INPUT)).toBeFocused();
});

test("A SEMICOLON TYPED INTO A BOX IS A SEMICOLON", async ({ page }) => {
  // The reason the text-field guard runs before the keymap is consulted. ";" is a
  // printable character, so without that ordering, typing one into the search box
  // would re-trigger the shortcut that opened it and select the text you just typed.
  await stampSeen(page);
  await page.goto("/app");
  await page.keyboard.press(";");

  const input = page.locator(SEARCH_INPUT);
  await expect(input).toBeFocused();
  await input.type("a;b");
  await expect(input).toHaveValue("a;b");
});

test("Ctrl+Q arms the draw tool, not just the flyout", async ({ page }) => {
  // A shortcut that only opened the group would save one click out of two and leave
  // the user looking at a panel wondering what the key did. The map's crosshair cursor
  // is the evidence that the gesture is actually live.
  await stampSeen(page);
  await page.goto("/app");
  await mapReady(page);

  await page.keyboard.press("Control+q");
  const pop = page.locator(".tnx-maprail-pop-draw");
  await expect(pop).toBeVisible();
  // The live readout, not the cursor: it is what the flyout says while a gesture is
  // running, and it distinguishes "armed" from "opened the panel and gave up".
  await expect(pop.getByRole("status")).toContainText(/points/);
  await expect(page.locator(".map-canvas canvas").first()).toHaveCSS("cursor", "crosshair");
});

test("a rebound key works, and it is still bound after a reload", async ({ page }) => {
  // The whole point of "configurable". Rebinding Sources from Ctrl+K to Ctrl+G must
  // (a) take effect on the next keypress, (b) leave the old chord dead, and (c) still
  // be there on the next visit — a keymap that resets on reload is a preference the
  // user has to set every time, which is worse than no preference at all.
  await stampSeen(page);
  await page.goto("/app");
  await openShortcuts(page);

  const chip = page.getByRole("button", { name: /^Sources rail: Ctrl\+K/ });
  await chip.click();
  await page.keyboard.press("Control+g");
  await expect(page.getByRole("button", { name: /^Sources rail: Ctrl\+G/ })).toBeVisible();

  await page.keyboard.press("Escape"); // shut the settings drawer
  await expect(page.locator(RAIL)).toHaveCount(0);

  await page.keyboard.press("Control+g");
  await expect(page.locator(RAIL)).toBeVisible();
  await page.keyboard.press("Control+g");
  await expect(page.locator(RAIL)).toHaveCount(0);

  // The old chord is dead, not a second door.
  await page.keyboard.press("Control+k");
  await expect(page.locator(RAIL)).toHaveCount(0);

  await page.reload();
  await page.keyboard.press("Control+g");
  await expect(page.locator(RAIL)).toBeVisible();
});

test("taking the only key off another action is REFUSED, and says which one", async ({ page }) => {
  // Sources holds exactly one chord, so binding Ctrl+K to Draw would leave Sources
  // unreachable from the keyboard with nothing on screen to say so. The refusal has to
  // be visible — a rejected keystroke that looks like a dropped one is the same bug.
  await stampSeen(page);
  await page.goto("/app");
  await openShortcuts(page);

  await page.getByRole("button", { name: /^Draw an area: Ctrl\+Q/ }).click();
  await page.keyboard.press("Control+k");

  const err = page.locator(".tn-keymap-err");
  await expect(err).toBeVisible();
  await expect(err).toContainText("Sources rail");
  await expect(page.getByRole("button", { name: /^Sources rail: Ctrl\+K/ })).toBeVisible();
});

test("an armed chip owns the arrow keys — they do not switch tab", async ({ page }) => {
  // The one regression the tabbed drawer can actually ship broken. The strip binds
  // ←/→/Home/End, and an armed shortcut chip claims every key it receives; if the arrow
  // handler ever moves onto `window` instead of the tablist element, arming a chip and
  // reaching for ← would silently change tab and unmount the row you were editing.
  //
  // Asserting the TAB, not the binding: whether ArrowRight ends up bound or refused is
  // keymap.ts's business and pinning it here would couple this test to RESERVED_CHORDS.
  await stampSeen(page);
  await page.goto("/app");
  await openShortcuts(page);

  await page.getByRole("button", { name: /^Draw an area: Ctrl\+Q/ }).click(); // arms
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Shortcuts" })).toHaveAttribute("aria-selected", "true");
});

test("Escape cancels arming without closing the drawer", async ({ page }) => {
  // Escape is ambiguous here by design, and the resolution is load-bearing: the chip's
  // stopPropagation is what keeps SettingsPanel's window listener from seeing it. Nothing
  // covered this before, and it is exactly the kind of thing a refactor quietly breaks.
  await stampSeen(page);
  await page.goto("/app");
  await openShortcuts(page);

  await page.getByRole("button", { name: /^Draw an area: Ctrl\+Q/ }).click();
  await page.keyboard.press("Escape");

  await expect(page.locator(".tn-settings")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Draw an area: Ctrl\+Q/ })).toBeVisible();

  // A second Escape, with nothing armed, closes it as it always did.
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-settings")).toHaveCount(0);
});

test("the drawer opens on Main, and the tabs are reachable by keyboard", async ({ page }) => {
  await stampSeen(page);
  await page.goto("/app");
  await page.locator(".tn-settings-trigger").click();

  await expect(page.getByRole("tab", { name: "Main" })).toHaveAttribute("aria-selected", "true");
  // Focus lands on the active tab, so the rail is one arrow press from anywhere.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("tab", { name: "Display" })).toHaveAttribute("aria-selected", "true");
  // Wraps at both ends rather than stopping dead.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("tab", { name: "Shortcuts" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /^Sources rail: Ctrl\+K/ })).toBeVisible();

  // ←/→ still step, because below 540px this same list is a horizontal strip and a user
  // who learned one axis must not find it dead at the other width.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Main" })).toHaveAttribute("aria-selected", "true");
});

test("the rail is a vertical tablist, and says so only while it is one", async ({ page }) => {
  await stampSeen(page);
  await page.goto("/app");
  await page.locator(".tn-settings-trigger").click();

  const rail = page.getByRole("tablist", { name: "Settings sections" });
  await expect(rail).toHaveAttribute("aria-orientation", "vertical");
  // The rail sits BESIDE the panel, not above it — the whole point of the layout. Comparing
  // boxes rather than asserting a width is what makes this survive a retune of either.
  const railBox = await rail.boundingBox();
  const panel = await page.locator("#tn-settings-panel").boundingBox();
  expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(panel!.x + 1);

  // Under the fold it lies down, and aria-orientation follows the CSS rather than lying.
  // SettingsPanel reads --tn-settings-axis back off the element for exactly this reason,
  // so this assertion is what proves the property and the @media block stayed in step.
  await page.setViewportSize({ width: 420, height: 900 });
  await expect(rail).toHaveAttribute("aria-orientation", "horizontal");
  const narrowRail = await rail.boundingBox();
  const narrowPanel = await page.locator("#tn-settings-panel").boundingBox();
  expect(narrowRail!.y + narrowRail!.height).toBeLessThanOrEqual(narrowPanel!.y + 1);
});

test("Restore puts every default back", async ({ page }) => {
  await stampSeen(page);
  await page.goto("/app");
  await openShortcuts(page);

  await page.getByRole("button", { name: /^Draw an area: Ctrl\+Q/ }).click();
  await page.keyboard.press("Control+g");
  await expect(page.getByRole("button", { name: /^Draw an area: Ctrl\+G/ })).toBeVisible();

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("button", { name: /^Draw an area: Ctrl\+Q/ })).toBeVisible();
});
