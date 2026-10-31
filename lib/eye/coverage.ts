// Where a drop of the person goes, and the index that decides it. Pure: no DOM, no MapLibre and
// no server module, so the node test suite holds every rule, and the console's bundle can carry
// the search (tests/unit/eye-coverage.test.ts). The route is app/api/eye/coverage, its memo is
// lib/eye/coverageBody.ts and the person is components/console/EyePerson.tsx.
//
// WHY A WIDE SEARCH. Google's Pegman looks in a ring of about 17 screen px and flies home on a
// miss (measured 2026-10-31). Its roads are everywhere and our cameras are not: production holds
// 46,480, the UK 1,311 of them, 890 in London, and England outside London almost none. So a zoomed
// out drop searches a wide radius and ranks what it finds, and the person shows the choice on the
// map before the release (a marker and a line), which is what makes the jump honest.
//
// RANK, NOT NEAREST. A city's cameras fall in many 0.1 degree cells, so a cell is scored by the
// cameras in its neighbourhood (`neighbourKm`), and that sum is divided by distance:
//     score = weight / (1 + (km / d0)^2),  d0 = radius / 3.
// That is why Manchester at zoom 6 opens London (262 km, 890 cameras) and not Glasgow (290 km,
// about 200): a nearest rule could not say so, and a raw per-cell count would let one busy
// junction beat a whole city.
//
// LAND ON SOMETHING, NOT ON AN AVERAGE. A cell's point is one real camera: the one with the most
// others close to it (`medoid`), so the mean of two far roads can never put the view in a field.
// The landing is the densest cell near the winner, and that camera's still is the preview.
//
// DETERMINISTIC. The same drop opens the same place: no clock and no randomness, every tie goes to
// the lower cell key, and the body does not depend on the order the registry lists its feeds.
//
// A CELL NEVER READS `live` FROM A LIST. `played` is counted through the gate the route hands in
// (`isLiveCamera`, lib/liveness/playcheck.ts), the same gate /api/near uses. Today no UK camera
// counts as live, so density alone carries the UK, and a stream that plays only adds to it.

import type { Camera } from "@/lib/types";
import { EYE_PLACES, type EyePlace } from "@/lib/eye/places";

/** A cell's side, in degrees. Measured 2026-10-31: 9,700 cells, 127 KB gzipped with ids. */
export const COVERAGE_CELL_DEG = 0.1;
/** A wider zoom than this searches at the same radius. */
export const WIDEST_SEARCH_ZOOM = 6;
/** The search radius at WIDEST_SEARCH_ZOOM and wider. Halves per zoom from there. */
export const WIDEST_SEARCH_KM = 500;
/** From this zoom a drop opens at the ring, always: the visitor zoomed in and chose the place. */
export const EXACT_FROM_ZOOM = 12;
/** From this zoom cells are too coarse to draw, and the overlay asks for exact points. */
export const POINTS_FROM_ZOOM = 9;
/** A camera whose stream played counts this many times over. */
const PLAYED_WEIGHT = 2;
/** A neighbourhood is this fraction of the search radius... */
const NEIGHBOUR_FRACTION = 1 / 12;
/** ...and a preset wins within this fraction of it, up to PRESET_MAX_KM. */
const PRESET_FRACTION = 1 / 2;
const PRESET_MAX_KM = 30;
/** Cameras this close to each other are one small cluster, for picking a cell's point. */
const CLUSTER_KM = 0.4;
/** The most exact points one answer carries: the nearest the middle of the box. */
export const COVERAGE_POINTS_CAP = 2000;

/** [lat, lon, cameras, played, still's camera id or "", index into `regions`]. */
export type CoverageRow = [number, number, number, number, string, number];

export interface CoverageBody {
  ok: boolean;
  /** Region names, once each. `region` on a row is "Strathclyde", not "Glasgow". */
  regions: string[];
  cells: CoverageRow[];
}

/** [lat, lon, still's camera id or "", played 0 or 1, the camera's own name]. */
export type CoveragePoint = [number, number, string, 0 | 1, string];

export interface CoveragePoints {
  ok: boolean;
  box?: [number, number, number, number];
  /** Every camera in the box, which can be more than `points` holds. */
  total: number;
  points: CoveragePoint[];
}

export interface Spot {
  lat: number;
  lon: number;
}

const KM_PER_DEG = 111.195;
const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f + 0;
};
const rad = (deg: number) => (deg * Math.PI) / 180;

/** The difference of two longitudes across the shorter way round. */
const lonGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Great-circle distance in km. */
export function kmBetween(a: Spot, b: Spot): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(lonGap(a.lon, b.lon));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Good to under 1% at the short lengths it is used for, and much cheaper: it runs millions of times. */
function nearKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const x = lonGap(aLon, bLon) * Math.cos(rad((aLat + bLat) / 2));
  const y = aLat - bLat;
  return Math.sqrt(x * x + y * y) * KM_PER_DEG;
}

/** The search radius for a map zoom, in km. */
export function searchRadiusKm(zoom: number): number {
  const z = Number.isFinite(zoom) ? Math.max(zoom, WIDEST_SEARCH_ZOOM) : WIDEST_SEARCH_ZOOM;
  return WIDEST_SEARCH_KM / 2 ** (z - WIDEST_SEARCH_ZOOM);
}

/** What one cell, or one neighbourhood, is worth before distance. */
export function coverageWeight(cameras: number, played: number): number {
  return cameras - played + played * PLAYED_WEIGHT;
}

/** The score for a weight at a distance, with a search radius. */
export function coverageScore(weight: number, km: number, radiusKm: number): number {
  const d0 = radiusKm / 3;
  return weight / (1 + (km / d0) ** 2);
}

const cellKey = (lat: number, lon: number) => `${Math.floor(lat / COVERAGE_CELL_DEG + 1e-9)}:${Math.floor(lon / COVERAGE_CELL_DEG + 1e-9)}`;

/** The camera with the most others within CLUSTER_KM, the lowest id on a tie. */
function medoid<T extends { id: string; lat: number; lon: number }>(list: readonly T[]): T {
  let best = list[0];
  let bestNear = -1;
  for (const a of list) {
    let near = 0;
    for (const b of list) if (a !== b && nearKm(a.lat, a.lon, b.lat, b.lon) <= CLUSTER_KM) near++;
    if (near > bestNear || (near === bestNear && a.id < best.id)) {
      best = a;
      bestNear = near;
    }
  }
  return best;
}

type IndexCamera = Pick<Camera, "id" | "lat" | "lon" | "available" | "region" | "imageUrl">;

/**
 * The route's body: one row per 0.1 degree cell with an available camera. Sorted, so a camera
 * list in another order gives the same bytes. The point is a camera that has a still where the
 * cell has one, because the preview shows it: a video-only camera has no picture at /api/proxy.
 */
export function buildCoverage(cameras: readonly IndexCamera[], isLive: (camera: IndexCamera) => boolean): CoverageBody {
  const cells = new Map<string, { list: IndexCamera[]; played: number }>();
  for (const c of cameras) {
    if (!c.available || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    const key = cellKey(c.lat, c.lon);
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { list: [], played: 0 }));
    cell.list.push(c);
    if (isLive(c)) cell.played++;
  }
  const picked = [...cells.values()].map((cell) => {
    const stills = cell.list.filter((c) => c.imageUrl);
    return { cell, rep: medoid(stills.length > 0 ? stills : cell.list), hasStill: stills.length > 0 };
  });
  picked.sort((a, b) => a.rep.lat - b.rep.lat || a.rep.lon - b.rep.lon || (a.rep.id < b.rep.id ? -1 : 1));
  const regions: string[] = [];
  const regionAt = new Map<string, number>();
  const rows = picked.map(({ cell, rep, hasStill }): CoverageRow => {
    const region = rep.region?.trim() ?? "";
    let at = regionAt.get(region);
    if (at === undefined) {
      at = regions.length;
      regions.push(region);
      regionAt.set(region, at);
    }
    return [round(rep.lat, 4), round(rep.lon, 4), cell.list.length, cell.played, hasStill ? rep.id : "", at];
  });
  return { ok: true, regions, cells: rows };
}

type PointCamera = IndexCamera & Pick<Camera, "name">;

/**
 * The exact cameras in a box, at most COVERAGE_POINTS_CAP, the nearest the middle. `box` is
 * [west, south, east, north].
 */
export function buildPoints(
  cameras: readonly PointCamera[],
  box: [number, number, number, number],
  isLive: (camera: PointCamera) => boolean,
): CoveragePoints {
  const [west, south, east, north] = box;
  const inBox = cameras.filter(
    (c) => c.available && c.lat >= south && c.lat <= north && c.lon >= west && c.lon <= east,
  );
  const midLat = (south + north) / 2;
  const midLon = (west + east) / 2;
  const nearest =
    inBox.length <= COVERAGE_POINTS_CAP
      ? inBox
      : inBox
          .map((c) => ({ c, km: nearKm(c.lat, c.lon, midLat, midLon) }))
          .sort((a, b) => a.km - b.km || (a.c.id < b.c.id ? -1 : 1))
          .slice(0, COVERAGE_POINTS_CAP)
          .map((x) => x.c);
  const points = nearest.map((c): CoveragePoint => [round(c.lat, 5), round(c.lon, 5), c.imageUrl ? c.id : "", isLive(c) ? 1 : 0, c.name]);
  return { ok: true, box, total: inBox.length, points };
}

const COVERAGE_BOX_STEP = 10;

/**
 * The box grown outward to the 0.1 degree grid. It is the view, not the pointer: two visitors in
 * the same area ask the same URL, and the access log never holds a place finer than a cell.
 */
export function snapCoverageBox(box: [number, number, number, number]): [number, number, number, number] {
  const [w, s, e, n] = box;
  const out = (v: number) => round(v / COVERAGE_BOX_STEP, 6);
  return [
    Math.max(-180, out(Math.floor(w * COVERAGE_BOX_STEP + 1e-9))),
    Math.max(-90, out(Math.floor(s * COVERAGE_BOX_STEP + 1e-9))),
    Math.min(180, out(Math.ceil(e * COVERAGE_BOX_STEP - 1e-9))),
    Math.min(90, out(Math.ceil(n * COVERAGE_BOX_STEP - 1e-9))),
  ];
}

// ── The index in the browser ────────────────────────────────────────────────────────────────

interface IndexedCell {
  /** Its place in `cells`, for the neighbourhood arrays. */
  at: number;
  key: string;
  lat: number;
  lon: number;
  cameras: number;
  played: number;
  stillId: string;
  region: string;
  weight: number;
}

interface Neighbourhoods {
  cameras: Int32Array;
  played: Int32Array;
}

export interface CoverageIndex {
  cells: readonly IndexedCell[];
  /** One-degree buckets, so a search reads only the cells near it. */
  buckets: Map<number, IndexedCell[]>;
  /** The neighbourhood sums, built once per whole zoom the first time it is asked for. */
  byZoom: Map<number, Neighbourhoods>;
}

const bucketKey = (latDeg: number, lonDeg: number) => (latDeg + 90) * 360 + (((lonDeg % 360) + 360) % 360);

/** Never throws: a row that is not a row is left out. An index with no cells is still an index. */
export function buildCoverageIndex(body: unknown): CoverageIndex | null {
  const b = body as Partial<CoverageBody> | null | undefined;
  if (!b || b.ok !== true || !Array.isArray(b.cells) || b.cells.length === 0) return null;
  const regions = Array.isArray(b.regions) ? b.regions : [];
  const cells: IndexedCell[] = [];
  const buckets = new Map<number, IndexedCell[]>();
  for (const row of b.cells) {
    if (!Array.isArray(row)) continue;
    const [lat, lon, cameras, played, stillId, region] = row;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(cameras > 0)) continue;
    const seen = Number.isFinite(played) ? played : 0;
    const cell: IndexedCell = {
      at: cells.length,
      key: cellKey(lat, lon),
      lat,
      lon,
      cameras,
      played: seen,
      stillId: typeof stillId === "string" ? stillId : "",
      region: regions[region] ?? "",
      weight: coverageWeight(cameras, seen),
    };
    cells.push(cell);
    const k = bucketKey(Math.floor(lat), Math.floor(lon));
    const bucket = buckets.get(k);
    if (bucket) bucket.push(cell);
    else buckets.set(k, [cell]);
  }
  return cells.length > 0 ? { cells, buckets, byZoom: new Map() } : null;
}

/** Calls `visit` for every cell that could be within `km` of the point. Not filtered by distance. */
function eachNear(index: CoverageIndex, lat: number, lon: number, km: number, visit: (cell: IndexedCell) => void): void {
  const dLat = km / KM_PER_DEG;
  const fromLat = Math.max(-90, Math.floor(lat - dLat));
  const toLat = Math.min(89, Math.floor(lat + dLat));
  for (let row = fromLat; row <= toLat; row++) {
    // The longitude span is widest at the end of the row nearest the pole.
    const poleward = Math.min(89.9, Math.max(Math.abs(row), Math.abs(row + 1)));
    const dLon = km / (KM_PER_DEG * Math.cos(rad(poleward)));
    if (dLon >= 180) {
      for (let col = -180; col < 180; col++) index.buckets.get(bucketKey(row, col))?.forEach(visit);
      continue;
    }
    const fromLon = Math.floor(lon - dLon);
    const toLon = Math.floor(lon + dLon);
    for (let col = fromLon; col <= toLon; col++) index.buckets.get(bucketKey(row, col))?.forEach(visit);
  }
}

/** The neighbourhood's radius for a zoom, in km. */
function neighbourKm(zoom: number): number {
  return searchRadiusKm(Math.floor(zoom)) * NEIGHBOUR_FRACTION;
}

function neighbourhoods(index: CoverageIndex, zoom: number): Neighbourhoods {
  const whole = Math.floor(Math.max(zoom, WIDEST_SEARCH_ZOOM));
  const held = index.byZoom.get(whole);
  if (held) return held;
  const km = neighbourKm(whole);
  const cameras = new Int32Array(index.cells.length);
  const played = new Int32Array(index.cells.length);
  for (const cell of index.cells) {
    let n = 0;
    let p = 0;
    eachNear(index, cell.lat, cell.lon, km, (other) => {
      if (other === cell || nearKm(cell.lat, cell.lon, other.lat, other.lon) <= km) {
        n += other.cameras;
        p += other.played;
      }
    });
    cameras[cell.at] = n;
    played[cell.at] = p;
  }
  const built = { cameras, played };
  index.byZoom.set(whole, built);
  return built;
}

/** Build the neighbourhood sums ahead of a carry, so its first move pays nothing. */
export function warmCoverageIndex(index: CoverageIndex, zoom: number): void {
  if (zoom < EXACT_FROM_ZOOM) neighbourhoods(index, zoom);
}

export type DropResult =
  | {
      kind: "snap";
      /** Where it opens. A preset's own framed spot, or a real camera's. */
      spot: Spot;
      /** A hand-framed preset won, or the densest cluster near the winner did. */
      why: "preset" | "densest";
      /** The preset, when `why` is "preset". */
      place?: EyePlace;
      /** The cell this result is cached and named by. */
      key: string;
      /** The cell's point, for the name lookup: never the pointer's. */
      cellSpot: Spot;
      stillId: string;
      region: string;
      /** The cameras around it, and how many of them played. */
      cameras: number;
      played: number;
      km: number;
      radiusKm: number;
      score: number;
    }
  | { kind: "exact"; note?: "no-index" }
  | { kind: "miss"; radiusKm: number };

/**
 * Where a drop at `at` goes, at a map zoom. `index` is null when there is no index (the route
 * answered empty or has not answered), and the person then opens where it was dropped.
 */
export function findDrop(index: CoverageIndex | null, zoom: number, at: Spot): DropResult {
  if (zoom >= EXACT_FROM_ZOOM) return { kind: "exact" };
  if (!index) return { kind: "exact", note: "no-index" };
  const radiusKm = searchRadiusKm(zoom);
  const near = neighbourhoods(index, zoom);
  let best: IndexedCell | null = null;
  let bestScore = -1;
  let bestKm = 0;
  eachNear(index, at.lat, at.lon, radiusKm, (cell) => {
    const km = kmBetween(at, cell);
    if (km > radiusKm) return;
    const score = coverageScore(coverageWeight(near.cameras[cell.at], near.played[cell.at]), km, radiusKm);
    if (score > bestScore || (score === bestScore && best && cell.key < best.key)) {
      best = cell;
      bestScore = score;
      bestKm = km;
    }
  });
  if (!best) return { kind: "miss", radiusKm };
  const winner: IndexedCell = best;
  const landing = densestNear(index, winner, zoom);
  const place = presetNear(landing, radiusKm);
  return {
    kind: "snap",
    spot: place ? { lat: place.wide.lat, lon: place.wide.lon } : { lat: landing.lat, lon: landing.lon },
    why: place ? "preset" : "densest",
    place,
    key: landing.key,
    cellSpot: { lat: landing.lat, lon: landing.lon },
    stillId: landing.stillId,
    region: landing.region,
    cameras: near.cameras[winner.at],
    played: near.played[winner.at],
    km: bestKm,
    radiusKm,
    score: bestScore,
  };
}

/** The busiest cell in the winner's neighbourhood, a closer one first when two are alike. */
function densestNear(index: CoverageIndex, winner: IndexedCell, zoom: number): IndexedCell {
  const km = neighbourKm(zoom);
  let best = winner;
  let bestValue = winner.weight;
  eachNear(index, winner.lat, winner.lon, km, (cell) => {
    if (cell === winner) return;
    const d = nearKm(winner.lat, winner.lon, cell.lat, cell.lon);
    if (d > km) return;
    const value = cell.weight / (1 + (d / km) ** 2);
    if (value > bestValue || (value === bestValue && cell.key < best.key)) {
      best = cell;
      bestValue = value;
    }
  });
  return best;
}

/** The nearest hand-framed preset, if the result is in its reach at this search radius. */
function presetNear(landing: Spot, radiusKm: number): EyePlace | undefined {
  const reach = Math.min(PRESET_MAX_KM, radiusKm * PRESET_FRACTION);
  let best: EyePlace | undefined;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const place of EYE_PLACES) {
    const km = kmBetween(landing, place.wide);
    if (km <= reach && km < bestKm) {
      best = place;
      bestKm = km;
    }
  }
  return best;
}

// ── What the overlay draws ──────────────────────────────────────────────────────────────────

/** A row's GeoJSON. Cells carry their count, so the circle's size can read it. */
export function coverageFeatures(cells: readonly { lat: number; lon: number; cameras: number }[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cells.map((c) => ({
      type: "Feature",
      properties: { c: c.cameras },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  };
}

/** Exact points as GeoJSON, each counting one. */
export function pointFeatures(points: readonly CoveragePoint[]): GeoJSON.FeatureCollection {
  return coverageFeatures(points.map(([lat, lon]) => ({ lat, lon, cameras: 1 })));
}
