// tests/e2e/console.spec.ts
import { test, expect } from "@playwright/test";

// The first-visit guided tour auto-opens ~900ms after load, and `.tn-tour-veil` is a
// `position:fixed; inset:0` transparent layer — so from that moment every click in
// the page lands on the veil instead of the control under it. Two of the tests below
// need real clicks and real key presses, and a test whose outcome depends on beating
// a 900ms timer is a flake, not a test.
//
// Stamping the "seen" flag before the app boots is the deterministic fix: it is the
// same envelope lib/shell/persist writes ({ v, d }) under the key lib/shell/tour
// reads, so tourStore.hydrate() finds TOUR_VERSION already seen and
// maybeAutoStart() returns without opening anything. The tour itself is unaffected
// and still reachable from ⌘K and the profile menu; this only declines the auto-run.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.tour.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
});

test("first-run seeds the World preset with widgets in segments", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tn-cw").first()).toBeVisible();
  await expect(page.locator('[data-segment="left"] .tn-cw')).not.toHaveCount(0);
});

test("⌘K adds a widget instance", async ({ page }) => {
  await page.goto("/");
  // Wait for the seeded board before counting. `count()` does NOT retry — it is a
  // one-shot query — so reading it straight after goto() captured 0 on a cold load
  // and the assertion below then demanded exactly 1 widget while the first-run
  // preset was busy rendering its eight. Anchoring on the first widget being
  // visible is the same gate the seeding test above uses.
  await expect(page.locator(".tn-cw").first()).toBeVisible();
  const before = await page.locator(".tn-cw").count();
  await page.keyboard.press("Control+k");
  // WAS getByPlaceholder(/Search/), which is a strict-mode violation: three inputs on
  // this page have a placeholder containing "Search" — the palette's "Search
  // actions…", the stage's "Search a place — drop a pin", and the Source Catalog
  // rail's "Search sources…". Narrowed to the palette's own copy rather than
  // `.first()`, so the test names the control it means instead of depending on DOM
  // order between three unrelated components.
  await page.getByPlaceholder(/Search actions/).fill("Add Aviation");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tn-cw")).toHaveCount(before + 1);
});

test("the stage switch swaps the map projection", async ({ page }) => {
  // WAS "stage switch swaps to the world clock", clicking a 🕐 button and expecting
  // `.tn-clock`. That stage was retired before this change — StageSwitch has offered
  // only 3D/2D since, and the world clock became a map overlay (it is now the
  // Terminal stage's bottom bar) — so the test could not pass at any commit on this
  // branch. Rewritten to assert what the control actually does: the projection, read
  // back off the Terminal stage bar's own live readout rather than off the button we
  // just clicked, so a button that highlights without driving the map still fails.
  await page.goto("/");
  await expect(page.locator(".tnx-stage-bar")).toBeVisible();

  await page.locator(".tn-stage-switch button", { hasText: "3D" }).click();
  await expect(page.locator(".tnx-stage-label")).toHaveText(/GLOBE/);

  await page.locator(".tn-stage-switch button", { hasText: "2D" }).click();
  await expect(page.locator(".tnx-stage-label")).toHaveText(/FLAT/);
});

test("WALL and CONSOLE re-lay the board without losing a widget", async ({ page }) => {
  // WAS "collapsing the left segment hides its widgets", which dragged `.tn-grip`.
  // The Terminal grid has fixed column tracks (lib/terminal/grid), so the column
  // splitters are gone — a splitter that cannot move anything is a control that
  // lies. The mode toggle is what re-lays the board now, and the property worth
  // pinning is the one a layout rewrite is most likely to break quietly: no widget
  // may be dropped on the way between the two templates.
  //
  // Worth noting what the old assertion actually checked: `toHaveCSS("width",
  // /0px|(\d|10|20)px/)` matches "300px" too, because "300px" contains "0px" — so it
  // passed whether or not the drag did anything.
  await page.goto("/");
  await expect(page.locator(".tn-cw").first()).toBeVisible();
  const before = await page.locator(".tn-cw").count();
  expect(before).toBeGreaterThan(0);

  await page.keyboard.press("w");
  await expect(page.locator(".tnx-hdr-mode-btn.is-active")).toHaveText("WALL");
  await expect(page.locator(".tn-cw")).toHaveCount(before);

  await page.keyboard.press("c");
  await expect(page.locator(".tnx-hdr-mode-btn.is-active")).toHaveText("CONSOLE");
  await expect(page.locator(".tn-cw")).toHaveCount(before);
  // The map is a single mounted instance across both modes — the mode switch is a
  // style change on the grid container, never a remount.
  await expect(page.locator(".map-canvas")).toHaveCount(1);
});
