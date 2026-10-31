import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import type maplibregl from "maplibre-gl";

/**
 * The person on the console's map (components/console/EyePerson.tsx), driven by real pointer
 * events on the real map. Run it on a production build in real Chrome with the GPU flags. The rules
 * are in tests/unit/eye-person.test.ts and tests/unit/eye-coverage.test.ts.
 *
 *   - Where a drop goes: each kind of line in the acceptance table, by a real drag.
 *   - He hangs from the pointer with the ring 58 px below it. Coverage lights up on the first move,
 *     not on the hover and not on the press, and is hidden the moment the carry ends.
 *   - A drag sends no location: the network is watched through a whole carry.
 *   - A miss says so before the release, flies home in about 500 ms, and leaves the address alone.
 *   - A click toggles coverage, a click on the map opens the search's result, and Esc turns it off.
 *   - The keyboard: Enter or Space toggles, arrows pan, Enter drops.
 *   - The edge pan, on the globe, with one `moveend`, and it stops on the release.
 *   - The card flips and stays on the screen at all four edges of the map.
 *   - Everything v1 held: above the i, a credit that does not move it, a late control above it,
 *     Escape's ladder, off the map and off the globe, a flat map, terrain, Streets, a widget.
 *   - 390 px with a real finger, and reduced motion.
 *
 * THE COVERAGE ROUTE IS STUBBED from tests/fixtures/eye-coverage.json, production's own cells, because
 * a cold local server has no TfL for its first 5 minutes. Run it once with EYE_PERSON_REAL=1 to
 * use the real route: only the tests that say so run then.
 *
 * THE HOOKS: `window.__map` (WorldMap's debug handle), `[data-eye-person-layer]` and its
 * `data-result` (off, miss, hit) and `data-ring` (moving, hit) while carrying, and
 * `main[data-eye-state="ready"]` on /eye. The stores that would cover the map (the boot plate and
 * the two corner notes) are stamped first. The gate (`npx tsc --noEmit && npm test`) does NOT run
 * this file. See CLAUDE.md, "Build gate". Set EYE_PERSON_SHOTS=<dir> to keep a screenshot of each state.
 */

test.describe.configure({ timeout: 120_000 });

const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "eye-coverage.json"), "utf8"));
const REAL = Boolean(process.env.EYE_PERSON_REAL);
const SHOTS = process.env.EYE_PERSON_SHOTS;

const DROP = "Drop to open God's eye view";
const MISS = "No cameras near here";
const OFF = "Not on the map. Let go to cancel";
const HANG = 58;

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: "jpeg", quality: 70 });
};

type Skin = "light" | "dark";
type Pt = { x: number; y: number };
type Win = Window & { __map: maplibregl.Map };

const person = (page: Page) => page.locator("[data-eye-person]");
const layer = (page: Page) => page.locator("[data-eye-person-layer]");
const ring = (page: Page) => page.locator("[data-eye-person-ring]");
const hit = (page: Page) => page.locator("[data-eye-person-hit]");
const card = (page: Page) => page.locator("[data-eye-person-card]");
const plate = (page: Page) => page.locator("[data-eye-person-label]");
const legend = (page: Page) => page.locator("[data-eye-person-legend]");
const iButton = (page: Page) => page.locator(".maplibregl-ctrl-attrib-button");
/** The i as it is drawn. On main its button sits 1 px off this circle; PR #339 lines them up. */
const iCircle = (page: Page) => page.locator(".maplibregl-ctrl-attrib");

async function seed(page: Page, skin: Skin = "dark") {
  await page.addInitScript((s) => {
    const env = (d: unknown) => JSON.stringify({ v: 1, d });
    const ls = window.localStorage;
    ls.setItem("tn.terminal.boot.v1", env({ seenVersion: 1 }));
    ls.setItem("tn.feedback.v1", env({ visits: 3, activeMs: 0, resolved: "dismissed" }));
    ls.setItem("tn.community.v1", env({ visits: 3, activeMs: 0, resolved: "dismissed" }));
    ls.setItem("tn.terminal.skin.v2", env(s));
  }, skin);
}

/** Town names for the fixture's places, so a test does not depend on a community geocoder. */
const TOWNS: [number, number, string][] = [
  [55.86, -4.25, "Glasgow"],
  [55.95, -3.3, "Edinburgh"],
  [33.75, -84.39, "Atlanta"],
  [25.05, 121.6, "Taipei"],
  [24.1, 120.7, "Taichung"],
];

/**
 * Answer the person's three calls from the fixture: the index, the points in a box, the town for a
 * cell. The stills come back as one small real JPEG unless `stills` says otherwise.
 */
async function stub(page: Page, opts: { index?: "fixture" | "empty" | "fail"; stills?: "ok" | "fail" } = {}) {
  const index = opts.index ?? "fixture";
  await page.route("**/api/eye/coverage**", (route) => {
    const box = new URL(route.request().url()).searchParams.get("bbox");
    if (index === "fail") return route.abort();
    if (index === "empty") return route.fulfill({ json: { ok: false, regions: [], cells: [], total: 0, points: [] } });
    if (!box) return route.fulfill({ json: fixture });
    const [w, s, e, n] = box.split(",").map(Number);
    const points = (fixture.cells as [number, number, number, number, string, number][])
      .filter((c) => c[0] >= s && c[0] <= n && c[1] >= w && c[1] <= e)
      .map((c) => [c[0], c[1], c[4], 0, `Camera ${c[4]}`]);
    return route.fulfill({ json: { ok: true, box: [w, s, e, n], total: points.length, points } });
  });
  await page.route("**/api/geocode?**", (route) => {
    const q = new URL(route.request().url()).searchParams;
    const lat = Number(q.get("lat"));
    const lon = Number(q.get("lon"));
    const town = TOWNS.find(([a, b]) => Math.abs(a - lat) < 0.6 && Math.abs(b - lon) < 0.6);
    return route.fulfill({ json: { results: town ? [{ name: `A road, ${town[2]}`, lat, lon, locality: town[2] }] : [] } });
  });
  await page.route("**/api/proxy?**", (route) =>
    opts.stills === "fail"
      ? route.fulfill({ status: 404, body: "no picture" })
      : route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="#567"/></svg>' }),
  );
}

/** Open the console, with the person up and the map in its final projection. */
async function openMap(page: Page, url: string, projection: "globe" | "mercator" | null = "globe") {
  await page.goto(url);
  await expect(person(page)).toBeVisible({ timeout: 90_000 });
  if (!projection) return;
  await page.waitForFunction(
    (want) => (window as unknown as Win).__map?.getProjection?.()?.type === want,
    projection,
    { timeout: 90_000 },
  );
}

const at = (lat: number, lon: number, z: number, base = "satellite") => `/app?lat=${lat}&lon=${lon}&z=${z}&layers=&base=${base}`;

async function box(loc: Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error(`no box for ${loc}`);
  return b;
}

const centre = (b: { x: number; y: number; width: number; height: number }): Pt => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

/** Where a place is on screen, in window px. */
const windowPoint = (page: Page, lng: number, lat: number): Promise<Pt> =>
  page.evaluate(
    ([lng, lat]) => {
      const m = (window as unknown as Win).__map;
      const r = m.getContainer().getBoundingClientRect();
      const p = m.project([lng, lat]);
      return { x: r.left + p.x, y: r.top + p.y };
    },
    [lng, lat],
  );

/** What the map says is under a window point, and how far one pixel reaches there. */
const underPoint = (page: Page, point: Pt) =>
  page.evaluate(({ x, y }) => {
    const m = (window as unknown as Win).__map;
    const r = m.getContainer().getBoundingClientRect();
    const px = x - r.left;
    const py = y - r.top;
    const u = m.unproject([px, py]);
    const dx = m.unproject([px + 1, py]);
    const dy = m.unproject([px, py + 1]);
    const back = m.project(u);
    return {
      lat: u.lat,
      lon: u.lng,
      perPixel: Math.max(Math.abs(dx.lat - u.lat), Math.abs(dx.lng - u.lng), Math.abs(dy.lat - u.lat), Math.abs(dy.lng - u.lng)),
      roundTrip: Math.hypot(back.x - px, back.y - py),
    };
  }, point);

const mapCentre = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as Win).__map;
    const c = m.getCenter();
    return { lat: c.lat, lon: c.lng, zoom: m.getZoom(), bearing: m.getBearing() };
  });

const overlayShown = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as Win).__map;
    const has = Boolean(m.getLayer("eye-coverage-core"));
    return { has, visible: has && m.getLayoutProperty("eye-coverage-core", "visibility") !== "none" };
  });

const eyeQuery = (page: Page) => new URL(page.url()).searchParams;
const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Press on the person and move so that the RING lands on a window point. */
async function carryRingTo(page: Page, to: Pt, steps = 12) {
  const from = centre(await box(person(page)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y - HANG, { steps });
  await expect(layer(page)).toHaveCount(1);
  await frame(page);
}

/** The same, then wait for the ring to settle and the card to be asked for. */
async function settleOn(page: Page, to: Pt) {
  await carryRingTo(page, to);
  await page.waitForTimeout(450);
}

async function expectAtHome(page: Page) {
  await expect(layer(page)).toHaveCount(0);
  await expect(person(page)).toHaveAttribute("data-state", "idle");
  expect(new URL(page.url()).pathname).toBe("/app");
}

/** Page errors and console errors. A failed fetch of a tile is the network's, and not ours. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/Failed to load resource|net::ERR|AJAXError|tiles?\b|WebGL.*GroupMarker|the server responded/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

const dropRing = async (page: Page, to: Pt) => {
  await carryRingTo(page, to);
  await page.mouse.up();
  await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
  return eyeQuery(page);
};

const kmFrom = (q: URLSearchParams, lat: number, lon: number) => {
  const dLat = ((Number(q.get("lat")) - lat) * Math.PI) / 180;
  const dLon = ((Number(q.get("lon")) - lon) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((Number(q.get("lat")) * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
};

const PRESET_IDS = ["westminster", "tower-bridge", "piccadilly"];

test.describe("1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.skip(REAL, "stubbed");

  test.beforeEach(async ({ page }) => {
    await stub(page);
  });

  test.describe("where a drop goes, by a real drag", () => {
    const table: {
      name: string;
      lat: number;
      lon: number;
      z: number;
      expectIt: (q: URLSearchParams) => void;
    }[] = [
      { name: "London at zoom 3", lat: 51.5, lon: -0.12, z: 3, expectIt: (q) => expect(PRESET_IDS).toContain(q.get("place")) },
      { name: "London at zoom 6", lat: 51.5, lon: -0.12, z: 6, expectIt: (q) => expect(PRESET_IDS).toContain(q.get("place")) },
      { name: "Manchester at zoom 6", lat: 53.48, lon: -2.24, z: 6, expectIt: (q) => expect(PRESET_IDS).toContain(q.get("place")) },
      { name: "mid-Wales at zoom 6", lat: 52.35, lon: -3.75, z: 6, expectIt: (q) => expect(PRESET_IDS).toContain(q.get("place")) },
      {
        name: "Inverness at zoom 6",
        lat: 57.48,
        lon: -4.22,
        z: 6,
        expectIt: (q) => {
          expect(q.get("place")).toBeNull();
          expect(Math.min(kmFrom(q, 55.86, -4.25), kmFrom(q, 55.95, -3.19))).toBeLessThan(20);
        },
      },
      {
        name: "Glasgow at zoom 8",
        lat: 55.86,
        lon: -4.25,
        z: 8,
        expectIt: (q) => {
          expect(q.get("place")).toBeNull();
          expect(kmFrom(q, 55.86, -4.25)).toBeLessThan(20);
        },
      },
      { name: "Atlanta at zoom 6", lat: 33.75, lon: -84.39, z: 6, expectIt: (q) => expect(kmFrom(q, 33.75, -84.39)).toBeLessThan(15) },
      { name: "rural Georgia at zoom 6", lat: 32.5, lon: -83.5, z: 6, expectIt: (q) => expect(kmFrom(q, 33.75, -84.39)).toBeLessThan(15) },
      { name: "north Taiwan at zoom 6", lat: 24.9, lon: 121.3, z: 6, expectIt: (q) => expect(kmFrom(q, 25.03, 121.56)).toBeLessThan(30) },
      { name: "the middle of Taiwan at zoom 6", lat: 23.7, lon: 121, z: 6, expectIt: (q) => expect(kmFrom(q, 24.15, 120.67)).toBeLessThan(25) },
    ];
    for (const row of table) {
      test(`${row.name}`, async ({ page }) => {
        const errors = trackErrors(page);
        await seed(page);
        await openMap(page, at(row.lat, row.lon, row.z));
        const to = await windowPoint(page, row.lon, row.lat);
        const q = await dropRing(page, to);
        row.expectIt(q);
        console.log(`${row.name}: ${page.url().split("/eye?")[1]}`);
        expect(errors).toEqual([]);
      });
    }

    test("a block in Manchester at zoom 13 opens exactly there, with the map's bearing", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53.4794, -2.2453, 13));
      await page.evaluate(() => (window as unknown as Win).__map.jumpTo({ bearing: 40 }));
      const to = await windowPoint(page, -2.2453, 53.4794);
      await carryRingTo(page, to);
      // The ring is on the point, and it says what a release does.
      const r = centre(await box(ring(page)));
      expect(Math.abs(r.x - to.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.y - to.y)).toBeLessThanOrEqual(1);
      await expect(plate(page)).toHaveText(DROP);
      await expect(layer(page)).toHaveAttribute("data-result", "hit");
      const under = await underPoint(page, to);
      expect(under.roundTrip).toBeLessThan(1);
      await page.mouse.up();
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
      const q = eyeQuery(page);
      expect(Math.abs(Number(q.get("lat")) - under.lat)).toBeLessThanOrEqual(under.perPixel);
      expect(Math.abs(Number(q.get("lon")) - under.lon)).toBeLessThanOrEqual(under.perPixel);
      expect(q.get("heading")).toBe("40");
      expect(q.get("z")).toBe("16");
      expect(q.get("tilt")).toBe("55");
    });

    test("closer than a city already, it is not thrown back out", async ({ page }) => {
      await seed(page);
      await openMap(page, at(51.5, -0.1, 17.4));
      await page.waitForFunction(() => (window as unknown as Win).__map.getZoom() > 17);
      const stage = await box(page.locator(".tn-cw-stage"));
      const q = await dropRing(page, { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 });
      expect(Number(q.get("z"))).toBeCloseTo(17.4, 1);
    });

    test("mid-Atlantic at zoom 5 says so before the release, flies home in about 500 ms and stays on this address", async ({ page }) => {
      const errors = trackErrors(page);
      await seed(page);
      await openMap(page, at(40, -38, 5));
      const to = await windowPoint(page, -38, 40);
      await carryRingTo(page, to);
      await expect(layer(page)).toHaveAttribute("data-result", "miss");
      await expect(plate(page)).toHaveText(MISS);
      await page.waitForTimeout(400);
      // A miss stays dotted: the solid ring means a hit.
      await expect(layer(page)).toHaveAttribute("data-ring", "moving");
      await expect(hit(page)).toBeHidden();
      await shot(page, "1440-dark-miss");
      const address = page.url();
      const t0 = Date.now();
      await page.mouse.up();
      // No fall: straight into the flight, with the words gone at once.
      await expect(layer(page)).toHaveAttribute("data-state", "return");
      await expect(plate(page)).toBeHidden();
      await expect(layer(page)).toHaveCount(0, { timeout: 3000 });
      const took = Date.now() - t0;
      console.log(`flight home: ${took} ms`);
      expect(took).toBeGreaterThan(350);
      expect(took).toBeLessThan(1100);
      await expectAtHome(page);
      expect(page.url()).toBe(address);
      expect(errors).toEqual([]);
    });

    test("no index: it opens at the ring, with a quiet note, and no 5xx reaches the visitor", async ({ page }) => {
      await page.unroute("**/api/eye/coverage**");
      await stub(page, { index: "empty" });
      await seed(page);
      await openMap(page, at(53.48, -2.24, 6));
      const to = await windowPoint(page, -2.24, 53.48);
      await page.mouse.move(100, 100);
      await carryRingTo(page, to);
      await page.waitForTimeout(350);
      await expect(plate(page)).toHaveText(/Coverage is not available/);
      const under = await underPoint(page, to);
      await page.mouse.up();
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
      const q = eyeQuery(page);
      expect(Math.abs(Number(q.get("lat")) - under.lat)).toBeLessThanOrEqual(under.perPixel);
    });
  });

  test.describe("the feel", () => {
    test("he hangs from the pointer, with the ring 58 px below it", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53, -2, 6));
      const stage = await box(page.locator(".tn-cw-stage"));
      const pointer = { x: stage.x + stage.width * 0.5, y: stage.y + stage.height * 0.4 };
      const from = centre(await box(person(page)));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(pointer.x, pointer.y, { steps: 10 });
      await page.waitForTimeout(450);
      const r = centre(await box(hit(page)));
      expect(r.x).toBeCloseTo(pointer.x, 0);
      expect(r.y - pointer.y).toBeCloseTo(HANG, 0);
      // His head is at the pointer, and his feet are clear of the ring.
      const fig = await box(page.locator("[data-eye-person-figure]"));
      expect(fig.y).toBeLessThanOrEqual(pointer.y);
      expect(fig.y + fig.height).toBeGreaterThan(pointer.y);
      expect(fig.y + fig.height).toBeLessThan(r.y - 16);
      await page.keyboard.press("Escape");
    });

    test("coverage lights up on the first move, not on the hover or the press, and hides the moment the carry ends", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53, -2, 6));
      const from = centre(await box(person(page)));
      await page.mouse.move(from.x, from.y);
      await page.waitForTimeout(500);
      expect(await overlayShown(page)).toEqual({ has: false, visible: false });
      await page.mouse.down();
      await page.waitForTimeout(150);
      expect(await overlayShown(page)).toEqual({ has: false, visible: false });
      // Under the 3 px: still not a carry.
      await page.mouse.move(from.x - 1, from.y);
      await page.waitForTimeout(100);
      expect(await overlayShown(page)).toEqual({ has: false, visible: false });
      await expect(layer(page)).toHaveCount(0);
      // The move that lifts him.
      await page.mouse.move(from.x - 4, from.y);
      await expect(layer(page)).toHaveCount(1);
      await expect.poll(() => overlayShown(page)).toEqual({ has: true, visible: true });
      await page.mouse.move(from.x - 300, from.y - 300, { steps: 6 });
      await page.keyboard.press("Escape");
      // Hidden at once: before he is home.
      await expect.poll(() => overlayShown(page), { timeout: 200 }).toEqual({ has: true, visible: false });
      await expect(layer(page)).toHaveCount(0, { timeout: 3000 });
      await page.mouse.up();
      // Nothing drawing at rest: both layers stay switched off.
      const painted = await page.evaluate(() => {
        const m = (window as unknown as Win).__map;
        return [m.getLayoutProperty("eye-coverage-halo", "visibility"), m.getLayoutProperty("eye-coverage-core", "visibility")];
      });
      expect(painted).toEqual(["none", "none"]);
    });

    test("a drag sends no location: nothing leaves through a whole carry until the ring settles, and then only a camera's cell", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53, -2, 6));
      const from = centre(await box(person(page)));
      await page.mouse.move(from.x, from.y);
      await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").some((e) => e.name.includes("/api/eye/coverage")))).toBe(true);
      await page.waitForTimeout(300);

      const seen: Request[] = [];
      const log = (r: Request) => {
        if (new URL(r.url()).origin === new URL(page.url()).origin) seen.push(r);
      };
      page.on("request", log);
      await page.mouse.down();
      const stage = await box(page.locator(".tn-cw-stage"));
      // A long carry, with no stop long enough to settle.
      for (let i = 0; i < 40; i++) {
        await page.mouse.move(stage.x + stage.width * (0.2 + (i % 20) * 0.03), stage.y + stage.height * (0.25 + (i % 8) * 0.04));
        await page.waitForTimeout(25);
      }
      const whileMoving = seen.map((r) => r.url()).filter((u) => /\/api\/(eye\/coverage|geocode|near|geolocate)|[?&](lat|lon|bbox)=/.test(u));
      expect(whileMoving, whileMoving.join("\n")).toEqual([]);
      expect(seen.filter((r) => r.url().includes("/api/eye/coverage"))).toEqual([]);

      await page.waitForTimeout(800);
      const named = seen.map((r) => new URL(r.url())).filter((u) => u.pathname === "/api/geocode");
      // A snap to a preset names itself. Anything looked up is one of the index's own cells.
      const rows: number[][] = fixture.cells;
      for (const u of named) {
        const lat = Number(u.searchParams.get("lat"));
        const lon = Number(u.searchParams.get("lon"));
        expect(rows.some((c) => c[0] === lat && c[1] === lon), u.href).toBe(true);
      }
      page.off("request", log);
      await page.keyboard.press("Escape");
      await page.mouse.up();
    });

    test("the index is asked for once, on the first hover, however many times he is hovered and carried", async ({ page }) => {
      const asked: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/eye/coverage")) asked.push(r.url());
      });
      await seed(page);
      await openMap(page, at(53, -2, 6));
      expect(asked).toEqual([]);
      const from = centre(await box(person(page)));
      for (let i = 0; i < 3; i++) {
        await page.mouse.move(from.x, from.y);
        await page.waitForTimeout(120);
        await page.mouse.move(from.x - 200, from.y - 200);
        await page.waitForTimeout(120);
      }
      expect(asked).toHaveLength(1);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x - 300, from.y - 300, { steps: 5 });
      await page.waitForTimeout(300);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      expect(asked).toHaveLength(1);
    });

    test("at zoom 9 and closer it asks for the points in view once at the pick-up, on the cell grid", async ({ page }) => {
      const asked: URL[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/eye/coverage?")) asked.push(new URL(r.url()));
      });
      await seed(page);
      await openMap(page, at(55.86, -4.25, 10));
      const stage = await box(page.locator(".tn-cw-stage"));
      await settleOn(page, { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 });
      expect(asked).toHaveLength(1);
      // On the 0.1 degree grid, so the log holds nothing finer than a cell.
      for (const v of asked[0].searchParams.get("bbox")!.split(",")) {
        expect(Number(v) * 10).toBeCloseTo(Math.round(Number(v) * 10), 6);
      }
      await page.mouse.move(stage.x + stage.width * 0.4, stage.y + stage.height * 0.4, { steps: 5 });
      await page.waitForTimeout(300);
      expect(asked).toHaveLength(1);
      await page.keyboard.press("Escape");
      await page.mouse.up();
    });

    test("the ring: dotted while it moves, an 8 px dot and a solid 32 px ring once it settles on a hit", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53, -2, 6));
      const stage = await box(page.locator(".tn-cw-stage"));
      const to = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
      await carryRingTo(page, to);
      await expect(layer(page)).toHaveAttribute("data-result", "hit");
      await page.mouse.move(to.x + 40, to.y - HANG, { steps: 4 });
      await expect(ring(page)).toBeVisible();
      const dotted = await ring(page).evaluate((el) => getComputedStyle(el).borderStyle);
      expect(dotted).toBe("dotted");
      await page.waitForTimeout(350);
      await expect(layer(page)).toHaveAttribute("data-ring", "hit");
      await expect(ring(page)).toBeHidden();
      const solid = await box(hit(page));
      expect([solid.width, solid.height]).toEqual([32, 32]);
      const dot = await box(hit(page).locator("i"));
      expect([dot.width, dot.height]).toEqual([8, 8]);
      await page.keyboard.press("Escape");
      await page.mouse.up();
    });

    test("a result far from the ring gets a marker on it and a line to it, and one under the ring gets neither", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53.48, -2.24, 6));
      const man = await windowPoint(page, -2.24, 53.48);
      await settleOn(page, man);
      await expect(layer(page)).toHaveAttribute("data-marker", "true");
      const marker = centre(await box(page.locator("[data-eye-person-marker]")));
      // It is on a London preset's place, not on the ring.
      const near = await Promise.all([
        windowPoint(page, -0.1218, 51.5013),
        windowPoint(page, -0.0772, 51.5062),
        windowPoint(page, -0.13424, 51.50995),
      ]);
      expect(Math.min(...near.map((p) => Math.hypot(p.x - marker.x, p.y - marker.y)))).toBeLessThan(2);
      // The line ends at both: not one px past either, which a stretched shadow did.
      const line = await page.locator("[data-eye-person-line]").evaluate((el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, shadow: getComputedStyle(el).boxShadow };
      });
      expect(line.shadow).toBe("none");
      expect(Math.abs(line.left - Math.min(man.x, marker.x))).toBeLessThan(4);
      expect(Math.abs(line.right - Math.max(man.x, marker.x))).toBeLessThan(4);
      expect(Math.abs(line.bottom - Math.max(man.y, marker.y))).toBeLessThan(4);
      await shot(page, "1440-dark-marker");
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(layer(page)).toHaveCount(0, { timeout: 3000 });

      // On the result itself: no marker.
      const london = await windowPoint(page, -0.1218, 51.5013);
      await settleOn(page, london);
      await expect(layer(page)).not.toHaveAttribute("data-marker", "true");
      await page.keyboard.press("Escape");
      await page.mouse.up();
    });

    test("the card: place, count and a still, about 200 ms after the ring settles, hidden at once on the drop", async ({ page }) => {
      const errors = trackErrors(page);
      await seed(page);
      await openMap(page, at(55.86, -4.25, 8));
      const to = await windowPoint(page, -4.25, 55.86);
      await carryRingTo(page, to);
      const t0 = Date.now();
      await expect(card(page)).toBeVisible({ timeout: 2000 });
      console.log(`card after ${Date.now() - t0} ms`);
      await expect(page.locator("[data-eye-person-name]")).toHaveText("Glasgow");
      await expect(page.locator("[data-eye-person-count]")).toHaveText(/^\d+ cameras$/);
      await expect(page.locator("[data-eye-person-still]")).toHaveAttribute("src", /\/api\/proxy\?id=trafficscotland%3A/);
      await expect(card(page)).not.toContainText(/live/i);
      // The arrow points at the ring.
      const c = await box(card(page));
      expect(c.y).toBeGreaterThan(to.y);
      await expect(card(page)).toHaveAttribute("data-side", "below");
      await shot(page, "1440-dark-card");

      // Short moves keep it, because the result does not change.
      await page.mouse.move(to.x + 3, to.y - HANG + 2, { steps: 2 });
      await page.waitForTimeout(40);
      await expect(card(page)).toBeVisible();

      await page.mouse.up();
      await expect(card(page)).toHaveCount(0, { timeout: 150 });
      await expect(plate(page)).toHaveText("Opening God's eye view");
      // Its words are at the ring, wherever the plate last was.
      const words = await box(plate(page));
      expect(Math.abs(words.x + words.width / 2 - (to.x + 3))).toBeLessThan(2);
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
      expect(errors).toEqual([]);
    });

    test("at zoom 13 a camera in the ring says so, with no name lookup, and it still opens at the ring", async ({ page }) => {
      const looked: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/geocode")) looked.push(r.url());
      });
      const rows = fixture.cells as [number, number, number, number, string, number][];
      const row = rows.find((c) => c[4].startsWith("trafficscotland:") && c[0] > 55.8 && c[0] < 55.9)!;
      await seed(page);
      await openMap(page, at(row[0], row[1], 13));
      const on = await windowPoint(page, row[1], row[0]);
      await settleOn(page, on);
      await expect(card(page)).toBeVisible();
      await expect(page.locator("[data-eye-person-count]")).toHaveText("A camera in the ring");
      await expect(page.locator("[data-eye-person-name]")).toHaveText(`Camera ${row[4]}`);
      await expect(card(page)).not.toContainText(/live/i);
      expect(looked).toEqual([]);

      // Out of the ring: the card goes, and the plate says what a release does.
      await page.mouse.move(on.x + 90, on.y - HANG, { steps: 4 });
      await expect(card(page)).toHaveCount(0);
      await expect(plate(page)).toHaveText(DROP);

      const under = await underPoint(page, { x: on.x + 90, y: on.y });
      await page.mouse.up();
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
      expect(Math.abs(Number(eyeQuery(page).get("lon")) - under.lon)).toBeLessThanOrEqual(under.perPixel * 2);
    });

    test("a preset's card says the city and where it opens, without a lookup", async ({ page }) => {
      const looked: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/geocode")) looked.push(r.url());
      });
      await seed(page);
      await openMap(page, at(53.48, -2.24, 6));
      const to = await windowPoint(page, -2.24, 53.48);
      await settleOn(page, to);
      await expect(page.locator("[data-eye-person-name]")).toHaveText("London");
      await expect(page.locator("[data-eye-person-sub]")).toHaveText(/^Opens at (Westminster|Tower Bridge|Piccadilly Circus)$/);
      expect(looked).toEqual([]);
      await page.keyboard.press("Escape");
      await page.mouse.up();
    });

    test("a picture that fails leaves the words, and the card still fits", async ({ page }) => {
      await page.unroute("**/api/proxy?**");
      await page.route("**/api/proxy?**", (r) => r.fulfill({ status: 404, body: "no" }));
      await seed(page);
      await openMap(page, at(55.86, -4.25, 8));
      const to = await windowPoint(page, -4.25, 55.86);
      await settleOn(page, to);
      await expect(page.locator("[data-eye-person-name]")).toHaveText("Glasgow");
      await expect(page.locator("[data-eye-person-still]")).toHaveCount(0);
      const c = await box(card(page));
      expect(c.height).toBeLessThan(90);
      await page.keyboard.press("Escape");
      await page.mouse.up();
    });

    test("the card hides on a miss, and swaps when the result changes", async ({ page }) => {
      await seed(page);
      await openMap(page, at(55, -3, 5));
      const glasgow = await windowPoint(page, -4.25, 55.86);
      await settleOn(page, glasgow);
      await expect(card(page)).toBeVisible();
      const name = await page.locator("[data-eye-person-name]").textContent();
      // West of Cornwall, past reach of anything: England outside London has almost no camera.
      const ocean = await windowPoint(page, -14, 50);
      await page.mouse.move(ocean.x, ocean.y - HANG, { steps: 6 });
      await expect(layer(page)).toHaveAttribute("data-result", "miss");
      await expect(card(page)).toHaveCount(0);
      await expect(plate(page)).toHaveText(MISS);
      // And to London.
      const london = await windowPoint(page, -0.12, 51.5);
      await page.mouse.move(london.x, london.y - HANG, { steps: 6 });
      await expect(card(page)).toBeVisible({ timeout: 1500 });
      await expect(page.locator("[data-eye-person-name]")).toHaveText("London");
      expect(name).not.toBe("London");
      await page.keyboard.press("Escape");
      await page.mouse.up();
    });

    test("the card flips and stays on the screen at all four edges of the map", async ({ page }) => {
      await seed(page);
      await openMap(page, at(51.5, -0.12, 7));
      const stage = await box(page.locator(".tn-cw-stage"));
      // Just inside the edge pan's 30 px at each edge. The map is moved so that London is near.
      const spots: [string, Pt, string][] = [
        ["right", { x: stage.x + stage.width - 36, y: stage.y + stage.height / 2 }, "below"],
        ["left", { x: stage.x + 36, y: stage.y + stage.height / 2 }, "below"],
        ["top", { x: stage.x + stage.width / 2, y: stage.y + 36 + HANG }, "below"],
        // Left of the world clock: a panel over the map is not the map.
        ["bottom", { x: stage.x + stage.width * 0.2, y: stage.y + stage.height - 36 }, "above"],
      ];
      for (const [edge, spot, side] of spots) {
        await page.evaluate(
          ({ spot }) => {
            const m = (window as unknown as Win).__map;
            const r = m.getContainer().getBoundingClientRect();
            const p = m.project([-0.12, 51.5]);
            const c = m.project(m.getCenter());
            const want = { x: spot.x - r.left, y: spot.y - r.top };
            m.jumpTo({ center: m.unproject([c.x + (p.x - want.x), c.y + (p.y - want.y)]) });
          },
          { spot },
        );
        await page.waitForTimeout(150);
        await settleOn(page, spot);
        await expect(card(page), edge).toBeVisible({ timeout: 2000 });
        await frame(page);
        const c = await box(card(page));
        expect(c.x, edge).toBeGreaterThanOrEqual(0);
        expect(c.y, edge).toBeGreaterThanOrEqual(0);
        expect(c.x + c.width, edge).toBeLessThanOrEqual(1440);
        expect(c.y + c.height, edge).toBeLessThanOrEqual(900);
        await expect(card(page), edge).toHaveAttribute("data-side", side);
        await shot(page, `1440-edge-${edge}`);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(layer(page)).toHaveCount(0, { timeout: 3000 });
      }
    });

    test("the swing: a fast move leans him, a stop overshoots and rests, and a vertical move gives no lean", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53, -2, 6));
      const stage = await box(page.locator(".tn-cw-stage"));
      const from = centre(await box(person(page)));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      const mid = { x: stage.x + stage.width * 0.2, y: stage.y + stage.height * 0.45 };
      await page.mouse.move(mid.x, mid.y, { steps: 3 });
      await page.waitForTimeout(1100);
      const swing = () => page.locator("[data-eye-person-swing]").evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--swing")) || 0);
      expect(Math.abs(await swing())).toBeLessThan(1);

      // Fast to the right: feet trail left, a positive angle. Sampled in the page, on each frame.
      await page.evaluate(() => {
        const w = window as unknown as { __swings: number[] };
        w.__swings = [];
        const el = document.querySelector("[data-eye-person-swing]") as HTMLElement;
        const read = () => {
          w.__swings.push(parseFloat(el.style.getPropertyValue("--swing")) || 0);
          if (el.isConnected && w.__swings.length < 300) requestAnimationFrame(read);
        };
        requestAnimationFrame(read);
      });
      for (let i = 1; i <= 25; i++) {
        await page.mouse.move(mid.x + i * 24, mid.y);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(1200);
      const swings = await page.evaluate(() => (window as unknown as { __swings: number[] }).__swings);
      const max = Math.max(...swings);
      const min = Math.min(...swings);
      console.log(`swing: lean ${max.toFixed(1)} deg, overshoot ${min.toFixed(1)} deg, end ${swings[swings.length - 1]}`);
      expect(max).toBeGreaterThan(10);
      expect(min).toBeLessThan(-0.5);
      expect(Math.abs(swings[swings.length - 1])).toBeLessThan(0.6);

      // Straight down: no lean.
      await page.evaluate(() => {
        const w = window as unknown as { __swings: number[] };
        w.__swings = [];
        const el = document.querySelector("[data-eye-person-swing]") as HTMLElement;
        const read = () => {
          w.__swings.push(parseFloat(el.style.getPropertyValue("--swing")) || 0);
          if (el.isConnected && w.__swings.length < 60) requestAnimationFrame(read);
        };
        requestAnimationFrame(read);
      });
      const now = { x: mid.x + 25 * 24, y: mid.y };
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(now.x, now.y + i * 16);
        await page.waitForTimeout(16);
      }
      const down = await page.evaluate(() => (window as unknown as { __swings: number[] }).__swings);
      expect(Math.max(...down.map(Math.abs))).toBeLessThan(0.6);
      await page.keyboard.press("Escape");
      await page.mouse.up();
    });

    test("the lift and the drop: the base shows an empty slot, and he falls straight down about 40 px", async ({ page }) => {
      await seed(page);
      await openMap(page, at(55.86, -4.25, 8));
      const to = await windowPoint(page, -4.25, 55.86);
      const home = await box(person(page));
      await settleOn(page, to);
      // His place: the plate has not moved, and he is not in it.
      expect(await box(person(page))).toEqual(home);
      expect(await page.locator("[data-eye-person] svg").evaluate((el) => getComputedStyle(el).visibility)).toBe("hidden");
      expect(await person(page).evaluate((el) => getComputedStyle(el, "::after").content)).not.toBe("none");
      // Slow the page's address change down, so the fall can be seen.
      const fig = page.locator("[data-eye-person-figure]");
      const before = await box(fig);
      await page.evaluate(() => {
        const w = window as unknown as { __tops: number[] };
        w.__tops = [];
        const el = document.querySelector("[data-eye-person-figure]") as HTMLElement;
        const read = () => {
          w.__tops.push(el.getBoundingClientRect().top);
          sessionStorage.setItem("fall", JSON.stringify(w.__tops));
          requestAnimationFrame(read);
        };
        requestAnimationFrame(read);
      });
      await page.mouse.up();
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
      const tops: number[] = JSON.parse((await page.evaluate(() => sessionStorage.getItem("fall"))) ?? "[]");
      const fell = Math.max(...tops) - before.y;
      console.log(`fall: ${fell.toFixed(1)} px over ${tops.length} frames`);
      expect(fell).toBeGreaterThan(30);
      expect(fell).toBeLessThan(46);
    });

    test("hover changes the base at once, and the tooltip comes about a second later", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53, -2, 6));
      const from = centre(await box(person(page)));
      const bg = () => person(page).evaluate((el) => getComputedStyle(el).backgroundColor);
      const rest = await bg();
      await page.mouse.move(from.x, from.y);
      await frame(page);
      expect(await bg()).not.toBe(rest);
      const tip = page.locator("[data-eye-person-tip]");
      await page.waitForTimeout(600);
      await expect(tip).toHaveCount(0);
      await expect(tip).toBeVisible({ timeout: 900 });
      await expect(tip).toContainText("Drag onto the map");
      await page.mouse.down();
      await expect(tip).toHaveCount(0);
      await page.mouse.up();
      // That was a click, so coverage came on.
      await expect(person(page)).toHaveAttribute("aria-pressed", "true");
    });
  });

  test.describe("the edge pan", () => {
    test("on the globe: it pans while the pointer is at the edge, with one moveend, and stops on the release", async ({ page }) => {
      const errors = trackErrors(page);
      await seed(page);
      await openMap(page, at(30, -50, 3));
      const stage = await box(page.locator(".tn-cw-stage"));
      await page.evaluate(() => {
        const w = window as unknown as Win & { __ends: number };
        w.__ends = 0;
        w.__map.on("moveend", () => {
          w.__ends += 1;
        });
      });
      const before = await mapCentre(page);
      const from = centre(await box(person(page)));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      // Picked up from the corner, inside the band. It must not pan until he has left the band.
      await page.mouse.move(from.x - 2, from.y - 3);
      await page.waitForTimeout(250);
      const still = await mapCentre(page);
      expect(still.lon).toBeCloseTo(before.lon, 5);

      await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height * 0.4, { steps: 6 });
      await page.waitForTimeout(100);
      const armed = await mapCentre(page);
      expect(armed.lon).toBeCloseTo(before.lon, 5);

      await page.mouse.move(stage.x + stage.width - 4, stage.y + stage.height * 0.4, { steps: 6 });
      const start = await mapCentre(page);
      const t0 = Date.now();
      await page.waitForTimeout(1000);
      const end = await mapCentre(page);
      const seconds = (Date.now() - t0) / 1000;
      const pxPerDegree = await page.evaluate(() => {
        const m = (window as unknown as Win).__map;
        const c = m.getCenter();
        return Math.abs(m.project([c.lng + 1, c.lat]).x - m.project([c.lng, c.lat]).x);
      });
      const rate = (Math.abs(end.lon - start.lon) * pxPerDegree) / seconds;
      console.log(`edge pan on the globe: ${rate.toFixed(0)} px/s`);
      expect(end.lon).toBeGreaterThan(start.lon);
      expect(rate).toBeGreaterThan(400);
      expect(rate).toBeLessThan(1400);
      const ends = await page.evaluate(() => (window as unknown as { __ends: number }).__ends);
      expect(ends).toBeLessThanOrEqual(1);
      await shot(page, "1440-dark-edge-pan");
      await expect(hit(page)).toBeHidden();

      await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height * 0.4, { steps: 6 });
      await page.waitForTimeout(300);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      const a = await mapCentre(page);
      await page.waitForTimeout(400);
      const b = await mapCentre(page);
      expect(b.lon).toBeCloseTo(a.lon, 4);
      expect(errors).toEqual([]);
    });

    test("a globe smaller than the map does not spin for a pointer out in the space beside it", async ({ page }) => {
      await seed(page);
      await openMap(page, at(20, 10, 0.6));
      const stage = await box(page.locator(".tn-cw-stage"));
      const from = centre(await box(person(page)));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height * 0.4, { steps: 6 });
      const start = await mapCentre(page);
      await page.mouse.move(stage.x + stage.width - 6, stage.y + stage.height * 0.4, { steps: 6 });
      await page.waitForTimeout(500);
      const end = await mapCentre(page);
      expect(end.lon).toBeCloseTo(start.lon, 3);
      await page.keyboard.press("Escape");
      await page.mouse.up();
    });

    test("a release at the edge stops the pan", async ({ page }) => {
      await seed(page);
      await openMap(page, at(30, -50, 3));
      const stage = await box(page.locator(".tn-cw-stage"));
      const from = centre(await box(person(page)));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height * 0.4, { steps: 6 });
      await page.mouse.move(stage.x + 6, stage.y + stage.height * 0.4, { steps: 6 });
      await page.waitForTimeout(400);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await page.waitForTimeout(200);
      const a = await mapCentre(page);
      await page.waitForTimeout(400);
      const b = await mapCentre(page);
      expect(b.lon).toBeCloseTo(a.lon, 3);
      expect(b.lat).toBeCloseTo(a.lat, 3);
    });

    test("well off the map it does not pan, so a drag out to cancel leaves the world alone", async ({ page }) => {
      await seed(page);
      await openMap(page, at(30, -50, 3));
      const stage = await box(page.locator(".tn-cw-stage"));
      const header = await box(page.locator(".tnx-hdr"));
      const from = centre(await box(person(page)));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height * 0.4, { steps: 6 });
      const start = await mapCentre(page);
      // Over the header: the ring is off the map's top, and the pointer is past the band.
      await page.mouse.move(stage.x + stage.width / 2, header.y + 2 - HANG / 2, { steps: 6 });
      await page.waitForTimeout(300);
      const end = await mapCentre(page);
      expect(Math.abs(end.lat - start.lat)).toBeLessThan(1.5);
      await page.keyboard.press("Escape");
      await page.mouse.up();
    });
  });

  test.describe("click and keyboard", () => {
    test("a click toggles coverage and a legend, a click on the map opens the search's result, and a pin there does not open", async ({ page }) => {
      const errors = trackErrors(page);
      await seed(page);
      await openMap(page, at(53.48, -2.24, 6));
      await expect(person(page)).toHaveAccessibleName(/^Show camera coverage/);
      await expect(person(page)).toHaveAttribute("aria-pressed", "false");
      await person(page).click();
      await expect(person(page)).toHaveAttribute("aria-pressed", "true");
      await expect(person(page)).toHaveAccessibleName(/^Hide camera coverage/);
      await expect(legend(page)).toContainText("Camera coverage");
      await expect(legend(page)).toContainText("Click the map");
      await expect.poll(() => overlayShown(page)).toEqual({ has: true, visible: true });
      await expect(page).toHaveURL(/\/app/);
      await shot(page, "1440-dark-toggled");

      // Off again with a click on it: no scene, and the layer is off.
      await person(page).click();
      await expect(person(page)).toHaveAttribute("aria-pressed", "false");
      await expect(legend(page)).toHaveCount(0);
      await expect.poll(() => overlayShown(page)).toEqual({ has: true, visible: false });

      await person(page).click();
      const m = await windowPoint(page, -2.24, 53.48);
      await page.mouse.click(m.x, m.y);
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
      expect(PRESET_IDS).toContain(eyeQuery(page).get("place"));
      expect(errors).toEqual([]);
    });

    test("while it is on: a drag on the map still pans, and a click on the map with nothing near says so", async ({ page }) => {
      await seed(page);
      await openMap(page, at(40, -38, 5));
      await person(page).click();
      await expect(person(page)).toHaveAttribute("aria-pressed", "true");
      const stage = await box(page.locator(".tn-cw-stage"));
      const before = await mapCentre(page);
      const c = centre(stage);
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x + 80, c.y, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const after = await mapCentre(page);
      expect(after.lon).not.toBeCloseTo(before.lon, 1);
      await expect(page).toHaveURL(/\/app/);
      await page.mouse.click(c.x, c.y);
      await expect(legend(page)).toContainText(MISS);
      await expect(page).toHaveURL(/\/app/);
      await expect(person(page)).toHaveAttribute("aria-pressed", "true");
    });

    test("Esc turns it off, with one press, and an open panel stays", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53, -2, 6));
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.locator("aside.tn-rail").first()).toBeVisible();
      await person(page).click();
      await expect(person(page)).toHaveAttribute("aria-pressed", "true");
      await expect(person(page)).toHaveAttribute("data-owns-escape", "");
      await page.keyboard.press("Escape");
      await expect(person(page)).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("aside.tn-rail").first()).toBeVisible();
      await expect(person(page)).not.toHaveAttribute("data-owns-escape", "");
      await expect.poll(() => overlayShown(page)).toEqual({ has: true, visible: false });
    });

    for (const key of ["Enter", "Space"] as const) {
      test(`${key} on the person toggles it, with the ring at the map's centre`, async ({ page }) => {
        await seed(page);
        await openMap(page, at(53.48, -2.24, 6));
        await person(page).focus();
        await page.keyboard.press(key);
        await expect(person(page)).toHaveAttribute("aria-pressed", "true");
        await expect(layer(page)).toHaveAttribute("data-state", "aim");
        await expect(page).toHaveURL(/\/app/);
        const stage = await box(page.locator(".tn-cw-stage"));
        await page.waitForTimeout(400);
        const r = centre(await box(hit(page)));
        expect(Math.abs(r.x - centre(stage).x)).toBeLessThan(2);
        expect(Math.abs(r.y - centre(stage).y)).toBeLessThan(2);
        await page.keyboard.press("Space");
        await expect(person(page)).toHaveAttribute("aria-pressed", "false");
        await expect(layer(page)).toHaveCount(0);
      });
    }

    test("the keyboard drop: arrows pan the map, the ring stays at its centre, and Enter drops", async ({ page }) => {
      const errors = trackErrors(page);
      await seed(page);
      await openMap(page, at(53.48, -2.24, 6));
      await person(page).focus();
      await page.keyboard.press("Enter");
      await expect(layer(page)).toHaveAttribute("data-state", "aim");
      await expect(page.locator("[data-eye-person-figure]")).toBeVisible();
      const before = await mapCentre(page);
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(350);
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(350);
      const after = await mapCentre(page);
      expect(after.lon).toBeLessThan(before.lon);
      expect(after.lat).toBeLessThan(before.lat);
      await page.waitForTimeout(400);
      await expect(card(page)).toBeVisible();
      await shot(page, "1440-dark-aim");
      await page.keyboard.press("Enter");
      await expect(card(page)).toHaveCount(0, { timeout: 150 });
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
      expect(PRESET_IDS).toContain(eyeQuery(page).get("place"));
      expect(errors).toEqual([]);
    });

    test("Enter over the ocean opens nothing and says so, and Esc leaves", async ({ page }) => {
      await seed(page);
      await openMap(page, at(40, -38, 5));
      await person(page).focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      await expect(plate(page)).toHaveText(MISS);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      await expect(page).toHaveURL(/\/app/);
      await expect(legend(page)).toContainText(MISS);
      await page.keyboard.press("Escape");
      await expect(person(page)).toHaveAttribute("aria-pressed", "false");
      await expect(layer(page)).toHaveCount(0);
    });

    test("the button has a focus ring and is reachable by Tab", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53, -2, 6));
      let reached = false;
      for (let i = 0; i < 40 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await person(page).evaluate((el) => el === document.activeElement);
      }
      expect(reached).toBe(true);
      const outline = await person(page).evaluate((el) => {
        const s = getComputedStyle(el);
        return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
      });
      expect(outline.style).toBe("solid");
      expect(outline.width).toBeGreaterThanOrEqual(2);
      await shot(page, "1440-dark-focus");
    });
  });

  test.describe("/eye names a spot itself", () => {
    test("the title is the town, the coordinates are the second line, and a word in the link is ignored", async ({ page }) => {
      await seed(page);
      await page.goto("/eye?lat=55.86&lon=-4.25&z=16&tilt=55&heading=0&name=Hacked&title=Hacked&place=nowhere");
      await page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Glasgow");
      await expect(page.locator("header p").first()).toContainText(/55\.8600°\sN,\s4\.2500°\sW/);
      await expect(page.locator("main")).not.toContainText("Hacked");
    });

    test("a place with no name keeps its coordinates as the title", async ({ page }) => {
      await seed(page);
      await page.goto("/eye?lat=35&lon=-40&z=16&tilt=55&heading=0");
      await page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
      await page.waitForTimeout(500);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^35\.0000°\sN,\s40\.0000°\sW$/);
      await expect(page.locator("header p").first()).toHaveText(/^Heading/);
    });

    test("a film asks for no name", async ({ page }) => {
      const asked: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/geocode")) asked.push(r.url());
      });
      await seed(page);
      await page.goto("/eye?lat=55.86&lon=-4.25&z=16&tilt=55&heading=0&clock=manual");
      await page.waitForSelector("main[data-eye-state]", { timeout: 90_000 });
      await page.waitForTimeout(800);
      expect(asked).toEqual([]);
    });
  });

  test.describe("kept from v1", () => {
    for (const skin of ["dark", "light"] as Skin[]) {
      test(`${skin}: directly above the i, in line, and the credit moves neither it nor its words under it`, async ({ page }) => {
        await seed(page, skin);
        await openMap(page, "/app?lat=20&lon=-20&z=2.3&layers=&base=satellite");
        const before = await box(person(page));
        const i = await box(iCircle(page));
        expect([before.width, before.height]).toEqual([36, 36]);
        expect(Math.abs(centre(before).x - centre(i).x)).toBeLessThanOrEqual(0.5);
        expect(i.y - (before.y + before.height)).toBeCloseTo(8, 0);
        await shot(page, `1440-${skin}-rest`);

        await iButton(page).click();
        await expect(page.locator(".maplibregl-compact-show")).toHaveCount(1);
        await page.waitForFunction(() => {
          const inner = document.querySelector(".maplibregl-ctrl-attrib-inner");
          return Boolean(inner && inner.textContent && inner.textContent.length > 0);
        });
        expect(await box(person(page))).toEqual(before);

        // Every line of the open credit, as drawn, stays clear of the person.
        const lines = await page.locator(".maplibregl-ctrl-attrib-inner").evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return Array.from(range.getClientRects()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
        });
        expect(lines.length).toBeGreaterThan(0);
        for (const l of lines) {
          const overlaps = l.left < before.x + before.width && before.x < l.right && l.top < before.y + before.height && before.y < l.bottom;
          expect(overlaps, JSON.stringify(l)).toBe(false);
        }

        await iButton(page).click();
        await expect(page.locator(".maplibregl-compact-show")).toHaveCount(0);
        expect(await box(person(page))).toEqual(before);
      });
    }

    test("a control added to the corner later lands above the person, and the person stays above the i", async ({ page }) => {
      await seed(page);
      await openMap(page, at(48, 2, 4));
      const before = await box(person(page));
      // What PR #339's compass does: a `.maplibregl-ctrl` through map.addControl, 8 px up.
      await page.evaluate(() => {
        const div = document.createElement("div");
        div.className = "maplibregl-ctrl";
        div.id = "late-control";
        div.style.cssText = "width:30px;height:30px;margin:0 0 8px 0;background:#888;border-radius:50%";
        (window as unknown as Win).__map.addControl({ onAdd: () => div, onRemove: () => div.remove() }, "bottom-right");
      });
      const late = await box(page.locator("#late-control"));
      expect(await box(person(page))).toEqual(before);
      expect(late.y + late.height).toBeLessThanOrEqual(before.y);
      expect(Math.abs(centre(late).x - centre(before).x)).toBeLessThanOrEqual(0.5);
      // In the corner's stack the person's slot stays directly before the credit, and the late
      // control goes first. PR #339's compass, once it is merged, is a third name between them.
      const order = await page.locator(".maplibregl-ctrl-bottom-right > *").evaluateAll((els) =>
        els.map((el) => (el.id === "late-control" ? "late" : el.hasAttribute("data-eye-person-slot") ? "slot" : el.classList.contains("maplibregl-ctrl-attrib") ? "credit" : "other")),
      );
      expect(order[0]).toBe("late");
      expect(order.slice(-2)).toEqual(["slot", "credit"]);
    });

    test("Escape cancels a carry with one press, and the selection and the panel stay", async ({ page }) => {
      await page.addInitScript(() => {
        if (window.localStorage.getItem("tn.inspector.v1")) return;
        window.localStorage.setItem(
          "tn.inspector.v1",
          JSON.stringify({
            v: 1,
            d: { world: {}, editing: null, areas: [{ id: "area:1", label: "West Pacific", polygon: [[90, -60], [180, -60], [180, 70], [90, 70]], bbox: [90, -60, 180, 70], createdAt: 1, sources: { earthquakes: true } }] },
          }),
        );
      });
      await seed(page);
      await openMap(page, at(48, 2, 4));
      // A selection (the area's own row, as tests/e2e/inspector-rail.spec.ts does it).
      await page.keyboard.press("ControlOrMeta+k");
      await page.click("#tn-rail-tab-inspector");
      await page.click("#inspector-rail .tn-insp-rail-btn-draw");
      await page.click(".tn-insp-row");
      const dossier = page.locator(".tn-inspector[role=dialog]");
      await expect(dossier).toHaveCount(1);

      const stage = await box(page.locator(".tn-cw-stage"));
      await carryRingTo(page, { x: stage.x + stage.width * 0.6, y: stage.y + stage.height * 0.5 });
      await expect(person(page)).toHaveAttribute("data-owns-escape", "");
      await page.keyboard.press("Escape");
      await expect(layer(page)).toHaveCount(0, { timeout: 3000 });
      await expect(person(page)).not.toHaveAttribute("data-owns-escape", "");
      await expect(dossier).toHaveCount(1);

      // A later release opens nothing, even over the map or back on the button.
      await page.mouse.up();
      await page.waitForTimeout(300);
      await expectAtHome(page);
    });

    test("a release off the map, or back on his own place, opens nothing and he goes home", async ({ page }) => {
      await seed(page);
      await openMap(page, at(48, 2, 4));
      const header = await box(page.locator(".tnx-hdr"));
      const from = centre(await box(person(page)));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      // The ring over the header: the pointer is above the window's top, which is still a carry.
      await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2 - HANG, { steps: 8 });
      await frame(page);
      await expect(plate(page)).toHaveText(OFF);
      await expect(layer(page)).toHaveAttribute("data-result", "off");
      await shot(page, "1440-dark-off-map");
      await page.mouse.up();
      await expect(layer(page)).toHaveCount(0, { timeout: 3000 });
      await expectAtHome(page);

      // Out and back onto its own button: a drag that went nowhere, and not a click.
      const home = centre(await box(person(page)));
      await page.mouse.move(home.x, home.y);
      await page.mouse.down();
      await page.mouse.move(home.x - 120, home.y - 120, { steps: 6 });
      await page.mouse.move(home.x, home.y - HANG, { steps: 6 });
      await page.mouse.up();
      await expect(layer(page)).toHaveCount(0, { timeout: 3000 });
      await expectAtHome(page);
      await expect(person(page)).toHaveAttribute("aria-pressed", "false");
    });

    test("a release in the space off the globe opens nothing, where unproject names a real-looking place", async ({ page }) => {
      await seed(page);
      await openMap(page, at(20, 10, 0.6));
      const stage = await box(page.locator(".tn-cw-stage"));
      // The map's corner, far off the disc at this zoom, and clear of the edge pan's band.
      const space = { x: stage.x + stage.width - 120, y: stage.y + 120 };

      const under = await underPoint(page, space);
      // The trap is real: a finite place, on the far side of nothing.
      expect(Number.isFinite(under.lat)).toBe(true);
      expect(Number.isFinite(under.lon)).toBe(true);
      expect(under.roundTrip).toBeGreaterThan(50);

      await carryRingTo(page, space);
      await expect(layer(page)).toHaveAttribute("data-result", "off");
      await expect(plate(page)).toHaveText(OFF);
      await shot(page, "1440-dark-off-globe");
      await page.mouse.up();
      await expect(layer(page)).toHaveCount(0, { timeout: 3000 });
      await expectAtHome(page);

      // Walking out from the middle of the disc: exact on it, and off by the distance past it.
      const walk = await page.evaluate(() => {
        const m = (window as unknown as Win).__map;
        const c = m.project(m.getCenter());
        const out: Array<[number, number]> = [];
        for (let r = 0; r < 700; r += 2) {
          const q = m.project(m.unproject([c.x + r, c.y]));
          out.push([r, Math.hypot(q.x - (c.x + r), q.y - c.y)]);
        }
        return out;
      });
      const edge = walk.findIndex(([, off]) => off > 3);
      expect(edge).toBeGreaterThan(10);
      const worstOn = Math.max(...walk.slice(0, edge - 3).map(([, off]) => off));
      console.log(`globe: disc edge at r=${walk[edge][0]} px, worst round trip on the disc ${worstOn.toFixed(4)} px`);
      expect(worstOn).toBeLessThan(1);
      expect(walk.slice(edge).every(([, off]) => off > 3)).toBe(true);

      // The same pointer on the disc does open: London is on this globe.
      const on = await windowPoint(page, -0.12, 51.5);
      await carryRingTo(page, on);
      await expect(layer(page)).toHaveAttribute("data-result", "hit");
      await page.mouse.up();
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
    });

    /** Switch to the flat map the way a visitor does, and shut the rail again. */
    async function goFlat(page: Page, also?: () => Promise<void>) {
      await page.keyboard.press("ControlOrMeta+k");
      await page.click("#tn-rail-tab-inspector");
      await page.locator("#inspector-rail").getByRole("button", { name: "Map settings" }).click();
      const tool = page.locator(".tn-insp-tool");
      await tool.getByRole("radiogroup", { name: "Projection" }).getByRole("radio", { name: "2D" }).click();
      await page.waitForFunction(() => (window as unknown as Win).__map.getProjection()?.type === "mercator");
      if (also) await also();
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.locator(".tn-rail")).toHaveCount(0);
    }

    const worstRoundTrip = (page: Page) =>
      page.evaluate(() => {
        const m = (window as unknown as Win).__map;
        const c = m.getContainer();
        let worst = 0;
        for (let i = 1; i < 8; i++) {
          for (let j = 1; j < 8; j++) {
            const p: [number, number] = [(c.clientWidth * i) / 8, (c.clientHeight * j) / 8];
            const q = m.project(m.unproject(p));
            worst = Math.max(worst, Math.hypot(q.x - p[0], q.y - p[1]));
          }
        }
        return worst;
      });

    test("a flat map: a drop opens the search's result, and the edge pan works there too", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53.48, -2.24, 4));
      await goFlat(page);
      await page.evaluate(() => (window as unknown as Win).__map.jumpTo({ center: [-2.24, 53.48], zoom: 6 }));
      const to = await windowPoint(page, -2.24, 53.48);
      expect(await worstRoundTrip(page)).toBeLessThan(1);
      const q = await dropRing(page, to);
      expect(PRESET_IDS).toContain(q.get("place"));
    });

    test("with terrain on, a point on the map still counts as on the map", async ({ page }) => {
      await seed(page);
      await openMap(page, at(48, 2, 4));
      await goFlat(page, async () => {
        await page.locator(".tn-insp-tool").getByRole("switch", { name: "Terrain" }).click();
      });
      // The Alps, close enough for the terrain to be attached, tilted so the relief counts.
      await page.evaluate(() => (window as unknown as Win).__map.jumpTo({ center: [8.0, 46.5], zoom: 13, pitch: 55 }));
      await page.waitForFunction(() => Boolean((window as unknown as Win).__map.getTerrain()), null, { timeout: 30_000 });
      await page.waitForFunction(() => (window as unknown as Win).__map.areTilesLoaded(), null, { timeout: 45_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const worst = await worstRoundTrip(page);
      console.log(`terrain: worst round trip ${worst.toFixed(3)} px`);
      const stage = await box(page.locator(".tn-cw-stage"));
      await carryRingTo(page, { x: stage.x + stage.width * 0.5, y: stage.y + stage.height * 0.55 });
      await expect(layer(page)).toHaveAttribute("data-result", "hit");
      await page.keyboard.press("Escape");
      await expect(layer(page)).toHaveCount(0, { timeout: 3000 });
      await page.mouse.up();
    });

    test("the old chip and the Map settings section are gone", async ({ page }) => {
      await seed(page);
      await openMap(page, at(48, 2, 4));
      await expect(page.locator(".tn-eye-return")).toHaveCount(0);
      await expect(page.getByRole("link", { name: /back to/i })).toHaveCount(0);
      await page.keyboard.press("ControlOrMeta+k");
      await page.click("#tn-rail-tab-inspector");
      await page.locator("#inspector-rail").getByRole("button", { name: "Map settings" }).click();
      const tool = page.locator(".tn-insp-tool");
      // The tool did render: the row beside the section is there.
      await expect(tool.getByRole("switch", { name: "Buildings" })).toBeVisible();
      await expect(tool.getByText("God's eye view")).toHaveCount(0);
      await expect(tool.getByText("Open this spot")).toHaveCount(0);
      await expect(tool.getByText("Zoom in on a city")).toHaveCount(0);
    });

    for (const [name, eye] of [
      ["a link kept from the old chip", "place%3Dtower-bridge%26lat%3D51.5%26lon%3D-0.08"],
      ["an outside address", "https%3A%2F%2Fevil.example"],
      ["a place that does not exist", "place%3Datlantis"],
    ] as const) {
      test(`${name} in eye= opens the console, with no chip and no error, and leaves the address`, async ({ page }) => {
        const errors = trackErrors(page);
        await seed(page);
        await openMap(page, `/app?lat=48&lon=2&z=4&eye=${eye}`);
        await expect.poll(() => new URL(page.url()).searchParams.has("eye")).toBe(false);
        expect(new URL(page.url()).searchParams.get("lat")).not.toBeNull();
        await expect(page.locator(".tn-eye-return")).toHaveCount(0);
        expect(errors).toEqual([]);
      });
    }

    test("sources=open still opens the rail, because the landing page's All sources uses it", async ({ page }) => {
      await seed(page);
      await openMap(page, "/app?lat=48&lon=2&z=4&sources=open");
      await expect(page.locator("aside.tn-rail").first()).toBeVisible();
      await expect.poll(() => new URL(page.url()).searchParams.has("sources")).toBe(false);
    });

    test("it stands down on the Streets wall and comes back on the Globe, with coverage off", async ({ page }) => {
      await seed(page);
      await openMap(page, at(48, 2, 4));
      await person(page).click();
      await expect(person(page)).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: /STREETS board/ }).click();
      await expect(person(page)).toHaveCount(0);
      await expect(legend(page)).toHaveCount(0);
      await expect(page.locator("[data-eye-person-slot]")).toHaveCount(0);
      await page.getByRole("button", { name: /GLOBE board/ }).click();
      await expect(person(page)).toBeVisible();
      await expect(person(page)).toHaveAttribute("aria-pressed", "false");
    });

    test("it stands down on an expanded widget and comes back with the map", async ({ page }) => {
      await seed(page);
      await openMap(page, "/app?lat=48&lon=2&z=4&preset=news&layers=&base=satellite", null);
      const expand = page.getByRole("button", { name: /^Expand / }).first();
      await expect(expand).toBeVisible({ timeout: 30_000 });
      await expand.click();
      await expect(page.locator(".tn-detail-back")).toBeVisible();
      await expect(person(page)).toHaveCount(0);
      await page.locator(".tn-detail-back").click();
      await expect(person(page)).toBeVisible({ timeout: 30_000 });
    });

    test("a basemap swap while coverage is on keeps the overlay", async ({ page }) => {
      await seed(page);
      await openMap(page, at(53, -2, 6));
      await person(page).click();
      await expect.poll(() => overlayShown(page)).toEqual({ has: true, visible: true });
      await page.keyboard.press("ControlOrMeta+k");
      await page.click("#tn-rail-tab-inspector");
      await page.locator("#inspector-rail").getByRole("button", { name: "Map settings" }).click();
      const tool = page.locator(".tn-insp-tool");
      await tool.getByRole("radiogroup", { name: "Basemap" }).locator('[aria-checked="false"]').first().click();
      await page.waitForTimeout(1500);
      await expect.poll(() => overlayShown(page), { timeout: 15_000 }).toEqual({ has: true, visible: true });
    });
  });

  test.describe("with reduced motion", () => {
    test("no swing, no pulse, no flight and no fall, and it still opens and cancels", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await seed(page);
      await openMap(page, at(53.48, -2.24, 6));
      const to = await windowPoint(page, -2.24, 53.48);
      await carryRingTo(page, to);
      const style = await page.evaluate(() => {
        const swing = document.querySelector("[data-eye-person-swing]") as HTMLElement;
        const fig = document.querySelector("[data-eye-person-figure]") as HTMLElement;
        const dots = document.querySelector("[data-eye-person-ring]") as HTMLElement;
        return {
          swing: swing.style.getPropertyValue("--swing"),
          figure: getComputedStyle(fig).animationName,
          dots: getComputedStyle(dots).animationName,
        };
      });
      expect(style.swing).toBe("");
      expect(style.figure).toBe("none");
      expect(style.dots).toBe("none");
      // Cancelled, he is simply home.
      await page.keyboard.press("Escape");
      await expect(layer(page)).toHaveCount(0);
      await page.mouse.up();
      await expectAtHome(page);

      await carryRingTo(page, to);
      await page.mouse.up();
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
    });
  });
});

test.describe("a phone, 390 px, with a finger", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test.skip(REAL, "stubbed");

  test.beforeEach(async ({ page }) => {
    await stub(page);
  });

  /** A real touch, through the browser's input pipeline, so it becomes pointer events. */
  async function finger(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd", point?: Pt) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ x: point.x, y: point.y }] : [] });
    return {
      async drag(from: Pt, to: Pt, steps = 10) {
        await send("touchStart", from);
        await this.move(from, to, steps);
      },
      async move(from: Pt, to: Pt, steps = 10) {
        for (let i = 1; i <= steps; i++) {
          await send("touchMove", { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
        }
      },
      lift: () => send("touchEnd"),
    };
  }

  for (const skin of ["dark", "light"] as Skin[]) {
    test(`${skin}: a touch drag shows the ring above the finger and the card above him, and opens the result`, async ({ page }) => {
      const errors = trackErrors(page);
      await seed(page, skin);
      await openMap(page, at(52.5, -2, 5.2));
      const start = await mapCentre(page);
      const home = await box(person(page));

      // In line with the i, above it, and a 44 px target around the 36 px plate.
      const i = await box(iCircle(page));
      expect(Math.abs(centre(home).x - centre(i).x)).toBeLessThanOrEqual(0.5);
      expect(home.y + home.height).toBeLessThanOrEqual(i.y);
      const c = centre(home);
      for (const [dx, dy] of [[-21.5, 0], [21.5, 0], [0, -21.5], [0, 21.5]]) {
        const onIt = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-eye-person]") != null, [c.x + dx, c.y + dy]);
        expect(onIt, `${dx},${dy}`).toBe(true);
      }

      const stage = await box(page.locator(".tn-cw-stage"));
      const fingerAt = { x: stage.x + stage.width / 2, y: stage.y + stage.height * 0.8 };
      const t = await finger(page);
      await t.drag(c, fingerAt);
      await expect(layer(page)).toHaveCount(1);
      await page.waitForTimeout(450);

      // The ring is above the finger, so the finger does not hide it, and it is on the map.
      const r = centre(await box(hit(page)));
      expect(Math.abs(r.x - fingerAt.x)).toBeLessThanOrEqual(1);
      expect(fingerAt.y - r.y).toBeCloseTo(72, 0);
      await expect(layer(page)).toHaveAttribute("data-result", "hit");
      // The whole card is on screen, above him, clear of the finger.
      await expect(card(page)).toBeVisible();
      await expect(card(page)).toHaveAttribute("data-side", "above");
      const k = await box(card(page));
      expect(k.x).toBeGreaterThanOrEqual(0);
      expect(k.x + k.width).toBeLessThanOrEqual(390);
      expect(k.y).toBeGreaterThanOrEqual(0);
      expect(k.y + k.height).toBeLessThanOrEqual(r.y);
      // No tooltip from the focus the carry took.
      await page.waitForTimeout(1100);
      await expect(page.locator("[data-eye-person-tip]")).toHaveCount(0);
      await shot(page, `390-${skin}-carry`);

      // The page does not move under the finger. The map did not pan from the corner he came from.
      expect(await page.evaluate(() => [window.scrollX, window.scrollY, document.documentElement.scrollWidth - window.innerWidth])).toEqual([0, 0, 0]);
      const during = await mapCentre(page);
      expect(during.lat).toBeCloseTo(start.lat, 2);
      expect(during.lon).toBeCloseTo(start.lon, 2);

      await t.lift();
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
      expect(PRESET_IDS).toContain(eyeQuery(page).get("place"));
      expect(errors).toEqual([]);
    });
  }

  test("a tap toggles coverage, and a tap on the map opens the search's result", async ({ page }) => {
    await seed(page);
    await openMap(page, at(52.5, -2, 5.2));
    const c = centre(await box(person(page)));
    await page.touchscreen.tap(c.x, c.y);
    await expect(person(page)).toHaveAttribute("aria-pressed", "true");
    await expect(legend(page)).toContainText("Tap the map");
    await shot(page, "390-dark-toggled");
    const stage = await box(page.locator(".tn-cw-stage"));
    await page.touchscreen.tap(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
    expect(PRESET_IDS).toContain(eyeQuery(page).get("place"));
  });

  test("a tap after a flick still works, because Chrome sends no click for it", async ({ page }) => {
    await seed(page);
    await openMap(page, at(52.5, -2, 5.2));
    const c = centre(await box(person(page)));
    const t = await finger(page);
    await t.drag(c, { x: c.x - 150, y: c.y - 150 });
    await expect(layer(page)).toHaveCount(1);
    await t.move({ x: c.x - 150, y: c.y - 150 }, { x: c.x, y: c.y + 72 }, 4);
    await t.lift();
    await expect(layer(page)).toHaveCount(0, { timeout: 3000 });
    await expectAtHome(page);
    await page.touchscreen.tap(c.x, c.y);
    await expect(person(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("the card stays on the screen at the phone's edges", async ({ page }) => {
    await seed(page);
    await openMap(page, at(52.5, -2, 5.2));
    const stage = await box(page.locator(".tn-cw-stage"));
    const c = centre(await box(person(page)));
    const t = await finger(page);
    const spots: Pt[] = [
      { x: stage.x + 40, y: stage.y + stage.height - 40 },
      { x: stage.x + stage.width - 40, y: stage.y + stage.height - 40 },
      { x: stage.x + 40, y: stage.y + 110 },
    ];
    let from = c;
    let first = true;
    for (const spot of spots) {
      if (first) await t.drag(from, spot);
      else await t.move(from, spot, 6);
      first = false;
      from = spot;
      await page.waitForTimeout(450);
      const k = await card(page).boundingBox();
      if (k) {
        expect(k.x).toBeGreaterThanOrEqual(0);
        expect(k.y).toBeGreaterThanOrEqual(0);
        expect(k.x + k.width).toBeLessThanOrEqual(390);
        expect(k.y + k.height).toBeLessThanOrEqual(844);
      }
    }
    await t.move(from, { x: c.x, y: c.y + 72 }, 4);
    await t.lift();
  });
});

test.describe("the real route", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(!REAL, "only with EYE_PERSON_REAL=1");

  test("the index answers, a drop over the UK opens a real place, and the card names it", async ({ page }) => {
    const errors = trackErrors(page);
    await seed(page);
    await openMap(page, at(56.5, -4, 6));
    const first = await page.evaluate(async () => {
      const res = await fetch("/api/eye/coverage");
      const body = await res.json();
      return { status: res.status, ok: body.ok, cells: body.cells?.length ?? 0, cache: res.headers.get("cache-control") };
    });
    console.log("index", JSON.stringify(first));
    expect(first.status).toBe(200);
    expect(first.ok).toBe(true);
    expect(first.cells).toBeGreaterThan(1000);
    const to = await windowPoint(page, -4.22, 57.48);
    await settleOn(page, to);
    await expect(layer(page)).toHaveAttribute("data-result", "hit");
    await expect(card(page)).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2500);
    console.log("card", await card(page).textContent());
    await expect(page.locator("[data-eye-person-count]")).toHaveText(/\d+ cameras/);
    await page.mouse.up();
    await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
    console.log("opened", page.url());
    await page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
    console.log("title", await page.getByRole("heading", { level: 1 }).textContent());
    expect(errors).toEqual([]);
  });

  test("a bad box is a 400, and a good one answers real points on the grid", async ({ request }) => {
    const bad = await request.get("/api/eye/coverage?bbox=nonsense");
    expect(bad.status()).toBe(400);
    const good = await request.get("/api/eye/coverage?bbox=-4.4,55.8,-4.1,55.95");
    expect(good.status()).toBe(200);
    const body = await good.json();
    console.log("points", body.total, JSON.stringify(body.points?.[0]));
    expect(body.ok).toBe(true);
    expect(body.box).toEqual([-4.4, 55.8, -4.1, 56]);
  });
});
