/**
 * The aircraft layer. The sole source is a bounded adsb.lol grid sweep
 * (lib/sources/adsb.ts). See `fetchAircraftOnce` for why OpenSky was removed —
 * the reason is its licence, not its reliability — and what the change costs in
 * coverage (in practice: nothing, because the sweep was already serving prod alone).
 *
 * FILENAME. This module is still called `opensky.ts` even though it no longer
 * contacts OpenSky, because renaming it touches eight importers and would bury a
 * licensing fix inside a rename diff. That rename is a named follow-up, not an
 * oversight.
 *
 * WHY A SWEEP IS AWKWARD, retained because it still shapes the code below:
 * adsb.lol is point+radius only (max 250 nm, no global query), so worldwide coverage
 * means sweeping ~50 cells and stitching them. On Vercel serverless that stitching
 * cannot accumulate across the cold, independent lambdas that handle each cache
 * revalidation, so the union is whatever one sweep collects inside its own budget —
 * dense over North America and Europe, thin elsewhere. That limit is real and is
 * declared through the coverage record rather than hidden. OpenSky's `/states/all`
 * did not have it, which is why it was preferred until the terms were read.
 *
 * CADENCE: the sweep is wrapped in Next's Data Cache (`unstable_cache`,
 * revalidate = REVALIDATE_S), so upstream is hit at most once per window for the
 * ENTIRE deployment (stale-while-revalidate) rather than per visitor. On failure
 * `fetchAircraftOnce` THROWS rather than returning empty, so the Data Cache keeps
 * serving whatever it last cached successfully — a persisted last-good snapshot, not
 * a module variable a fresh serverless instance would reset to empty. That
 * distinction is load-bearing: `unstable_cache` commits whatever it is handed, so a
 * swallowed failure overwrites a good snapshot with an empty one. A staleness gate
 * (decideStaleness/gateSnapshot) then refuses to serve anything older than
 * STALE_CEILING_MS — aircraft move, so an old enough "live" snapshot would be a
 * fabrication, not just a late one.
 *
 * RETAINED, NOT DEAD: `parseStates` / `planeToWorldObject` / the `Plane` interface
 * parse OpenSky's positional state-vector format and are no longer on any live path.
 * They stay because `lib/sources/adsb.ts` shapes its `meta` to match
 * `planeToWorldObject` exactly, so this is the written contract for that shape, and
 * because their squawk handling (index 14 → 7500/7600/7700) is what the
 * emergency-squawk alerts in `lib/console/widgets/aviation.tsx` are specified
 * against. Deleting them is a separate mechanical change with its own test churn.
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
import { fetchAdsbSweep, sweepToObjects } from "@/lib/sources/adsb";

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
  /**
   * Epoch ms this snapshot's positions were actually fetched from OpenSky.
   * Undefined only before this deployment's first-ever successful fetch — see
   * `decideStaleness`, which treats that as "never-fetched", not "fresh".
   */
  fetchedAt?: number;
  /**
   * Present ONLY when this snapshot is being served with a disclosed age, or was
   * withheld for being too old to serve honestly. Absent ⇒ fresh, no caveat
   * needed. Aircraft move, so a served-stale position without its age would be a
   * fabrication — see `decideStaleness`/`gateSnapshot` below.
   */
  staleness?: { stale: true; ageMs: number } | { reason: "too-old"; ageMs: number };
  /**
   * Which upstream actually produced these positions. Everything minted now is
   * `"adsb.lol"` — OpenSky was removed on licensing grounds (see `fetchAircraftOnce`).
   *
   * `"opensky"` REMAINS IN THIS UNION ON PURPOSE. The Data Cache persists across
   * deploys, so a snapshot stamped by the previous code can still be rehydrated and
   * served after this change ships; narrowing the type would make that a parse
   * failure rather than a correctly-labelled stale snapshot. It will age out on its
   * own. Do not remove it in the same PR as the fetch change.
   *
   * The providers had materially different coverage — OpenSky was worldwide, the
   * sweep sees only where volunteers run receivers — so a consumer that prints a
   * count without reading this cannot describe it correctly. Undefined only for a
   * snapshot that predates this field or carries no aircraft.
   */
  source?: "opensky" | "adsb.lol";
}

/** Pure: lift the coverage a capped array carries into a JSON-serializable snapshot. */
export function toAircraftSnapshot(planes: WorldObject[]): AircraftSnapshot {
  const coverage = readCoverage(planes);
  return coverage ? { planes, coverage } : { planes };
}

// ---------------------------------------------------------------------------
// Snapshot fetch — one adsb.lol sweep, cached deployment-wide, dormant-safe
// ---------------------------------------------------------------------------

// Deployment-wide revalidate, unchanged at 240 s. This used to be sized against
// OpenSky's ~400-credits/day anonymous budget; adsb.lol publishes no such cap, so
// the number now exists only to bound how often the 14 s sweep runs.
const REVALIDATE_S = 240;

/**
 * One aircraft snapshot, from a bounded adsb.lol grid sweep (lib/sources/adsb.ts).
 *
 * WHY OPENSKY IS GONE, AND WHY THIS IS NOT A REGRESSION.
 *
 * OpenSky used to be the primary here, with this sweep as its fallback. It has been
 * removed outright — not demoted — because of its licence, not its reliability.
 * OpenSky's Terms of Use require a WRITTEN LICENCE for "use of the REST API in any
 * operational ... integration into a live product, service, or automated system",
 * and state that this applies "REGARDLESS OF THE ENTITY'S NON-PROFIT STATUS". The
 * free grant covers non-profit research and education only. Provenance is a live,
 * publicly reachable product, so calling that endpoint from it is the licensed act
 * whether or not the response is ever served onward, and whether or not this project
 * is free and open-source. We hold no such licence, so we do not make the call.
 *
 * Note the shape of that clause: it binds the CALL, not the data. Demoting OpenSky
 * to a fallback would not have helped — a fallback still calls it. Neither would
 * adding credentials, which is what CLAUDE.md previously prescribed for the empty
 * layer: that turns an anonymous failing request into an authenticated, working,
 * attributable one, which is more squarely the licensed act, not less.
 *
 * NOTHING IS LOST OPERATIONALLY. The OpenSky call had already been failing from the
 * deployment for months, and this sweep has been carrying the layer alone: prod
 * `/api/planes` measured 3,000 aircraft with `source: "adsb.lol"` on 2026-08-14. The
 * coverage difference is real and is still declared — OpenSky was worldwide in one
 * call, the sweep sees only where volunteers run receivers, dense over North America
 * and Europe and thin elsewhere — but that difference was already what production
 * was serving. This change makes the code match it.
 *
 * adsb.lol carries no equivalent restriction: its feeders waive rights under CC0 and
 * no term on its site restricts API use, commercial use or redistribution. Verified
 * against content/en/privacy-license/index.md in the adsblol/website repo, 2026-08-14.
 * That is "no restriction exists", which is a slightly weaker claim than "a licence
 * expressly grants this" — worth knowing before anyone builds a paid product on it.
 *
 * THROWS on a sweep that returns nothing, deliberately. `unstable_cache` commits
 * whatever this returns, so returning an empty snapshot on failure would overwrite a
 * good cached one and empty the layer for the rest of the revalidate window. Throwing
 * leaves the previous Data Cache entry in place for the staleness gate to judge —
 * see `decideStaleness`.
 */
async function fetchAircraftOnce(): Promise<AircraftSnapshot> {
  const sweep = await fetchAdsbSweep();
  if (!sweep.objects.length) throw new Error("adsb.lol sweep returned zero positioned aircraft");
  const objects = sweepToObjects(sweep, MAX_PLANES);
  return { ...toAircraftSnapshot(objects), fetchedAt: Date.now(), source: "adsb.lol" };
}

/** Re-attach the coverage field to the array after a Data Cache (JSON) round trip. */
function rehydrate(snapshot: AircraftSnapshot): AircraftSnapshot {
  const planes = Array.isArray(snapshot?.planes) ? snapshot.planes : [];
  // withCoverage re-measures `returned` from the array it is given, so a record that
  // survived the round trip cannot claim a count the payload does not hold.
  if (snapshot?.coverage) withCoverage(planes, snapshot.coverage);
  return {
    planes,
    ...(snapshot?.coverage ? { coverage: snapshot.coverage } : {}),
    ...(snapshot?.fetchedAt ? { fetchedAt: snapshot.fetchedAt } : {}),
    ...(snapshot?.source ? { source: snapshot.source } : {}),
  };
}

// ---------------------------------------------------------------------------
// Staleness gate — HONESTY BOUNDARY. Aircraft move, so a served-stale snapshot
// without its age is a fabrication ("live" positions that are actually old), and
// a snapshot old enough isn't merely late — showing it would be drawing ghosts,
// not traffic. Pure and unit-tested apart from any network/cache code.
// ---------------------------------------------------------------------------

/**
 * Below this age a snapshot is ordinary cache latency, not evidence anything
 * failed: under healthy operation the Data Cache refreshes at least this often
 * (REVALIDATE_S), so no caveat is warranted.
 */
export const FRESH_CEILING_MS = REVALIDATE_S * 1000; // 240_000 ms = 4 min

/**
 * Above this age, refuse to serve at all — prefer an honest empty layer over
 * ghosts. A widebody cruises at up to ~900 km/h (~250 m/s); at 15 minutes that
 * is up to ~225 km of possible drift, which is not "this aircraft, a little
 * late" — it's a plotted point that can no longer be trusted as this aircraft's
 * position. 15 min is also ~3.75 REVALIDATE_S windows, chosen so a few
 * consecutive failed polls (rate-limit, timeout) are ridden out with a
 * disclosed-stale serve before the layer gives up and goes empty — a
 * deliberate ceiling, not a leftover default.
 */
export const STALE_CEILING_MS = 15 * 60 * 1000; // 900_000 ms = 15 min

/** fresh -> serve; stale-but-usable -> serve WITH age; too old -> do not serve. */
export type StalenessDecision =
  | { serve: false; reason: "never-fetched" }
  | { serve: false; reason: "too-old"; ageMs: number }
  | { serve: true; stale: false }
  | { serve: true; stale: true; ageMs: number };

/**
 * Pure staleness decision. `fetchedAt` null/undefined means this deployment has
 * never completed a successful OpenSky fetch: that's "never-fetched", not
 * "fresh" — there is nothing to serve either way, but the reason differs (cold
 * start vs. upstream gone quiet for a long stretch), worth keeping distinct for
 * debugging prod.
 */
export function decideStaleness(
  fetchedAt: number | null | undefined,
  now: number,
  freshCeilingMs: number = FRESH_CEILING_MS,
  staleCeilingMs: number = STALE_CEILING_MS,
): StalenessDecision {
  if (fetchedAt == null) return { serve: false, reason: "never-fetched" };
  const ageMs = Math.max(0, now - fetchedAt);
  if (ageMs <= freshCeilingMs) return { serve: true, stale: false };
  if (ageMs <= staleCeilingMs) return { serve: true, stale: true, ageMs };
  return { serve: false, reason: "too-old", ageMs };
}

/**
 * Apply the staleness gate to a snapshot. A too-old (or never-fetched) input
 * comes back EMPTY and coverage-less — never the old positions — so a long
 * upstream outage reads as "no data" to every downstream consumer, never as a
 * frozen layer quietly claiming to be live.
 */
export function gateSnapshot(snapshot: AircraftSnapshot, now: number = Date.now()): AircraftSnapshot {
  const decision = decideStaleness(snapshot.fetchedAt, now);
  if (!decision.serve) {
    return decision.reason === "too-old"
      ? { planes: [], staleness: { reason: "too-old", ageMs: decision.ageMs } }
      : { planes: [] };
  }
  return decision.stale ? { ...snapshot, staleness: { stale: true, ageMs: decision.ageMs } } : snapshot;
}

/**
 * Live aircraft worldwide, with the coverage record for the render cap and a
 * staleness verdict for the honesty gate. Wrapped in Next's Data Cache so
 * upstream is polled at most once per REVALIDATE_S for the whole deployment; on
 * a failed revalidation (see `fetchGlobalOnce`) the PREVIOUS cached snapshot
 * keeps being served — that persistence lives in the Data Cache, not in this
 * module's memory, so it survives across the independent serverless invocations
 * that would otherwise reset a plain variable on every cold start. Every result
 * — cache hit or fallback — passes through `gateSnapshot` before it leaves this
 * function, so nothing older than STALE_CEILING_MS is ever returned.
 *
 * CACHE KEY: `planes-aircraft-v4`. Renamed off `planes-opensky-global-v3` because
 * the entry is no longer OpenSky-specific — it now holds whichever provider
 * answered — and bumped for the shape change (added `source`). The rename also
 * guarantees a clean start: a v3 entry on prod can only hold what the exhausted
 * credit cap produced, and reusing that key would serve it until it revalidated.
 */
export async function fetchAircraftSnapshot(): Promise<AircraftSnapshot> {
  let snapshot: AircraftSnapshot;
  try {
    const { unstable_cache } = await import("next/cache");
    snapshot = rehydrate(
      await unstable_cache(fetchAircraftOnce, ["planes-aircraft-v4"], {
        revalidate: REVALIDATE_S,
      })(),
    );
  } catch {
    // Either outside the Next runtime (unit tests — no Data Cache to speak of),
    // or the Data Cache has never held a successful snapshot and this attempt
    // failed too. One direct attempt; if that also fails, there is genuinely
    // nothing to serve.
    try {
      snapshot = await fetchAircraftOnce();
    } catch {
      snapshot = { planes: [] };
    }
  }
  return gateSnapshot(snapshot);
}

/**
 * Live aircraft worldwide as WorldObjects. Back-compat wrapper over
 * {@link fetchAircraftSnapshot} — the returned array still carries its coverage on
 * the side channel, so `readCoverage()` works on it.
 */
export async function fetchAircraft(): Promise<WorldObject[]> {
  return (await fetchAircraftSnapshot()).planes;
}
