import { Camera, CameraArray, Source } from "@/lib/types";

// Castle Rock Associates "511" platform — ONE adapter fans out to the ten
// traveler-information systems that share its software (US: FL/GA/NY/ID/LA +
// New England ME-NH-VT; Canada: ON/AB/NS/NB). All keyless. Each system serves
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
    "Live traffic camera data © state & provincial 511 systems (FL/GA/NY/ID/LA/New England · ON/AB/NS/NB)",
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
  { system: "ny", site: "511ny.org", country: "US", region: "New York", agency: "NYSDOT (511NY)" },
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

// PAGE is the server's hard row cap; PAGE_CONCURRENCY bounds how many page
// requests are in flight across ALL systems at once (polite + bounded);
// MAX_PAGES_PER_SYSTEM guards against a bogus recordsTotal looping us forever.
const PAGE = 100;
const PAGE_CONCURRENCY = 10;
const MAX_PAGES_PER_SYSTEM = 120; // 120×100 = 12k cams/system — above any real total

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

export async function fetchRegistry(): Promise<Camera[]> {
  // 1) One page-0 per system, concurrently → first 100 rows + the true total.
  //    A system whose first page fails (e.g. NY's intermittent 500) drops here.
  const heads = await Promise.allSettled(
    CASTLEROCK_SYSTEMS.map(async (system) => ({ system, head: await fetchPage(system.site, 0) })),
  );
  const live = heads
    .filter(
      (r): r is PromiseFulfilledResult<{ system: CastleRockSystem; head: PageResult }> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);

  // 2) Round-robin every remaining page across systems so the pool never points
  //    all `PAGE_CONCURRENCY` slots at one host. A page that fails yields nothing.
  const perSystem = live.map((entry) => pageStarts(entry.head.recordsTotal));
  const maxLen = Math.max(0, ...perSystem.map((a) => a.length));
  const jobs: { si: number; start: number }[] = [];
  for (let k = 0; k < maxLen; k++) {
    for (let si = 0; si < live.length; si++) {
      const start = perSystem[si][k];
      if (start !== undefined) jobs.push({ si, start });
    }
  }
  const pages = await mapPool(jobs, PAGE_CONCURRENCY, ({ si, start }) =>
    fetchPage(live[si].system.site, start)
      .then((p) => ({ si, records: p.records }))
      .catch(() => ({ si, records: [] as CastleRockRecord[] })),
  );

  // 3) Regroup pages under their system, normalize, and combine.
  const recordsBySystem = live.map((entry) => [...entry.head.records]);
  for (const { si, records } of pages) recordsBySystem[si].push(...records);
  const cams = live.flatMap((entry, si) => normalizeCastleRock(recordsBySystem[si], entry.system));
  return CameraArray.parse(cams);
}
