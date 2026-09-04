import { test, expect } from "@playwright/test";

// The stage rail: four icon groups on the right edge of the map, one flyout open
// at a time, expanding leftward.
//
// WHY THIS FILE EXISTS AT ALL. vitest here is `environment: "node"` and collects
// `tests/unit/**/*.test.ts` only — .tsx is not collected and no React testing
// library is installed, so the rail's *rendered* behaviour cannot be tested
// anywhere else. tests/unit/map-rail.test.ts holds the pure reducers; everything
// that needs a DOM, a focus ring or a real map is here.
//
// Both localStorage stamps are copied from camslot-shots.spec.ts, for the reason
// stated there: the guided tour and the launch sequence are each a
// `position:fixed; inset:0` layer, so without them a click lands on an overlay
// instead of the control under it. The tour version is deliberately far above the
// current one so bumping the tour cannot silently re-arm the veil.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.tour.v1", JSON.stringify({ v: 1, d: { seenVersion: 99 } }));
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
  // `/app`, not `/`. CLAUDE.md is explicit that `/` is the marketing site and
  // `/app` is the console; several older specs in this directory open `/` and
  // assert console selectors, and fail on main for that reason.
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
});

const RAIL = "#map-rail";

/**
 * Wait until the map has a loaded style, not merely a canvas element.
 *
 * `.map-canvas` exists from the first render, so it proves nothing about the
 * engine. MapLibre only resolves the credit line once the style document (and, for
 * the OpenFreeMap vector basemaps, the TileJSON it points at) has come back — see
 * the attribution note in lib/basemaps.ts. So a non-empty credit is the earliest
 * honest signal that `getMapInstance()` will hand back a map that `startDraw` and
 * `setStyle` can actually use. The text is inside a collapsed control, hence
 * `toContainText` rather than `toBeVisible`.
 */
async function mapReady(page: import("@playwright/test").Page) {
  await expect(page.locator(".maplibregl-ctrl-attrib-inner")).toContainText(/\S/, {
    timeout: 30_000,
  });
}

/** The four groups, by the accessible name each button actually carries. */
const SEARCH = /Search for a place/;
const DRAW = /Restrict results to an area/;
const CAMERAS = /Pick cameras for a wall/;
const VIEW = /View settings/;

test("the rail is one toolbar of four groups, and opens one at a time", async ({ page }) => {
  const rail = page.locator(RAIL);
  await expect(rail).toBeVisible();
  // role=toolbar, never role=dialog: ConsoleShell's global keydown handler early
  // returns while any dialog is mounted, so a dialog-flavoured flyout would kill
  // "/" and Escape app-wide for as long as it was open.
  await expect(rail).toHaveAttribute("role", "toolbar");
  await expect(rail.getByRole("button")).toHaveCount(4);

  for (const name of [SEARCH, DRAW, CAMERAS, VIEW]) {
    await expect(rail.getByRole("button", { name })).toHaveAttribute("aria-expanded", "false");
  }

  await rail.getByRole("button", { name: VIEW }).click();
  await expect(rail.getByRole("button", { name: VIEW })).toHaveAttribute("aria-expanded", "true");

  // Opening another group REPLACES it rather than stacking. Asserted on the flyout
  // count, not on the button state, so a panel left mounted behind the new one
  // still fails.
  await rail.getByRole("button", { name: CAMERAS }).click();
  await expect(page.locator(".tnx-maprail-pop")).toHaveCount(1);
  await expect(rail.getByRole("button", { name: VIEW })).toHaveAttribute("aria-expanded", "false");

  // Clicking the open group closes it.
  await rail.getByRole("button", { name: CAMERAS }).click();
  await expect(page.locator(".tnx-maprail-pop")).toHaveCount(0);
});

test("the flyout expands LATERALLY, to the left of the button that opened it", async ({ page }) => {
  // The shape of the thing is the feature — a panel that opened as a narrow column
  // under the icon would satisfy every aria assertion above and still be the wrong
  // control. This measures it.
  const rail = page.locator(RAIL);
  const btn = rail.getByRole("button", { name: VIEW });
  await btn.click();

  const pop = page.locator(".tnx-maprail-pop");
  const p = await pop.boundingBox();
  const b = await btn.boundingBox();
  if (!p || !b) throw new Error("no box for the flyout or its button");

  // Entirely to the LEFT of the rail button.
  expect(p.x + p.width).toBeLessThanOrEqual(b.x + 1);
  // Wider than tall, and wider than the rail itself by a long way. The View group
  // carries the most content, so if any flyout is lateral it is this one.
  expect(p.width).toBeGreaterThan(p.height);
  expect(p.width).toBeGreaterThan(240);
  // Vertically aligned with its own button rather than with the rail's top.
  expect(Math.abs(p.y + p.height / 2 - (b.y + b.height / 2))).toBeLessThan(4);
});

test("View: 2D/3D and Dark/Light are ONE button each, and the map follows", async ({ page }) => {
  const rail = page.locator(RAIL);
  await rail.getByRole("button", { name: VIEW }).click();
  const pop = page.locator(".tnx-maprail-pop");

  // Exactly one projection chip, not a 2D|3D pair. The board's landing stage is
  // the globe, so the chip is labelled with the target: "2D".
  await expect(pop.getByRole("button", { name: /^(2D|3D)$/ })).toHaveCount(1);
  await expect(pop.getByRole("button", { name: "2D" })).toBeVisible();

  // Exactly one light/dark chip, likewise labelled with the target.
  await expect(pop.getByRole("button", { name: /^(Dark|Light)$/ })).toHaveCount(1);

  // Three standalone basemaps beside it. Five basemaps are reachable; two of them
  // share the pair chip.
  for (const n of ["Streets", "Sat", "Topo"]) {
    await expect(pop.getByRole("radio", { name: n })).toBeVisible();
  }

  // THE EFFECT, NOT THE BUTTON — the house rule from console.spec.ts, "so a button
  // that highlights without driving the map still fails". OpenTopoMap declares its
  // own credit on its source, so the attribution control is proof the style
  // actually swapped, and it is the one observable that cannot be faked by a
  // highlight. (The control is collapsed, so the text is in the DOM but hidden;
  // toContainText reads textContent and does not require visibility.)
  await pop.getByRole("radio", { name: "Topo" }).click();
  await expect(pop.getByRole("radio", { name: "Topo" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText(/OpenTopoMap/, {
    timeout: 15_000,
  });

  // The pair chip is not part of that radio group, and says so.
  await expect(pop.getByRole("button", { name: /^(Dark|Light)$/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("Search: the group opens focused, and / opens it from anywhere", async ({ page }) => {
  const rail = page.locator(RAIL);
  const input = page.locator("#stage-search input");

  await rail.getByRole("button", { name: SEARCH }).click();
  await expect(input).toBeFocused();

  // Escape closes it and hands focus back to the button that opened it.
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(rail.getByRole("button", { name: SEARCH })).toBeFocused();

  // "/" is the shortcut the search field advertises with its own prefix chip. It
  // has to open the group AND land in the input — before the rail there was
  // nothing to open, so this is a new path, not a preserved one.
  await page.locator(".map-canvas").click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("/");
  await expect(input).toBeFocused();
  // And the "/" itself must not be typed into the field it just opened.
  await expect(input).toHaveValue("");
});

test("Draw: clicking the map does not close the flyout that armed the gesture", async ({ page }) => {
  // The §1 regression guard. Draw exists to make the user click ON the map; a
  // plain close-on-outside-click would shut the panel on the very first vertex and
  // take the live counter and Cancel with it.
  const rail = page.locator(RAIL);
  await rail.getByRole("button", { name: DRAW }).click();

  const pop = page.locator(".tnx-maprail-pop");
  await pop.getByRole("button", { name: "Restrict results to area" }).click();

  const canvas = page.locator(".map-canvas");
  await canvas.click({ position: { x: 300, y: 200 } });

  await expect(pop).toBeVisible();
  await expect(pop.getByRole("status")).toContainText(/points/);
  await expect(pop.getByRole("button", { name: "Cancel" })).toBeVisible();

  // Escape abandons the RING, not the flyout — rung 1 of the ladder. The rail's
  // capture-phase listener stands down while a draw is running, so this key
  // reaches lib/map/aoi.ts and the panel is still there afterwards, back in its
  // idle state.
  await page.keyboard.press("Escape");
  await expect(pop).toBeVisible();
  await expect(pop.getByRole("button", { name: "Restrict results to area" })).toBeVisible();
});

test("the zoom cluster is gone and the ⓘ attribution is not", async ({ page }) => {
  // Two assertions that have to travel together. The zoom/compass cluster was
  // removed because the rail replaces it; the attribution was NOT, because
  // OpenStreetMap/OpenMapTiles (ODbL), Esri and OpenTopoMap all require the
  // credit — see lib/map/attribution.ts. Deleting it would be a licensing
  // regression that no other test would notice.
  await expect(page.locator(".maplibregl-ctrl-group")).toHaveCount(0);
  await expect(page.locator(".maplibregl-ctrl-attrib-button")).toBeVisible();
});

test("shots", async ({ page }) => {
  // Viewport, not fullPage: the map animates behind the board and a fullPage
  // capture reframes the page to catch it mid-flight.
  const rail = page.locator(RAIL);
  await page.setViewportSize({ width: 1440, height: 900 });
  await rail.getByRole("button", { name: VIEW }).click();
  await expect(page.locator(".tnx-maprail-pop")).toBeVisible();
  await page.screenshot({ path: "persona-shots/map-rail-view-desktop.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".tnx-maprail-pop")).toBeVisible();
  await page.screenshot({ path: "persona-shots/map-rail-view-phone.png" });
});
