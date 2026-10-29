import { expect, test, type Page } from "@playwright/test";
import type maplibregl from "maplibre-gl";

// Pointing at a Sources rail row, or at a section heading, picks its marks out on the
// map: the lit ids go into ONE MapLibre global-state key (`srcHover`) and every app layer
// fades unless it is lit (lib/map/sourceHighlight.ts, lib/shell/sourceHover.ts).
//
// WHY E2E. The unit tests hold the expression shapes and the timing. What they cannot
// reach is the wiring that makes it real: a pointer over a React row, MapLibre accepting
// the wrapped layers, a touch tap, and the light surviving a basemap switch.
//
// THE FEEDS ARE ROUTED. Two signal layers and two live cameras are answered from fixtures
// so the spec does not depend on USGS, NASA or the camera registry being up, and so "has
// marks" is the same on every run.
//
// What it reads is the map's own global state (`window.__map`, which WorldMap always
// sets), not a screenshot: a repaint that fades nothing would still look like a pass.

// A cold dev server compiles /app on the first visit; give the page room.
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  // The first-visit boot plate covers the map and takes the first clicks.
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
  await answerFeeds(page);
});

function signalBody(signalId: string, places: Array<[number, number]>) {
  const features = places.map(([lat, lon], i) => ({
    id: `${signalId}:${i}`,
    lat,
    lon,
    title: `${signalId} ${i}`,
    signalId,
    precision: "exact",
  }));
  return JSON.stringify({ ok: true, observedAt: Date.now(), count: features.length, features });
}

async function answerFeeds(page: Page) {
  const signals: Record<string, Array<[number, number]>> = {
    earthquakes: [[38.3, 142.4], [35.6, 139.7], [-33.4, -70.6]],
    wildfires: [[37.5, -119.6], [-31.9, 116.0]],
  };
  for (const [id, places] of Object.entries(signals)) {
    await page.route((url) => url.pathname === `/api/signals/${id}`, (route) =>
      route.fulfill({ contentType: "application/json", body: signalBody(id, places) }),
    );
  }
  const cam = (id: string, lat: number, lon: number) => ({
    id,
    name: id,
    lat,
    lon,
    available: true,
    source: "fixture",
    country: "GB",
    live: true,
  });
  await page.route((url) => url.pathname === "/api/cameras", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ cameras: [cam("cam-a", 51.5, -0.1), cam("cam-b", 48.85, 2.35)] }),
    }),
  );
}

const URL = "/app?sources=open&layers=livecams&sig=earthquakes,wildfires&base=light";
const row = (page: Page, id: string) => page.locator(`.tn-src-row[data-source-row="${id}"] .tn-src-label`);
const heading = (page: Page, section: string) => page.locator(`[data-section="${section}"] .tn-src-sec-head`);

/** What the map is lighting now: the global-state key the layers read. */
const lit = (page: Page) =>
  page.evaluate(() => {
    const map = (window as unknown as { __map: { style: { getGlobalState(): Record<string, unknown> } } }).__map;
    return (map.style.getGlobalState().srcHover ?? null) as string[] | null;
  });

/** The map has loaded both signals and the cameras, so every id below has marks. */
async function loaded(page: Page) {
  await page.waitForFunction(
    () => {
      const map = (window as unknown as { __map?: maplibregl.Map }).__map;
      if (!map?.getSource("signals") || !map.getSource("cameras")) return false;
      const count = (id: string) => {
        // maplibre keeps the data it was last given on `_data.geojson`.
        const src = map.getSource(id) as unknown as { _data?: { geojson?: GeoJSON.FeatureCollection } };
        return src._data?.geojson?.features?.length ?? 0;
      };
      return count("signals") >= 5 && count("cameras") >= 2;
    },
    undefined,
    { timeout: 60_000, polling: 250 },
  );
}

test("hovering a row lights that source, leaving the rail clears it, an off source lights nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  await expect(page.locator(".tn-rail")).toBeVisible();
  await loaded(page);

  // The layers read the key: wrapped once the app layers exist.
  const wrapped = await page.evaluate(() => {
    const map = (window as unknown as { __map: maplibregl.Map }).__map;
    return JSON.stringify(map.getPaintProperty("signal-dots", "circle-opacity"));
  });
  expect(wrapped).toContain("global-state");

  await row(page, "earthquakes").hover();
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual(["earthquakes"]);

  // Moving onto the map ends it.
  await page.locator(".map-canvas").hover({ position: { x: 600, y: 400 } });
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual([]);

  // A switched-off source fades nothing. Aurora is off in this URL.
  await row(page, "aurora").hover();
  await page.waitForTimeout(300);
  expect(await lit(page)).toEqual([]);

  // Live cams is on and has two fixture cameras; Static cams is off.
  await row(page, "livecams").hover();
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual(["livecams"]);
  await row(page, "staticcams").hover();
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual([]);
});

test("a click on the label you are pointing at keeps the light on", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  await loaded(page);

  await row(page, "earthquakes").hover();
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual(["earthquakes"]);
  // The click toggles the popover shut. The pointer is still on the row, so the light stays.
  await row(page, "earthquakes").click();
  await page.waitForTimeout(400);
  expect(await lit(page)).toEqual(["earthquakes"]);
});

test("keyboard focus on a label lights it, and moving focus away clears it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  await loaded(page);

  // A key press first, so the browser treats the focus that follows as keyboard focus
  // (`:focus-visible`), which is what a Tab gives.
  await page.keyboard.press("Shift");
  await row(page, "wildfires").focus();
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual(["wildfires"]);
  await row(page, "wildfires").blur();
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual([]);
});

test("hovering a section heading lights every switched-on source in it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  await loaded(page);

  await heading(page, "hazards").hover();
  await expect
    .poll(async () => [...((await lit(page)) ?? [])].sort(), { timeout: 2_000 })
    .toEqual(["earthquakes", "wildfires"]);

  // A heading with nothing switched on lights nothing (Conflict & security has no source on).
  await page.locator(".map-canvas").hover({ position: { x: 600, y: 400 } });
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual([]);
  await heading(page, "security").hover();
  await page.waitForTimeout(300);
  expect(await lit(page)).toEqual([]);
});

test("the light survives a basemap switch", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  await loaded(page);

  await row(page, "earthquakes").hover();
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual(["earthquakes"]);

  // Inspector -> Map settings -> Topographic. A restyle throws away the layers AND the
  // global state; addAppLayers puts both back.
  await page.locator("#inspector-rail").getByRole("button", { name: "Map settings" }).click();
  const basemaps = page.locator(".tn-insp-tool").getByRole("radiogroup", { name: "Basemap" });
  await basemaps.getByRole("radio", { name: "Topographic" }).click();
  await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText(/OpenTopoMap/, { timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const map = (window as unknown as { __map: maplibregl.Map }).__map;
      return JSON.stringify(map.getPaintProperty("signal-dots", "circle-opacity") ?? "").includes("global-state");
    },
    undefined,
    { timeout: 30_000 },
  );

  // The rail shows the Inspector while it is open; the Sources tab brings the rows back.
  await page.getByRole("tab", { name: "Sources" }).click();
  await page.locator(".map-canvas").hover({ position: { x: 600, y: 400 } });
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual([]);
  await row(page, "wildfires").hover();
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual(["wildfires"]);
});

test("touch: a tap on a label lights it, a second tap clears it, a tap on the map clears it", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
    });
    await answerFeeds(page);
    await page.goto(URL);
    await loaded(page);

    await row(page, "earthquakes").tap();
    await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual(["earthquakes"]);

    // The same tap again closes the popover, and the light goes with it.
    await row(page, "earthquakes").tap();
    await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual([]);

    await row(page, "wildfires").tap();
    await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual(["wildfires"]);
    await page.locator(".map-canvas").tap({ position: { x: 600, y: 400 } });
    await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual([]);

    // A tap on a section heading does nothing: a heading is not a button. (The map tap
    // above opened a country in the rail, so bring the Sources list back first.)
    await page.getByRole("tab", { name: "Sources" }).click();
    await heading(page, "hazards").tap();
    await page.waitForTimeout(300);
    expect(await lit(page)).toEqual([]);
  } finally {
    await context.close();
  }
});
