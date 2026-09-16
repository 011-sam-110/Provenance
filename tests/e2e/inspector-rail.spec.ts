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

test("the rail is one toolbar, and the eye does not exist until something is selected", async ({
  page,
}) => {
  await openInspector(page);
  const rail = page.locator(RAIL);
  // role=toolbar, never role=dialog: ConsoleShell's global keydown handler early
  // returns while any dialog is mounted, so a dialog-flavoured rail would kill the
  // console's Escape ladder app-wide for as long as the tab was open.
  await expect(rail).toHaveAttribute("role", "toolbar");

  // THREE, and the names are asserted separately so a missing one reads as a missing
  // one. Draw is below the rule and is an ACTION rather than a tool — it is a button
  // on this toolbar all the same.
  expect(await slots(page)).toEqual(["search", "settings", "draw"]);
  await expect(rail.getByRole("button", { name: "Search for a place" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Map settings" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Draw an area" })).toBeVisible();
  // Sam's rule from the mockups: the eye APPEARS when a map click gives it something
  // to show. An eye with nothing to view is a button that opens an empty pane.
  await expect(rail.getByRole("button", { name: "View" })).toHaveCount(0);
});

test("a tool TAKES the panel body — it is not a card over the object", async ({ page }) => {
  await openInspector(page);
  const rail = page.locator(RAIL);

  // Open an object first, so there is something a card could have covered.
  await page.click("#tn-rail-tab-sources");
  await page.click(".tn-insp-row");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);

  // The eye is here now, and it is the current view.
  expect(await slots(page)).toEqual(["search", "view", "settings", "draw"]);
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

  // Clicking the open tool again, or its ✕, puts the object's view back.
  await page.click(".tn-insp-tool-close");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);
  await expect(rail.getByRole("button", { name: "View" })).toHaveAttribute("aria-pressed", "true");
});

test("Map settings: 2D/3D is ONE button, three basemaps are radios, and the map follows", async ({
  page,
}) => {
  await openInspector(page);
  await page.locator(RAIL).getByRole("button", { name: "Map settings" }).click();
  const tool = page.locator(".tn-insp-tool");

  // Exactly one projection button, not a 2D|3D pair. The board's landing stage is the
  // globe, so it is labelled with the target: "2D".
  await expect(tool.getByRole("button", { name: /^(2D|3D)$/ })).toHaveCount(1);
  await expect(tool.getByRole("button", { name: "2D" })).toBeVisible();

  // THE DARK/LIGHT PAIR IS GONE and its absence is asserted rather than dropped: Dark
  // and Positron left the basemap registry with the console's dark skin, so an option
  // offering either would mean the removal was incomplete.
  await expect(tool.getByRole("button", { name: /^(Dark|Light)$/ })).toHaveCount(0);

  // A RADIOGROUP, not a strip of chips — the rail is a column now and each basemap is
  // a full-width row. Full names, so the abbreviations the lateral strip needed are
  // gone with it (lib/console/viewControls.ts).
  for (const n of ["Streets", "Satellite", "Topographic"]) {
    await expect(tool.getByRole("radio", { name: n })).toBeVisible();
  }
  await expect(tool.getByRole("radio")).toHaveCount(3);

  // THE EFFECT, NOT THE BUTTON — the house rule from console.spec.ts, "so a button
  // that highlights without driving the map still fails". OpenTopoMap declares its own
  // credit on its source, so the attribution control is proof the style actually
  // swapped, and it is the one observable a highlight cannot fake. (The control is
  // collapsed, so the text is in the DOM but hidden; toContainText reads textContent
  // and does not require visibility.)
  await tool.getByRole("radio", { name: "Topographic" }).click();
  await expect(tool.getByRole("radio", { name: "Topographic" })).toHaveAttribute("aria-checked", "true");
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
  await page.click("#tn-rail-tab-sources");
  await page.click(".tn-insp-row");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);

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

test("Draw is the only way in left, and it arms the map rather than opening a panel", async ({
  page,
}) => {
  await openInspector(page);

  // The Sources tab lost BOTH of its entry points on 2026-09-16 — the dashed button
  // under the areas list and the action row inside the context switcher's menu. Both
  // are asserted, because removing one and forgetting the other is exactly the
  // half-done state that leaves a duplicate nobody notices for a month.
  await page.click("#tn-rail-tab-sources");
  await expect(page.locator(".tn-insp-draw")).toHaveCount(0);
  await page.click(".tn-ctxbar");
  await expect(page.locator(".tn-ctxbar-draw")).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /Draw an area/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.click("#tn-rail-tab-inspector");
  const draw = page.locator(RAIL).getByRole("button", { name: "Draw an area" });

  // It OPENS NOTHING. The panel keeps showing the object view empty state, and the
  // only new thing on screen is the banner over the map — which is the one surface
  // that cannot be dismissed while the map is swallowing clicks.
  await draw.click();
  await expect(page.locator(".tn-drawbanner")).toBeVisible();
  await expect(page.locator(".tn-insp-tool")).toHaveCount(0);
  await expect(draw).toHaveAttribute("aria-pressed", "true");

  // And the gesture is really armed, not merely painted: MapLibre has the crosshair.
  // Two observables on purpose — a button that sets a store and never reaches the map
  // would satisfy the first alone.
  await expect(page.locator(".map-canvas canvas").first()).toHaveCSS("cursor", "crosshair");

  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-drawbanner")).toHaveCount(0);
  await expect(draw).toHaveAttribute("aria-pressed", "false");
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
