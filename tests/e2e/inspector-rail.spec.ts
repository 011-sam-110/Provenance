import { test, expect, type Page } from "@playwright/test";

// The INSPECTOR TOOL RAIL: Search, View, Map settings and Draw, on the right edge of
// the Sources rail's INSPECTOR tab. It replaces tests/e2e/map-rail.spec.ts, which
// covered the two icon groups that used to float on the map's right edge — those
// buttons moved here on 2026-09-16, and Draw an area moved with them off the Sources
// tab. The cases below are that file's assertions repointed at the new surface, plus
// the two claims the move itself makes: that a tool TAKES the panel rather than
// covering it, and that the map's edge is now plain map.
//
// WHY THIS FILE EXISTS AT ALL. vitest here is `environment: "node"` and collects
// `tests/unit/**/*.test.ts` only — .tsx is not collected and no React testing library
// is installed, so the rail's *rendered* behaviour cannot be tested anywhere else.
// tests/unit/inspector-rail.test.ts holds the pure reducers; everything that needs a
// DOM, a focus ring or a real map is here.
//
// The localStorage stamp is copied from inspector-areas.spec.ts, for the reason stated
// there: the launch sequence is a `position:fixed; inset:0` layer, so without it a
// click lands on the plate instead of the control under it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
    // ONE AREA, so the Sources tab has an areas LIST — which is also the only
    // remaining way to open an object without depending on what the globe happens to
    // be drawing. Its row calls overlay.open(), which is the door a map click uses.
    //
    // SEEDED ONLY IF ABSENT, and that guard is load-bearing for the colour test: this
    // script runs on EVERY navigation, reloads included, so an unconditional write
    // would put the colourless area back over whatever the app had just saved — and
    // "the colour survives a reload" would then be asserting the seed rather than the
    // app.
    if (window.localStorage.getItem("tn.inspector.v1")) return;
    window.localStorage.setItem(
      "tn.inspector.v1",
      JSON.stringify({
        v: 1,
        d: {
          world: {},
          editing: null,
          areas: [
            {
              id: "area:1",
              label: "West Pacific",
              polygon: [[90, -60], [180, -60], [180, 70], [90, 70]],
              bbox: [90, -60, 180, 70],
              createdAt: 1,
              sources: { earthquakes: true },
            },
          ],
        },
      }),
    );
  });
  // `/app`, not `/`. CLAUDE.md is explicit that `/` is the marketing site and `/app`
  // is the console.
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
});

const RAIL = "#inspector-rail";

/** Open the console's left rail and point it at the Inspector tab. */
async function openInspector(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".tn-rail")).toBeVisible();
  await page.click("#tn-rail-tab-inspector");
  await expect(page.locator(RAIL)).toBeVisible();
}

/** The rail's slots, in render order, as the store's own ids. */
function slots(page: Page): Promise<string[]> {
  return page.locator(`${RAIL} button`).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.slot ?? "?"),
  );
}

/**
 * Select an object through the UI. The seeded area's row is the only opener that does
 * not depend on what the globe happens to be drawing, and since the areas block moved
 * onto the rail it lives in the Draw tool's panel — its own test asserts that.
 *
 * The row calls overlay.open(), which points the rail at the Inspector AND closes any
 * open tool (see lib/overlay.ts), so this lands on the object's own view with the eye
 * filled in.
 */
async function selectArea(page: Page) {
  await page.click(`${RAIL} .tn-insp-rail-btn-draw`);
  await expect(page.locator(".tn-insp-row")).toHaveCount(1);
  await page.click(".tn-insp-row");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);
}

test("the rail is one toolbar, it is on BOTH tabs, and the eye waits for a selection", async ({
  page,
}) => {
  // The rail belongs to the PANEL, not to the Inspector tab — Sam's second pass:
  // "the buttons on the right should exist on both sources and inspector".
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".tn-rail")).toBeVisible();
  await expect(page.locator(RAIL)).toBeVisible();
  await expect(page.locator("#tn-rail-tab-sources")).toHaveAttribute("aria-selected", "true");

  await page.click("#tn-rail-tab-inspector");
  const rail = page.locator(RAIL);
  // role=toolbar, never role=dialog: ConsoleShell's global keydown handler early
  // returns while any dialog is mounted, so a dialog-flavoured rail would kill the
  // console's Escape ladder app-wide.
  await expect(rail).toHaveAttribute("role", "toolbar");

  // FOUR, and the names are asserted separately so a missing one reads as a missing
  // one. Draw and Alerts are below the rule and open panels like the rest.
  expect(await slots(page)).toEqual(["search", "settings", "draw", "alerts"]);
  await expect(rail.getByRole("button", { name: "Search for a place" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Map settings" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Draw an area" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Notifications" })).toBeVisible();
  // Sam's rule from the mockups: the eye APPEARS when a map click gives it something
  // to show. An eye with nothing to view is a button that opens an empty pane.
  await expect(rail.getByRole("button", { name: "View" })).toHaveCount(0);
});

test("a rail button clicked from the Sources tab lands on the Inspector with that tool", async ({
  page,
}) => {
  // "If any of the buttons on the right rail are clicked, it should automatically
  // take you to the inspector page, and that button." The rail is mounted outside
  // both tab panels precisely so this can be true from either of them.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator("#tn-rail-tab-sources")).toHaveAttribute("aria-selected", "true");

  await page.click(`${RAIL} .tn-insp-rail-btn-settings`);
  await expect(page.locator("#tn-rail-tab-inspector")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".tn-insp-switch")).toHaveCount(2);
  await expect(page.locator(`${RAIL} .tn-insp-rail-btn-settings`)).toHaveAttribute("aria-pressed", "true");

  // And it is not a one-off for one button: Draw behaves the same way, which is the
  // path a user takes most often from the Sources tab.
  await page.click("#tn-rail-tab-sources");
  await expect(page.locator("#tn-rail-tab-sources")).toHaveAttribute("aria-selected", "true");
  await page.click(`${RAIL} .tn-insp-rail-btn-draw`);
  await expect(page.locator("#tn-rail-tab-inspector")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".tn-insp-draw")).toBeVisible();
});

test("a tool TAKES the panel body — it is not a card over the object", async ({ page }) => {
  await openInspector(page);
  const rail = page.locator(RAIL);

  // Open an object first, so there is something a card could have covered.
  await selectArea(page);

  // The eye is here now, and it is the current view.
  expect(await slots(page)).toEqual(["search", "view", "settings", "draw", "alerts"]);
  await expect(rail.getByRole("button", { name: "View" })).toHaveAttribute("aria-pressed", "true");

  // Open Map settings. Option D, and the assertion is an ABSENCE on purpose: if the
  // tool were a card over the dossier (option A, the first mockup) the dialog would
  // still be mounted underneath it, and every aria assertion about the tool would
  // still pass. The panel shows one thing at a time.
  await rail.getByRole("button", { name: "Map settings" }).click();
  await expect(page.locator(".tn-insp-switch")).toHaveCount(2);
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(0);

  // Opening another tool REPLACES it rather than stacking.
  await rail.getByRole("button", { name: "Search for a place" }).click();
  await expect(page.locator("#inspector-search input")).toBeVisible();
  await expect(page.locator(".tn-insp-switch")).toHaveCount(0);

  // Clicking the open tool again puts the object's view back. THAT IS THE ONLY WAY
  // OUT BESIDES ESCAPE, since the ✕ left this panel's head on Sam's ask — it competed
  // with the title it sat beside, and the button that opened the tool is the control
  // the user already has in hand.
  await expect(page.locator(".tn-insp-tool-close")).toHaveCount(0);
  await rail.getByRole("button", { name: "Search for a place" }).click();
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);
  await expect(rail.getByRole("button", { name: "View" })).toHaveAttribute("aria-pressed", "true");
});

test("Map settings: a projection pair, three basemap radios, and the map follows", async ({
  page,
}) => {
  await openInspector(page);
  await page.locator(RAIL).getByRole("button", { name: "Map settings" }).click();
  const tool = page.locator(".tn-insp-tool");

  // A SEGMENTED PAIR NOW, both states visible, the current one checked. The first
  // version was ONE button labelled with what you would get, and its stated reason was
  // width — which this panel has. `aria-checked` rather than a changed label, so a
  // screen reader is told which is on instead of inferring it from wording.
  const projection = tool.getByRole("radiogroup", { name: "Projection" });
  await expect(projection.getByRole("radio")).toHaveCount(2);
  // The board's landing stage is the globe, so 3D is the checked one.
  await expect(projection.getByRole("radio", { name: "3D" })).toHaveAttribute("aria-checked", "true");
  await projection.getByRole("radio", { name: "2D" }).click();
  await expect(projection.getByRole("radio", { name: "2D" })).toHaveAttribute("aria-checked", "true");
  await expect(projection.getByRole("radio", { name: "3D" })).toHaveAttribute("aria-checked", "false");

  // THE DARK/LIGHT PAIR IS GONE and its absence is asserted rather than dropped: Dark
  // and Positron left the basemap registry with the console's dark skin, so an option
  // offering either would mean the removal was incomplete.
  await expect(tool.getByRole("button", { name: /^(Dark|Light)$/ })).toHaveCount(0);

  // A RADIOGROUP, not a strip of chips — the rail is a column now and each basemap is
  // a full-width row. Full names, so the abbreviations the lateral strip needed are
  // gone with it (lib/console/viewControls.ts).
  //
  // SCOPED TO ITS OWN GROUP, since the projection above is a radiogroup too: an
  // unscoped `getByRole("radio")` would count five and pass while one of them was
  // missing.
  const basemaps = tool.getByRole("radiogroup", { name: "Basemap" });
  for (const n of ["Streets", "Satellite", "Topographic"]) {
    await expect(basemaps.getByRole("radio", { name: n })).toBeVisible();
  }
  await expect(basemaps.getByRole("radio")).toHaveCount(3);

  // THE EFFECT, NOT THE BUTTON — the house rule from console.spec.ts, "so a button
  // that highlights without driving the map still fails". OpenTopoMap declares its own
  // credit on its source, so the attribution control is proof the style actually
  // swapped, and it is the one observable a highlight cannot fake. (The control is
  // collapsed, so the text is in the DOM but hidden; toContainText reads textContent
  // and does not require visibility.)
  await basemaps.getByRole("radio", { name: "Topographic" }).click();
  await expect(basemaps.getByRole("radio", { name: "Topographic" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText(/OpenTopoMap/, {
    timeout: 15_000,
  });
});

test("Search opens focused, Escape hands focus back, and ; opens the whole panel", async ({ page }) => {
  await openInspector(page);
  const rail = page.locator(RAIL);
  const input = page.locator("#inspector-search input");

  await rail.getByRole("button", { name: "Search for a place" }).click();
  await expect(input).toBeFocused();

  // Escape closes the TOOL and hands focus back to the button that opened it. It must
  // not close anything else on the same press — the rail's handler is capture-phase
  // and stops propagation precisely so one key does one thing.
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "Search for a place" })).toBeFocused();

  // ";" is the search shortcut and it has to get all the way here: open the collapsed
  // rail, point it at the Inspector, open the tool and land in the input. It was "/"
  // until the keymap landed; "/" shadows Firefox's quick-find, which is a browser
  // default worth leaving alone now that a plain ";" does the job.
  // tests/e2e/shortcuts.spec.ts owns the rest of the keymap; this case stays here
  // because it is about the RAIL — that the shortcut reaches the tool, not just the
  // store.
  await page.click(".tn-rail-collapse");
  await expect(page.locator(".tn-rail-fab")).toBeVisible();
  // Pressed at the BODY rather than after clicking the map, and that is not
  // squeamishness: a bare map click selects whatever is under it and opens a dialog,
  // and ConsoleShell hands Escape back to any mounted dialog on purpose.
  await page.locator("body").press(";");
  await expect(page.locator(".tn-rail")).toBeVisible();
  await expect(page.locator("#tn-rail-tab-inspector")).toHaveAttribute("aria-selected", "true");
  await expect(input).toBeFocused();
  // And the ";" itself must not be typed into the field it just opened.
  await expect(input).toHaveValue("");
});

test("Escape closes the tool first, then the object", async ({ page }) => {
  // The ladder, end to end, because it is asserted in two files and lives in three:
  // lib/map/aoi.ts owns rung 1 for a live draw, InspectorRail owns rung 2, and
  // InspectorPanel plus ConsoleShell own rung 3. A single unsequenced press that did
  // both jobs would be the bug — closing the tool AND dropping the user's selection.
  await openInspector(page);
  await selectArea(page);

  await page.locator(RAIL).getByRole("button", { name: "Search for a place" }).click();
  await expect(page.locator("#inspector-search input")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#inspector-search input")).toHaveCount(0);
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(0);
  // A closed inspection returns the rail to Sources, which is what the ✕ says it does.
  await expect(page.locator("#tn-rail-tab-sources")).toHaveAttribute("aria-selected", "true");
});

test("Draw opens a panel, and the gesture starts from the button inside it", async ({ page }) => {
  // TWO CLICKS, ON PURPOSE. Sam: "when you click the draw area button on the
  // inspector, it shouldnt just automatically start drawing an area. A user should
  // click draw area on that page." So the rail's button is the way IN to the tool,
  // and the tool's own button arms the map.
  await openInspector(page);

  // The Sources tab no longer carries the areas block at all — it moved onto the
  // rail with the button that creates them.
  await page.click("#tn-rail-tab-sources");
  await expect(page.locator(".tn-insp-draw")).toHaveCount(0);
  await expect(page.locator(".tn-insp-row")).toHaveCount(0);
  // ...nor does the context switcher's menu, which lost its action row in the first
  // pass and has not grown one back.
  await page.click(".tn-ctxbar");
  await expect(page.locator(".tn-ctxbar-draw")).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /Draw an area/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.click("#tn-rail-tab-inspector");
  const draw = page.locator(`${RAIL} .tn-insp-rail-btn-draw`);

  // FIRST CLICK — the panel, and nothing armed. The banner over the map is the
  // observable that would appear if the gesture had started, so its absence is the
  // assertion that the rail button no longer arms anything.
  await draw.click();
  await expect(page.locator(`${RAIL} .tn-insp-rail-btn-draw`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".tn-insp-tool-title")).toHaveText(/Draw an area/i);
  await expect(page.locator(".tn-drawbanner")).toHaveCount(0);
  await expect(page.locator(".map-canvas canvas").first()).not.toHaveCSS("cursor", "crosshair");

  // The areas block is this panel's body, seeded area and all.
  await expect(page.locator(".tn-insp-row")).toHaveCount(1);
  await expect(page.locator(".tn-insp-label")).toHaveText("West Pacific");

  // SECOND CLICK — the gesture. Two observables on purpose: the banner proves the
  // app believes a draw is running, the crosshair proves the MAP does. A button that
  // sets a store and never reaches MapLibre would satisfy the first alone.
  const start = page.locator(".tn-insp-draw");
  await expect(start).toHaveText(/Draw an area/);
  await start.click();
  await expect(page.locator(".tn-drawbanner")).toBeVisible();
  await expect(page.locator(".tn-drawbanner")).toContainText(/Drawing an area/);
  await expect(start).toHaveAttribute("aria-pressed", "true");
  await expect(start).toContainText(/Drawing/);
  await expect(page.locator(".map-canvas canvas").first()).toHaveCSS("cursor", "crosshair");

  // Escape abandons the ring — and it has to do that rather than close the panel or
  // drop the map selection, which is the ladder the rail's capture-phase handler
  // stands down for.
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-drawbanner")).toHaveCount(0);
  await expect(page.locator(".tn-insp-draw")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".tn-insp-tool")).toHaveCount(1);
});

test("the map's right edge is plain map now, and the ⓘ attribution is not", async ({ page }) => {
  // Two assertions that have to travel together. The stage rail, the zoom/compass
  // cluster and the centred search box are all gone from the stage — the map's own
  // controls live on the Inspector tab now. The attribution was NOT removed, because
  // OpenStreetMap/OpenMapTiles (ODbL), Esri and OpenTopoMap all require the credit
  // (lib/map/attribution.ts); deleting it would be a licensing regression that no
  // other test would notice.
  await expect(page.locator("#map-rail")).toHaveCount(0);
  await expect(page.locator(".tnx-maprail")).toHaveCount(0);
  await expect(page.locator(".maplibregl-ctrl-group")).toHaveCount(0);
  await expect(page.locator(".maplibregl-ctrl-attrib-button")).toBeVisible();

  // On a phone the mobile pass grows that button to a 44px tap target, and MapLibre
  // paints its mark as a 24px background-image with no `background-repeat` of its own
  // — so the default `repeat` tiled ONE icon into a 2x2 grid of them. Pinned here
  // because it is invisible to every other kind of test: the DOM is identical either
  // way.
  await page.setViewportSize({ width: 390, height: 844 });
  const btn = page.locator(".maplibregl-ctrl-attrib-button");
  await expect(btn).toHaveCount(1);
  await expect(btn).toHaveCSS("background-repeat", "no-repeat");

  // AND THE RAIL SURVIVES THE NARROW PASS. The panel becomes a bottom sheet at this
  // width; hiding the tool column with it would take the search box, the map settings
  // and the only draw entry point off a phone — the strictly bigger loss the retired
  // stage rail's own mobile pass already argued about once.
  await openInspector(page);
  const search = page.locator(`${RAIL} .tn-insp-rail-btn-search`);
  await expect(search).toBeVisible();
  const box = await search.boundingBox();
  if (!box) throw new Error("the search button has no box on a phone");
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(box.height).toBeGreaterThanOrEqual(40);
});

test("areas are renamed from the Draw panel, and Escape puts it back", async ({ page }) => {
  await openInspector(page);
  await page.click(`${RAIL} .tn-insp-rail-btn-draw`);
  await page.waitForSelector(".tn-insp-row-edit", { timeout: 10_000 });
  await expect(page.locator(".tn-insp-label")).toHaveText("West Pacific");

  // The pencil replaces the row with a field holding the current name.
  await page.click(".tn-insp-row-edit");
  const field = page.locator(".tn-insp-rename");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("West Pacific");

  // ESCAPE PUTS THE OLD NAME BACK AND LEAVES THE PANEL OPEN. That second half is the
  // rung-0 case in the rail's ladder: its Escape handler is capture phase, so without
  // the stand-down this key would close the whole panel instead of the field.
  await field.fill("Cancelled name");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(page.locator(".tn-insp-tool")).toHaveCount(1);
  await expect(page.locator(".tn-insp-label")).toHaveText("West Pacific");

  // Enter commits, and the name is trimmed.
  await page.click(".tn-insp-row-edit");
  await page.locator(".tn-insp-rename").fill("  North Atlantic watch  ");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tn-insp-rename")).toHaveCount(0);
  await expect(page.locator(".tn-insp-label")).toHaveText("North Atlantic watch");

  // ONE NAME, EVERYWHERE IT IS PRINTED: the row, the dossier header, the dossier's own
  // field, and the context switcher's trigger all read the same store. A rename that
  // landed in only one of them would be four names for one area.
  await page.click(".tn-insp-row-main");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveAttribute(
    "aria-label",
    "North Atlantic watch",
  );
  await expect(page.locator("[data-tn-area-label]")).toHaveValue("North Atlantic watch");

  // A BLANK NAME REVERTS rather than saving, because the label is the only thing
  // identifying the row in four places at once.
  await page.click(".tn-inspector-close");
  await page.click(`${RAIL} .tn-insp-rail-btn-draw`);
  await page.click(".tn-insp-row-edit");
  await page.locator(".tn-insp-rename").fill("   ");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tn-insp-label")).toHaveText("North Atlantic watch");
});

test("the rail's marks are big enough to hit and to read", async ({ page }) => {
  // Sam asked for the icons "50% bigger" and the number is 18px → 27px, but the
  // assertion is on the RENDERED box rather than on the token: a future rule that
  // sizes `.tn-insp-rail-btn svg` from somewhere else would leave the token correct
  // and the mark small, which is the failure this is for.
  await openInspector(page);
  const glyph = page.locator(`${RAIL} .tn-insp-rail-btn-search svg`);
  const box = await glyph.boundingBox();
  if (!box) throw new Error("the search glyph has no box");
  expect(box.width).toBeGreaterThanOrEqual(26);
  expect(box.height).toBeGreaterThanOrEqual(26);

  // And the button around it grew with the mark, or the fill would be a hairline.
  const btn = await page.locator(`${RAIL} .tn-insp-rail-btn-search`).boundingBox();
  if (!btn) throw new Error("the search button has no box");
  expect(btn.width).toBeGreaterThanOrEqual(40);
  expect(box.width / btn.width).toBeLessThan(0.72);
});

test("the panel's hierarchy is measurable, not just intended", async ({ page }) => {
  // Sam's brief was about visual weight, and visual weight is exactly the kind of
  // thing a later retune undoes without noticing. So the three claims are MEASURED:
  // the title outweighs a section heading, a section heading outweighs the rows under
  // it, and the rows are indented past the heading they belong to.
  await openInspector(page);
  await page.click(`${RAIL} .tn-insp-rail-btn-settings`);

  const css = (sel: string, prop: string) =>
    page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

  const titleSize = parseFloat(await css(".tn-insp-tool-title", "font-size"));
  const titleWeight = parseInt(await css(".tn-insp-tool-title", "font-weight"), 10);
  const headSize = parseFloat(await css(".tn-insp-group .tn-src-sec-head", "font-size"));
  const headWeight = parseInt(await css(".tn-insp-group .tn-src-sec-head", "font-weight"), 10);
  const rowWeight = parseInt(await css(".tn-insp-field-label", "font-weight"), 10);

  expect(titleSize).toBeGreaterThan(headSize);
  expect(titleWeight).toBeGreaterThanOrEqual(700);
  // THE HEADING IS NOT MERELY BOLDER TEXT — it carries its own surface, which is what
  // separates it from the rows rather than a 1px step in weight.
  expect(await css(".tn-insp-group .tn-src-sec-head", "background-color")).not.toBe(
    "rgba(0, 0, 0, 0)",
  );
  expect(headWeight).toBeGreaterThan(rowWeight);

  // The rows sit inside the section, to the right of their heading.
  const head = await page.locator(".tn-insp-group .tn-src-sec-head").first().boundingBox();
  const row = await page.locator(".tn-insp-group .tn-insp-field").first().boundingBox();
  if (!head || !row) throw new Error("no box for the heading or its first row");
  expect(row.x).toBeGreaterThan(head.x + 4);

  // The ✕ that competed with the title is gone.
  await expect(page.locator(".tn-insp-tool-close")).toHaveCount(0);
});

test("Alerts is its own rail button AND its own group, and the Draw panel is only areas", async ({
  page,
}) => {
  // IT WAS A SECTION INSIDE THE DRAW PANEL, for one round. Sam: "i cant see the alerts
  // and bell" — which is the whole argument for it being a tool. Then it was a BUTTON
  // IN THE DRAW GROUP for one build, and he reported that too: "the alerts isnt its own
  // separate section, its part of the drawing". Both halves are asserted here, because
  // both were wrong in turn.
  await openInspector(page);
  await expect(page.locator(`${RAIL} .tn-insp-rail-btn-alerts`)).toHaveCount(1);

  // ITS OWN GROUP: a rule above the bell, and none directly above it inside a block
  // with the polygon button. The rule is the only thing on the column saying where one
  // idea stops and the next starts.
  const groups = await page.locator(`${RAIL} .tn-insp-rail-cell`).evaluateAll((els) =>
    els.map((el) => ({
      slot: (el.querySelector("button") as HTMLElement | null)?.dataset.slot ?? "?",
      rule: !!el.querySelector(".tn-insp-rail-rule"),
    })),
  );
  expect(groups).toEqual([
    { slot: "search", rule: false },
    { slot: "settings", rule: false },
    { slot: "draw", rule: true },
    { slot: "alerts", rule: true },
  ]);

  await page.click(`${RAIL} .tn-insp-rail-btn-alerts`);
  await expect(page.locator(".tn-insp-tool-title")).toHaveText(/Notifications/i);
  // The composer is here, in a section of its own panel.
  const alerts = page.locator(".tn-insp-group", { has: page.getByText("Alerts", { exact: true }) });
  await expect(alerts).toHaveCount(1);
  await expect(alerts.locator(".tn-alert")).toHaveCount(1);
  await expect(alerts.locator(".tn-alert-head")).toBeVisible();

  // The Draw panel is the areas list and nothing else now.
  await page.click(`${RAIL} .tn-insp-rail-btn-draw`);
  await expect(page.locator(".tn-insp-tool-title")).toHaveText(/Draw an area/i);
  await expect(page.locator(".tn-alert")).toHaveCount(0);
  await expect(page.locator(".tn-insp-group")).toHaveCount(1);
});

test("an area's colour can be changed, and the MAP is what changes", async ({ page }) => {
  await openInspector(page);
  await page.click(`${RAIL} .tn-insp-rail-btn-draw`);
  await page.waitForSelector(".tn-insp-row-color", { timeout: 10_000 });

  // The swatch shows the area's colour, so the list and the map agree before anything
  // is clicked.
  const swatch = page.locator(".tn-insp-row-color");
  await expect(swatch).toHaveCSS("--c", "#0ea5e9");

  await swatch.click();
  const pop = page.locator(".tn-insp-color-pop");
  await expect(pop).toBeVisible();
  await expect(pop.getByRole("radio")).toHaveCount(8);
  await expect(pop.getByRole("radio", { name: "Sky" })).toHaveAttribute("aria-checked", "true");

  await pop.getByRole("radio", { name: "Amber" }).click();
  await expect(swatch).toHaveCSS("--c", "#f59e0b");

  // THE EFFECT, NOT THE SWATCH — the house rule from console.spec.ts, "so a button that
  // highlights without driving the map still fails". The colour travels to MapLibre as a
  // FEATURE PROPERTY on the areas source, which is what makes one area's change one
  // area's change; so the assertion is on the data MapLibre is holding, not on the
  // layers (whose paint expression is the same for every colour by design).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = (window as unknown as { __map?: unknown }).__map as
            | {
                getSource: (id: string) =>
                  | { serialize?: () => { data?: { features?: { properties?: Record<string, unknown> }[] } } }
                  | undefined;
              }
            | undefined;
          const f = map?.getSource("aoi-areas")?.serialize?.().data?.features?.[0];
          return f?.properties?.color ?? null;
        }),
      { message: "the areas source never carried the chosen colour" },
    )
    .toBe("#f59e0b");

  // AND IT SURVIVES A RELOAD, because the colour belongs to the persisted area rather
  // than being a view setting.
  await page.reload();
  await page.waitForSelector(".map-canvas", { timeout: 30_000 });
  await openInspector(page);
  await page.click(`${RAIL} .tn-insp-rail-btn-draw`);
  await expect(page.locator(".tn-insp-row-color")).toHaveCSS("--c", "#f59e0b");
});

test("Escape closes the colour picker and leaves the panel open", async ({ page }) => {
  // Rung 0 of the rail's Escape ladder, for the second surface that uses it. Capture
  // phase means the rail sees the key first, so without the stand-down Escape here would
  // close the whole Draw panel instead of the popover.
  await openInspector(page);
  await page.click(`${RAIL} .tn-insp-rail-btn-draw`);
  await page.click(".tn-insp-row-color");
  const pop = page.locator(".tn-insp-color-pop");
  await expect(pop).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(page.locator(".tn-insp-tool")).toHaveCount(1);
  await expect(page.locator(".tn-insp-tool-title")).toHaveText(/Draw an area/i);
});

test("shots", async ({ page }) => {
  // Viewport, not fullPage: the map animates behind the board and a fullPage capture
  // reframes the page to catch it mid-flight.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openInspector(page);
  await page.screenshot({ path: "persona-shots/inspector-rail-desktop.png" });

  await page.locator(RAIL).getByRole("button", { name: "Map settings" }).click();
  await page.mouse.move(900, 720);
  await expect(page.locator(".tn-insp-switch")).toHaveCount(2);
  await page.screenshot({ path: "persona-shots/inspector-rail-settings-desktop.png" });
});
