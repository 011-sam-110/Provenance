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
//
// THE SECOND HALF IS THE PREVIEW. Pointing at a switched-OFF row (or a heading that has off
// rows) draws that source as it would be if it were on, for as long as the pointer stays,
// and writes nothing: those tests snapshot every `tn.*` storage key and the address, and
// check them again afterwards. The reads are routed, so what each one answers is known.

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

const EMPTY_SIGNAL = JSON.stringify({ ok: true, observedAt: 0, count: 0, features: [] });

async function answerFeeds(page: Page) {
  // Every other signal answers an empty list, so a heading that previews its whole section
  // reads nothing from upstream. Registered FIRST: Playwright tries the newest route first.
  await page.route((url) => url.pathname.startsWith("/api/signals/"), (route) =>
    route.fulfill({ contentType: "application/json", body: EMPTY_SIGNAL }),
  );
  const signals: Record<string, Array<[number, number]>> = {
    earthquakes: [[38.0, 23.7], [41.9, 12.5], [48.8, 2.3]],
    wildfires: [[40.4, -3.7], [45.4, 9.2]],
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

const VIEW = "lat=44&lon=12&z=3.5";
const BOARD = `/app?sources=open&${VIEW}&layers=livecams&sig=earthquakes,wildfires&base=light`;
/** Earthquakes is OFF here; wildfires is on, and no camera layer is. */
const OFF_URL = `/app?sources=open&${VIEW}&layers=&sig=wildfires&base=light`;
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

test("hovering a row lights that source, leaving the rail clears it, an off source with nothing in it lights nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BOARD);
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

  // A switched-off source with nothing to show fades nothing. Aurora is off in this URL
  // and answers an empty list.
  await row(page, "aurora").hover();
  await page.waitForTimeout(700);
  expect(await lit(page)).toEqual([]);

  // Live cams is on and has two fixture cameras; Static cams is off and the fixture has
  // no stills, so its preview has nothing to light.
  await row(page, "livecams").hover();
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual(["livecams"]);
  await row(page, "staticcams").hover();
  await page.waitForTimeout(700);
  expect(await lit(page)).toEqual([]);
});

test("a click on the label you are pointing at keeps the light on", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BOARD);
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
  await page.goto(BOARD);
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
  await page.goto(BOARD);
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
  await page.goto(BOARD);
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

  // The glow layers are put back with the rest.
  expect(
    await page.evaluate(() => {
      const map = (window as unknown as { __map: maplibregl.Map }).__map;
      return map.getStyle().layers.filter((l) => l.id.startsWith("srchl-")).length;
    }),
  ).toBeGreaterThanOrEqual(10);

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
    await page.goto(BOARD);
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

// ---------------------------------------------------------------------------------------
// The preview of a switched-off source (lib/shell/sourcePreview.ts)
// ---------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every key this app stores, and the address: what a preview must leave exactly as it found it. */
const snapshot = (page: Page) =>
  page.evaluate(() => ({
    keys: Object.fromEntries(
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith("tn."))
        .sort()
        .map((k) => [k, window.localStorage.getItem(k)]),
    ),
    search: window.location.search,
  }));

/** Features of the aggregated signals source, counted by signal id. */
const signalCounts = (page: Page) =>
  page.evaluate(() => {
    const map = (window as unknown as { __map?: maplibregl.Map }).__map;
    const src = map?.getSource("signals") as unknown as { _data?: { geojson?: GeoJSON.FeatureCollection } } | undefined;
    const out: Record<string, number> = {};
    for (const f of src?._data?.geojson?.features ?? []) {
      const id = String(f.properties?.signalId);
      out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  });

/** Requests to the signal routes and the camera route, with the time each one started. */
function watchReads(page: Page) {
  const reads: Array<{ path: string; at: number }> = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/signals/") || path === "/api/cameras") reads.push({ path, at: Date.now() });
  });
  return reads;
}

/** Every value a row's `data-preview` takes, in order, from the moment this is called. */
async function watchPreview(page: Page, id: string) {
  await page.evaluate((rowId) => {
    const el = document.querySelector(`.tn-src-row[data-source-row="${rowId}"]`);
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    const note = () => {
      const v = el?.getAttribute("data-preview") ?? "idle";
      if (seen[seen.length - 1] !== v) seen.push(v);
    };
    note();
    if (el) new MutationObserver(note).observe(el, { attributes: true, attributeFilter: ["data-preview"] });
  }, id);
}
const previewSeen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);

const rowEl = (page: Page, id: string) => page.locator(`.tn-src-row[data-source-row="${id}"]`);
const popover = (page: Page) => page.locator(".tn-src-pop");

function slowEarthquakes(page: Page, holdMs: number, count = 3) {
  return page.route((url) => url.pathname === "/api/signals/earthquakes", async (route) => {
    await sleep(holdMs);
    await route.fulfill({
      contentType: "application/json",
      body: signalBody("earthquakes", [[38.0, 23.7], [41.9, 12.5], [48.8, 2.3]].slice(0, count) as Array<[number, number]>),
    });
  });
}

test("pointing at a switched-off row previews it, and writes nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const reads = watchReads(page);
  await slowEarthquakes(page, 600);
  await page.goto(OFF_URL);
  await expect.poll(async () => (await signalCounts(page)).wildfires ?? 0, { timeout: 60_000 }).toBe(2);
  // The address is rewritten once, shortly after the map settles (parameter order, a basemap
  // name that is not one of ours). Wait for that to be over: it is not the preview's doing.
  let search = "";
  for (let steady = 0; steady < 4; ) {
    await page.waitForTimeout(300);
    const now = await page.evaluate(() => window.location.search);
    steady = now === search ? steady + 1 : 0;
    search = now;
  }
  const before = await snapshot(page);
  await expect(rowEl(page, "earthquakes").locator(".tn-src-toggle")).toHaveAttribute("aria-checked", "false");
  expect(reads.filter((r) => r.path.endsWith("/earthquakes"))).toHaveLength(0);

  await watchPreview(page, "earthquakes");
  const hoveredAt = Date.now();
  await row(page, "earthquakes").hover();

  // The preview waits for a rest before it reads, and shows a ring while it does.
  await expect.poll(() => reads.filter((r) => r.path.endsWith("/earthquakes")).length, { timeout: 5_000 }).toBe(1);
  expect(reads.find((r) => r.path.endsWith("/earthquakes"))!.at - hoveredAt).toBeGreaterThanOrEqual(250);
  await expect(rowEl(page, "earthquakes")).toHaveAttribute("data-preview", "loading");
  await expect(rowEl(page, "earthquakes")).toHaveAttribute("aria-busy", "true");

  // Then its marks are drawn, the rest fades, and the switch has not moved.
  await expect.poll(() => lit(page), { timeout: 5_000 }).toEqual(["earthquakes"]);
  await expect(rowEl(page, "earthquakes")).toHaveAttribute("data-preview", "ready");
  expect(await signalCounts(page)).toEqual({ wildfires: 2, earthquakes: 3 });
  await expect(rowEl(page, "earthquakes").locator(".tn-src-toggle")).toHaveAttribute("aria-checked", "false");
  await expect(popover(page)).toContainText("Preview only. Switch it on to keep it on the map.");
  expect(await previewSeen(page)).toEqual(["idle", "waiting", "loading", "ready"]);

  // Moving away takes it off again, and the board is exactly as it was.
  await page.locator(".map-canvas").hover({ position: { x: 700, y: 450 } });
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual([]);
  await expect.poll(() => signalCounts(page), { timeout: 3_000 }).toEqual({ wildfires: 2 });
  expect(await snapshot(page)).toEqual(before);

  // The next hover draws from the cache: no second read.
  await row(page, "earthquakes").hover();
  await expect.poll(() => lit(page), { timeout: 3_000 }).toEqual(["earthquakes"]);
  await page.waitForTimeout(600);
  expect(reads.filter((r) => r.path.endsWith("/earthquakes"))).toHaveLength(1);
  await page.locator(".map-canvas").hover({ position: { x: 700, y: 450 } });
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual([]);
  expect(await snapshot(page)).toEqual(before);
});

test("a sweep down the list reads nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const reads = watchReads(page);
  await page.goto(OFF_URL);
  await expect.poll(async () => (await signalCounts(page)).wildfires ?? 0, { timeout: 60_000 }).toBe(2);
  const quiet = reads.length;

  const off = page.locator('[data-section="hazards"] .tn-src-row[data-on="false"] .tn-src-label');
  const boxes = [];
  for (const l of (await off.all()).slice(0, 6)) {
    await l.scrollIntoViewIfNeeded();
    const b = await l.boundingBox();
    if (b) boxes.push(b);
  }
  expect(boxes.length).toBeGreaterThanOrEqual(5);
  // Under 100 ms on each row.
  for (const b of boxes) {
    await page.mouse.move(b.x + 30, b.y + b.height / 2);
    await page.waitForTimeout(40);
  }
  await page.locator(".map-canvas").hover({ position: { x: 700, y: 450 } });
  await page.waitForTimeout(900);
  expect(reads.length).toBe(quiet);
  expect(await lit(page)).toEqual([]);
});

test("a heading previews the whole section: its off sources are read once each, its on ones are only lit", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const reads = watchReads(page);
  await page.goto(OFF_URL);
  await expect.poll(async () => (await signalCounts(page)).wildfires ?? 0, { timeout: 60_000 }).toBe(2);
  const quiet = reads.length;

  await heading(page, "hazards").hover();
  await expect
    .poll(async () => [...((await lit(page)) ?? [])].sort(), { timeout: 10_000 })
    .toEqual(["earthquakes", "wildfires"]);
  expect(await signalCounts(page)).toEqual({ wildfires: 2, earthquakes: 3 });

  const after = reads.slice(quiet).map((r) => r.path);
  expect(after.filter((p) => p.endsWith("/earthquakes"))).toHaveLength(1);
  expect(after.filter((p) => p.endsWith("/wildfires"))).toHaveLength(0); // on: lit, never previewed
  expect(new Set(after).size).toBe(after.length); // one read per source
  expect(after.length).toBeGreaterThan(1); // the other rows of the section were read too

  await page.locator(".map-canvas").hover({ position: { x: 700, y: 450 } });
  await expect.poll(() => signalCounts(page), { timeout: 3_000 }).toEqual({ wildfires: 2 });
});

test("a failed read fades nothing and says so, and is not retried while you stay", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const reads = watchReads(page);
  await page.route((url) => url.pathname === "/api/signals/earthquakes", (route) => route.fulfill({ status: 500, body: "boom" }));
  await page.goto(OFF_URL);
  await expect.poll(async () => (await signalCounts(page)).wildfires ?? 0, { timeout: 60_000 }).toBe(2);

  await row(page, "earthquakes").hover();
  await expect(rowEl(page, "earthquakes")).toHaveAttribute("data-preview", "failed", { timeout: 5_000 });
  await expect(popover(page)).toContainText("No preview right now.");
  await page.waitForTimeout(800);
  expect(await lit(page)).toEqual([]);
  expect(reads.filter((r) => r.path.endsWith("/earthquakes"))).toHaveLength(1);
});

test("an empty read fades nothing and says so", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route((url) => url.pathname === "/api/signals/earthquakes", (route) =>
    route.fulfill({ contentType: "application/json", body: signalBody("earthquakes", []) }),
  );
  await page.goto(OFF_URL);
  await expect.poll(async () => (await signalCounts(page)).wildfires ?? 0, { timeout: 60_000 }).toBe(2);

  await row(page, "earthquakes").hover();
  await expect(rowEl(page, "earthquakes")).toHaveAttribute("data-preview", "empty", { timeout: 5_000 });
  await expect(popover(page)).toContainText("Nothing to show right now.");
  expect(await lit(page)).toEqual([]);
});

test("keyboard focus on an off row reads at once, with no rest first", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(OFF_URL);
  await expect.poll(async () => (await signalCounts(page)).wildfires ?? 0, { timeout: 60_000 }).toBe(2);

  await watchPreview(page, "earthquakes");
  await page.keyboard.press("Shift");
  await row(page, "earthquakes").focus();
  await expect.poll(() => lit(page), { timeout: 5_000 }).toEqual(["earthquakes"]);
  // Never "waiting": that is the rest a resting pointer has to sit through.
  expect(await previewSeen(page)).not.toContain("waiting");
  expect(await previewSeen(page)).toContain("ready");
  await row(page, "earthquakes").blur();
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual([]);
});

test("switching the source on while it is previewed does not draw it twice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(OFF_URL);
  await expect.poll(async () => (await signalCounts(page)).wildfires ?? 0, { timeout: 60_000 }).toBe(2);

  await row(page, "earthquakes").hover();
  await expect.poll(async () => (await signalCounts(page)).earthquakes ?? 0, { timeout: 5_000 }).toBe(3);

  await rowEl(page, "earthquakes").locator(".tn-src-toggle").click();
  await expect(rowEl(page, "earthquakes").locator(".tn-src-toggle")).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(1_200);
  expect((await signalCounts(page)).earthquakes).toBe(3);
  // ...and still 3 once the pointer has gone.
  await page.locator(".map-canvas").hover({ position: { x: 700, y: 450 } });
  await page.waitForTimeout(1_200);
  expect((await signalCounts(page)).earthquakes).toBe(3);
});

test("phone: the camera rows say 'Switch it on to see them' and read nothing; a signal previews", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
    });
    await answerFeeds(page);
    const reads = watchReads(page);
    await page.goto(OFF_URL);
    expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true);
    await expect.poll(async () => (await signalCounts(page)).wildfires ?? 0, { timeout: 60_000 }).toBe(2);

    await row(page, "livecams").tap();
    await expect(rowEl(page, "livecams")).toHaveAttribute("data-preview", "unavailable", { timeout: 3_000 });
    await expect(popover(page)).toContainText("Switch it on to see them.");
    await page.waitForTimeout(600);
    expect(reads.filter((r) => r.path === "/api/cameras")).toHaveLength(0);
    expect(await lit(page)).toEqual([]);

    // An off signal previews at once on a tap.
    await row(page, "earthquakes").tap();
    await expect.poll(() => lit(page), { timeout: 5_000 }).toEqual(["earthquakes"]);
    expect(await signalCounts(page)).toEqual({ wildfires: 2, earthquakes: 3 });
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------------------
// Two fixes from QA: the popover never blocks the list, and the lit marks glow
// ---------------------------------------------------------------------------------------

test("the popover takes no pointer events and never covers the rows below its own", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BOARD);
  await loaded(page);

  const labels = page.locator('[data-section="hazards"] .tn-src-row .tn-src-label');
  const count = Math.min(await labels.count(), 8);
  expect(count).toBeGreaterThanOrEqual(6);
  await labels.first().scrollIntoViewIfNeeded();

  // A slow sweep: rest on each row until its popover is up, then move to the next row and
  // ask what is under the pointer there. It must be that row, never the previous popover.
  for (let i = 0; i < count; i++) {
    await labels.nth(i).scrollIntoViewIfNeeded();
    const b = (await labels.nth(i).boundingBox())!;
    await page.mouse.move(b.x + 30, b.y + b.height / 2);
    await expect(popover(page)).toHaveCount(1);
    const info = await page.evaluate(
      ({ x, y }) => {
        const under = document.elementFromPoint(x, y);
        const pop = document.querySelector(".tn-src-pop") as HTMLElement | null;
        const r = pop?.getBoundingClientRect();
        const rail = document.querySelector(".tn-rail")?.getBoundingClientRect();
        return {
          rowId: under?.closest(".tn-src-row")?.getAttribute("data-source-row") ?? null,
          inPopover: !!under?.closest(".tn-src-pop"),
          pointerEvents: pop ? getComputedStyle(pop).pointerEvents : null,
          popLeft: r?.left ?? null,
          railRight: rail?.right ?? null,
        };
      },
      { x: b.x + 30, y: b.y + b.height / 2 },
    );
    expect(info.inPopover).toBe(false);
    expect(info.rowId).toBe(await labels.nth(i).evaluate((el) => el.closest(".tn-src-row")!.getAttribute("data-source-row")));
    expect(info.pointerEvents).toBe("none");
    // Beside the rail, not over it.
    expect(info.popLeft!).toBeGreaterThanOrEqual(info.railRight!);
  }

  // A fast sweep over the same rows lands on the last one.
  const last = (await labels.nth(count - 1).boundingBox())!;
  const first = (await labels.nth(0).boundingBox())!;
  await page.mouse.move(first.x + 30, first.y + first.height / 2);
  for (let i = 0; i <= 24; i++) {
    await page.mouse.move(first.x + 30, first.y + first.height / 2 + ((last.y - first.y) * i) / 24);
  }
  await expect(popover(page)).toHaveCount(1);
  const lastId = await labels.nth(count - 1).evaluate((el) => el.closest(".tn-src-row")!.getAttribute("data-source-row"));
  await expect(rowEl(page, lastId!)).toHaveCSS("background-color", /rgb/);
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest(".tn-src-row")?.getAttribute("data-source-row"),
      { x: last.x + 30, y: last.y + last.height / 2 },
    ),
  ).toBe(lastId);
});

test("on the phone the popover sits over the rows above, and takes no taps", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
    });
    await answerFeeds(page);
    await page.goto(BOARD);
    await expect.poll(async () => (await signalCounts(page)).wildfires ?? 0, { timeout: 60_000 }).toBe(2);

    const labels = page.locator('[data-section="hazards"] .tn-src-row .tn-src-label');
    await labels.nth(4).scrollIntoViewIfNeeded();
    await labels.nth(4).tap();
    await expect(popover(page)).toHaveCount(1);
    const info = await page.evaluate(() => {
      const pop = document.querySelector(".tn-src-pop") as HTMLElement;
      const row = document.querySelector(".tn-src-pop")?.id
        ? document.querySelector(`[aria-describedby="${pop.id}"]`)?.closest(".tn-src-row")
        : null;
      const p = pop.getBoundingClientRect();
      const r = row?.getBoundingClientRect();
      const sheet = document.querySelector(".tn-rail")?.getBoundingClientRect();
      return {
        pointerEvents: getComputedStyle(pop).pointerEvents,
        popTop: p.top,
        popBottom: p.bottom,
        rowTop: r?.top ?? null,
        rowBottom: r?.bottom ?? null,
        sheetTop: sheet?.top ?? null,
      };
    });
    expect(info.pointerEvents).toBe("none");
    // Over the rows above: its bottom edge is at or above this row's top, never below the row...
    expect(info.popBottom).toBeLessThanOrEqual(info.rowTop!);
    // ...and inside the sheet, so the strip of map above it, where a tap's marks show, stays clear.
    expect(info.popTop).toBeGreaterThanOrEqual(info.sheetTop!);
    // A tap on the next row goes to the next row.
    const next = (await labels.nth(5).boundingBox())!;
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest(".tn-src-row")?.getAttribute("data-source-row"),
      { x: next.x + 20, y: next.y + next.height / 2 },
    );
    expect(hit).toBe(await labels.nth(5).evaluate((el) => el.closest(".tn-src-row")!.getAttribute("data-source-row")));
  } finally {
    await context.close();
  }
});

test("the lit marks glow: halo layers sit under the marks they pick out, filtered to the lit source", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BOARD);
  await loaded(page);

  // (queryRenderedFeatures is not used here: it throws while a source is being rebuilt, which
  // is exactly when a hover happens. The layers' own filters say what each one draws.)
  const halos = () =>
    page.evaluate(() => {
      const map = (window as unknown as { __map: maplibregl.Map }).__map;
      const layers = map.getStyle().layers.map((l) => l.id);
      return {
        count: layers.filter((id) => id.startsWith("srchl-")).length,
        points: map.getFilter("srchl-signal-points"),
        cameras: map.getFilter("srchl-cameras"),
        // Where it sits: beneath the marks it picks out, never above them.
        below:
          layers.indexOf("srchl-signal-points") < layers.indexOf("signal-dots") &&
          layers.indexOf("srchl-cameras") < layers.indexOf("camera-dots"),
        casingFirst: layers.indexOf("srchl-signal-lines-casing") < layers.indexOf("srchl-signal-lines"),
      };
    });

  const rest = await halos();
  expect(rest.count).toBeGreaterThanOrEqual(10);
  expect(rest.below).toBe(true);
  expect(rest.casingFirst).toBe(true);
  // The filter IS the owner match: with nothing lit the list is empty, so the layer holds no
  // feature and costs nothing at rest.
  expect(rest.points).toEqual(["in", ["get", "signalId"], ["global-state", "srcHover"]]);
  expect(JSON.stringify(rest.cameras)).toContain('"feed"');
  expect(await lit(page)).toEqual([]);

  // Lit, the same layers draw: the global state is what they filter on.
  await row(page, "earthquakes").hover();
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual(["earthquakes"]);
  await page.waitForTimeout(500);
  await page.locator(".map-canvas").hover({ position: { x: 700, y: 450 } });
  await expect.poll(() => lit(page), { timeout: 2_000 }).toEqual([]);
});
