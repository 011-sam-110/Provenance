// tests/e2e/console.spec.ts
import { test, expect } from "@playwright/test";

// The launch sequence (components/terminal/BootSequence.tsx) is a
// `position:fixed; inset:0` plate that owns the screen for five seconds on a first
// visit, so from load every click in the page lands on the plate instead of the
// control under it. Two of the tests below need real clicks and real key presses,
// and a test whose outcome depends on beating a five-second timer is a flake.
//
// Stamping the "seen" flag before the app boots is the deterministic fix: it is the
// envelope lib/shell/persist writes ({ v, d }) under the key lib/terminal/boot.ts
// reads, so the app is interactive from the first frame.
//
// There was a second stamp here, for the first-visit guided tour, which auto-opened
// ~900ms after load behind its own transparent veil. The tour is gone.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
});

test("/app opens on a bare globe — the landing board seeds NO widgets", async ({ page }) => {
  // INVERTED, not repaired. This asserted that the first run seeded a "World" preset
  // full of cards in segments, and it had been failing on two counts: it navigated to
  // "/", which is the marketing site rather than the console at "/app", and the
  // landing board it described no longer exists. Globe replaced it and is
  // DELIBERATELY empty (lib/console/presets.ts: "/app opens on a bare rotating globe
  // and nothing else"), so the honest test is the opposite of the one that was here.
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await expect(page.locator(".tn-cw")).toHaveCount(0);
  await expect(page.locator(".tnx-hdr-board.is-active")).toContainText("GLOBE");
});

test("the palette adds a widget instance", async ({ page }) => {
  // WAS "⌘K adds a widget instance", and ⌘K is not the palette's chord any more —
  // the keymap gave it to the Sources rail (lib/shell/keymap.ts), so pressing it
  // here would open a panel and never reach the palette. The palette kept its door,
  // it lost its shortcut; tests/e2e/sources-rail.spec.ts pins that trade from the
  // other side.
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  const before = await page.locator(".tn-cw").count();

  await page.locator(".tn-palette-trigger").click();
  // NOT getByPlaceholder(/Search/), which is a strict-mode violation: three inputs on
  // this page have a placeholder containing "Search" — the palette's "Search
  // actions…", the stage's "Search a place — drop a pin", and the Source Catalog
  // rail's "Search sources…". Narrowed to the palette's own copy rather than
  // `.first()`, so the test names the control it means instead of depending on DOM
  // order between three unrelated components.
  await page.getByPlaceholder(/Search actions/).fill("Add Aviation");
  await page.keyboard.press("Enter");

  // The palette does not place the widget itself any more — it closes and hands over
  // to the placement picker, which asks which rail the card belongs in. Pressing
  // Enter and expecting a card was the second thing stale about this test: the
  // command ran, the palette shut, and nothing appeared, which reads exactly like a
  // dead command.
  await expect(page.locator(".tn-place")).toBeVisible();
  await page.getByRole("radio", { name: "Left column" }).click();

  await expect(page.locator(".tn-cw")).toHaveCount(before + 1);
});

// THE "stage switch swaps the map projection" TEST IS DELETED, not rewritten.
//
// It drove `.tn-stage-switch`, the 3D/2D projection control. That control has been
// removed from the console along with the FEED HEALTH band it sat in, and
// components/console/StageSwitch.tsx was deleted with it — there is no button left
// for this test to click, so no selector change could save it.
//
// NOT REPLACED WITH A ⌘K EQUIVALENT, deliberately. The projection is still
// changeable from the command palette ("Stage → 3D map" / "Stage → 2D map", see
// CommandPalette.tsx), so the CAPABILITY is intact and a palette-driven test could
// be written. It is not written here because this spec was rotten in ways that had
// nothing to do with it: every test navigated to "/", the marketing site rather than
// the console at "/app", and it asserted on `.tnx-stage-bar` and `.tnx-stage-label`,
// two classes the stage's 22px top bar took with it when that band was removed.
//
// The three surviving tests were repaired when the guided tour came out, because one
// of them pressed ⌘K for the palette and that chord now belongs to the Sources rail.
// A projection test still is not written here.

// THE "WALL and CONSOLE re-lay the board" TEST IS REPLACED, and it is worth saying
// what it lost. It pressed "w" and "c" to drive a CONSOLE|WALL toggle in the header
// and asserted no widget was dropped between the two templates. That toggle is gone:
// `mode` is a property of the BOARD now (lib/console/presets.ts — Streets is the only
// `mode: "wall"` one), so there is no user control left to press and no pair of
// templates for one board to move between. The reducers that own a wall layout are
// covered by unit tests; what only a browser can still see is below.

test("switching boards keeps ONE map instance and lays out the new board", async ({ page }) => {
  // The invariant the old test asserted last and cared about least: the map is a
  // single mounted MapLibre instance across every board, never a remount. A board
  // switch that quietly tore the map down and rebuilt it would cost a full style and
  // tile load, lose the camera position, and look — from the outside — like a slow
  // board rather than a bug.
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await expect(page.locator(".tn-cw")).toHaveCount(0); // Globe is deliberately empty

  await page.getByRole("button", { name: /STREETS board/ }).click();
  await expect(page.locator(".tn-cw").first()).toBeVisible();
  const streets = await page.locator(".tn-cw").count();
  expect(streets).toBeGreaterThan(0);
  await expect(page.locator(".map-canvas")).toHaveCount(1);

  await page.getByRole("button", { name: /GLOBE board/ }).click();
  await expect(page.locator(".tn-cw")).toHaveCount(0);
  await expect(page.locator(".map-canvas")).toHaveCount(1);
});
