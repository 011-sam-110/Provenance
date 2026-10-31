import { test, expect, type Page } from "@playwright/test";

// THE CONSOLE'S SIDEBAR AND THE SEARCH PILL, in a browser. components/shell/ConsoleSidebar.tsx
// is the column, lib/console/consolePanel.ts holds which panel is open, and
// components/console/MapSearch.tsx is the pill. The pure rules are in
// tests/unit/console-panel.test.ts; this file holds what needs a DOM, a real map and a real
// keyboard. tests/e2e/inspector-rail.spec.ts goes deeper into the Inspector's three tools.

const NAV = 'nav[data-rail="console"]';
const PANEL = "#tn-console-panel";
const PILL = "#tn-map-search";

const row = (page: Page, id: string) => page.locator(`${NAV} [data-rail-entry="${id}"]`);
const menu = (page: Page) => page.locator(`${NAV} [data-rail-menu]`);
const title = (page: Page) => page.locator(`${PANEL} .tn-insp-tool-title`);

const FIVE = [
  ["sources", "Sources"],
  ["inspector", "Inspector"],
  ["settings", "Map settings"],
  ["draw", "Areas"],
  ["alerts", "Notifications"],
] as const;

async function seed(page: Page, extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    ({ extra: more }) => {
      window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
      if (!window.localStorage.getItem("tn.inspector.v1")) {
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
      }
      for (const [k, v] of Object.entries(more)) {
        if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, JSON.stringify(v));
      }
    },
    { extra },
  );
}

async function open(page: Page, url = "/app", extra: Record<string, unknown> = {}) {
  await seed(page, extra);
  await page.goto(url);
  await expect(page.locator(".map-canvas")).toHaveCount(1);
}

/** A map that has drawn a frame, so a measurement of it means something. */
async function mapReady(page: Page) {
  await page.waitForFunction(
    () => {
      const map = (window as unknown as { __map?: { loaded(): boolean; isStyleLoaded(): boolean } }).__map;
      return !!map && map.isStyleLoaded();
    },
    undefined,
    { timeout: 60_000 },
  );
}

test("all five rows open by mouse, each with its title and its way out, and a second click closes", async ({ page }) => {
  await open(page);
  for (const [id, name] of FIVE) {
    await row(page, id).click();
    await expect(title(page)).toHaveText(name);
    await expect(page.locator(PANEL)).toHaveAttribute("aria-label", name);
    await expect(row(page, id)).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: `Close ${name.toLowerCase()}` })).toBeVisible();
    // One panel at a time: no other row says it is open.
    await expect(page.locator(`${NAV} [data-active="true"]`)).toHaveCount(1);
  }
  // The second click on the open row closes it.
  await row(page, "alerts").click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(row(page, "alerts")).toHaveAttribute("aria-expanded", "false");
});

test("all five rows open by keyboard: Enter opens and lands on the title, Escape comes back", async ({ page }) => {
  await open(page);
  await menu(page).focus();
  // Arrow keys walk the rows and do not open them.
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "sources")).toBeFocused();
  await expect(page.locator(PANEL)).toHaveCount(0);

  for (const [id, name] of FIVE) {
    await row(page, id).focus();
    await page.keyboard.press("Enter");
    await expect(title(page)).toHaveText(name);
    await expect(title(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(PANEL)).toHaveCount(0);
    await expect(row(page, id)).toBeFocused();
  }

  // Home and End reach the ends, and the walk wraps.
  await page.keyboard.press("End");
  await expect(row(page, "controls")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page)).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await expect(menu(page)).toBeFocused();
});

test("one real control in each panel changes the app", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/app?lat=46.6&lon=2.4&z=5");
  await mapReady(page);

  // SOURCES: a switch puts a layer on the map, not only a tick on the row. The earthquakes
  // feed answers with a small fixture, so the assertion is on what MapLibre was given.
  await page.route("**/api/signals/earthquakes**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        observedAt: Date.now(),
        count: 1,
        features: [{ id: "eq1", lat: 46.6, lon: 2.4, title: "Fixture quake", signalId: "earthquakes", precision: "exact" }],
      },
    }),
  );
  await row(page, "sources").click();
  const quake = page.locator('[data-source-row="earthquakes"]');
  await page.getByLabel("Search sources").fill("earthquake");
  await expect(quake).toHaveCount(1);
  const asked = page.waitForRequest((r) => r.url().includes("/api/signals/earthquakes"));
  await quake.locator(".tn-src-toggle").click();
  await asked;
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = (window as unknown as { __map: { getSource(id: string): { _data?: { geojson?: { features?: unknown[] } } } | undefined } }).__map;
        return map.getSource("signals")?._data?.geojson?.features?.length ?? 0;
      }),
    )
    .toBeGreaterThan(0);

  // MAP SETTINGS: the basemap really swaps. OpenTopoMap's credit is on its own source.
  await row(page, "settings").click();
  await page.getByRole("radiogroup", { name: "Basemap" }).getByRole("radio", { name: "Topographic" }).click();
  await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText(/OpenTopoMap/, { timeout: 15_000 });
  await mapReady(page);

  // AREAS: the button starts a draw, and the map is what says so.
  await row(page, "draw").click();
  await page.locator(".tn-insp-draw").click();
  await expect(page.locator(".tn-drawbanner")).toBeVisible();
  await expect(page.locator(".map-canvas canvas").first()).toHaveCSS("cursor", "crosshair");
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-drawbanner")).toHaveCount(0);
  // That press was the draw's, so the panel stayed.
  await expect(title(page)).toHaveText("Areas");

  // NOTIFICATIONS: the rules are here, with the seeded area to pick.
  await row(page, "alerts").click();
  await expect(page.locator(".tn-alert")).toHaveCount(1);
  await expect(page.locator(".tn-alert-head")).toBeVisible();

  // INSPECTOR: a click on the map fills it, whichever panel was open. The middle of the stage
  // is France at this view, and a country opens its own dossier.
  await row(page, "alerts").click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  const at = await page.evaluate(() => {
    const map = (window as unknown as { __map: { project(l: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement } }).__map;
    const p = map.project([2.4, 46.6]);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1, { timeout: 15_000 });
  await expect(title(page)).toHaveText("Inspector");
});

test("Escape runs in order: popover, field, draw, tool, object, then the panel", async ({ page }) => {
  await open(page);
  await mapReady(page);

  // The Controls popover goes first, and takes nothing else with it.
  await row(page, "sources").click();
  await row(page, "controls").click();
  await expect(page.locator("#tn-console-controls")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#tn-console-controls")).toHaveCount(0);
  await expect(title(page)).toHaveText("Sources");
  await expect(row(page, "controls")).toBeFocused();

  // Sources' search box: words first, then the panel.
  await page.getByLabel("Search sources").fill("quake");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Search sources")).toHaveValue("");
  await expect(title(page)).toHaveText("Sources");
  await page.keyboard.press("Escape");
  await expect(page.locator(PANEL)).toHaveCount(0);

  // A rename field keeps the key (rung 0).
  await row(page, "draw").click();
  await page.click(".tn-insp-row-edit");
  await page.locator(".tn-insp-rename").fill("x");
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-insp-rename")).toHaveCount(0);
  await expect(title(page)).toHaveText("Areas");

  // A draw keeps the key (rung 1), with the panel left open.
  await page.locator(".tn-insp-draw").click();
  await expect(page.locator(".tn-drawbanner")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-drawbanner")).toHaveCount(0);
  await expect(title(page)).toHaveText("Areas");

  // The tool, then the object behind it, and only one of them per press (rung 2, rung 3).
  await page.click(".tn-insp-row-main");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);
  await row(page, "settings").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);
  await expect(title(page)).toHaveText("Inspector");
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(0);
  await expect(title(page)).toHaveText("Areas");

  // A tool with nothing behind it closes.
  await page.keyboard.press("Escape");
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(row(page, "draw")).toBeFocused();

  // And a dialog outside the panel keeps the key: the palette closes, the panel stays.
  await row(page, "settings").click();
  // Its door is on the Shortcuts tab of Settings.
  await page.locator(".tnx-hdr").getByRole("button", { name: /settings/i }).click();
  await page.getByRole("tab", { name: "Shortcuts" }).click();
  await page.getByRole("button", { name: "Open command palette" }).click();
  await expect(page.locator(".tn-palette-root")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-palette-root")).toHaveCount(0);
  await expect(title(page)).toHaveText("Map settings");
});

test("a dialog's Escape closes that dialog and leaves the panel open", async ({ page }) => {
  await open(page);
  await row(page, "sources").click();
  await expect(title(page)).toHaveText("Sources");

  // The placement picker closes from a React handler, so it is gone before the shell looks.
  await page.locator(`${PANEL} .tn-src-row .tn-src-add`).first().click();
  const picker = page.getByRole("dialog").filter({ has: page.locator("#tn-place-h") });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(title(page)).toHaveText("Sources");

  // The settings drawer closes from a window listener.
  await page.locator(".tn-settings-trigger").click();
  await expect(page.locator(".tn-settings")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-settings")).toHaveCount(0);
  await expect(title(page)).toHaveText("Sources");

  // With no dialog left, the next press is the panel's.
  await page.keyboard.press("Escape");
  await expect(page.locator(PANEL)).toHaveCount(0);
});

test("the chords: Sources toggles, search lands in the pill with no typed character, Draw arms", async ({ page }) => {
  await open(page);
  await mapReady(page);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(title(page)).toHaveText("Sources");
  // From another panel the chord goes to Sources; on Sources it closes.
  await row(page, "alerts").click();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(title(page)).toHaveText("Sources");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(PANEL)).toHaveCount(0);

  await page.locator("body").press(";");
  await expect(page.locator(PILL)).toBeFocused();
  await expect(page.locator(PILL)).toHaveValue("");
  await expect(page.locator(PANEL)).toHaveCount(0);
  // Typing a semicolon in the box is a semicolon.
  await page.locator(PILL).pressSequentially("a;b");
  await expect(page.locator(PILL)).toHaveValue("a;b");
  // Out again: Escape closes the list, then empties the box, then leaves it.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator(PILL)).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.locator(PILL)).not.toBeFocused();

  await page.locator("body").press("Control+q");
  await expect(page.locator(".tn-drawbanner")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-drawbanner")).toHaveCount(0);
});

test("a search chord with no box on screen does not eat the key", async ({ page }) => {
  // A focused widget unmounts the map and the pill. The chord must then do nothing at all,
  // so the character still reaches whatever would have had it.
  await open(page, "/app?preset=news");
  await mapReady(page);
  await page.locator(".tn-cw-expand").first().click();
  await expect(page.locator(PILL)).toHaveCount(0);
  const prevented = await page.evaluate(() => {
    const e = new KeyboardEvent("keydown", { key: ";", code: "Semicolon", bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(false);

  // And the rows stay, with the ones that need the map saying why it is not there.
  await row(page, "settings").click();
  await expect(page.locator(".tn-panel-note")).toContainText("Close that widget");
  await row(page, "inspector").click();
  await expect(page.locator(".tn-panel-note")).toContainText("Close that widget");
  await row(page, "draw").click();
  await page.locator(".tn-insp-draw").click();
  await expect(page.locator(".tn-toast")).toContainText("The map is not on screen");
  await row(page, "alerts").click();
  await expect(page.locator(".tn-panel-note")).toHaveCount(0);
});

test("`sources=open` opens Sources once, and the flag leaves the address", async ({ page }) => {
  await open(page, "/app?sources=open");
  await expect(title(page)).toHaveText("Sources");
  await expect(page).not.toHaveURL(/sources=open/);
  await page.reload();
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await expect(page.locator(PANEL)).toHaveCount(0);
});

test("a reload keeps the sidebar and the panel's width, and lands with no panel open", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Every browser that has used the console holds these two values.
  await open(page, "/app", {
    "tn.sources.railw": { v: 1, d: 372 },
    "tn.rail.open.v1": { v: 1, d: { eye: false, console: true } },
  });
  await expect(page.locator(NAV)).toHaveAttribute("data-expanded", "true");
  await expect(page.locator(PANEL)).toHaveCount(0);
  await row(page, "sources").click();
  // A width saved under the old 372 floor is still the width.
  expect((await page.locator(PANEL).boundingBox())?.width).toBe(372);

  // Drag the seam: it measures from the panel's left edge, past the open sidebar.
  const seam = await page.locator(".tn-src-splitter").boundingBox();
  if (!seam) throw new Error("no seam");
  await page.mouse.move(seam.x + seam.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(232 + 500, 300, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await page.locator(PANEL).boundingBox())?.width ?? 0)).toBe(500);

  // The column's choice is one key, and the seed above only writes when it is empty.
  await menu(page).click();
  await expect(page.locator(NAV)).toHaveAttribute("data-expanded", "false");
  await page.reload();
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await expect(page.locator(NAV)).toHaveAttribute("data-expanded", "false");
  await expect(page.locator(PANEL)).toHaveCount(0);
  await row(page, "sources").click();
  expect(Math.round((await page.locator(PANEL).boundingBox())?.width ?? 0)).toBe(500);
});

test("the pill finds a place, drops a pin and offers the network row for an IP", async ({ page }) => {
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({
      json: { results: [{ name: "Ben Nevis, Highland, United Kingdom", lat: 56.7969, lon: -5.0036, type: "peak" }] },
    }),
  );
  await open(page);
  await mapReady(page);

  await page.locator(PILL).click();
  // An empty box offers the one thing it can do without being told.
  await expect(page.getByRole("option", { name: /Cameras near me/ })).toBeVisible();
  await page.locator(PILL).fill("ben nevis");
  const place = page.getByRole("option", { name: /Ben Nevis/ });
  await expect(place).toBeVisible();
  await expect(place).toContainText("peak");
  await expect(page.getByRole("option", { name: /Cameras near me/ })).toHaveCount(0);

  // The arrow keys reach the row, and Enter presses it.
  await page.keyboard.press("ArrowDown");
  await expect(place).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tn-pinnav")).toBeVisible();
  await expect(page.locator(".tn-pinnav-label")).toContainText("Ben Nevis");
  await expect(page.locator(PILL)).toHaveValue("");

  // An IP is not a place, and is not sent to the geocoder.
  let geocoded = 0;
  await page.route("**/api/geocode**", (route) => {
    geocoded += 1;
    return route.fulfill({ json: { results: [] } });
  });
  await page.locator(PILL).fill("8.8.8.8");
  await expect(page.getByRole("option", { name: /Locate network: 8\.8\.8\.8/ })).toBeVisible();
  await page.waitForTimeout(500);
  expect(geocoded).toBe(0);
});

test("Cameras near me asks for the location only when pressed, and says so when refused", async ({ page }) => {
  // No permission is granted in this context, and no geolocation is mocked, so the browser
  // refuses. The promise is that nothing asks before the press.
  await page.addInitScript(() => {
    const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    (window as unknown as { __asked: number }).__asked = 0;
    navigator.geolocation.getCurrentPosition = (ok, err, opts) => {
      (window as unknown as { __asked: number }).__asked += 1;
      real(ok, err, opts);
    };
  });
  await open(page);
  await page.locator(PILL).click();
  expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked)).toBe(0);
  await page.getByRole("option", { name: /Cameras near me/ }).click();
  expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked)).toBe(1);
  await expect(page.locator(".tn-mapsearch-status")).toContainText(/location/i, { timeout: 15_000 });
});

test("the open sidebar overlays the map: the plates move out from under it, and the map keeps its size", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/app", {
    "tn.hud.v1": { v: 1, d: { enabled: true, variant: "compact", animate: false, opacity: 88 } },
  });
  await mapReady(page);
  // A pin, so the pin list is on the map.
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { results: [{ name: "Ben Nevis", lat: 56.7969, lon: -5.0036, type: "peak" }] } }),
  );
  await page.locator(PILL).fill("ben nevis");
  await page.getByRole("option", { name: /Ben Nevis/ }).click();
  await page.locator(PILL).blur();

  const bar = page.locator(".tn-mapsearch-bar");
  const hud = page.locator("[data-tn-hud]");
  const pins = page.locator(".tn-pinnav");
  const canvas = page.locator(".map-canvas canvas").first();
  const stage = (await page.locator(".tn-cw-stage").boundingBox())!;
  await expect(hud).toBeVisible();
  await expect(pins).toBeVisible();

  const before = {
    bar: (await bar.boundingBox())!,
    hud: (await hud.boundingBox())!,
    pins: (await pins.boundingBox())!,
    canvas: (await canvas.boundingBox())!,
  };
  // Closed: the column keeps its 64px, the stage starts past it, the pill is 12px into the
  // stage, and the HUD sits under the pill.
  expect(stage.x).toBeGreaterThanOrEqual(64);
  expect(Math.round(before.bar.x)).toBe(Math.round(stage.x) + 12);
  expect(before.hud.y).toBeGreaterThanOrEqual(before.bar.y + before.bar.height);

  await menu(page).click();
  await expect(page.locator(NAV)).toHaveAttribute("data-expanded", "true");
  // Open: the pill stands 12px past the column, and the other two moved by the same amount.
  await expect.poll(async () => Math.round((await bar.boundingBox())!.x)).toBe(232 + 12);
  const moved = 232 + 12 - Math.round(before.bar.x);
  await expect.poll(async () => Math.round((await hud.boundingBox())!.x)).toBe(Math.round(before.hud.x) + moved);
  await expect.poll(async () => Math.round((await pins.boundingBox())!.x)).toBe(Math.round(before.pins.x) + moved);
  // The map did not change: an open column overlays it.
  expect(await canvas.boundingBox()).toEqual(before.canvas);

  // Nothing is under the column: what you find at each plate's middle is the plate.
  for (const sel of [".tn-mapsearch-bar", "[data-tn-hud]", ".tn-pinnav"]) {
    const clear = await page.locator(sel).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const nav = document.querySelector('nav[data-rail="console"]')!.getBoundingClientRect();
      return r.left >= nav.right;
    });
    expect(clear, sel).toBe(true);
  }
});

test("a panel resizes the stage, the map redraws on the same frame, and the plates keep clear", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await mapReady(page);
  await page.waitForTimeout(1500);

  // THE BLANK FRAME. map.resize() clears the canvas, and a frame shown before the next
  // draw is an empty stage. This observer runs after WorldMap's and MapLibre's on the same
  // element, in the same frame, before the browser paints, and reads a pixel from the drawing
  // buffer. MapLibre's own observer covers this one change, so the test below is the one that
  // goes red with no redraw in WorldMap's observer.
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".map-canvas canvas")!;
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext;
    const out: { w: number; rgba: number[] }[] = [];
    (window as unknown as { __frames: typeof out }).__frames = out;
    const ro = new ResizeObserver(() => {
      const px = new Uint8Array(4);
      gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push({ w: canvas.width, rgba: [...px] });
    });
    ro.observe(document.querySelector(".map-canvas")!);
  });

  const before = (await page.locator(".map-canvas canvas").first().boundingBox())!;
  await row(page, "sources").click();
  const panel = (await page.locator(PANEL).boundingBox())!;
  expect(panel.x).toBe(64);
  await expect
    .poll(async () => Math.round((await page.locator(".map-canvas canvas").first().boundingBox())!.width))
    .toBe(Math.round(before.width - panel.width));
  const after = (await page.locator(".map-canvas canvas").first().boundingBox())!;
  expect(after.x).toBeGreaterThanOrEqual(panel.x + panel.width);

  const frames = await page.evaluate(() => (window as unknown as { __frames: { w: number; rgba: number[] }[] }).__frames);
  const resized = frames.filter((f, i) => i > 0 || f.w !== Math.round(before.width));
  expect(resized.length, "the observer saw the resize").toBeGreaterThan(0);
  for (const f of resized) {
    expect(f.rgba.some((v) => v > 0), `frame at width ${f.w} is blank`).toBe(true);
  }

  // The panel with the column open: it moves over with the column, and so does the seam.
  await menu(page).click();
  await expect.poll(async () => Math.round((await page.locator(PANEL).boundingBox())!.x)).toBe(232);
  const seam = (await page.locator(".tn-src-splitter").boundingBox())!;
  expect(Math.round(seam.x + seam.width / 2)).toBe(Math.round(232 + panel.width));
  // And the pill has moved so it is not under the panel.
  const bar = (await page.locator(".tn-mapsearch-bar").boundingBox())!;
  const moved = (await page.locator(PANEL).boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(moved.x + moved.width);
});

test("dragging the panel's edge shows no blank frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await mapReady(page);
  await row(page, "sources").click();
  await page.waitForTimeout(1500);

  // A drag changes the size on every frame. MapLibre's own observer draws at most once in
  // 50 ms, so the frames between are WorldMap's to draw. The width is set the way the splitter
  // sets it, on each animation frame, so every step lands inside that 50 ms.
  const frames = await page.evaluate(
    () =>
      new Promise<{ w: number; rgba: number[] }[]>((resolve) => {
        const canvas = document.querySelector<HTMLCanvasElement>(".map-canvas canvas")!;
        const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext;
        const out: { w: number; rgba: number[] }[] = [];
        const ro = new ResizeObserver(() => {
          const px = new Uint8Array(4);
          gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          out.push({ w: canvas.width, rgba: [...px] });
        });
        ro.observe(document.querySelector(".map-canvas")!);
        let step = 0;
        const next = () => {
          step += 1;
          document.documentElement.style.setProperty("--tn-rail-user-w", `${452 + step * 3}px`);
          if (step < 30) requestAnimationFrame(next);
          else
            requestAnimationFrame(() => {
              ro.disconnect();
              resolve(out);
            });
        };
        requestAnimationFrame(next);
      }),
  );

  // The first call is the observer's own at the old size.
  const moved = frames.slice(1);
  expect(moved.length, "the observer saw the drag").toBeGreaterThan(15);
  const blank = moved.filter((f) => f.rgba.every((v) => v === 0)).map((f) => f.w);
  expect(blank, "these frames were blank").toEqual([]);
});

test("the Controls popover says what is true, beside the column, and closes on a press elsewhere", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await row(page, "controls").click();
  const pop = page.locator("#tn-console-controls");
  await expect(pop).toBeVisible();
  await expect(pop).toHaveAttribute("role", "group");
  await expect(pop).toContainText("Move the map");
  await expect(pop).toContainText("Turn and tilt");
  // The visitor's own key, from the keymap.
  await expect(pop).toContainText(/Sources panel\s*(Ctrl\+K|⌘K)/);
  // Left edge at the sidebar's width + 12px, the same as the tips.
  expect(Math.round((await pop.boundingBox())!.x)).toBe(76);
  // A desktop gets the mouse and the keys; touch is on a touch screen.
  await expect(pop.locator('[data-group="touch"]')).toBeHidden();
  await expect(pop.locator('[data-group="mouse"]')).toBeVisible();

  await page.mouse.click(900, 500);
  await expect(pop).toHaveCount(0);
});

test("Streets: the sidebar stays, every row works, and the map plates clear the column", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/app?preset=streets");
  await mapReady(page);
  await expect(page.locator(NAV)).toBeVisible();
  for (const [id, name] of FIVE) {
    await row(page, id).click();
    await expect(title(page)).toHaveText(name);
  }
  await row(page, "alerts").click();
  await expect(page.locator(PANEL)).toHaveCount(0);

  await menu(page).click();
  await expect.poll(async () => Math.round((await page.locator(".tn-mapsearch-bar").boundingBox())!.x)).toBeGreaterThanOrEqual(232);
});

test("a selection behind a closed panel shows a dot on the Inspector row", async ({ page }) => {
  await open(page);
  await mapReady(page);
  await row(page, "draw").click();
  await page.click(".tn-insp-row-main");
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);
  await expect(page.getByTestId("inspector-dot")).toHaveCount(0);

  // ✕ closes the panel and keeps the selection, so the row says something is waiting.
  await page.getByRole("button", { name: "Close inspector" }).click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.getByTestId("inspector-dot")).toBeVisible();
  await row(page, "inspector").click();
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(1);
  await expect(page.getByTestId("inspector-dot")).toHaveCount(0);

  // "Clear" drops it.
  await page.getByRole("button", { name: "Clear this selection" }).click();
  await expect(page.locator(".tn-inspector[role=dialog]")).toHaveCount(0);
  await expect(page.getByTestId("inspector-dot")).toHaveCount(0);
});

test.describe("at 360 wide", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  // The narrow pass holds the stage at 46dvh so cards can scroll under it. A board with no cards
  // (Globe ships none) had nothing under it: a blank band of about 290 px at 390 x 844, measured
  // on production on 2026-10-31.
  test("a board with no cards gives the map the whole screen, and the map draws at that size", async ({ page }) => {
    await open(page);
    await mapReady(page);
    await expect(page.locator(".tn-seg-slot")).toHaveCount(0);
    for (const [width, height] of [[360, 740], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(async () => {
          const stage = (await page.locator(".tn-cw-stage").boundingBox())!;
          const canvas = (await page.locator("canvas.maplibregl-canvas").boundingBox())!;
          return { gap: height - (stage.y + stage.height) <= 12, fits: Math.abs(canvas.height - stage.height) <= 2 };
        }, { message: `${width} x ${height}` })
        .toEqual({ gap: true, fits: true });
    }
  });

  test("the ☰ and the pill share a line, nothing collides, and a row opens today's sheet", async ({ page }) => {
    await open(page);
    await mapReady(page);

    const m = (await menu(page).boundingBox())!;
    const bar = (await page.locator(".tn-mapsearch-bar").boundingBox())!;
    expect(m.width).toBeGreaterThanOrEqual(44);
    expect(m.height).toBeGreaterThanOrEqual(44);
    expect(bar.height).toBeGreaterThanOrEqual(44);
    // Beside it, on the same line, and inside the screen.
    expect(bar.x).toBeGreaterThanOrEqual(m.x + m.width);
    expect(bar.x - (m.x + m.width)).toBeLessThanOrEqual(10);
    expect(Math.abs(bar.y + bar.height / 2 - (m.y + m.height / 2))).toBeLessThanOrEqual(1);
    expect(bar.x + bar.width).toBeLessThanOrEqual(360);
    // The placeholder is not cut off at this width.
    const fits = await page.locator(PILL).evaluate((el) => {
      const input = el as HTMLInputElement;
      const style = getComputedStyle(input);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return { room, text: context.measureText(input.placeholder).width };
    });
    expect(fits.text).toBeLessThanOrEqual(fits.room);
    // The ☰ does not cover the header.
    const hdr = (await page.locator(".tnx-hdr").boundingBox())!;
    expect(m.y).toBeGreaterThanOrEqual(hdr.y + hdr.height);
    // No sideways scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    // The sheet, then a row: the sheet closes and the panel opens, not underneath it.
    await menu(page).click();
    await expect(row(page, "settings")).toBeVisible();
    await expect(page.locator("[data-rail-scrim]")).toBeVisible();
    await row(page, "settings").click();
    await expect(page.locator("[data-rail-scrim]")).toHaveCount(0);
    await expect(title(page)).toHaveText("Map settings");
    // A sheet from the bottom that leaves a strip of map above it. It slides up, so wait for it.
    await expect
      .poll(async () => {
        const b = (await page.locator(PANEL).boundingBox())!;
        return Math.round(b.y + b.height);
      })
      .toBe(740);
    const panel = (await page.locator(PANEL).boundingBox())!;
    expect(Math.round(panel.width)).toBe(360);
    expect(panel.y).toBeGreaterThan(m.y + m.height);
    // Its way out is a real target.
    const close = (await page.getByRole("button", { name: "Close map settings" }).boundingBox())!;
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Close map settings" }).click();
    await expect(page.locator(PANEL)).toHaveCount(0);
    // Focus goes back to the ☰, because the row is inside the closed sheet.
    await expect(menu(page)).toBeFocused();

    // Escape closes the sheet and nothing behind it.
    await menu(page).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-rail-scrim]")).toHaveCount(0);
    await expect(page.locator(PANEL)).toHaveCount(0);
  });

  test("the Controls popover shows touch gestures on a touch screen", async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    await open(page);
    await menu(page).tap();
    await row(page, "controls").tap();
    const pop = page.locator("#tn-console-controls");
    await expect(pop).toBeVisible();
    await expect(pop.locator('[data-group="touch"]')).toBeVisible();
    await expect(pop.locator('[data-group="mouse"]')).toBeHidden();
    await expect(pop).toContainText("Pinch");
    const box = (await pop.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    await context.close();
  });
});

/** WCAG's relative luminance, for text over a colour that is itself over the map. */
function contrast(fg: number[], bg: number[]): number {
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Parse "rgb(…)" or "rgba(…)", compositing a translucent ground over a worst-case map. */
function ground(css: string, map: number[]): number[] {
  const n = (css.match(/[\d.]+/g) ?? []).map(Number);
  const alpha = n[3] ?? 1;
  return [0, 1, 2].map((i) => n[i] * alpha + map[i] * (1 - alpha));
}

for (const skin of ["light", "dark"] as const) {
  test(`${skin} skin: the pill and the popover read at 4.5:1 over any map`, async ({ page }) => {
    await page.addInitScript((s) => {
      window.localStorage.setItem("tn.terminal.skin.v2", JSON.stringify({ v: 1, d: s }));
      if (s === "dark") document.documentElement.setAttribute("data-tnx-skin", "dark");
    }, skin);
    await open(page);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-tnx-skin") ?? "light"))
      .toBe(skin);

    const read = (sel: string, pseudo?: string) =>
      page.locator(sel).first().evaluate((el, p) => {
        const c = getComputedStyle(el, p ?? undefined);
        return { color: c.color, bg: c.backgroundColor };
      }, pseudo);

    // The pill's translucent ground, over a black map and over a white one.
    const bar = await read(".tn-mapsearch-bar");
    const text = await read(PILL);
    const holder = await read(PILL, "::placeholder");
    for (const map of [[0, 0, 0], [255, 255, 255]]) {
      const under = ground(bar.bg, map);
      const ink = (text.color.match(/[\d.]+/g) ?? []).map(Number);
      const ph = (holder.color.match(/[\d.]+/g) ?? []).map(Number);
      expect(contrast(ink, under), `pill text over ${map}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ph, under), `placeholder over ${map}`).toBeGreaterThanOrEqual(4.5);
    }

    await row(page, "controls").click();
    const pop = await read("#tn-console-controls");
    const dd = await read("#tn-console-controls dd");
    for (const map of [[0, 0, 0], [255, 255, 255]]) {
      const under = ground(pop.bg, map);
      const dim = (dd.color.match(/[\d.]+/g) ?? []).map(Number);
      expect(contrast(dim, under), `popover text over ${map}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test("shots", async ({ browser }) => {
  // Few and small, for a person to look at: persona-shots/ is not committed.
  test.setTimeout(240_000);
  const dir = "persona-shots/hud-v2/console-sidebar";
  const seedHud = { "tn.hud.v1": { v: 1, d: { enabled: true, variant: "compact", animate: false, opacity: 88 } } };
  for (const skin of ["light", "dark"] as const) {
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await desk.newPage();
    await p.addInitScript((s) => {
      window.localStorage.setItem("tn.terminal.skin.v2", JSON.stringify({ v: 1, d: s }));
    }, skin);
    await open(p, "/app", seedHud);
    await mapReady(p);
    await p.waitForTimeout(3000);
    const shot = (name: string) => p.screenshot({ path: `${dir}/${skin}-1440-${name}.jpg`, type: "jpeg", quality: 60 });
    await p.mouse.move(900, 700);
    await shot("closed");
    await menu(p).click();
    await p.mouse.move(900, 700);
    await p.waitForTimeout(400);
    await shot("open");
    await menu(p).click();
    await row(p, "sources").click();
    await p.mouse.move(1200, 700);
    await p.waitForTimeout(800);
    await shot("sources");
    await row(p, "inspector").click();
    await p.mouse.move(1200, 700);
    await p.waitForTimeout(300);
    await shot("inspector-empty");
    await row(p, "settings").click();
    await p.mouse.move(1200, 700);
    await p.waitForTimeout(300);
    await shot("settings");
    await row(p, "alerts").click();
    await row(p, "controls").click();
    await p.mouse.move(1200, 700);
    await p.waitForTimeout(300);
    await shot("controls");
    await p.keyboard.press("Escape");
    await row(p, "alerts").click();
    await p.route("**/api/geocode**", (route) =>
      route.fulfill({
        json: {
          results: [
            { name: "London, England, United Kingdom", lat: 51.5, lon: -0.12, type: "city" },
            { name: "London, Ontario, Canada", lat: 42.98, lon: -81.24, type: "city" },
          ],
        },
      }),
    );
    await p.locator(PILL).fill("london");
    await expect(p.getByRole("option", { name: /London, Ontario/ })).toBeVisible();
    await shot("search");
    await desk.close();

    const phone = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
    const q = await phone.newPage();
    await q.addInitScript((s) => {
      window.localStorage.setItem("tn.terminal.skin.v2", JSON.stringify({ v: 1, d: s }));
    }, skin);
    await open(q);
    await mapReady(q);
    await q.waitForTimeout(2500);
    const qshot = (name: string) => q.screenshot({ path: `${dir}/${skin}-360-${name}.jpg`, type: "jpeg", quality: 60 });
    await qshot("closed");
    await menu(q).tap();
    await q.waitForTimeout(300);
    await qshot("sheet");
    await row(q, "sources").tap();
    await q.waitForTimeout(500);
    await qshot("sources");
    await phone.close();
  }
});
