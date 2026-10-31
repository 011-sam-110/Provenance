import { test, expect, type Page } from "@playwright/test";

// THE INSPECTOR AND ITS TOOLS: Map settings, Areas and Notifications, opened from the
// console's sidebar. It replaced tests/e2e/map-rail.spec.ts, which covered the two icon groups
// that used to float on the map's right edge, and until 2026-10-31 these were buttons on a tool
// column on the Sources panel. The cases below are those assertions repointed at the rows,
// plus the claim the moves make: a tool TAKES the panel rather than covering it, and the map's
// edge is plain map. tests/e2e/console-sidebar.spec.ts holds the sidebar and the search pill.
//
// WHY THIS FILE EXISTS AT ALL. vitest here is `environment: "node"` and collects
// `tests/unit/**/*.test.ts` only — .tsx is not collected and no React testing library
// is installed, so the rendered behaviour cannot be tested anywhere else.
// tests/unit/inspector-rail.test.ts holds the pure reducers; everything that needs a
// DOM, a focus ring or a real map is here.
//
// The localStorage stamp is copied from inspector-areas.spec.ts, for the reason stated
// there: the launch sequence is a `position:fixed; inset:0` layer, so without it a
// click lands on the plate instead of the control under it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
    // ONE AREA, so the Areas panel has a LIST — which is also the only remaining way to
    // open an object without depending on what the globe happens to be drawing. Its row
    // calls overlay.open(), which is the door a map click uses.
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

const NAV = 'nav[data-rail="console"]';
const row = (page: Page, id: string) => page.locator(`${NAV} [data-rail-entry="${id}"]`);
const title = (page: Page) => page.locator(".tn-rail .tn-insp-tool-title");

/**
 * Select an object through the UI. The seeded area's row is the only opener that does
 * not depend on what the globe happens to be drawing, and it lives in the Areas panel.
 * The row calls overlay.open(), which brings up the Inspector AND closes any open tool
 * (see lib/overlay.ts), so this lands on the object's own view.
 */
async function selectArea(page: Page) {
  await row(page, "draw").click();
  await expect(page.locator(".tn-insp-row")).toHaveCount(1);
  await page.click(".tn-insp-row-main");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);
}

test("the sidebar is a nav, never a dialog, and Inspector is there with nothing selected", async ({ page }) => {
  // A nav, never role=dialog: ConsoleShell's global keydown handler early returns while
  // any dialog is mounted, so a dialog-flavoured column would kill the console's Escape
  // ladder app-wide.
  const nav = page.locator(NAV);
  await expect(nav).toHaveAttribute("aria-label", "Dashboard tools");
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);

  const ids = await nav.locator("[data-rail-entry]").evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.railEntry ?? "?"),
  );
  expect(ids).toEqual(["sources", "inspector", "rule-map", "settings", "draw", "rule-notify", "alerts", "controls"]);

  // The row says what it is even with nothing to show. It used to wait for a selection,
  // on the grounds that an eye with nothing to view opens an empty pane. Sam asked for a
  // place you can see, and the pane says what to do.
  await row(page, "inspector").click();
  await expect(title(page)).toHaveText("Inspector");
  await expect(page.locator(".tn-inspector-empty")).toContainText("Click something on the map to inspect it.");
  await expect(row(page, "inspector")).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, "inspector")).toHaveAttribute("aria-controls", "tn-console-panel");
});

test("a row clicked from Sources lands on that tool", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(title(page)).toHaveText("Sources");

  await row(page, "settings").click();
  await expect(title(page)).toHaveText("Map settings");
  await expect(page.locator(".tn-insp-switch").first()).toBeVisible();
  await expect(row(page, "settings")).toHaveAttribute("data-active", "true");
  await expect(row(page, "sources")).not.toHaveAttribute("data-active", "true");

  await row(page, "sources").click();
  await row(page, "draw").click();
  await expect(title(page)).toHaveText("Areas");
  await expect(page.locator(".tn-insp-draw")).toBeVisible();
});

test("a tool TAKES the panel body — it is not a card over the object", async ({ page }) => {
  // Open an object first, so there is something a card could have covered.
  await selectArea(page);
  await expect(title(page)).toHaveText("Inspector");

  // Option D, and the assertion is an ABSENCE on purpose: if the tool were a card over the
  // dossier (option A, the first mockup) the dialog would still be mounted underneath it,
  // and every aria assertion about the tool would still pass.
  await row(page, "settings").click();
  await expect(page.locator(".tn-insp-switch").first()).toBeVisible();
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(0);

  // Opening another tool REPLACES it rather than stacking.
  await row(page, "alerts").click();
  await expect(title(page)).toHaveText("Notifications");
  await expect(page.locator(".tn-insp-switch")).toHaveCount(0);

  // The Inspector's own row brings the object back.
  await row(page, "inspector").click();
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);
});

test("Map settings: a projection pair, three basemap radios, and the map follows", async ({ page }) => {
  await row(page, "settings").click();
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

  // A RADIOGROUP, not a strip of chips, and each basemap is a full-width row. Full names,
  // so the abbreviations the lateral strip needed are gone with it
  // (lib/console/viewControls.ts).
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

test("Escape closes the tool first, then the object", async ({ page }) => {
  // The ladder, end to end, because it is asserted in two files and lives in three:
  // lib/map/aoi.ts owns rung 1 for a live draw, ConsoleSidebar owns rung 2, and
  // InspectorPanel plus ConsoleShell own rung 3. A single unsequenced press that did
  // both jobs would be the bug — closing the tool AND dropping the user's selection.
  await selectArea(page);

  await row(page, "alerts").click();
  await expect(title(page)).toHaveText("Notifications");

  await page.keyboard.press("Escape");
  await expect(title(page)).toHaveText("Inspector");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);
  // Focus goes back to the row that opened the tool.
  await expect(row(page, "alerts")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(0);
  // A closed inspection goes back to what it replaced, and the area came from Areas.
  await expect(title(page)).toHaveText("Areas");
});

test("Areas opens a panel, and the gesture starts from the button inside it", async ({ page }) => {
  // TWO CLICKS, ON PURPOSE. Sam: "when you click the draw area button on the
  // inspector, it shouldnt just automatically start drawing an area. A user should
  // click draw area on that page." So the row is the way IN to the tool, and the
  // tool's own button arms the map.

  // The Sources panel does not carry the areas block at all.
  await row(page, "sources").click();
  await expect(page.locator(".tn-insp-draw")).toHaveCount(0);
  await expect(page.locator(".tn-insp-row")).toHaveCount(0);
  // ...nor does the context switcher's menu, which lost its action row in the first
  // pass and has not grown one back.
  await page.click(".tn-ctxbar");
  await expect(page.locator(".tn-ctxbar-draw")).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /Draw an area/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // That press closed the menu and nothing else.
  await expect(title(page)).toHaveText("Sources");

  // FIRST CLICK — the panel, and nothing armed. The banner over the map is the
  // observable that would appear if the gesture had started, so its absence is the
  // assertion that the row does not arm anything.
  await row(page, "draw").click();
  await expect(row(page, "draw")).toHaveAttribute("aria-expanded", "true");
  await expect(title(page)).toHaveText("Areas");
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
  // drop the map selection, which is the ladder the sidebar's capture-phase handler
  // stands down for.
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-drawbanner")).toHaveCount(0);
  await expect(page.locator(".tn-insp-draw")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".tn-insp-tool")).toHaveCount(1);
});

test("the map's right edge is plain map now, and the ⓘ attribution is not", async ({ page }) => {
  // Two assertions that have to travel together. The stage rail, the zoom/compass
  // cluster and the centred search box are all gone from the right of the stage. The
  // attribution was NOT removed, because OpenStreetMap/OpenMapTiles (ODbL), Esri and
  // OpenTopoMap all require the credit (lib/map/attribution.ts); deleting it would be a
  // licensing regression that no other test would notice.
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

  // AND EVERY TOOL SURVIVES THE NARROW PASS. Hiding them would take the map settings and
  // the only draw entry point off a phone, the strictly bigger loss the retired stage
  // rail's own mobile pass already argued about once.
  await page.locator(`${NAV} [data-rail-menu]`).click();
  for (const id of ["sources", "inspector", "settings", "draw", "alerts", "controls"]) {
    const box = await row(page, id).boundingBox();
    if (!box) throw new Error(`the ${id} row has no box on a phone`);
    expect(box.height, id).toBeGreaterThanOrEqual(44);
    expect(box.width, id).toBeGreaterThanOrEqual(44);
  }
});

test("areas are renamed from the Areas panel, and Escape puts it back", async ({ page }) => {
  await row(page, "draw").click();
  await page.waitForSelector(".tn-insp-row-edit", { timeout: 10_000 });
  await expect(page.locator(".tn-insp-label")).toHaveText("West Pacific");

  // The pencil replaces the row with a field holding the current name.
  await page.click(".tn-insp-row-edit");
  const field = page.locator(".tn-insp-rename");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("West Pacific");

  // ESCAPE PUTS THE OLD NAME BACK AND LEAVES THE PANEL OPEN. That second half is the
  // rung-0 case in the sidebar's ladder: its Escape handler is capture phase, so without
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
  // identifying the row in four places at once. "Clear" goes back to the Areas list.
  await page.getByRole("button", { name: "Clear this selection" }).click();
  await expect(title(page)).toHaveText("Areas");
  await page.click(".tn-insp-row-edit");
  await page.locator(".tn-insp-rename").fill("   ");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tn-insp-label")).toHaveText("North Atlantic watch");
});

test("every mark on the closed sidebar is centred in its column", async ({ page }) => {
  // Leon, on the column these rows replaced: "centre the elements horizontally on the bar".
  // The drawn INK's centre is measured against the 64px column's centre, within 1px. The
  // column's right border is 1px, so the centre of what you can see is 31.5.
  await page.setViewportSize({ width: 1440, height: 900 });
  const rows = await page.locator(NAV).evaluate((nav) => {
    const n = nav.getBoundingClientRect();
    const cx = n.x + (n.width - 1) / 2;
    return [...nav.querySelectorAll<HTMLElement>("[data-rail-entry] svg")].map((svg) => {
      const ink = [...svg.querySelectorAll("path, circle, line")].map((s) => s.getBoundingClientRect());
      const left = Math.min(...ink.map((k) => k.left));
      const right = Math.max(...ink.map((k) => k.right));
      const box = svg.getBoundingClientRect();
      return { id: svg.closest<HTMLElement>("[data-rail-entry]")?.dataset.railEntry, ink: (left + right) / 2 - cx, w: box.width, h: box.height };
    });
  });
  expect(rows.map((r) => r.id)).toEqual(["sources", "inspector", "settings", "draw", "alerts", "controls"]);
  for (const r of rows) {
    expect(Math.abs(r.ink), `${r.id} drawing`).toBeLessThanOrEqual(1);
    expect(r.w, `${r.id} glyph`).toBe(18);
    expect(r.h, `${r.id} glyph`).toBe(18);
  }
});

test("a phone names every tool in words", async ({ page }) => {
  // Leon: "There should be labels on mobile so the user can tell what they are". There
  // is no hover on a phone, so the sheet carries the word beside each icon, inside its
  // button's accessible name.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(`${NAV} [data-rail-menu]`).click();
  for (const [id, word] of [
    ["sources", "Sources"],
    ["inspector", "Inspector"],
    ["settings", "Map settings"],
    ["draw", "Areas"],
    ["alerts", "Notifications"],
    ["controls", "Controls"],
  ]) {
    await expect(row(page, id)).toBeVisible();
    await expect(page.locator(NAV).getByRole("button", { name: word, exact: true })).toBeVisible();
  }
});

test("the panel's hierarchy is measurable, not just intended", async ({ page }) => {
  // Sam's brief was about visual weight, and visual weight is exactly the kind of
  // thing a later retune undoes without noticing. So the three claims are MEASURED:
  // the title outweighs a section heading, a section heading outweighs the rows under
  // it, and the rows are indented past the heading they belong to.
  await row(page, "settings").click();

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
  const field = await page.locator(".tn-insp-group .tn-insp-field").first().boundingBox();
  if (!head || !field) throw new Error("no box for the heading or its first row");
  expect(field.x).toBeGreaterThan(head.x + 4);

  // THE ✕ DOES NOT COMPETE WITH THE TITLE. Sam asked for that once, about a ✕ at the
  // title's own weight. It came back because the plan asks for a close button on every
  // panel's top edge, and it is the quiet kind: smaller than the title, no box at rest.
  const close = page.getByRole("button", { name: "Close map settings" });
  await expect(close).toBeVisible();
  expect(await close.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  expect(await close.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
});

test("Notifications is its own row AND its own group, and Areas is only areas", async ({ page }) => {
  // IT WAS A SECTION INSIDE THE DRAW PANEL, for one round. Sam: "i cant see the alerts
  // and bell" — which is the whole argument for it being a tool. Then it was a BUTTON
  // IN THE DRAW GROUP for one build, and he reported that too: "the alerts isnt its own
  // separate section, its part of the drawing". Both halves are asserted here, because
  // both were wrong in turn.
  const ids = await page.locator(`${NAV} [data-rail-entry]`).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.railEntry),
  );
  // ITS OWN GROUP: a rule stands between Areas and Notifications, and between Inspector
  // and Map settings.
  expect(ids.indexOf("rule-notify")).toBe(ids.indexOf("draw") + 1);
  expect(ids.indexOf("alerts")).toBe(ids.indexOf("rule-notify") + 1);
  expect(ids.indexOf("rule-map")).toBe(ids.indexOf("inspector") + 1);

  await row(page, "alerts").click();
  await expect(title(page)).toHaveText("Notifications");
  // The composer is here, in a section of its own panel.
  const alerts = page.locator(".tn-insp-group", { has: page.getByText("Alerts", { exact: true }) });
  await expect(alerts).toHaveCount(1);
  await expect(alerts.locator(".tn-alert")).toHaveCount(1);
  await expect(alerts.locator(".tn-alert-head")).toBeVisible();

  // The Areas panel is the areas list and nothing else now.
  await row(page, "draw").click();
  await expect(title(page)).toHaveText("Areas");
  await expect(page.locator(".tn-alert")).toHaveCount(0);
  await expect(page.locator(".tn-insp-group")).toHaveCount(1);
});

test("an area's colour can be changed, and the MAP is what changes", async ({ page }) => {
  await row(page, "draw").click();
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
  await row(page, "draw").click();
  await expect(page.locator(".tn-insp-row-color")).toHaveCSS("--c", "#f59e0b");
});

test("Escape closes the colour picker and leaves the panel open", async ({ page }) => {
  // Rung 0 of the sidebar's Escape ladder, for the second surface that uses it. Capture
  // phase means the sidebar sees the key first, so without the stand-down Escape here would
  // close the whole Areas panel instead of the popover.
  await row(page, "draw").click();
  await page.click(".tn-insp-row-color");
  const pop = page.locator(".tn-insp-color-pop");
  await expect(pop).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(page.locator(".tn-insp-tool")).toHaveCount(1);
  await expect(title(page)).toHaveText("Areas");
});
