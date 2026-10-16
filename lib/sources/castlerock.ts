import { Camera, CameraArray, Source } from "@/lib/types";

// Castle Rock Associates "511" platform — ONE adapter fans out to the nine
// traveler-information systems that share its software (US: FL/GA/ID/LA +
// New England ME-NH-VT; Canada: ON/AB/NS/NB). All keyless.
//
// NEW YORK LEFT THIS TABLE ON 2026-10-16. 511ny.org moved to the CARS platform and
// `POST /List/GetData/Cameras` there now answers 200 with the new app's HTML shell,
// so the row produced 0 cameras on every round (two probes, and 0 `ny` ids in two
// prod readings). Its cameras are served by lib/sources/cars.ts now. Each system serves
// a DataTables endpoint at `POST https://{site}/List/GetData/Cameras` (a GET
// returns an empty table — it MUST be POST). Per camera we surface the JPEG
// snapshot `https://{site}/map/Cctv/{id}` (loads with no referer/cookie). We
// deliberately ignore each record's `videoUrl` HLS — it is auth-gated
// (`isVideoAuthRequired: true`). Coordinates arrive as WKT `POINT (lon lat)` —
// LONGITUDE FIRST — so `parseWktPoint` keeps lon/lat in that order and the
// caller assigns them deliberately (the #1 way to ship this adapter swapped).
//
// PAGINATION: the DataTables endpoint HARD-CAPS each response at 100 rows — it
// ignores a large `length=` and rejects `length=-1` with a 500 — but it honours
// `start=`, so we walk 100-row pages per system up to the reported recordsTotal.
// (A single capped request would silently surface only ~100 cams/system.)
// Live-verified 2026-06-27 (recordsTotal per system): FL=4881 GA=4043 NY=2293
// ON=932 ID=457 NewEngland=403 AB=356 NS=57 NB=57 (~13,479 cameras total).
// LA (Louisiana DOTD) added 2026-09-05, live-verified the same way: recordsTotal
// =336, every row `source: "LADOTD"`, and `/map/Cctv/1` answers 200 image/jpeg
// with no cookie or referer. NOTE FOR THE NEXT READER: `511la.org` is LOUISIANA,
// not Los Angeles — the site is branded "Louisiana DOTD" and its assets live
// under `/Content/LU/`. It was added here rather than as a module of its own
// because it is the same Castle Rock software: `POST /List/GetData/Cameras`
// returns the identical DataTables shape, down to the WKT `latLng` and the
// relative `/map/Cctv/{id}` snapshot. Louisiana is also the first system whose
// `videoUrl` is NOT auth-gated (`isVideoAuthRequired: false`, an HLS playlist on
// `ITSStreamingBR2.dotd.la.gov`); we still drop it, because `mediaType` is a
// per-adapter constant here and promoting one system to video would make the
// feed inconsistent. Revisit deliberately, not by accident.

export const CASTLEROCK_SOURCE: Source = {
  id: "castlerock",
  name: "Castle Rock 511 (US & Canada DOT cameras)",
  license: "511 DOT Traveler Information — Terms of Use",
  attribution:
    "Live traffic camera data © state & provincial 511 systems (FL/GA/ID/LA/New England · ON/AB/NS/NB)",
  refreshSeconds: 60, // live traffic snapshots refresh frequently
  needsKey: false,
};

export interface CastleRockSystem {
  system: string; // short namespace key, e.g. "fl"
  site: string; // host serving both the list endpoint and the snapshots
  country: string; // ISO-3166 alpha-2
  region: string; // default region label (per-camera `state` wins when present)
  agency: string; // attribution credit
}

// Order: US systems then Canadian. Each `site` was live-verified to answer the
// `POST /List/GetData/Cameras` endpoint and to serve snapshots at /map/Cctv/{id}.
export const CASTLEROCK_SYSTEMS: CastleRockSystem[] = [
  { system: "fl", site: "fl511.com", country: "US", region: "Florida", agency: "Florida DOT (FL511)" },
  { system: "ga", site: "511ga.org", country: "US", region: "Georgia", agency: "Georgia DOT (511GA)" },
  { system: "id", site: "511.idaho.gov", country: "US", region: "Idaho", agency: "Idaho Transportation Dept (511)" },
  { system: "newengland", site: "newengland511.org", country: "US", region: "New England", agency: "New England 511 (ME/NH/VT)" },
  // Louisiana, not Los Angeles. Its rows carry `state: null`, so `region` falls
  // back to this table's label — which is why the label has to be right.
  { system: "la", site: "511la.org", country: "US", region: "Louisiana", agency: "Louisiana DOTD (511LA)" },
  { system: "on", site: "511on.ca", country: "CA", region: "Ontario", agency: "Ontario MTO (511ON)" },
  { system: "ab", site: "511.alberta.ca", country: "CA", region: "Alberta", agency: "Alberta 511" },
  { system: "ns", site: "511.novascotia.ca", country: "CA", region: "Nova Scotia", agency: "Nova Scotia 511" },
  { system: "nb", site: "511.gnb.ca", country: "CA", region: "New Brunswick", agency: "New Brunswick 511" },
];

export interface CastleRockImage {
  id?: number;
  imageUrl?: string; // relative, e.g. "/map/Cctv/1"
  videoUrl?: string; // auth-gated HLS — intentionally unused
  isVideoAuthRequired?: boolean;
  disabled?: boolean;
  blocked?: boolean;
  description?: string;
}

export interface CastleRockRecord {
  id?: number | string;
  visible?: boolean;
  roadway?: string;
  direction?: string;
  location?: string;
  state?: string;
  county?: string;
  country?: string;
  images?: CastleRockImage[];
  latLng?: { geography?: { coordinateSystemId?: number; wellKnownText?: string } } | null;
}

// WKT points are "POINT (lon lat)" — longitude is the FIRST ordinate. We return
// the two values under their true names so the caller can never silently swap.
export function parseWktPoint(wkt: string | undefined | null): { lon: number; lat: number } | null {
  if (!wkt) return null;
  const m = wkt.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!m) return null;
  const lon = Number(m[1]); // first ordinate = X = longitude
  const lat = Number(m[2]); // second ordinate = Y = latitude
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

export function normalizeCastleRock(records: CastleRockRecord[], system: CastleRockSystem): Camera[] {
  const cams: Camera[] = [];
  const attribution = `Live traffic camera data © ${system.agency}`;
  for (const r of records) {
    const pt = parseWktPoint(r.latLng?.geography?.wellKnownText);
    if (!pt) continue;
    const { lon, lat } = pt;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const nativeId = (r.id ?? "").toString().trim();
    if (!nativeId) continue;

    // One snapshot view per camera. The relative `imageUrl` is authoritative;
    // fall back to the documented `/map/Cctv/{id}` pattern. No images = no snapshot.
    const img = (r.images ?? [])[0];
    if (!img) continue;
    const rel = (img.imageUrl?.trim() || `/map/Cctv/${nativeId}`);
    const imageUrl = rel.startsWith("http")
      ? rel
      : `https://${system.site}${rel.startsWith("/") ? "" : "/"}${rel}`;

    cams.push({
      id: `castlerock:${system.system}:${nativeId}`,
      source: "castlerock",
      country: system.country,
      region: r.state?.trim() || system.region,
      name: r.location?.trim() || [r.roadway, r.direction].filter(Boolean).join(" ").trim() || `${system.region} camera ${nativeId}`,
      lat, // ← latitude (POINT's 2nd ordinate); swapping with lon would be the classic bug
      lon, // ← longitude (POINT's 1st ordinate)
      road: r.roadway?.trim() || undefined,
      direction: r.direction?.trim() || undefined,
      imageUrl,
      mediaType: "jpeg", // video is auth-gated; we only serve the snapshot
      refreshSeconds: CASTLEROCK_SOURCE.refreshSeconds,
      license: CASTLEROCK_SOURCE.license,
      attribution,
      available: r.visible !== false && img.disabled !== true && img.blocked !== true,
    });
  }
  return cams;
}

// PAGE is the server's hard row cap; PER_HOST_CONCURRENCY bounds how many page
// requests are in flight against ONE system at once; MAX_PAGES_PER_SYSTEM guards
// against a bogus recordsTotal looping us forever.
//
// WHY PER HOST, AND WHY THREE. This used to be one pool of ten across all systems.
// The round-robin spread it fairly while every system still had pages, but Florida
// (~50 pages) and Georgia (~44) outlast the rest, so for most of a round the pool
// pointed five requests at each of those two hosts. Prod then lost pages exactly
// there: on 2026-10-16 one reading served FL 4,687 of 4,987 and GA 0 of 4,331, the
// next FL 4,587 and GA 2,931, while every page answered when fetched directly. The
// throttling is not proved (no log line yet), but the shape fits it and a lower,
// per-host ceiling costs only time: ~50 pages at three in flight is well inside the
// feed's 60 s budget.
const PAGE = 100;
const PER_HOST_CONCURRENCY = 3;
const MAX_PAGES_PER_SYSTEM = 120; // 120×100 = 12k cams/system — above any real total
/** One more try for a page that failed, after this pause. */
const PAGE_RETRY_DELAY_MS = 750;

const REQUEST_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "X-Requested-With": "XMLHttpRequest",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "User-Agent": "TrafficNerd/2.0 (+https://github.com/011-sam-110/TrafficNerd-V2)",
} as const;

interface PageResult {
  records: CastleRockRecord[];
  recordsTotal: number;
}

/** The `start=` offsets needed AFTER page 0 to cover `recordsTotal` rows. Pure. */
export function pageStarts(recordsTotal: number, pageSize = PAGE): number[] {
  const starts: number[] = [];
  for (let s = pageSize; s < recordsTotal; s += pageSize) starts.push(s);
  return starts.slice(0, MAX_PAGES_PER_SYSTEM - 1); // page 0 is the +1
}

/** A page that fails is tried once more before it counts as lost. */
async function fetchPageWithRetry(site: string, start: number): Promise<PageResult> {
  try {
    return await fetchPage(site, start);
  } catch {
    await new Promise((r) => setTimeout(r, PAGE_RETRY_DELAY_MS));
    return fetchPage(site, start);
  }
}

/** Fetch one 100-row page; returns its records and the system's reported total. */
async function fetchPage(site: string, start: number): Promise<PageResult> {
  const res = await fetch(`https://${site}/List/GetData/Cameras`, {
    method: "POST", // a GET returns an empty DataTables table
    headers: { ...REQUEST_HEADERS },
    body: `draw=1&start=${start}&length=${PAGE}`,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Castle Rock ${site} @${start}: ${res.status}`);
  const json = (await res.json()) as { data?: CastleRockRecord[]; recordsTotal?: number };
  return { records: json.data ?? [], recordsTotal: Number(json.recordsTotal) || 0 };
}

/** Tiny bounded-concurrency map — no deps; runs `fn` over items, `limit` at a time. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Below this share of its own reported total, a system's round counts as incomplete.
 * Every page answering gives exactly `recordsTotal` rows, so one lost 100-row page in
 * Florida is ~98%; the margin is for rows the upstream drops between page reads.
 */
export const SYSTEM_COMPLETE_RATIO = 0.97;

/**
 * What one system contributes to this round. Pure.
 *
 * `fresh` is null when the system's first page failed (no total, no rows). A round
 * that came back short of the system's own `recordsTotal` is a partial read, not a
 * smaller network, so the system's last complete read is served instead when there is
 * one. Without this, one throttled host emptied Georgia from the map while the feed as
 * a whole still reported success, because the other eight systems answered.
 *
 * With no previous read, a partial read is still served: some cameras beat none, and
 * the next complete round replaces it.
 */
export function settleSystem(
  fresh: CastleRockRecord[] | null,
  expected: number,
  previous: CastleRockRecord[] | undefined,
): { records: CastleRockRecord[]; complete: boolean; fromPrevious: boolean } {
  if (fresh === null) {
    return { records: previous ?? [], complete: false, fromPrevious: previous !== undefined };
  }
  const complete = fresh.length >= Math.floor(expected * SYSTEM_COMPLETE_RATIO);
  if (complete || !previous || previous.length <= fresh.length) {
    return { records: fresh, complete, fromPrevious: false };
  }
  return { records: previous, complete: false, fromPrevious: true };
}

/** Last complete read per system, so a partial round serves the last whole one. */
const lastCompleteBySystem = new Map<string, CastleRockRecord[]>();

/** Read every page of one system. `null` when its first page fails. */
async function readSystem(system: CastleRockSystem): Promise<{ records: CastleRockRecord[]; total: number } | null> {
  let head: PageResult;
  try {
    head = await fetchPageWithRetry(system.site, 0);
  } catch {
    return null;
  }
  const pages = await mapPool(pageStarts(head.recordsTotal), PER_HOST_CONCURRENCY, (start) =>
    fetchPageWithRetry(system.site, start)
      .then((p) => p.records)
      .catch(() => [] as CastleRockRecord[]),
  );
  return { records: [...head.records, ...pages.flat()], total: head.recordsTotal };
}

export async function fetchRegistry(): Promise<Camera[]> {
  // Every system in parallel; inside each, at most PER_HOST_CONCURRENCY pages in
  // flight. A system whose first page fails, or whose round comes back short of its
  // own total, falls back to its last complete read (settleSystem).
  const reads = await Promise.all(CASTLEROCK_SYSTEMS.map((system) => readSystem(system)));
  const cams = CASTLEROCK_SYSTEMS.flatMap((system, i) => {
    const read = reads[i];
    const settled = settleSystem(read?.records ?? null, read?.total ?? 0, lastCompleteBySystem.get(system.system));
    if (settled.complete) lastCompleteBySystem.set(system.system, settled.records);
    return normalizeCastleRock(settled.records, system);
  });
  return CameraArray.parse(cams);
}
