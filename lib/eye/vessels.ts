// The God's eye view's vessels, the pure half: which box of the world the view asks
// for, when it must ask again, and the route's answer. Pinned by
// tests/unit/eye-vessels.test.ts. The server half (the held feeds) is vesselFeed.ts.
//
// WHY A BOX. The console's Ships layer is the 11 chokepoints, so it cannot show New
// York, Hamburg or Hong Kong. The AISStream socket now hears the whole world (88
// messages a second, 11,583 vessels in 4 minutes, measured 2026-10-28), and a view
// downloading all of it every minute would be 467 KB a time to keep about ten boats.
// So the view asks for the boats around what is on screen: `?bbox=west,south,east,north`,
// at most 500, the nearest the middle of the view, and asks again once the view has
// settled outside the box it holds.
//
// THE BOX IS A SNAPPED, CAPPED SHAPE ON PURPOSE. It is outward to a 0.01 degree grid
// (about 1 km), so two visitors at the same place ask the same URL and the access log
// (/privacy says it keeps the query) never holds a place finer than that. And it is
// never wider than MAX_SPAN, so a view zoomed out over a whole sea asks for a bounded
// answer, which the response says in `clamped` and in its coverage note.

import { applyCap, describeCoverage, readCoverage, type SignalCoverage } from "@/lib/signals/coverage";
import { vesselFeature, type AisVessel, type StreamState } from "@/lib/signals/ais";
import type { SignalFeature } from "@/lib/signals/types";

/** [west, south, east, north], degrees. No antimeridian wrap: west is always below east. */
export type Box = [west: number, south: number, east: number, north: number];

/** The most vessels one answer carries (eye-boat-models designs for this many). */
export const EYE_VESSEL_CAP = 500;
/** How often an open view asks again. The server holds its own feeds at the same pace. */
export const EYE_VESSELS_EVERY_MS = 60_000;
/** Two reloads from moving are at least this far apart. */
export const MOVE_RELOAD_GAP_MS = 2_000;
/** The box asks for this much more than the view reaches, so a small pan stays inside it. */
export const VIEW_PAD = 1.25;
/** The widest box one answer covers, degrees. */
export const MAX_SPAN = { lat: 1, lon: 2 } as const;
/** The grid a box snaps outward to, degrees. */
export const BOX_GRID = 0.01;

const PER_DEG = Math.round(1 / BOX_GRID);
/** Grid steps are whole numbers; this forgives the float noise of x * 100. */
const NOISE = 1e-6;

/** Whole grid steps to degrees, divided (not multiplied) so 29 steps print as 0.29. */
const degrees = (steps: number): number => Math.round(steps) / PER_DEG + 0; // + 0: never -0
const floorStep = (deg: number): number => Math.floor(deg * PER_DEG + NOISE);
const ceilStep = (deg: number): number => Math.ceil(deg * PER_DEG - NOISE);

/**
 * Pure: the `bbox` query value, or null. Four finite numbers, west below east, south
 * below north, latitudes within 90 and longitudes within 180. A box that crosses the
 * antimeridian (west above east) is refused rather than guessed at.
 */
export function parseBox(raw: string | null | undefined): Box | null {
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (p.trim() === "" ? Number.NaN : Number(p)));
  if (!nums.every((n) => Number.isFinite(n))) return null;
  const [west, south, east, north] = nums;
  if (west >= east || south >= north) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  return [west, south, east, north];
}

/** Pure: the box grown outward to the 0.01 degree grid, so it never shrinks. Idempotent. */
export function snapBox(b: Box): Box {
  const [west, south, east, north] = b;
  return [
    Math.max(-180, degrees(floorStep(west))),
    Math.max(-90, degrees(floorStep(south))),
    Math.min(180, degrees(ceilStep(east))),
    Math.min(90, degrees(ceilStep(north))),
  ];
}

/**
 * One axis of a box limited to `max` degrees about its centre. A limited axis lands on
 * the grid (its width is a whole number of steps), which keeps a clamped box what
 * snapBox would leave alone: asking for the box an answer carried gets the same box.
 */
function clampAxis(lo: number, hi: number, max: number, floor: number, ceil: number): [number, number, boolean] {
  if (hi - lo <= max) return [lo, hi, false];
  const start = degrees((lo + hi) / 2 * PER_DEG - (max * PER_DEG) / 2);
  const at = Math.min(Math.max(start, floor), ceil - max);
  return [at, degrees(at * PER_DEG + max * PER_DEG), true];
}

/**
 * Pure: the box limited to MAX_SPAN about its own centre. `clamped` says it was wider.
 * An axis within its limit is returned as it came.
 */
export function clampBox(b: Box): { box: Box; clamped: boolean } {
  const [west, south, east, north] = b;
  const [w, e, wide] = clampAxis(west, east, MAX_SPAN.lon, -180, 180);
  const [s, n, tall] = clampAxis(south, north, MAX_SPAN.lat, -90, 90);
  return { box: [w, s, e, n], clamped: wide || tall };
}

/** Longitude brought into [-180, 180]. MapLibre's centre and corners can sit in a copy of the world. */
function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Pure: how far the view reaches from its centre: the distance to the farthest of its
 * four canvas corners (unprojected), padded by VIEW_PAD, as a latitude and a longitude
 * radius of the same ground distance. A circle, not the largest latitude and longitude
 * difference taken on their own: a wide view turned a quarter swaps its two extents, so
 * those would change with the bearing and a Turn (motion=orbit) would ask for a new box
 * every few degrees. The corners of a turning view stay the same far from its centre.
 */
export function viewRadius(
  centre: { lat: number; lon: number },
  corners: readonly { lat: number; lon: number }[],
): { lat: number; lon: number } {
  // A degree of longitude is this much of a degree of latitude here (never 0 at a pole).
  const k = Math.max(Math.cos((centre.lat * Math.PI) / 180), 0.01);
  let far = 0;
  for (const c of corners) {
    // Across the antimeridian the short way round is the difference.
    far = Math.max(far, Math.hypot(c.lat - centre.lat, wrapLon(c.lon - centre.lon) * k));
  }
  return { lat: far * VIEW_PAD, lon: (far * VIEW_PAD) / k };
}

/** Pure: the box a view at `centre` reaching `radius` asks for: snapped, then capped. */
export function boxAround(centre: { lat: number; lon: number }, radius: { lat: number; lon: number }): Box {
  const lon = wrapLon(centre.lon);
  const lat = Math.max(-90, Math.min(90, centre.lat));
  // At least one grid step each way, so a canvas not laid out yet (radius 0) still asks for a box.
  const rLon = Math.max(radius.lon, BOX_GRID);
  const rLat = Math.max(radius.lat, BOX_GRID);
  const raw: Box = [
    Math.max(-180, lon - rLon),
    Math.max(-90, lat - rLat),
    Math.min(180, lon + rLon),
    Math.min(90, lat + rLat),
  ];
  return clampBox(snapBox(raw)).box;
}

/** Pure: must the view ask again? True when nothing is loaded or the view's box is not inside the loaded one. */
export function needsReload(
  loaded: Box | null,
  centre: { lat: number; lon: number },
  radius: { lat: number; lon: number },
): boolean {
  if (!loaded) return true;
  const want = boxAround(centre, radius);
  return want[0] < loaded[0] || want[1] < loaded[1] || want[2] > loaded[2] || want[3] > loaded[3];
}

/** Pure: is the point inside the box (edges included)? */
export function inBox(lat: number, lon: number, box: Box): boolean {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

/** Pure: is a projected point inside the canvas (edges included)? */
export function inFrame(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

/**
 * Pure: a copy of `items`, nearest `centre` first, by flat distance with the longitude
 * difference shortened by the cosine of the latitude. Ties keep their order.
 */
export function nearestFirst<T extends { lat: number; lon: number }>(items: readonly T[], centre: { lat: number; lon: number }): T[] {
  const k = Math.cos((centre.lat * Math.PI) / 180);
  const d = (t: T) => {
    const dLat = t.lat - centre.lat;
    const dLon = wrapLon(t.lon - centre.lon) * k;
    return dLat * dLat + dLon * dLon;
  };
  return items
    .map((t, i) => ({ t, i, d: d(t) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.t);
}

/** What the route answers: the vessels in the box and what each source said. */
export interface EyeVesselsBody {
  ok: boolean;
  observedAt: number;
  /** The AISStream socket: off (no key), warming, live or down. */
  stream: StreamState;
  feeds: { digitraffic: "ok" | "down"; barentswatch: "off" | "ok" | "down" };
  /** The box the answer covers: the one asked for, capped. The view compares itself to this. */
  box: Box;
  /** The box asked for was wider than MAX_SPAN and was cut down about its centre. */
  clamped: boolean;
  count: number;
  coverage: SignalCoverage;
  features: SignalFeature[];
}

/**
 * Pure: the route's answer. Every vessel heard inside the box, as the same feature
 * /api/signals/ais serves, the EYE_VESSEL_CAP nearest the middle of the box, with the
 * cap said in `coverage`. `ok` is false only when nothing answered at all: the socket
 * is off or down, Digitraffic is down and BarentsWatch is not answering either.
 */
export function eyeVesselsBody(input: {
  box: Box;
  clamped: boolean;
  vessels: readonly AisVessel[];
  state: StreamState;
  digitraffic: "ok" | "down";
  barentswatch: "off" | "ok" | "down";
  now: number;
}): EyeVesselsBody {
  const { box, clamped, vessels, state, digitraffic, barentswatch, now } = input;
  const inside: SignalFeature[] = [];
  for (const v of vessels) {
    if (typeof v.latitude !== "number" || typeof v.longitude !== "number") continue;
    if (!inBox(v.latitude, v.longitude, box)) continue;
    const f = vesselFeature(v);
    if (f) inside.push(f);
  }
  const centre = { lat: (box[1] + box[3]) / 2, lon: (box[0] + box[2]) / 2 };
  const features = applyCap(nearestFirst(inside, centre), EYE_VESSEL_CAP, {
    noun: "vessels",
    rule: `the ${EYE_VESSEL_CAP} nearest the middle of the view`,
  });
  const nothingAnswered = (state === "off" || state === "down") && digitraffic === "down" && barentswatch !== "ok";
  const coverage = readCoverage(features);
  return {
    ok: !nothingAnswered,
    observedAt: now,
    stream: state,
    feeds: { digitraffic, barentswatch },
    box,
    clamped,
    count: features.length,
    coverage: coverage ? describeCoverage(coverage) : { returned: features.length, available: features.length, availableExact: true, capped: false },
    features,
  };
}
