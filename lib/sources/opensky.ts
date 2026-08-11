/**
 * OpenSky Network — live aircraft worldwide, from ONE global snapshot.
 *
 * WHY GLOBAL, NOT A SWEEP: adsb.lol/adsb.fi are point+radius only (max 250 nm, no
 * global query), so worldwide coverage there means sweeping ~50 cells and stitching
 * them together in server state. On Vercel serverless that state is per-instance and
 * never accumulates across the cold, independent lambdas that handle each cache
 * revalidation — so the stitched union collapses to whichever handful of (rate-limit-
 * surviving, North-America-first) cells landed last. OpenSky's `/states/all` returns
 * EVERY tracked aircraft on Earth in a single request, so coverage is worldwide by
 * construction — no grid, no rolling store, no rate-limit-order bias.
 *
 * TRADE-OFF: OpenSky's anonymous tier is credit-capped (~400 credits/day, a global
 * call costs ~4), so we DON'T poll it per-visitor. The fetch is wrapped in Next's
 * Data Cache (`unstable_cache`, revalidate = REVALIDATE_S) so upstream is hit at most
 * once per window for the ENTIRE deployment (stale-while-revalidate) and REVALIDATE_S
 * is set so a fully-saturated day still stays under the daily cap. On any failure
 * (429 / 5xx / null states / timeout) we serve the last-good snapshot — and because
 * that snapshot is GLOBAL, even a stale serve is still worldwide, never regional.
 *
 * OpenSky omits type-code + registration (unlike adsb.lol); the dossier fetches those
 * on demand from /api/flight by callsign+hex, both of which OpenSky provides. squawk
 * IS present (index 14), so the emergency-squawk (7500/7600/7700) alerts stay live.
 *
 * Docs: https://openskynetwork.github.io/opensky-api/rest.html#all-state-vectors
 */

import type { WorldObject } from "@/lib/world";
import { classifyPlane } from "@/lib/planes/classify";
import { PLANE_META } from "@/lib/icons/svg";
import {
  applyCap,
  readCoverage,
  withCoverage,
  type SignalCoverage,
} from "@/lib/signals/coverage";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Plane {
  icao24: string;
  callsign: string;           // trimmed; falls back to icao24 when blank
  lat: number;
  lon: number;
  altKm: number;              // (geo_altitude ?? baro_altitude ?? 0) / 1000
  headingDeg: number;         // true_track; 0 when null
  velocityMs: number | null;  // m/s ground speed; null when unknown
  verticalRateMs: number | null; // m/s climb (+) / descent (−); null when unknown
  onGround: boolean;
  country: string;            // origin_country string (not ISO code)
  squawk: string;             // transponder code; "" when unknown. Drives emergency alerts.
}

// ---------------------------------------------------------------------------
// State-vector index helpers (avoids magic numbers throughout the parser)
// ---------------------------------------------------------------------------

const IDX = {
  icao24: 0,
  callsign: 1,
  country: 2,
  // time_position: 3,
  // last_contact: 4,
  lon: 5,
  lat: 6,
  baro_altitude: 7,
  on_ground: 8,
  velocity: 9,
  true_track: 10,
  vertical_rate: 11,
  // sensors: 12,
  geo_altitude: 13,
  squawk: 14,
  // spi: 15,
  // position_source: 16,
} as const;

// ---------------------------------------------------------------------------
// Type-safe accessors for the heterogeneous state-vector arrays
// ---------------------------------------------------------------------------

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asNum(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function asBool(v: unknown): boolean {
  return v === true;
}

// ---------------------------------------------------------------------------
// Core parser — exported for unit testing (pure, no I/O)
// ---------------------------------------------------------------------------

/**
 * Convert raw OpenSky state-vector arrays into typed {@link Plane} objects.
 * Rows where latitude OR longitude is null are silently skipped.
 */
export function parseStates(states: unknown[][]): Plane[] {
  const planes: Plane[] = [];

  for (const s of states) {
    const lat = asNum(s[IDX.lat]);
    const lon = asNum(s[IDX.lon]);
    if (lat === null || lon === null) continue;

    const geoAlt = asNum(s[IDX.geo_altitude]);
    const baroAlt = asNum(s[IDX.baro_altitude]);
    const altMeters = geoAlt ?? baroAlt ?? 0;

    const icao24 = asStr(s[IDX.icao24]) || "unknown";
    const rawCallsign = asStr(s[IDX.callsign]).trim();
    const callsign = rawCallsign || icao24;

    planes.push({
      icao24,
      callsign,
      lat,
      lon,
      altKm: altMeters / 1000,
      headingDeg: asNum(s[IDX.true_track]) ?? 0,
      velocityMs: asNum(s[IDX.velocity]),
      verticalRateMs: asNum(s[IDX.vertical_rate]),
      onGround: asBool(s[IDX.on_ground]),
      country: asStr(s[IDX.country]),
      squawk: asStr(s[IDX.squawk]).trim(),
    });
  }

  return planes;
}

// ---------------------------------------------------------------------------
// WorldObject mapper — exported for unit testing + consumed by the planes route
// ---------------------------------------------------------------------------

/**
 * Map a parsed {@link Plane} to the shared {@link WorldObject} contract so the
 * globe layer can render it uniformly alongside cameras and satellites.
 */
export function planeToWorldObject(p: Plane): WorldObject {
  const category = classifyPlane({
    altKm: p.altKm,
    velocityMs: p.velocityMs,
    onGround: p.onGround,
  });
  const meta = PLANE_META[category];
  return {
    kind: "plane",
    id: `plane:${p.icao24}`,
    lat: p.lat,
    lon: p.lon,
    altKm: p.altKm,
    heading: p.headingDeg,
    label: p.callsign,
    color: meta.color,
    icon: meta.key,
    typeLabel: meta.label,
    meta: {
      callsign: p.callsign,
      country: p.country,
      velocityMs: p.velocityMs,
      altKm: p.altKm,
      verticalRateMs: p.verticalRateMs,
      onGround: p.onGround,
      headingDeg: p.headingDeg,
      category,
      typeLabel: meta.label,
      squawk: p.squawk,
    },
  };
}

// ---------------------------------------------------------------------------
// Cap — bounds the served set (client payload + Data Cache 2 MB entry limit)
// ---------------------------------------------------------------------------

// A global snapshot is ~10k aircraft; capping keeps the cached entry under the
// Data Cache 2 MB limit and the client payload reasonable.
export const MAX_PLANES = 3000;

/**
 * Keep at most `cap` aircraft, preferring airborne over ground. Pure/testable.
 *
 * TRUNCATION HONESTY. `/states/all` is a whole-Earth snapshot — measured at 11,824
 * state vectors (11,705 with a position) on 2026-08-10 — so this cap discards two
 * thirds of it. Before the coverage record, `/api/planes` answered `{count: 3000}`
 * and 3,000 was the CAP wearing the costume of a measurement. The returned array
 * carries a coverage record (lib/signals/coverage.ts) declaring what upstream held,
 * so the count can be published as "3,000 of 11,705" rather than "3,000".
 *
 * `available` is EXACT here: OpenSky's global endpoint takes no page/limit
 * parameter, so the response is the whole tracked set and we counted it ourselves.
 */
export function capPlanes(objects: WorldObject[], cap: number): WorldObject[] {
  // Sort only when the cap actually bites — an under-cap snapshot keeps upstream order.
  let ordered = objects;
  if (objects.length > cap) {
    const airborne: WorldObject[] = [];
    const ground: WorldObject[] = [];
    for (const o of objects) {
      ((o.meta as { onGround?: boolean } | undefined)?.onGround ? ground : airborne).push(o);
    }
    ordered = [...airborne, ...ground];
  }
  return applyCap(ordered, cap, {
    noun: "aircraft",
    rule: "airborne first, then on-ground, in the order OpenSky reported them — not a ranking",
  });
}

/**
 * The snapshot the planes route publishes: the capped aircraft PLUS the coverage
 * record as a real JSON field.
 *
 * WHY A FIELD AND NOT JUST THE SIDE CHANNEL: coverage rides on the array as a
 * symbol-keyed, non-enumerable property, and this payload goes through Next's Data
 * Cache — i.e. through JSON. A symbol property does not survive that round trip, so
 * every cache HIT (the common case: one upstream call per REVALIDATE_S serves the
 * whole deployment) would arrive with the cap invisible again. The field survives.
 */
export interface AircraftSnapshot {
  planes: WorldObject[];
  /**
   * Undefined ⇒ NOT DECLARED, never "nothing was truncated". It is absent only
   * before the first successful upstream fetch, where we have no snapshot at all
   * and therefore know nothing about what upstream holds.
   */
  coverage?: SignalCoverage;
}

/** Pure: lift the coverage a capped array carries into a JSON-serializable snapshot. */
export function toAircraftSnapshot(planes: WorldObject[]): AircraftSnapshot {
  const coverage = readCoverage(planes);
  return coverage ? { planes, coverage } : { planes };
}

// ---------------------------------------------------------------------------
// Global fetch — one worldwide snapshot, cached deployment-wide, dormant-safe
// ---------------------------------------------------------------------------

// No bbox → every tracked aircraft on Earth in one response.
const GLOBAL_URL = "https://opensky-network.org/api/states/all";
const FETCH_TIMEOUT_MS = 12_000;
// Deployment-wide revalidate. OpenSky anonymous is ~400 credits/day and a global
// call costs ~4 (≈100 calls/day). 240 s ⇒ ≤360 upstream calls even on a fully
// saturated day, so it never exhausts the daily budget and freezes. (A registered
// OpenSky account lifts the cap ~10×; this could then drop to ~60–90 s.)
const REVALIDATE_S = 240;

interface OpenSkyResponse {
  time: number;
  states: unknown[][] | null;
}

// Last-good worldwide snapshot (module state). Served on any refresh failure so the
// map never blanks — and because it is GLOBAL, a stale serve is still worldwide.
// It carries its own coverage, so a stale serve still discloses its truncation.
let lastGood: AircraftSnapshot = { planes: [] };

/**
 * Fetch one global snapshot and map it to capped WorldObjects. Never throws: on a
 * 429 (rate-limit), non-2xx, null `states` (degraded upstream), timeout, or parse
 * error it returns the last-good snapshot (or an empty, coverage-less one before the
 * first success), so the Data Cache never memoises a thrown error.
 */
async function fetchGlobalOnce(): Promise<AircraftSnapshot> {
  try {
    const res = await fetch(GLOBAL_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return lastGood;
    const data = (await res.json()) as OpenSkyResponse;
    if (!data.states) return lastGood;
    const objects = capPlanes(parseStates(data.states).map(planeToWorldObject), MAX_PLANES);
    const snapshot = toAircraftSnapshot(objects);
    if (objects.length) lastGood = snapshot; // only overwrite last-good with a real snapshot
    return snapshot;
  } catch {
    return lastGood;
  }
}

/** Re-attach the coverage field to the array after a Data Cache (JSON) round trip. */
function rehydrate(snapshot: AircraftSnapshot): AircraftSnapshot {
  const planes = Array.isArray(snapshot?.planes) ? snapshot.planes : [];
  // withCoverage re-measures `returned` from the array it is given, so a record that
  // survived the round trip cannot claim a count the payload does not hold.
  if (snapshot?.coverage) withCoverage(planes, snapshot.coverage);
  return snapshot?.coverage ? { planes, coverage: snapshot.coverage } : { planes };
}

/**
 * Live aircraft worldwide, with the coverage record for the render cap. Wrapped in
 * Next's Data Cache so upstream is polled at most once per REVALIDATE_S for the whole
 * deployment (stale-while-revalidate): every visitor is served the shared stored
 * snapshot rather than triggering their own live pull. Returns an empty, coverage-less
 * snapshot only before the first successful fetch (or outside the Next runtime, e.g.
 * unit tests, where it fetches directly).
 *
 * CACHE KEY: bumped to -v2 with the shape change. A v1 entry written by a previous
 * deployment is a bare WorldObject[]; deserialising that as a snapshot would leave
 * `planes` undefined and blank the map for a whole revalidate window.
 */
export async function fetchAircraftSnapshot(): Promise<AircraftSnapshot> {
  try {
    const { unstable_cache } = await import("next/cache");
    const snapshot = await unstable_cache(fetchGlobalOnce, ["planes-opensky-global-v2"], {
      revalidate: REVALIDATE_S,
    })();
    return rehydrate(snapshot);
  } catch {
    return fetchGlobalOnce();
  }
}

/**
 * Live aircraft worldwide as WorldObjects. Back-compat wrapper over
 * {@link fetchAircraftSnapshot} — the returned array still carries its coverage on
 * the side channel, so `readCoverage()` works on it.
 */
export async function fetchAircraft(): Promise<WorldObject[]> {
  return (await fetchAircraftSnapshot()).planes;
}
