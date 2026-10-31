/**
 * The aircraft layer. The sole source is an adsb.lol pull by ICAO type designator
 * (lib/sources/adsb.ts): one request naming every listed type, which covers the whole
 * receiver network, capped as a proportional spatial sample. See `fetchAircraftOnce` for why
 * OpenSky was removed — the reason is its licence, not its reliability.
 *
 * FILENAME. This module is still called `opensky.ts` even though it no longer
 * contacts OpenSky, because renaming it touches eight importers and would bury a
 * licensing fix inside a rename diff. That rename is a named follow-up, not an
 * oversight.
 *
 * HISTORY THAT STILL SHAPES THE CODE: between 2026-08-13 and 2026-09-06 this layer
 * was a sweep of 40 point+radius cells, and on Vercel the shared egress IP tripped
 * adsb.lol's per-IP rate limit so hard that prod served 1 of 40 cells. The type
 * pull replaced it: `/v2/type/{list}` answers worldwide in one request, so the
 * layer needed four requests per snapshot instead of forty (one since 2026-10-16),
 * and the cap became a spatial sample instead of a prefix (which is what had drawn two dense discs on
 * the globe). Coverage is still a lower bound — receivers are where volunteers put
 * them, and only listed types are asked for — and the coverage record says so.
 *
 * CADENCE: the pull is wrapped in Next's Data Cache (`unstable_cache`,
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
import { classifyPlaneDetailed } from "@/lib/planes/classify";
import { PLANE_META } from "@/lib/icons/svg";
import {
  applyCap,
  readCoverage,
  withCoverage,
  type SignalCoverage,
} from "@/lib/signals/coverage";
import { fetchAdsbTypePull, pullToObjects, PULL_BUDGET_MS } from "@/lib/sources/adsb";
import { notePlanePool } from "@/lib/planes/pool";
import {
  FAILOVER_CELLS,
  GAP_CELLS,
  MIN_FAILOVER_AIRCRAFT,
  fetchAdsbFiCells,
  mergeGapFill,
  shouldFailOver,
  sweepToObjects,
} from "@/lib/sources/adsbfi";

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
  // No `category` passed — this parser's input (OpenSky's state-vector shape) never
  // carried a broadcast ADS-B category, so this always falls to the heuristic.
  // categoryTrusted is therefore always false here; kept as a real field (not
  // omitted) so this meta shape matches adsb.ts's exactly, per the contract this
  // function's docstring already commits to.
  const { category, trusted: categoryTrusted } = classifyPlaneDetailed({
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
      categoryTrusted,
      typeLabel: meta.label,
      squawk: p.squawk,
    },
  };
}

// ---------------------------------------------------------------------------
// Cap — bounds the served set (client payload + Data Cache 2 MB entry limit)
// ---------------------------------------------------------------------------

/**
 * The served cap. The type pull returns ~9,700 positioned aircraft (2026-09-06),
 * and this is how many of them leave the server, chosen as a proportional spatial
 * sample (lib/planes/sample.ts) so every region keeps its share.
 *
 * TWO COSTS BOUND IT, both measured on the same day; raise it with both in view:
 *   - The capped WorldObject array is what `unstable_cache` stores, and the Vercel
 *     Data Cache allows 2 MB per entry. Prod served 571,124 bytes for 1,311 aircraft
 *     (~436 B each), so 3,000 ≈ 1.3 MB and ~4,500 is the ceiling.
 *   - Every open console downloads it every 12 s (lib/planes/usePlanes.ts), edge
 *     cached for 20 s. 3,000 aircraft is ~1.3 MB before compression per poll.
 * The uncapped pool leaves the server only as /api/eye/planes' answer for one box, and it is
 * kept nowhere but in this process's memory (lib/planes/pool.ts).
 */
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
  source?: "opensky" | "adsb.lol" | "adsb.fi";
}

/** Pure: lift the coverage a capped array carries into a JSON-serializable snapshot. */
export function toAircraftSnapshot(planes: WorldObject[]): AircraftSnapshot {
  const coverage = readCoverage(planes);
  return coverage ? { planes, coverage } : { planes };
}

// ---------------------------------------------------------------------------
// Snapshot fetch — one adsb.lol sweep, cached deployment-wide, dormant-safe
// ---------------------------------------------------------------------------

// Deployment-wide revalidate: 90 s since 2026-10-16, 240 s before. 240 was sized
// against OpenSky's ~400-credits/day anonymous budget and then kept for a four-request
// pull. Upstream positions are under a second old, but at 240 s each aircraft jumped
// once every 4-6 minutes on prod (stale-while-revalidate re-pulls only when a request
// arrives after the window), up to 60 km at cruise. The pull is one request now, and
// with military-air's /v2/mil every 20 s that is about 3.7 adsb.lol requests a minute,
// inside the refill measured the same day (one token per 10-20 s). Lower it only after
// re-measuring that bucket.
const REVALIDATE_S = 90;

/**
 * One aircraft snapshot, from the adsb.lol type pull (lib/sources/adsb.ts).
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
 * deployment for months, and adsb.lol has been carrying the layer alone since. The
 * coverage difference is real and is still declared — OpenSky was worldwide in one
 * call, adsb.lol sees only where volunteers run receivers and only the types we
 * list — and the coverage record says so on every response.
 *
 * adsb.lol's terms are the ODbL 1.0, not "no restriction" as this paragraph said
 * until 2026-10-16. Its OpenAPI document states: "The license for the API as well as
 * all data ADSB.lol makes public is ODbL" (`info.license`,
 * https://api.adsb.lol/api/openapi.json). The ODbL allows display and reuse with
 * attribution and share-alike on a derived database, so the layer is fine; the credit
 * (ADSB_ATTRIBUTION) names the licence. The same document says a future API key will
 * go to feeders only, and asks production users to get in touch. Both are open items
 * for the owner, not for this code.
 *
 * THROWS, deliberately, on a pull that returns nothing OR that lost its mainline
 * batch. `unstable_cache` commits whatever this returns, so returning a poor
 * snapshot on failure would overwrite a good cached one for the rest of the
 * revalidate window while reading as "fresh": a general-aviation-only sky of a few
 * hundred aircraft standing in for 3,000. Throwing leaves the previous Data Cache
 * entry in place for the staleness gate to judge — see `decideStaleness`.
 *
 * THE ONE EXCEPTION (2026-10-16): when adsb.lol has given this process nothing for
 * FAILOVER_AFTER_MS, the last good snapshot is close to the staleness gate's ceiling
 * and the layer is about to go empty. Then an adsb.fi sweep of the busiest hubs is
 * served instead, with `source: "adsb.fi"` and a coverage rule that says it is
 * regional (lib/sources/adsbfi.ts). It still throws when that sweep is small.
 *
 * Every cycle, adsb.fi's gap-fill cells add the aircraft adsb.lol did not hear over
 * thinly covered cities; adsb.lol's row wins for any aircraft both heard.
 */
async function fetchAircraftOnce(): Promise<AircraftSnapshot> {
  const started = Date.now();
  // adsb.fi's gap-fill cells run beside the adsb.lol request: another host, so they
  // spend none of adsb.lol's allowance, and they finish inside the same budget.
  const [pull, gap] = await Promise.all([
    fetchAdsbTypePull(),
    fetchAdsbFiCells(GAP_CELLS, { deadline: started + PULL_BUDGET_MS }),
  ]);

  if (pull.mainlineSucceeded && pull.objects.length) {
    noteAdsbLolOk(Date.now());
    const merged = mergeGapFill(pull.objects, gap.objects);
    const objects = pullToObjects({ ...pull, objects: merged.objects }, MAX_PLANES, {
      added: merged.added,
      cellsSucceeded: gap.cellsSucceeded,
      cellsPlanned: gap.cellsPlanned,
    });
    const snapshot: AircraftSnapshot = { ...toAircraftSnapshot(objects), fetchedAt: Date.now(), source: "adsb.lol" };
    notePlanePool(merged.objects, snapshot.fetchedAt!);
    // One line per revalidation so runtime logs show the pool, the served set and the
    // cached entry's size against the Data Cache's 2 MB limit.
    console.info(
      `adsb.lol snapshot: serving ${objects.length} of ${merged.objects.length} aircraft ` +
        `from ${pull.batchesSucceeded}/${pull.batchesPlanned} requests, +${merged.added} from adsb.fi ` +
        `(${gap.cellsSucceeded}/${gap.cellsPlanned} cells), ${JSON.stringify(snapshot).length} bytes`,
    );
    return snapshot;
  }

  const why = pull.mainlineSucceeded
    ? "adsb.lol type pull returned zero positioned aircraft"
    : `adsb.lol did not answer (${pull.batchesSucceeded} of ${pull.batchesPlanned} requests)`;
  // A blip: keep the last good adsb.lol snapshot, which the staleness gate serves
  // with its age. Refusing to cache is what keeps it in place.
  if (!shouldFailOver(adsbLolOkAt(), Date.now())) throw new Error(`${why}; keeping the last good snapshot`);

  // An outage: adsb.lol has not answered for FAILOVER_AFTER_MS. Widen adsb.fi's sweep
  // to the hubs and serve that, labelled regional.
  const more = await fetchAdsbFiCells(FAILOVER_CELLS, { deadline: started + FAILOVER_BUDGET_MS });
  const pool = mergeGapFill(gap.objects, more.objects).objects;
  const sweep = {
    objects: pool,
    cellsPlanned: gap.cellsPlanned + more.cellsPlanned,
    cellsAttempted: gap.cellsAttempted + more.cellsAttempted,
    cellsSucceeded: gap.cellsSucceeded + more.cellsSucceeded,
    answered: [...gap.answered, ...more.answered],
  };
  if (pool.length < MIN_FAILOVER_AIRCRAFT) {
    throw new Error(`${why}, and adsb.fi failover heard only ${pool.length} aircraft`);
  }
  const objects = sweepToObjects(sweep, MAX_PLANES);
  console.warn(
    `${why}; serving adsb.fi failover: ${objects.length} of ${pool.length} aircraft from ` +
      `${sweep.cellsSucceeded}/${sweep.cellsPlanned} cells`,
  );
  return { ...toAircraftSnapshot(objects), fetchedAt: Date.now(), source: "adsb.fi" };
}

/**
 * The failover sweep's whole wall clock, gap cells included. Inside the route's
 * maxDuration of 60 s, with room for the response.
 */
const FAILOVER_BUDGET_MS = 45_000;

// When adsb.lol last gave this process a good pull. On globalThis because the planes
// route is its own bundle; one process serves prod (the box), so this is the
// deployment's memory. A restart forgets it, so the first failed cycle after one
// fails over at once even if the Data Cache still holds an adsb.lol snapshot. That
// costs one cycle of a labelled regional snapshot, not a wrong one.
const OK_KEY = Symbol.for("provenance.planes.adsbLolOkAt.v1");
function adsbLolOkAt(): number | null {
  const v = (globalThis as unknown as Record<symbol, unknown>)[OK_KEY];
  return typeof v === "number" ? v : null;
}
function noteAdsbLolOk(at: number): void {
  (globalThis as unknown as Record<symbol, unknown>)[OK_KEY] = at;
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
 * failed. Under healthy operation an entry is at most REVALIDATE_S old when a
 * request triggers its refresh, that request is still answered from the old entry,
 * and the refresh itself can take PULL_BUDGET_MS. The extra minute covers both, so
 * a healthy cycle is never labelled stale (at 240 s with no margin, prod labelled
 * healthy snapshots stale at 244-297 s on 2026-10-16).
 */
export const FRESH_CEILING_MS = REVALIDATE_S * 1000 + 60_000; // 150_000 ms = 2.5 min

/**
 * Above this age, refuse to serve at all — prefer an honest empty layer over
 * ghosts. A widebody cruises at up to ~900 km/h (~250 m/s); at 15 minutes that
 * is up to ~225 km of possible drift, which is not "this aircraft, a little
 * late" — it's a plotted point that can no longer be trusted as this aircraft's
 * position. 15 min is also 10 REVALIDATE_S windows, chosen so a few
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
 * CACHE KEY: `planes-aircraft-v6`. v5 was the four-request type pull, v4 the sweep;
 * each bump makes the first deploy start clean rather than serve the older shape
 * until it revalidated. (`unstable_cache` also folds the callback's source text into the
 * key, so in practice every deploy that touches `fetchAircraftOnce` starts cold.)
 *
 * ONE ATTEMPT PER REQUEST. A cold cache (first request after a deploy) runs the pull
 * inline and, if it throws, serves an empty snapshot — the next request tries again
 * and the edge cache coalesces those retries to one per 20 s. The old code made a
 * second, direct attempt on failure, which put two full pulls inside one function
 * invocation: 14 + 14 s against a 30 s ceiling then, and 20 + 20 s against 60 now.
 * The direct path survives only for the no-Data-Cache case (unit tests, or a
 * runtime without `next/cache`).
 */
export async function fetchAircraftSnapshot(): Promise<AircraftSnapshot> {
  let cache: typeof import("next/cache") | null;
  try {
    cache = await import("next/cache");
  } catch {
    cache = null;
  }
  let snapshot: AircraftSnapshot;
  try {
    snapshot = cache
      ? rehydrate(
          await cache.unstable_cache(fetchAircraftOnce, ["planes-aircraft-v6"], {
            revalidate: REVALIDATE_S,
          })(),
        )
      : await fetchAircraftOnce();
  } catch {
    // The Data Cache has never held a successful snapshot and this attempt failed
    // too (or, with no cache, the one direct attempt failed). Nothing to serve.
    snapshot = { planes: [] };
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
