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
  await page.locator(".tn-settings-trigger").click();

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
  await page.locator(".tn-settings-trigger").click();

  await page.getByRole("button", { name: /^Draw an area: Ctrl\+Q/ }).click();
  await page.keyboard.press("Control+k");

  const err = page.locator(".tn-keymap-err");
  await expect(err).toBeVisible();
  await expect(err).toContainText("Sources rail");
  await expect(page.getByRole("button", { name: /^Sources rail: Ctrl\+K/ })).toBeVisible();
});

test("Restore puts every default back", async ({ page }) => {
  await stampSeen(page);
  await page.goto("/app");
  await page.locator(".tn-settings-trigger").click();

  await page.getByRole("button", { name: /^Draw an area: Ctrl\+Q/ }).click();
  await page.keyboard.press("Control+g");
  await expect(page.getByRole("button", { name: /^Draw an area: Ctrl\+G/ })).toBeVisible();

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("button", { name: /^Draw an area: Ctrl\+Q/ })).toBeVisible();
});
