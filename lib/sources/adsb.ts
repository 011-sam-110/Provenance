/**
 * adsb.lol — live aircraft from a community ADS-B receiver network, pulled
 * WORLDWIDE by ICAO type designator in a handful of requests.
 *
 * WHY BY TYPE AND NOT BY REGION: adsb.lol publishes no keyless "everything"
 * endpoint (probed 2026-08-13: `/v2/all` 404 here, 400/403 at adsb.fi,
 * airplanes.live and adsb.one). Until 2026-09-06 this module swept 40 point+radius
 * cells (250 nm each) one at a time. That design died twice over on Vercel:
 *
 *   1. adsb.lol enforces a strict per-IP token bucket, and a serverless egress IP
 *      is shared with other tenants. Measured on prod 2026-09-06: 1 of 40 cells
 *      answered (4 refused with 429, 35 never reached inside the 14 s budget), so
 *      the layer served 1,311 aircraft, every one of them between 2° and 15° E.
 *   2. The cap then kept a PREFIX of the cell-ordered union, so even a perfect
 *      sweep would have rendered as two or three dense discs.
 *
 * `GET /v2/type/{A,B,C…}` answers for the whole network in one request and takes a
 * comma-separated list. Probed 2026-09-06 (three paced requests, ~0.5 s each):
 *
 *   20 mainline types (B738, A320, A21N…)   5,703 rows  5,424 positioned  3.2 MB
 *   40 regional / widebody / older types    1,708 rows  1,632 positioned  0.9 MB
 *   70 bizjet / GA / helicopter types       2,932 rows  2,619 positioned  1.4 MB
 *
 * ≈9,700 positioned aircraft spanning 12 of 12 thirty-degree longitude bands, from
 * three requests instead of forty. Four batches below (the lists grew), still four
 * requests per snapshot.
 *
 * ── THE HONESTY BOUNDARY ────────────────────────────────────────────────────
 * Two things make every count here a LOWER BOUND, so `availableExact` is always
 * false and the coverage `rule` says why:
 *   - adsb.lol only sees where volunteers run receivers. Oceans, deserts and much
 *     of Africa, South America and Oceania are thin.
 *   - We only ask for the types we list. An aircraft broadcasting no type code, or
 *     a type not in TYPE_BATCHES, is not requested and cannot appear.
 * Military types (C130, C17, K35R…) are deliberately NOT listed: `/v2/mil` already
 * serves them on the military-air signal layer with their own provenance class,
 * and listing them here would plot the same airframe twice. The old sweep did
 * include them, so that is a small visible change.
 *
 * ── RATE LIMIT ──────────────────────────────────────────────────────────────
 * Token bucket, burst of roughly 3-5, refill of about one request per second or
 * slower: on 2026-09-06 the 6th request at 1.5 s spacing was refused. Hence
 * PACE_MS between batches, a backoff on 429 only, and a hard PULL_BUDGET_MS.
 * `lib/signals/military-air.ts` draws on the same bucket (`/v2/mil`, at most once
 * per 20 s per warm instance); together that is well under the refill, and the
 * only collision is one `/v2/mil` token landing in a pacing gap, which the 429
 * retry absorbs.
 *
 * Failures are COUNTED and LOGGED, never swallowed: `console.warn` once per failed
 * batch, and `batchesSucceeded < batchesPlanned` in the coverage record. The sweep
 * swallowed per-cell failures, which is exactly why 1-of-40 went unnoticed.
 *
 * Deliberately imports NOTHING from opensky.ts: that module imports this one, and
 * the dependency has to stay one-way.
 *
 * Docs: https://api.adsb.lol/docs
 */

import type { WorldObject } from "@/lib/world";
import { classifyPlane } from "@/lib/planes/classify";
import { sampleSpatially } from "@/lib/planes/sample";
import { PLANE_META } from "@/lib/icons/svg";
import { withCoverage } from "@/lib/signals/coverage";

export const ADSB_ATTRIBUTION = "Live aircraft © adsb.lol (community ADS-B receivers)";

// ---------------------------------------------------------------------------
// The type lists
// ---------------------------------------------------------------------------

/**
 * ICAO type designators, four batches, ORDERED BY EXPECTED AIRBORNE VOLUME with the
 * mainline fleet first. The order is load-bearing: when the time budget bites, the
 * tail is what is dropped, and a snapshot that holds the mainline fleet is still a
 * recognisable world; one that holds only light aircraft is not (see
 * `mainlineSucceeded`).
 *
 * Each batch stays at or under 75 codes so its URL stays under 400 characters.
 * Every code appears once across all batches (pinned by a test), so `dedupeById`
 * below is a guard against an upstream quirk, not something the lists rely on.
 * Codes are checked against the bizjet detector in lib/planes/bizjet.ts: every
 * valid designator it knows is requested here, or that detector would be blind.
 */
export const TYPE_BATCHES: readonly (readonly string[])[] = [
  // A — mainline narrowbodies and widebodies.
  [
    "B738", "A320", "A321", "A20N", "B38M", "A21N", "B77W", "A319", "B789", "B739",
    "A359", "A333", "B788", "B737", "B763", "B752", "A332", "B744", "B77L", "B78X",
    "B772", "A388", "A339", "B748", "B39M", "B764", "B712", "MD11",
  ],
  // B — regional jets, turboprop airliners, older and freighter mainline.
  [
    "E75L", "CRJ9", "E190", "CRJ7", "AT76", "DH8D", "E195", "CRJ2", "E170", "BCS3",
    "AT75", "E145", "E75S", "AT72", "B734", "A35K", "B753", "A306", "SU95", "E45X",
    "BCS1", "E295", "E290", "C919", "AJ27", "DH8C", "DH8B", "DH8A", "AT45", "AT43",
    "AT46", "SF34", "JS41", "B733", "B735", "A343", "A346", "A310", "A318", "B37M",
    "B3XM", "MD82", "MD83", "MD88", "MD90", "RJ85", "RJ1H", "F100", "F70", "B462",
    "B463", "DHC6", "IL76", "L410", "MA60", "SB20",
  ],
  // C — business jets (superset of the valid codes in lib/planes/bizjet.ts).
  [
    "C56X", "CL35", "C25B", "E55P", "H25B", "GLF4", "CL60", "GLEX", "C680", "F2TH",
    "LJ45", "C68A", "GLF5", "C560", "C550", "C25C", "GLF6", "C525", "BE40", "LJ60",
    "E50P", "F900", "FA7X", "C25A", "C750", "GL5T", "GL7T", "LJ35", "SF50", "C510",
    "FA50", "PRM1", "G280", "GALX", "C25M", "HDJT", "PC24", "E35L", "C650", "C55B",
    "GA5C", "E550", "E545", "LJ75", "LJ40", "CL30", "C700", "GA6C", "EA50", "H25A",
    "LJ31", "G150", "LJ55", "ASTR", "FA8X", "GA7C", "H25C", "WW24", "C500", "FA6X",
    "GL8T", "LJ70", "C501", "MU30", "FA20", "E135",
    // Near-extinct airframes the bizjet detector still knows; asking costs nothing.
    "GLF2", "GLF3", "LJ23", "LJ24", "LJ25", "C526", "C551", "FA10",
  ],
  // D — general aviation and helicopters. The sacrificial batch when the budget bites.
  [
    "C172", "SR22", "P28A", "C182", "PC12", "BE20", "B350", "SR20", "C208", "BE36",
    "TBM9", "DA40", "PA46", "BE58", "PA32", "P28R", "C206", "PA34", "BE9L", "DA42",
    "M20P", "C152", "C210", "TBM8", "BE33", "C310", "C340", "C414", "C421", "C441",
    "PA31", "PA44", "P180", "KODI", "B190", "SW4", "DA62", "TBM7", "M20T", "C177",
    "EC35", "AS50", "EC45", "A139", "B06", "R44", "B407", "S76", "A109", "EC30",
    "EC20", "B412", "S92", "EC55", "EC75", "EC25", "A169", "A189", "R66", "R22",
    "B429", "B505", "H500", "EXPL", "A119", "AS65", "MD52", "B212",
  ],
];

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** Between batches. The bucket refills under this; do not lower it without re-measuring. */
export const PACE_MS = 2_000;
/** Per batch, on 429 only. Distinct from PACE_MS so a log line says which one it was. */
export const RETRY_BACKOFF_MS: readonly number[] = [2_500, 5_000];
/**
 * Wall clock for the whole pull, retries included. The planes route runs one pull
 * per request under `maxDuration = 60`, so this leaves headroom rather than racing
 * the function ceiling the way the old 14 + 14 s cold path did against 30 s.
 */
export const PULL_BUDGET_MS = 20_000;
/** A single request, clamped to what is left of the budget. */
const BATCH_TIMEOUT_MS = 10_000;
/** Do not start a batch, or a retry, with less than this left. */
const MIN_BATCH_MS = 1_000;

export const typeBatchUrl = (types: readonly string[]): string =>
  `https://api.adsb.lol/v2/type/${types.join(",")}`;

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
 * Pure: collapse duplicates by aircraft id, first occurrence winning. The type
 * lists are disjoint, so this is a guard against an upstream quirk (an aircraft
 * changing its broadcast type between two requests, say), not a dependency.
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
// The pull
// ---------------------------------------------------------------------------

export interface PullResult {
  objects: WorldObject[];
  /**
   * Batches the lists INTENDED to pull. Reported separately from
   * `batchesAttempted` because a record that only compared succeeded-to-attempted
   * would print "2 of 2" when two batches were never asked at all.
   */
  batchesPlanned: number;
  /** Batches actually requested before the time budget ran out. */
  batchesAttempted: number;
  /** Batches that answered. Fewer than attempted ⇒ some refused or timed out. */
  batchesSucceeded: number;
  /**
   * Whether the FIRST batch (the mainline fleet) answered. The caller refuses to
   * cache a snapshot without it: a GA-only sky would overwrite a good snapshot for
   * a whole revalidation window while reading as "fresh".
   */
  mainlineSucceeded: boolean;
  /** How many type designators were asked for, for the coverage rule. */
  typesPlanned: number;
  /**
   * Set when any response declared `total` greater than the rows it returned —
   * i.e. upstream capped a response. Not observed as of 2026-09-06 (`total` always
   * equalled `ac.length`); carried so a future cap cannot pass silently.
   */
  upstreamLimit?: number;
}

/** The seams the tests drive. Production passes nothing and gets the real ones. */
export interface PullDeps {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Thrown for a 429 specifically, so the caller backs off rather than giving up. */
class RateLimited extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number | null,
  ) {
    super(message);
  }
}

function retryAfterMs(res: Response): number | null {
  const s = Number(res.headers.get("retry-after"));
  return Number.isFinite(s) && s > 0 ? s * 1000 : null;
}

interface BatchAnswer {
  objects: WorldObject[];
  /** Rows in the response body. */
  count: number;
  /** What upstream said it held; equals `count` unless upstream capped the body. */
  total: number;
}

async function fetchBatchOnce(
  types: readonly string[],
  label: string,
  timeoutMs: number,
  fetchImpl: NonNullable<PullDeps["fetchImpl"]>,
): Promise<BatchAnswer> {
  const res = await fetchImpl(typeBatchUrl(types), {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
  });
  if (res.status === 429) throw new RateLimited(`adsb.lol ${label} rate-limited (429)`, retryAfterMs(res));
  if (!res.ok) throw new Error(`adsb.lol ${label} answered ${res.status}`);
  const json = (await res.json()) as { ac?: AdsbRow[]; total?: number };
  const rows = json.ac ?? [];
  return {
    objects: normalizeAdsbRows(rows),
    count: rows.length,
    total: typeof json.total === "number" ? json.total : rows.length,
  };
}

/**
 * One batch, retried on 429 only, and only when the retry can still land inside
 * the budget. A non-429 failure is a real upstream problem and retrying it just
 * burns budget a later batch could have used.
 */
async function fetchBatch(
  types: readonly string[],
  label: string,
  deadline: number,
  deps: Required<PullDeps>,
): Promise<BatchAnswer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const left = deadline - deps.now();
      return await fetchBatchOnce(types, label, Math.min(BATCH_TIMEOUT_MS, left), deps.fetchImpl);
    } catch (err) {
      const retryable = err instanceof RateLimited && attempt < RETRY_BACKOFF_MS.length;
      if (!retryable) throw err;
      const wait = err.retryAfterMs ?? RETRY_BACKOFF_MS[attempt];
      if (deps.now() + wait + MIN_BATCH_MS > deadline) throw err;
      await deps.sleep(wait);
    }
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Pull the batches in order and union the rows.
 *
 * SEQUENTIAL AND PACED, not concurrent — this upstream 429s a concurrent burst
 * outright. Batches run mainline-first so that when the budget bites, what gets
 * dropped is what matters least.
 *
 * Per-batch failures are tolerated (one refused batch must not empty the layer)
 * but they are COUNTED and LOGGED, because `batchesSucceeded < batchesPlanned` is
 * what makes the resulting count a lower bound rather than a measurement, and a
 * warn line is what makes it visible in runtime logs.
 */
export async function fetchAdsbTypePull(
  batches: readonly (readonly string[])[] = TYPE_BATCHES,
  deps: PullDeps = {},
): Promise<PullResult> {
  const d: Required<PullDeps> = {
    fetchImpl: deps.fetchImpl ?? ((url, init) => fetch(url, init)),
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? realSleep,
  };
  const deadline = d.now() + PULL_BUDGET_MS;
  const collected: WorldObject[] = [];
  let attempted = 0;
  let succeeded = 0;
  let mainlineSucceeded = false;
  let upstreamLimit: number | undefined;

  for (let i = 0; i < batches.length; i++) {
    if (d.now() + MIN_BATCH_MS > deadline) break;
    const label = `batch ${i + 1}/${batches.length} (${batches[i].length} types)`;
    const started = d.now();
    attempted++;
    try {
      const answer = await fetchBatch(batches[i], label, deadline, d);
      collected.push(...answer.objects);
      succeeded++;
      if (i === 0) mainlineSucceeded = true;
      if (answer.total > answer.count && (upstreamLimit === undefined || answer.count < upstreamLimit)) {
        upstreamLimit = answer.count;
      }
    } catch (err) {
      console.warn(`adsb.lol ${label} failed after ${d.now() - started} ms: ${describeError(err)}`);
    }
    if (i < batches.length - 1 && d.now() < deadline) await d.sleep(PACE_MS);
  }

  return {
    objects: dedupeById(collected),
    batchesPlanned: batches.length,
    batchesAttempted: attempted,
    batchesSucceeded: succeeded,
    mainlineSucceeded,
    typesPlanned: batches.reduce((n, b) => n + b.length, 0),
    ...(upstreamLimit !== undefined ? { upstreamLimit } : {}),
  };
}

/**
 * The pull, capped as a spatial sample and carrying an honest coverage record.
 *
 * `availableExact` is ALWAYS false: the network only sees where volunteers run
 * receivers, and the lists only ask for the types we thought to list. Neither is a
 * measurement of how many aircraft are airborne, so the count publishes as a lower
 * bound ("N of N+") and `rule` carries the reason.
 *
 * `capped` is ALWAYS true, deliberately: `coverageCountLabel` and `coverageNote`
 * both return early on `!capped`, so declaring false would print a bare "3,412"
 * with no note — the exact reading ("that's all of them") this record exists to
 * prevent. `cap` is stamped only when the cap actually bit.
 *
 * When the cap bites, the survivors are a PROPORTIONAL SPATIAL SAMPLE
 * (lib/planes/sample.ts), never a prefix — a prefix is how the globe came to show
 * two dense discs and nothing else.
 */
export function pullToObjects(result: PullResult, cap: number): WorldObject[] {
  const hasCap = Number.isFinite(cap) && cap > 0;
  const localCapped = hasCap && result.objects.length > cap;
  const out = localCapped ? sampleSpatially(result.objects, cap) : result.objects.slice();

  // Two different shortfalls, reported separately because they mean different
  // things: batches never asked (the time budget ran out) vs batches asked that
  // refused. Collapsing them would hide which one is degrading.
  const unasked = result.batchesPlanned - result.batchesAttempted;
  const refused = result.batchesAttempted - result.batchesSucceeded;
  const caveats = [
    unasked > 0 ? `${unasked} not reached within the time budget` : "",
    refused > 0 ? `${refused} did not answer` : "",
  ].filter(Boolean);

  const sample = localCapped
    ? "a proportional spatial sample (every 10-degree cell keeps about the same share and at least one aircraft, airborne first) of "
    : "";

  return withCoverage(out, {
    available: result.objects.length,
    availableExact: false,
    capped: true,
    ...(localCapped ? { cap } : {}),
    ...(result.upstreamLimit != null ? { upstreamLimit: result.upstreamLimit } : {}),
    noun: "aircraft",
    rule:
      `${sample}aircraft broadcasting one of ${result.typesPlanned} listed ICAO type designators, ` +
      `seen by community ADS-B receivers across ${result.batchesSucceeded} of ` +
      `${result.batchesPlanned} type batches` +
      (caveats.length ? ` (${caveats.join("; ")})` : "") +
      " - aircraft without a type code are not requested, so a lower bound, not a global count",
  });
}
