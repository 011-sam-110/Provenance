// Bounding-box maths for the live webcam search. Pure — no network, no DOM.
//
// Windy's list endpoint takes `bbox=north,east,south,west` and reports a `total`
// for that box, which is the only honest denominator we can print. Everything here
// exists to turn a place the user typed into such a box, and to key a server-side
// cache on it without letting near-identical boxes each mint their own entry.

/** [north, east, south, west] — Windy's own ordering, kept verbatim to avoid a
 *  transposition bug at the boundary. */
export type Bbox = [number, number, number, number];

/** Mean metres per degree of latitude. Longitude shrinks by cos(lat). */
const KM_PER_DEG_LAT = 111.32;

// 25km, measured rather than picked: at 15km Tokyo's box holds 33 webcams and at
// 25km it holds 55, while Madrid and London are already over the free tier's
// 50-row page cap at either radius, so the wider box costs nothing there. Beyond
// ~40km the gain flattens and the box stops meaning "this city".
export const DEFAULT_RADIUS_KM = 25;
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 200;

const clampLat = (n: number) => Math.min(90, Math.max(-90, n));
const clampLon = (n: number) => Math.min(180, Math.max(-180, n));

/**
 * A box around a point. Used for "the user typed Madrid, we geocoded it, now show
 * what Windy has there".
 *
 * The longitude span widens with latitude because a degree of longitude is
 * cos(lat) as long as a degree of latitude — without that correction a search in
 * Reykjavik would cover roughly half the ground a search in Nairobi does. Near the
 * poles cos(lat) approaches zero, so the span is capped rather than exploding to a
 * whole-world box.
 */
export function bboxAround(lat: number, lon: number, radiusKm = DEFAULT_RADIUS_KM): Bbox {
  const r = Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, Number.isFinite(radiusKm) ? radiusKm : DEFAULT_RADIUS_KM));
  const dLat = r / KM_PER_DEG_LAT;
  const cos = Math.cos((lat * Math.PI) / 180);
  // At |lat| > ~89.4 the cosine is small enough that the division runs away; 60
  // degrees of longitude is already far more ground than any city search needs.
  const dLon = Math.abs(cos) < 0.01 ? 60 : Math.min(60, r / (KM_PER_DEG_LAT * Math.abs(cos)));
  return [
    clampLat(lat + dLat),
    clampLon(lon + dLon),
    clampLat(lat - dLat),
    clampLon(lon - dLon),
  ];
}

/**
 * Parse an untrusted `bbox=` parameter. Returns null rather than throwing, and
 * rejects a box whose north is below its south — a transposed box silently returns
 * zero results, which would look exactly like "there are no cameras here".
 */
export function parseBbox(raw: string | null | undefined): Bbox | null {
  if (!raw) return null;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [n, e, s, w] = parts;
  if (n < -90 || n > 90 || s < -90 || s > 90) return null;
  if (e < -180 || e > 180 || w < -180 || w > 180) return null;
  if (n < s) return null;
  if (e < w) return null;
  return [n, e, s, w];
}

/**
 * The cache key for a box, rounded to ~1km so that panning a few metres does not
 * mint a new upstream request. Windy's quota is undocumented and the CDN is the
 * only thing between a busy search box and it, so the rounding is deliberate
 * rather than cosmetic.
 */
export function bboxKey(b: Bbox): string {
  return b.map((n) => n.toFixed(2)).join(",");
}

/** Rough area in square degrees — used to refuse a box so large the free-tier
 *  offset cap would make the reported total meaningless. */
export function bboxSpan(b: Bbox): { lat: number; lon: number } {
  return { lat: Math.abs(b[0] - b[2]), lon: Math.abs(b[1] - b[3]) };
}
