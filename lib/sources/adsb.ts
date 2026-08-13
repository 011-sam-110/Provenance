/**
 * adsb.lol — live aircraft from a community ADS-B receiver network, swept as a
 * bounded grid of point+radius queries.
 *
 * WHY THIS EXISTS: `lib/sources/opensky.ts` is the aircraft layer's primary source
 * because `/states/all` is genuinely worldwide in one request. But OpenSky's
 * anonymous tier is credit-capped PER IP, and on the production deployment's IP that
 * cap is permanently exhausted: every poll throws, `unstable_cache` therefore never
 * commits a value, and the layer sits in `never-fetched` forever serving
 * `{count: 0}`. Measured on prod 2026-08-13. From a home IP the same endpoint
 * answers 200 with ~1.7 MB in 0.58 s, which is what makes it an IP-reputation
 * problem rather than a code problem.
 *
 * WHY A SWEEP AND NOT A GLOBAL CALL: there is no keyless global ADS-B endpoint.
 * Probed 2026-08-13: `api.adsb.lol/v2/all` 404, `opendata.adsb.fi/api/v2/all` 400,
 * `api.airplanes.live/v2/all` 403, `api.adsb.one/v2/all` 403. Only point+radius
 * (max 250 nm) answers, so worldwide-ish coverage means asking many cells.
 *
 * WHY THAT IS SAFE HERE, WHEN opensky.ts's header says a sweep collapses: that
 * warning is about accumulating cells in MODULE state across serverless
 * invocations, where each cold lambda starts empty and the union degrades to
 * whichever cells landed last. This sweep does every cell inside ONE invocation and
 * caches the finished union, so there is no cross-invocation accumulation to lose.
 *
 * ── THE HONESTY BOUNDARY ────────────────────────────────────────────────────
 * adsb.lol is fed by volunteers, so its coverage is wherever people run receivers,
 * NOT the whole sky. Measured per-cell yield 2026-08-13 (250 nm):
 *   New York 1,023 · London 491 · Dubai 129 · Tokyo 25 · Singapore 21 · Sydney 0.
 * North America and Europe are dense; much of Asia, Africa, South America and
 * Oceania are thin to empty. So this provider must NEVER declare its result as a
 * global count. It reports `availableExact: false` — an explicit lower bound — and
 * a rule string naming what was actually swept. A number that says "global" when it
 * means "wherever volunteers point antennas" is the precise failure this codebase
 * exists to not commit.
 *
 * Deliberately imports NOTHING from opensky.ts: that module imports this one for
 * its fallback, and the dependency has to stay one-way.
 *
 * Docs: https://api.adsb.lol/docs
 */

import type { WorldObject } from "@/lib/world";
import { classifyPlane } from "@/lib/planes/classify";
import { PLANE_META } from "@/lib/icons/svg";
import { withCoverage } from "@/lib/signals/coverage";

export const ADSB_ATTRIBUTION = "Live aircraft © adsb.lol (community ADS-B receivers)";

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

export interface SweepCell {
  lat: number;
  lon: number;
  /** Human label, used only in diagnostics — never rendered as a source claim. */
  label: string;
}

/**
 * Cell centres over the airspace that actually carries traffic, rather than tiling
 * the globe uniformly — two thirds of Earth is ocean, and a cell over empty ocean
 * spends a rate-limit token to return nothing.
 *
 * ── THE ORDER IS LOAD BEARING, NOT COSMETIC ─────────────────────────────────
 * The upstream rate limit (see below) means a sweep gets through roughly 9-11
 * cells inside its time budget, so THE TAIL OF THIS LIST USUALLY DOES NOT RUN.
 * That makes ordering a coverage decision.
 *
 * Sorted by yield, but INTERLEAVED ACROSS CONTINENTS. Strict yield order would put
 * the eight densest US cells first and Europe would never be swept at all — a
 * "global" aviation layer that is quietly United-States-only. Interleaving means a
 * truncated sweep still spans North America and Europe, which is where this network
 * has receivers.
 */
export const SWEEP_CELLS: readonly SweepCell[] = [
  // Highest yield, alternating continents — these are the ones that reliably run.
  { lat: 40.7, lon: -74.0, label: "New York" },
  { lat: 51.5, lon: -0.1, label: "London" },
  { lat: 41.9, lon: -87.6, label: "Chicago" },
  { lat: 50.1, lon: 8.7, label: "Frankfurt" },
  { lat: 34.0, lon: -118.2, label: "Los Angeles" },
  { lat: 40.4, lon: -3.7, label: "Madrid" },
  { lat: 33.7, lon: -84.4, label: "Atlanta" },
  { lat: 41.9, lon: 12.5, label: "Rome" },
  { lat: 32.8, lon: -96.8, label: "Dallas" },
  { lat: 54.0, lon: 14.0, label: "Baltic" },
  { lat: 25.2, lon: 55.3, label: "Dubai" },

  // Reached when the budget is generous.
  { lat: 37.6, lon: -122.4, label: "San Francisco" },
  { lat: 56.0, lon: -3.5, label: "Scotland" },
  { lat: 29.8, lon: -95.4, label: "Houston" },
  { lat: 45.8, lon: 4.8, label: "Lyon" },
  { lat: 25.8, lon: -80.3, label: "Miami" },
  { lat: 41.0, lon: 28.9, label: "Istanbul" },
  { lat: 47.6, lon: -122.3, label: "Seattle" },
  { lat: 59.3, lon: 18.1, label: "Stockholm" },
  { lat: 39.7, lon: -104.9, label: "Denver" },
  { lat: 35.7, lon: 139.7, label: "Tokyo" },
  { lat: 43.7, lon: -79.4, label: "Toronto" },
  { lat: 47.5, lon: 19.0, label: "Budapest" },
  { lat: 28.6, lon: 77.2, label: "Delhi" },
  { lat: 42.4, lon: -71.0, label: "Boston" },
  { lat: 55.8, lon: 37.6, label: "Moscow" },

  // The long tail. Rarely reached, kept so a fast day is not artificially
  // North-Atlantic-only, and so the planned grid honestly states our intent.
  { lat: 44.9, lon: -93.2, label: "Minneapolis" },
  { lat: 33.4, lon: -112.0, label: "Phoenix" },
  { lat: 49.2, lon: -123.1, label: "Vancouver" },
  { lat: 19.4, lon: -99.1, label: "Mexico City" },
  { lat: 19.1, lon: 72.9, label: "Mumbai" },
  { lat: 13.7, lon: 100.5, label: "Bangkok" },
  { lat: 1.35, lon: 103.8, label: "Singapore" },
  { lat: 22.3, lon: 114.2, label: "Hong Kong" },
  { lat: 30.0, lon: 31.2, label: "Cairo" },
  { lat: -26.1, lon: 28.0, label: "Johannesburg" },
  { lat: -23.5, lon: -46.6, label: "Sao Paulo" },
  { lat: -34.6, lon: -58.4, label: "Buenos Aires" },
  { lat: -33.9, lon: 151.2, label: "Sydney" },
  { lat: 64.1, lon: -21.9, label: "Reykjavik" },
];

const RADIUS_NM = 250; // the endpoint's documented maximum
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const CELL_TIMEOUT_MS = 8_000;

/**
 * ── RATE LIMIT, MEASURED 2026-08-13. Do not raise these without re-measuring. ──
 *
 * adsb.lol enforces a token bucket with a burst of roughly 3 and a refill of about
 * one request per second. It is strict and it fails fast: a 10-wide concurrent
 * burst returned 429 on ALL TEN in 0.4 s, and even 250 ms spacing only landed
 * roughly one request in three.
 *
 * The first version of this sweep ran 10-wide and got 1 cell out of 40. It still
 * "worked" — 822 aircraft, and the coverage record honestly said 1 of 40 — which is
 * exactly the kind of quietly-crippled success that looks fine in a response body.
 * Hence sequential-with-pacing rather than concurrency.
 */
const PACE_MS = 400; // between successful requests; the bucket refills under this
const RETRY_BACKOFF_MS = [900, 1800]; // per cell, on 429 only
const SWEEP_BUDGET_MS = 14_000;

export const cellUrl = (c: SweepCell): string =>
  `https://api.adsb.lol/v2/lat/${c.lat}/lon/${c.lon}/dist/${RADIUS_NM}`;

// ---------------------------------------------------------------------------
// Upstream shape
// ---------------------------------------------------------------------------

export interface AdsbRow {
  hex?: string;
  flight?: string;
  r?: string; // registration / tail
  t?: string; // ICAO type code
  desc?: string; // long type description
  alt_baro?: number | string; // feet, or the literal "ground"
  alt_geom?: number; // feet
  gs?: number; // ground speed, knots
  track?: number; // true track, degrees
  baro_rate?: number; // feet/minute
  squawk?: string;
  category?: string; // ADS-B emitter category, e.g. "A3"
  lat?: number;
  lon?: number;
}

// Unit conversions, named so the parser reads as physics rather than magic numbers.
const FT_TO_KM = 0.0003048;
const KT_TO_MS = 0.514444;
const FTMIN_TO_MS = 0.00508;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Pure: one adsb.lol row → a {@link WorldObject}, or null when it carries no usable
 * position. Shapes `meta` to match `planeToWorldObject` in opensky.ts exactly, so
 * the globe layer and the dossier cannot tell which provider served a given
 * aircraft — with two additive extras this feed has and OpenSky does not.
 *
 * CLASSIFICATION IS BETTER HERE, and that is worth stating: adsb.lol broadcasts the
 * real ADS-B emitter `category`, so `classifyPlane` reads a transmitted fact. The
 * OpenSky path has no category field at all and always falls through to the
 * altitude/speed heuristic, which the UI labels "est.". Aircraft served by this
 * provider are therefore classified, not estimated.
 */
export function adsbRowToWorldObject(row: AdsbRow): WorldObject | null {
  const lat = num(row.lat);
  const lon = num(row.lon);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const hex = (row.hex ?? "").trim();
  if (!hex) return null;

  const onGround = typeof row.alt_baro === "string" && row.alt_baro.toLowerCase() === "ground";
  const altFt = onGround ? 0 : (num(row.alt_geom) ?? num(row.alt_baro) ?? 0);
  const altKm = altFt * FT_TO_KM;

  const gs = num(row.gs);
  const velocityMs = gs === null ? null : gs * KT_TO_MS;
  const baroRate = num(row.baro_rate);
  const verticalRateMs = baroRate === null ? null : baroRate * FTMIN_TO_MS;
  const headingDeg = num(row.track) ?? 0;

  const category = classifyPlane({
    altKm,
    velocityMs,
    onGround,
    category: (row.category ?? "").trim() || undefined,
  });
  const meta = PLANE_META[category];

  const callsign = (row.flight ?? "").trim() || hex;
  const typeCode = (row.t ?? "").trim();
  const registration = (row.r ?? "").trim();

  return {
    kind: "plane",
    id: `plane:${hex}`,
    lat,
    lon,
    altKm,
    heading: headingDeg,
    label: callsign,
    color: meta.color,
    icon: meta.key,
    typeLabel: meta.label,
    meta: {
      callsign,
      // adsb.lol does not broadcast an origin country. OpenSky does, so this field
      // exists in the shared shape; leaving it "" is the honest value. It is NOT
      // inferred from the hex block or the registration prefix — that would be a
      // derivation dressed as an observation.
      country: "",
      velocityMs,
      altKm,
      verticalRateMs,
      onGround,
      headingDeg,
      category,
      typeLabel: meta.label,
      squawk: (row.squawk ?? "").trim(),
      // Additive extras this provider supplies and OpenSky does not.
      ...(typeCode ? { typeCode } : {}),
      ...(registration ? { registration } : {}),
      ...(row.desc?.trim() ? { typeDescription: row.desc.trim() } : {}),
    },
  };
}

/** Pure: rows → objects, dropping the unusable ones. */
export function normalizeAdsbRows(rows: readonly AdsbRow[]): WorldObject[] {
  const out: WorldObject[] = [];
  for (const r of rows) {
    const o = adsbRowToWorldObject(r);
    if (o) out.push(o);
  }
  return out;
}

/**
 * Pure: collapse overlapping cells by aircraft id, first occurrence winning.
 * Adjacent 250 nm discs deliberately overlap so there are no seams, which means the
 * same aircraft is reported by more than one cell; without this the layer would
 * double-count precisely over the busiest airspace.
 */
export function dedupeById(objects: readonly WorldObject[]): WorldObject[] {
  const seen = new Set<string>();
  const out: WorldObject[] = [];
  for (const o of objects) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

export interface SweepResult {
  objects: WorldObject[];
  /**
   * Cells the grid INTENDED to sweep. Reported separately from `cellsAttempted`
   * because the rate limit usually stops the sweep early, and a record that only
   * compared succeeded-to-attempted would print "9 of 9" — indistinguishable from
   * complete coverage, when 31 regions were never asked at all.
   */
  cellsPlanned: number;
  /** Cells actually requested before the time budget ran out. */
  cellsAttempted: number;
  /** Cells that answered. Fewer than attempted ⇒ some regions refused or timed out. */
  cellsSucceeded: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Thrown for a 429 specifically, so the caller can back off rather than give up. */
class RateLimited extends Error {}

async function fetchCellOnce(cell: SweepCell): Promise<WorldObject[]> {
  const res = await fetch(cellUrl(cell), {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(CELL_TIMEOUT_MS),
  });
  if (res.status === 429) throw new RateLimited(`adsb.lol ${cell.label} rate-limited`);
  if (!res.ok) throw new Error(`adsb.lol ${cell.label} answered ${res.status}`);
  const json = (await res.json()) as { ac?: AdsbRow[] };
  return normalizeAdsbRows(json.ac ?? []);
}

/**
 * One cell, retried on 429 only. A non-429 failure is a real upstream problem and
 * retrying it just burns budget that a later cell could have used.
 */
async function fetchCell(cell: SweepCell, deadline: number): Promise<WorldObject[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchCellOnce(cell);
    } catch (err) {
      const retryable = err instanceof RateLimited && attempt < RETRY_BACKOFF_MS.length;
      if (!retryable) throw err;
      const wait = RETRY_BACKOFF_MS[attempt];
      if (Date.now() + wait > deadline) throw err;
      await sleep(wait);
    }
  }
}

/**
 * Sweep the cells in order and stitch the union.
 *
 * SEQUENTIAL AND PACED, not concurrent — see the rate-limit block above; this
 * upstream 429s a concurrent burst outright. Cells run densest-first so that when
 * the budget bites, what gets dropped is what was going to return least.
 *
 * Per-cell failures are tolerated (one dead cell must not empty the layer) but are
 * COUNTED, because `cellsSucceeded < cellsAttempted` is what makes the resulting
 * count a lower bound rather than a measurement.
 */
export async function fetchAdsbSweep(
  cells: readonly SweepCell[] = SWEEP_CELLS,
): Promise<SweepResult> {
  const deadline = Date.now() + SWEEP_BUDGET_MS;
  const collected: WorldObject[] = [];
  let succeeded = 0;
  let attempted = 0;

  for (const cell of cells) {
    if (Date.now() >= deadline) break;
    attempted++;
    try {
      collected.push(...(await fetchCell(cell, deadline)));
      succeeded++;
    } catch {
      // A cell that 429s past its retries or times out is a hole in coverage, not a
      // reason to fail the layer.
    }
    if (Date.now() < deadline) await sleep(PACE_MS);
  }

  return {
    objects: dedupeById(collected),
    cellsPlanned: cells.length,
    cellsAttempted: attempted,
    cellsSucceeded: succeeded,
  };
}

/**
 * The sweep, capped and carrying an honest coverage record.
 *
 * `availableExact` is ALWAYS false, for two independent reasons either of which
 * would be sufficient: this network only sees where volunteers run receivers, and
 * the grid only asks where we thought to look. Neither is a measurement of how many
 * aircraft are airborne, so the count publishes as a lower bound ("N of N+") and
 * `rule` carries the reason.
 *
 * `capped` is ALWAYS true, and that is deliberate rather than cosmetic:
 * `coverageCountLabel` and `coverageNote` both return early on `!capped`, so
 * declaring false here would print a bare "3,412" with no note — the exact reading
 * ("that's all of them") this record exists to prevent. `returned` genuinely is a
 * ceiling on what we can claim, so `capped` is also just true.
 *
 * Built with `withCoverage` rather than `applyCap`, because `applyCap` only reaches
 * `availableExact: false` via its `upstream` option, which would also stamp an
 * `upstreamLimit` — and no upstream request `limit=` was saturated here. That would
 * be a false detail in the published note.
 */
export function sweepToObjects(result: SweepResult, cap: number): WorldObject[] {
  const hasCap = Number.isFinite(cap) && cap > 0;
  const localCapped = hasCap && result.objects.length > cap;
  const out = localCapped ? result.objects.slice(0, cap) : result.objects.slice();

  // Two different shortfalls, reported separately because they mean different
  // things: cells never asked (rate limit ate the time budget) vs cells asked that
  // refused. Collapsing them would hide which one is degrading.
  const unasked = result.cellsPlanned - result.cellsAttempted;
  const refused = result.cellsAttempted - result.cellsSucceeded;
  const caveats = [
    unasked > 0 ? `${unasked} not reached within the time budget` : "",
    refused > 0 ? `${refused} did not answer` : "",
  ].filter(Boolean);

  return withCoverage(out, {
    available: result.objects.length,
    availableExact: false,
    capped: true,
    ...(localCapped ? { cap } : {}),
    noun: "aircraft",
    rule:
      `seen by community ADS-B receivers across ${result.cellsSucceeded} of ` +
      `${result.cellsPlanned} planned ${RADIUS_NM} nm regions` +
      (caveats.length ? ` (${caveats.join("; ")})` : "") +
      ", densest over North America and Europe and thin elsewhere - a lower bound, not a global count",
  });
}
