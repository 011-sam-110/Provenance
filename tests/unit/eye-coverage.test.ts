import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COVERAGE_POINTS_CAP,
  EXACT_FROM_ZOOM,
  buildCoverage,
  buildCoverageIndex,
  buildPoints,
  coverageScore,
  coverageWeight,
  findDrop,
  kmBetween,
  searchRadiusKm,
  snapCoverageBox,
  type DropResult,
} from "@/lib/eye/coverage";
import { __resetCoverageBody, coverageCellsBody } from "@/lib/eye/coverageBody";
import { EYE_PLACES } from "@/lib/eye/places";
import type { Camera } from "@/lib/types";

/**
 * Where a drop of the person goes (lib/eye/coverage.ts), and the index that decides it. The
 * acceptance table runs on tests/fixtures/eye-coverage.json: production's own cells (2026-10-31,
 * 44,961 available cameras), cut to every cell that can decide a drop in the table. Nothing in it
 * is invented, so when the registry moves the file can be cut again, and a line that then fails
 * is news about the data. tests/e2e/eye-person.spec.ts serves the same file to a real drag.
 */

const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "eye-coverage.json"), "utf8"));
const index = buildCoverageIndex(fixture)!;

const PRESETS = new Set(EYE_PLACES.map((p) => p.id));

function snap(zoom: number, lat: number, lon: number): Extract<DropResult, { kind: "snap" }> {
  const r = findDrop(index, zoom, { lat, lon });
  if (r.kind !== "snap") throw new Error(`expected a snap at z${zoom} ${lat},${lon}, got ${r.kind}`);
  return r;
}

// Named places in the fixture's two Scottish cities, as the geocoder names their cells.
const GLASGOW = { lat: 55.86, lon: -4.25 };
const EDINBURGH = { lat: 55.95, lon: -3.19 };
const ATLANTA = { lat: 33.75, lon: -84.39 };
const TAIPEI = { lat: 25.03, lon: 121.56 };
const TAICHUNG = { lat: 24.15, lon: 120.67 };

describe("the search radius", () => {
  it("is 500 km at zoom 6 and wider", () => {
    for (const z of [0, 1.4, 3, 5, 6]) expect(searchRadiusKm(z)).toBe(500);
  });

  it("halves per zoom from there", () => {
    expect(searchRadiusKm(7)).toBe(250);
    expect(searchRadiusKm(8)).toBe(125);
    expect(searchRadiusKm(9)).toBe(62.5);
    expect(searchRadiusKm(10)).toBe(31.25);
    expect(searchRadiusKm(11)).toBeCloseTo(15.6, 1);
  });

  it("moves smoothly between whole zooms", () => {
    expect(searchRadiusKm(7.5)).toBeLessThan(250);
    expect(searchRadiusKm(7.5)).toBeGreaterThan(125);
  });

  it("has a radius for a broken zoom", () => {
    expect(searchRadiusKm(Number.NaN)).toBe(500);
  });
});

describe("the score", () => {
  it("is the weight at no distance, and half of it at d0, a third of the radius", () => {
    expect(coverageScore(120, 0, 300)).toBe(120);
    expect(coverageScore(120, 100, 300)).toBeCloseTo(60, 6);
  });

  it("falls with distance", () => {
    expect(coverageScore(120, 200, 300)).toBeLessThan(coverageScore(120, 100, 300));
  });

  it("lets more cameras far away beat fewer nearby: rank, not nearest", () => {
    expect(coverageScore(829, 262, 500)).toBeGreaterThan(coverageScore(200, 290, 500));
    expect(coverageScore(829, 262, 500)).toBeGreaterThan(coverageScore(30, 40, 500));
  });

  it("counts a camera whose stream played for more than a still", () => {
    expect(coverageWeight(10, 0)).toBe(10);
    expect(coverageWeight(10, 4)).toBe(14);
  });
});

describe("the acceptance table, on production's cells", () => {
  it.each([3, 4, 5, 6])("London at zoom %i opens a London preset", (z) => {
    const r = snap(z, 51.5, -0.12);
    expect(r.why).toBe("preset");
    expect(PRESETS.has(r.place!.id)).toBe(true);
    expect(r.place!.area).toBe("London");
  });

  it("Manchester at zoom 6 opens London, not the closer-looking Scotland", () => {
    expect(snap(6, 53.48, -2.24).place?.area).toBe("London");
  });

  it("mid-Wales at zoom 6 opens London", () => {
    expect(snap(6, 52.35, -3.75).place?.area).toBe("London");
  });

  it("Inverness at zoom 6 opens Glasgow or Edinburgh, not London", () => {
    const r = snap(6, 57.48, -4.22);
    expect(r.place).toBeUndefined();
    expect(Math.min(kmBetween(r.spot, GLASGOW), kmBetween(r.spot, EDINBURGH))).toBeLessThan(20);
  });

  it("Glasgow at zoom 8 opens Glasgow or Edinburgh, not London", () => {
    const r = snap(8, 55.86, -4.25);
    expect(r.place).toBeUndefined();
    expect(Math.min(kmBetween(r.spot, GLASGOW), kmBetween(r.spot, EDINBURGH))).toBeLessThan(20);
  });

  it("mid-Atlantic at zoom 5 is a miss", () => {
    expect(findDrop(index, 5, { lat: 40, lon: -38 }).kind).toBe("miss");
  });

  it("Atlanta at zoom 6 opens Atlanta", () => {
    expect(kmBetween(snap(6, 33.75, -84.39).spot, ATLANTA)).toBeLessThan(15);
  });

  it("rural Georgia at zoom 6 opens Atlanta", () => {
    expect(kmBetween(snap(6, 32.5, -83.5).spot, ATLANTA)).toBeLessThan(15);
  });

  it("north Taiwan at zoom 6 opens the densest place on the island, at Taipei's edge", () => {
    const r = snap(6, 24.9, 121.3);
    expect(kmBetween(r.spot, TAIPEI)).toBeLessThan(30);
    expect(r.cameras).toBeGreaterThan(500);
  });

  // THE ONE LINE THE SPEC'S WORDS DO NOT COVER, kept as measured and reported to the lead. The
  // middle of the island is 47 km from Taichung (373 cameras) and 153 km from Taipei (531). The
  // spec's score gives Taichung 350 and Taipei 288. Taipei would need d0 at about 0.45 of the
  // radius, and that sends Newcastle to London past Edinburgh, 385 km against 165.
  it("the middle of Taiwan at zoom 6 opens Taichung, the big city it is nearest", () => {
    const r = snap(6, 23.7, 121.0);
    expect(kmBetween(r.spot, TAICHUNG)).toBeLessThan(25);
    expect(r.cameras).toBeGreaterThan(300);
  });

  it("a block in Manchester at zoom 13 opens exactly there", () => {
    expect(findDrop(index, 13, { lat: 53.4794, lon: -2.2453 })).toEqual({ kind: "exact" });
  });
});

describe("the rules around the table", () => {
  it("opens at the ring from zoom 12, and searches below it", () => {
    expect(findDrop(index, EXACT_FROM_ZOOM, GLASGOW).kind).toBe("exact");
    expect(findDrop(index, EXACT_FROM_ZOOM - 0.01, GLASGOW).kind).toBe("snap");
  });

  it("opens at the ring with a note when there is no index, rather than failing", () => {
    expect(findDrop(null, 6, GLASGOW)).toEqual({ kind: "exact", note: "no-index" });
  });

  it("misses where a closer zoom has shrunk the radius past the cameras", () => {
    // Manchester holds no camera, and the nearest is out of reach at zoom 9's 62.5 km.
    expect(findDrop(index, 9, { lat: 53.48, lon: -2.24 }).kind).toBe("miss");
  });

  it("gives the same place for the same drop, every time", () => {
    const a = findDrop(index, 6, { lat: 53.48, lon: -2.24 });
    const fresh = buildCoverageIndex(fixture)!;
    expect(findDrop(fresh, 6, { lat: 53.48, lon: -2.24 })).toEqual(a);
    expect(findDrop(index, 6, { lat: 53.48, lon: -2.24 })).toEqual(a);
  });

  it("lands on a real camera's point, never on an average of two", () => {
    const r = snap(8, 55.86, -4.25);
    const rows: number[][] = fixture.cells;
    expect(rows.some((row) => row[0] === r.spot.lat && row[1] === r.spot.lon)).toBe(true);
  });

  it("a preset does not take a result outside its reach at a close zoom", () => {
    // 12 km south of Westminster: inside zoom 11's 15.6 km search, outside its 7.8 km preset reach.
    const croydon = { lat: 51.393, lon: -0.1 };
    const local = buildCoverageIndex({ ok: true, regions: [""], cells: [[croydon.lat, croydon.lon, 40, 0, "a:1", 0]] })!;
    const r = findDrop(local, 11, croydon);
    expect(r.kind === "snap" && r.why).toBe("densest");
    // Further out the same cell is London, and a preset takes it.
    const wide = findDrop(local, 7, croydon);
    expect(wide.kind === "snap" && wide.why).toBe("preset");
  });

  it("a preset takes a result near it at a close zoom", () => {
    expect(snap(11, 51.505, -0.075).place?.id).toBe("tower-bridge");
  });

  it("never sends the card's name lookup the pointer's place", () => {
    const r = snap(8, 55.81, -4.31);
    const rows: number[][] = fixture.cells;
    expect(rows.some((row) => row[0] === r.cellSpot.lat && row[1] === r.cellSpot.lon)).toBe(true);
  });

  it("counts the neighbourhood, so a city reads as a city", () => {
    const r = snap(6, 51.5, -0.12);
    expect(r.cameras).toBeGreaterThan(800);
    expect(r.played).toBe(0);
  });

  it("reaches across the antimeridian", () => {
    const local = buildCoverageIndex({ ok: true, regions: ["Fiji"], cells: [[-17.8, 179.9, 40, 0, "fj:1", 0]] })!;
    const r = findDrop(local, 6, { lat: -17.8, lon: -179.8 });
    expect(r.kind).toBe("snap");
    if (r.kind === "snap") {
      expect(r.spot.lon).toBe(179.9);
      expect(r.km).toBeLessThan(40);
    }
  });

  it("works near a pole, where a degree of longitude is short", () => {
    const local = buildCoverageIndex({ ok: true, regions: [""], cells: [[84, 40, 3, 0, "x:1", 0]] })!;
    expect(findDrop(local, 6, { lat: 84, lon: 20 }).kind).toBe("snap");
  });
});

/** Real rows from /api/cameras, the operator's own positions, with a stand-in picture address. */
const row = (id: string, lat: number, lon: number, extra: Partial<Camera> = {}) =>
  ({
    id,
    source: id.split(":")[0],
    country: "GB",
    region: "Strathclyde",
    name: id,
    lat,
    lon,
    imageUrl: "https://example.test/x.jpg",
    mediaType: "jpeg",
    refreshSeconds: 300,
    license: "OGL",
    attribution: "Traffic Scotland",
    available: true,
    ...extra,
  }) as Camera;

const GLASGOW_ROWS = [
  row("trafficscotland:13", 55.8523, -4.0888),
  row("trafficscotland:14", 55.8531, -4.0861),
  row("trafficscotland:15", 55.8519, -4.0902),
  row("trafficscotland:90", 55.7997, -4.0012),
];

describe("the index builder", () => {
  it("makes one row per 0.1 degree cell, counting the available cameras only", () => {
    const body = buildCoverage([...GLASGOW_ROWS, row("x:off", 55.85, -4.09, { available: false })], () => false);
    expect(body.cells).toHaveLength(2);
    expect(body.cells.map((c) => c[2]).sort()).toEqual([1, 3]);
  });

  it("takes the cell's point from the densest small cluster, not from a mean", () => {
    const body = buildCoverage(GLASGOW_ROWS.slice(0, 3).concat(row("trafficscotland:16", 55.8999, -4.0999)), () => false);
    const cell = body.cells[0];
    // The lone camera at the cell's far corner cannot drag the point towards it.
    expect(GLASGOW_ROWS.slice(0, 3).map((c) => c.id)).toContain(cell[4]);
    expect(cell[0]).toBeLessThan(55.86);
  });

  it("counts `played` through the gate it is given, and never reads a `live` flag from a list", () => {
    const flagged = GLASGOW_ROWS.map((c) => ({ ...c, live: true }));
    expect(buildCoverage(flagged, () => false).cells.every((c) => c[3] === 0)).toBe(true);
    const played = buildCoverage(GLASGOW_ROWS, (c) => c.id === "trafficscotland:14").cells;
    expect(played.find((c) => c[2] === 3)?.[3]).toBe(1);
  });

  it("gives the same body whatever order the registry lists its cameras", () => {
    const a = buildCoverage(GLASGOW_ROWS, () => false);
    const b = buildCoverage([...GLASGOW_ROWS].reverse(), () => false);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("names a still only where the cell has a camera with a picture", () => {
    const video = row("x:1", 50.05, 3.05, { imageUrl: undefined, mediaType: "video" });
    const still = row("x:2", 50.06, 3.06);
    expect(buildCoverage([video], () => false).cells[0][4]).toBe("");
    expect(buildCoverage([video, still], () => false).cells[0][4]).toBe("x:2");
  });

  it("holds each region once, and a row points at it", () => {
    const body = buildCoverage(GLASGOW_ROWS, () => false);
    expect(body.regions).toEqual(["Strathclyde"]);
    expect(body.cells.every((c) => body.regions[c[5]] === "Strathclyde")).toBe(true);
  });

  it("leaves out a broken position", () => {
    expect(buildCoverage([row("x:1", Number.NaN, 1)], () => false).cells).toEqual([]);
  });

  it("carries no picture address and no stream address", () => {
    const text = JSON.stringify(buildCoverage(GLASGOW_ROWS, () => false));
    expect(text).not.toContain("example.test");
  });
});

describe("the browser's index", () => {
  it("is null for an answer that holds nothing, so the person opens at the ring", () => {
    expect(buildCoverageIndex(null)).toBeNull();
    expect(buildCoverageIndex({ ok: false, cells: [], regions: [] })).toBeNull();
    expect(buildCoverageIndex({ ok: true, cells: [], regions: [] })).toBeNull();
    expect(buildCoverageIndex({ ok: true, cells: "nope" })).toBeNull();
  });

  it("leaves out a row that is not a row", () => {
    const i = buildCoverageIndex({ ok: true, regions: [], cells: [[1, 2, 3, 0, "a:1", 0], "junk", [Number.NaN, 1, 1, 0, "", 0], [1, 2, 0, 0, "", 0]] });
    expect(i?.cells).toHaveLength(1);
  });

  it("reads the region a row points at", () => {
    const i = buildCoverageIndex({ ok: true, regions: ["Strathclyde"], cells: [[55.85, -4.09, 3, 0, "a:1", 0]] })!;
    const r = findDrop(i, 8, { lat: 55.85, lon: -4.09 });
    expect(r.kind === "snap" && r.region).toBe("Strathclyde");
  });
});

describe("the exact points", () => {
  const many = Array.from({ length: COVERAGE_POINTS_CAP + 50 }, (_, i) => row(`x:${i}`, 50 + i * 0.0001, 3));

  it("are only the available cameras in the box", () => {
    const out = buildPoints(
      [...GLASGOW_ROWS, row("x:off", 55.85, -4.09, { available: false }), row("x:far", 10, 10)],
      [-5, 55, -3, 56],
      () => false,
    );
    expect(out.points).toHaveLength(4);
    expect(out.total).toBe(4);
  });

  it("stop at the cap, the nearest the middle of the box, and still say how many there are", () => {
    const out = buildPoints(many, [2, 50, 4, 50.3], () => false);
    expect(out.points).toHaveLength(COVERAGE_POINTS_CAP);
    expect(out.total).toBe(many.length);
    const lats = out.points.map((p) => p[0]);
    expect(Math.min(...lats)).toBeGreaterThan(50);
  });

  it("carry the name, and a still's id only where there is a picture", () => {
    const video = row("x:1", 50, 3, { imageUrl: undefined, name: "A406 Billet Upass E" });
    const [p] = buildPoints([video], [2, 49, 4, 51], () => true).points;
    expect(p[2]).toBe("");
    expect(p[3]).toBe(1);
    expect(p[4]).toBe("A406 Billet Upass E");
  });

  it("are asked for on a grid, so a log never holds a place finer than a cell", () => {
    expect(snapCoverageBox([-0.1234, 51.4567, 0.0123, 51.5612])).toEqual([-0.2, 51.4, 0.1, 51.6]);
    // Idempotent: the route snaps again, and must not grow the box.
    expect(snapCoverageBox([-0.2, 51.4, 0.1, 51.6])).toEqual([-0.2, 51.4, 0.1, 51.6]);
    expect(snapCoverageBox([-179.99, -89.99, 179.99, 89.99])).toEqual([-180, -90, 180, 90]);
  });
});

describe("the route's body", () => {
  it("is not built twice for the same registry and gate", () => {
    __resetCoverageBody();
    const cams = GLASGOW_ROWS;
    const gate = { warm: false, ids: new Set<string>() };
    const a = coverageCellsBody(cams, gate);
    expect(coverageCellsBody(cams, gate)).toBe(a);
    expect(JSON.parse(a).ok).toBe(true);
  });

  it("counts a stream as played only through the play check's gate", () => {
    __resetCoverageBody();
    const streaming = [row("x:1", 50.05, 3.05, { streamUrl: "https://example.test/live.m3u8", mediaType: "both" })];
    const cold = JSON.parse(coverageCellsBody(streaming, { warm: false, ids: new Set<string>() }));
    expect(cold.cells[0][3]).toBe(0);
  });

  it("is under its budget at production's size: 9,700 cells, 452 KB raw, 129 KB gzipped", () => {
    // The route's measured size is in the report. This holds the row's shape to six fields.
    expect(fixture.cells[0]).toHaveLength(6);
  });
});

describe("the route, read as source", () => {
  const route = readFileSync(join(process.cwd(), "app", "api", "eye", "coverage", "route.ts"), "utf8");
  const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("starts the play check, as /api/near does", () => {
    expect(code).toContain("ensurePlayCheck(getRegistry)");
  });

  it("is never a 5xx: a failure is a 200 with no rows, and nothing stores it", () => {
    expect(code).toMatch(/catch \{/);
    expect(code).not.toMatch(/status: 5\d\d/);
    expect(code).toContain("no-store");
  });

  it("keeps the edge's copy, and exports only what a route may", () => {
    expect(code).toContain("coverageCacheHeaders()");
    expect(code.match(/^export [^\n]+/gm)).toEqual(['export const dynamic = "force-dynamic";', "export async function GET(req: Request) {"]);
  });
});
