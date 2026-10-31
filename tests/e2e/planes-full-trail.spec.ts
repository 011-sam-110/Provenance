import { expect, test, type Page } from "@playwright/test";

// The Full flight trail setting, in the browser: the switch in Map settings, the long line on the
// map, a click that loads the stored line, and the 12-point line it leaves alone when off.
//
// WHY E2E. tests/unit/plane-track-*.test.ts and plane-full-history.test.ts hold the rules. What
// they cannot reach is the wiring: a real switch, a real poll, MapLibre taking the line, and a
// click on a real plane mark.
//
// THE FEEDS ARE ROUTED. /api/planes answers a sequence, with one new snapshot each poll, and
// /api/planes/track answers fixtures, so nothing here depends on adsb.lol. The poll's 12 s is
// shortened in the page (the only 12,000 ms interval the console starts in these tests), or a
// line past 12 points would take three minutes to grow.
//
// WHAT IT READS is the map's own source (`window.__map`, WorldMap's debug handle), not a
// screenshot: a line that looks long and a line that is long are different claims.

test.setTimeout(180_000);

const ID = "plane:abc123";
const QUIET_ID = "plane:0ff1ce";
const PULL_MS = 120_000;
const T0 = Date.now() - 6 * 3_600_000;

/** A plane on a curve of 8 degrees a pull, so thinning keeps every position. */
function pathOf(pulls: number, from: { lat: number; lon: number }) {
  const out = [from];
  let { lat, lon } = from;
  for (let i = 1; i <= pulls; i++) {
    const b = (i * 8 * Math.PI) / 180;
    lat += Math.cos(b) * 0.2;
    lon += Math.sin(b) * 0.25;
    out.push({ lat, lon });
  }
  return out;
}

const PATH = pathOf(200, { lat: 48, lon: 2 });
const QUIET_PATH = pathOf(200, { lat: 44, lon: 12 });

function planeRow(id: string, at: { lat: number; lon: number }) {
  return {
    kind: "plane",
    id,
    lat: at.lat,
    lon: at.lon,
    altKm: 10.5,
    heading: 90,
    label: id.slice(6).toUpperCase(),
    color: "#fbbf24",
    icon: "plane-airliner",
    typeLabel: "Airliner",
    meta: { callsign: id.slice(6).toUpperCase(), category: "airliner", velocityMs: 240, altKm: 10.5, onGround: false, headingDeg: 90 },
  };
}

interface Feeds {
  planesCalls: number;
  trackCalls: string[];
  /** Snapshots from this step on repeat the last one, so a plane holds still for a click. */
  holdAfter: number;
}

/** Answer the plane feed and the stored line, and stay out of every other request's way. */
async function routeFeeds(page: Page, track: (id: string, step: number) => unknown): Promise<Feeds> {
  const feeds: Feeds = { planesCalls: 0, trackCalls: [], holdAfter: Number.POSITIVE_INFINITY };
  await page.route((url) => url.pathname === "/api/planes", (route) => {
    const step = Math.min(feeds.planesCalls, feeds.holdAfter);
    feeds.planesCalls += 1;
    const body = {
      count: 2,
      source: "adsb.lol",
      fetchedAt: T0 + step * PULL_MS,
      planes: [planeRow(ID, PATH[step % PATH.length]), planeRow(QUIET_ID, QUIET_PATH[step % QUIET_PATH.length])],
    };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route((url) => url.pathname === "/api/planes/track", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id") ?? "";
    feeds.trackCalls.push(id);
    const step = Math.min(feeds.planesCalls - 1, feeds.holdAfter);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(track(id, step)) });
  });
  await page.route((url) => url.pathname === "/api/flight", (route) =>
    route.fulfill({ contentType: "application/json", body: "null" }),
  );
  return feeds;
}

const emptyTrack = (id: string) => ({ id, firstHeardAt: null, lastHeardAt: null, trimmed: false, points: [], breaks: [] });

/** Ten stored points from before the tab opened, on a path that runs up to where the tab's begins. */
const STORED_BEFORE = pathOf(9, { lat: 46, lon: 0 });

/**
 * What the server would hold: the points before the tab opened, then the same pulls the tab has
 * been taking, up to the one it took last. Only the ones older than the tab's own line get used.
 */
function serverLine(id: string, step: number, breaks: number[]) {
  const older = STORED_BEFORE.map((p, i) => [p.lat, p.lon, 10.5, T0 - (STORED_BEFORE.length - i) * PULL_MS]);
  const heard = PATH.slice(0, step + 1).map((p, i) => [p.lat, p.lon, 10.5, T0 + i * PULL_MS]);
  return { id, firstHeardAt: older[0][3], lastHeardAt: T0 + step * PULL_MS, trimmed: false, points: [...older, ...heard], breaks };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
    const realInterval = window.setInterval.bind(window);
    window.setInterval = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) =>
      realInterval(fn, ms === 12_000 ? 350 : ms, ...rest)) as typeof window.setInterval;
  });
});

async function openConsole(page: Page) {
  await page.goto("/app");
  await page.waitForFunction(() => Boolean((window as unknown as { __map?: unknown }).__map), null, { timeout: 90_000 });
  await page.waitForFunction(
    () => (window as unknown as { __map: { isStyleLoaded(): boolean } }).__map.isStyleLoaded(),
    null,
    { timeout: 90_000 },
  );
}

/** One panel beside the console's sidebar, the way a person opens it. */
async function openPanel(page: Page, row: "sources" | "settings") {
  const entry = page.locator(`nav[data-rail="console"] [data-rail-entry="${row}"]`);
  if ((await entry.getAttribute("aria-expanded")) !== "true") await entry.click();
  await expect(entry).toHaveAttribute("aria-expanded", "true");
}

/** The Planes row of the Sources rail: the layer is off on a fresh console. */
async function turnPlanesOn(page: Page) {
  await openPanel(page, "sources");
  const search = page.getByLabel("Search sources");
  await search.fill("Planes");
  const toggle = page.locator('.tn-src-row[data-source-row="planes"] .tn-src-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await search.fill("");
}

async function openMapSettings(page: Page) {
  await openPanel(page, "settings");
  return page.getByRole("switch", { name: "Full flight trail" });
}

interface DrawnLine {
  type: string;
  parts: number[][][];
  vertices: number;
}

/** What the map holds for a plane's line. */
function drawnLine(page: Page, id: string): Promise<DrawnLine | null> {
  return page.evaluate((planeId) => {
    const map = (window as unknown as {
      __map: { getSource(id: string): { serialize(): { data: GeoJSON.FeatureCollection } } | undefined };
    }).__map;
    const data = map.getSource("trails")?.serialize().data;
    const f = data?.features.find((x) => x.properties?.id === planeId);
    if (!f) return null;
    const g = f.geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
    const parts = g.type === "LineString" ? [g.coordinates] : g.coordinates;
    return { type: g.type, parts, vertices: parts.reduce((s, p) => s + p.length, 0) };
  }, id);
}

async function waitForVertices(page: Page, id: string, atLeast: number) {
  await expect
    .poll(async () => (await drawnLine(page, id))?.vertices ?? 0, { timeout: 60_000, intervals: [250] })
    .toBeGreaterThanOrEqual(atLeast);
}

/** Click the plane's mark on the map. */
async function clickPlane(page: Page, id: string, feeds: Feeds) {
  // Hold the feed so the mark stays where it is, then bring the plane into view.
  feeds.holdAfter = feeds.planesCalls;
  const before = feeds.planesCalls;
  await expect.poll(() => feeds.planesCalls, { timeout: 15_000 }).toBeGreaterThan(before + 1);
  const spot = await page.evaluate(async (planeId) => {
    const map = (window as unknown as {
      __map: {
        jumpTo(o: { center: [number, number]; zoom: number }): void;
        getSource(id: string): { serialize(): { data: GeoJSON.FeatureCollection } } | undefined;
        project(p: [number, number]): { x: number; y: number };
        getCanvas(): HTMLCanvasElement;
        once(e: string, f: () => void): void;
        queryRenderedFeatures(p: [number, number], o: { layers: string[] }): unknown[];
      };
    }).__map;
    const f = map.getSource("planes")?.serialize().data.features.find((x) => x.properties?.id === planeId);
    if (!f) return null;
    const c = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    map.jumpTo({ center: c, zoom: 6 });
    await new Promise<void>((r) => map.once("idle", () => r()));
    const p = map.project(c);
    const box = map.getCanvas().getBoundingClientRect();
    return { x: box.left + p.x, y: box.top + p.y, px: p.x, py: p.y };
  }, id);
  expect(spot, `the plane ${id} is on the map`).not.toBeNull();
  // A click that misses a mark opens the country under it, so wait until the mark is under the
  // pointer, and then check whose panel opened.
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ px, py, planeId }) => {
            const map = (window as unknown as {
              __map: { queryRenderedFeatures(p: [number, number], o: { layers: string[] }): { properties?: { id?: string } }[] };
            }).__map;
            return map.queryRenderedFeatures([px, py], { layers: ["plane-markers"] }).some((f) => f.properties?.id === planeId);
          },
          { px: spot!.px, py: spot!.py, planeId: id },
        ),
      { timeout: 30_000, intervals: [250] },
    )
    .toBe(true);
  await page.mouse.click(spot!.x, spot!.y);
  await expect(page.locator(".tn-inspector[role=dialog]")).toContainText(id.slice(6).toUpperCase(), { timeout: 15_000 });
}

test("off by default: the switch is off and the line stops at the short cap", async ({ page }) => {
  const feeds = await routeFeeds(page, emptyTrack);
  await openConsole(page);
  await turnPlanesOn(page);

  await expect.poll(() => feeds.planesCalls, { timeout: 60_000 }).toBeGreaterThan(20);
  // 11 points behind it, the plane, and the point ahead: 13 vertices, as it has always been.
  const line = await drawnLine(page, ID);
  expect(line?.type).toBe("LineString");
  expect(line?.vertices).toBe(13);

  const toggle = await openMapSettings(page);
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Each line grows while this tab is open. Click a plane to load its line from when we first heard it.")).toBeVisible();
  // Off asks the store nothing, even for a plane someone clicks.
  await clickPlane(page, ID, feeds);
  expect(feeds.trackCalls).toEqual([]);
  await expect(page.getByText(/first heard it/)).toHaveCount(0);
});

test("on: the line grows past the cap, and switching off puts the short line back", async ({ page }) => {
  const feeds = await routeFeeds(page, emptyTrack);
  await openConsole(page);
  await turnPlanesOn(page);
  await expect.poll(() => feeds.planesCalls, { timeout: 60_000 }).toBeGreaterThan(14);
  await expect.poll(async () => (await drawnLine(page, ID))?.vertices ?? 0).toBe(13);

  const toggle = await openMapSettings(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await waitForVertices(page, ID, 25);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await drawnLine(page, ID))?.vertices ?? 0, { timeout: 15_000 }).toBe(13);
});

test("a click loads the stored line once, joined to the tab's line with no jump", async ({ page }) => {
  const feeds = await routeFeeds(page, (id, step) => (id === ID ? serverLine(id, step, []) : emptyTrack(id)));
  await openConsole(page);
  await turnPlanesOn(page);
  const toggle = await openMapSettings(page);
  await toggle.click();
  await waitForVertices(page, ID, 15);
  const before = await drawnLine(page, ID);

  await clickPlane(page, ID, feeds);
  await expect.poll(() => feeds.trackCalls).toEqual([ID]);
  await expect(page.getByText(/Its line runs from when we first heard it, at /)).toBeVisible();

  await expect.poll(async () => (await drawnLine(page, ID))?.parts[0]?.[0]?.[1] ?? 0).toBeCloseTo(STORED_BEFORE[0].lat, 3);
  const after = await drawnLine(page, ID);
  expect(after?.type).toBe("LineString");
  expect(after!.vertices).toBeGreaterThanOrEqual(before!.vertices + STORED_BEFORE.length);

  // No jump: each stored point is where the fixture put it, and the tab's first point follows.
  const coords = after!.parts[0];
  for (let i = 0; i < STORED_BEFORE.length; i++) {
    expect(coords[i][1]).toBeCloseTo(STORED_BEFORE[i].lat, 5);
    expect(coords[i][0]).toBeCloseTo(STORED_BEFORE[i].lon, 5);
  }
  expect(coords[STORED_BEFORE.length][1]).toBeCloseTo(PATH[0].lat, 5);

  // The projected point ahead is still last, past the plane's own position.
  const end = coords[coords.length - 2];
  const held = PATH[feeds.holdAfter % PATH.length];
  expect(end[1]).toBeCloseTo(held.lat, 5);
  expect(end[0]).toBeCloseTo(held.lon, 5);
  expect(coords[coords.length - 1][0]).toBeGreaterThan(held.lon);

  // Once: a second click on the same plane asks nothing.
  await page.mouse.click(10, 300); // off the mark
  const box = await page.evaluate(() => {
    const map = (window as unknown as { __map: { getCenter(): { lng: number; lat: number }; project(p: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement } }).__map;
    const c = map.getCenter();
    const p = map.project([c.lng, c.lat]);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(800);
  expect(feeds.trackCalls).toEqual([ID]);
});

test("a stored gap stays a gap: nothing is drawn across it", async ({ page }) => {
  const feeds = await routeFeeds(page, (id, step) => serverLine(id, step, [5]));
  await openConsole(page);
  await turnPlanesOn(page);
  await (await openMapSettings(page)).click();
  await waitForVertices(page, ID, 15);
  await clickPlane(page, ID, feeds);

  await expect.poll(async () => (await drawnLine(page, ID))?.type, { timeout: 15_000 }).toBe("MultiLineString");
  const line = await drawnLine(page, ID);
  expect(line!.parts[0]).toHaveLength(5);
  expect(line!.parts[1][0][1]).toBeCloseTo(STORED_BEFORE[5].lat, 5);
});

test("a reload keeps the switch, and the long line, without opening Map settings", async ({ page }) => {
  const feeds = await routeFeeds(page, emptyTrack);
  await openConsole(page);
  await turnPlanesOn(page);
  const toggle = await openMapSettings(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const saved = await page.evaluate(() => window.localStorage.getItem("tn.planes.fullTrail.v1"));
  expect(saved).toBe(JSON.stringify({ v: 1, d: { on: true } }));

  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __map?: unknown }).__map), null, { timeout: 90_000 });
  await waitForVertices(page, ID, 20);
  await expect(await openMapSettings(page)).toHaveAttribute("aria-checked", "true");
  void feeds;
});

test("an unknown plane is quiet: an empty line, no error, and its own line stays", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    // Only this feature's own requests and words. MapLibre can warn about a plane icon at start-up.
    if ((m.type() === "error" || m.type() === "warning") && /planes\/track|stored line|first heard/i.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  const feeds = await routeFeeds(page, emptyTrack);
  await openConsole(page);
  await turnPlanesOn(page);
  await (await openMapSettings(page)).click();
  await waitForVertices(page, QUIET_ID, 15);
  const before = (await drawnLine(page, QUIET_ID))!;

  await clickPlane(page, QUIET_ID, feeds);
  await expect.poll(() => feeds.trackCalls).toEqual([QUIET_ID]);
  await expect(page.getByText("We hold no line for it yet. Its line runs from when this tab first heard it.")).toBeVisible();

  const after = (await drawnLine(page, QUIET_ID))!;
  expect(after.type).toBe("LineString");
  expect(after.vertices).toBeGreaterThanOrEqual(before.vertices);
  expect(problems).toEqual([]);
});

test("a failed fetch keeps the line, says so, and can be asked again", async ({ page }) => {
  const feeds = await routeFeeds(page, emptyTrack);
  let failures = 1;
  await page.route((url) => url.pathname === "/api/planes/track", (route) => {
    if (failures > 0) {
      failures -= 1;
      return route.fulfill({ status: 500, body: "nope" });
    }
    return route.fallback();
  });
  await openConsole(page);
  await turnPlanesOn(page);
  await (await openMapSettings(page)).click();
  await waitForVertices(page, ID, 15);
  const before = (await drawnLine(page, ID))!;

  await clickPlane(page, ID, feeds);
  await expect(page.getByText("Its stored line did not load. The line in this tab stays.")).toBeVisible();
  expect((await drawnLine(page, ID))!.vertices).toBeGreaterThanOrEqual(before.vertices);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/We hold no line for it yet/)).toBeVisible();
  expect(feeds.trackCalls).toEqual([ID]);
});
