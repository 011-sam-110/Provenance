import { Webcam, WebcamArray, Source } from "@/lib/types";
import { applyCap, carryCoverage } from "@/lib/signals/coverage";

// Windy.com Webcams API v3 — ~73k global webcams. UNLIKE the road-CCTV adapters
// this one is KEYED: every request carries an `x-windy-api-key` header injected
// SERVER-SIDE only (the key never reaches the browser). It is wired into its own
// /api/webcams path + webcams store, NOT the camera registry, so it stays a
// distinct "Webcams" sub-layer and never inflates the road-camera counts.
//
// Contract (live-verified 2026-06-27 against api.windy.com):
//   LIST   GET /webcams/api/v3/webcams?bbox={N},{E},{S},{W}&limit&offset&include
//   DETAIL GET /webcams/api/v3/webcams/{webcamId}?include=images,location,urls
//   Auth   header  x-windy-api-key: <key>
//   Free-tier caps: limit ≤ 50, offset ≤ 1000 (paging past 1000 → HTTP 400),
//     image URLs are tokened and expire ~10 min → re-fetch, never cache them.
//   total: 73,320 webcams globally. bbox order is north,east,south,west.
// Mandatory attribution: "Webcams provided by Windy.com" + a per-webcam link
// back to its Windy page (urls.detail).

const BASE = "https://api.windy.com/webcams/api/v3/webcams";
const ATTRIBUTION = "Webcams provided by Windy.com";

export const WINDY_SOURCE: Source = {
  id: "windy",
  name: "Windy.com Webcams (global)",
  license: "Windy.com Webcams API — Terms of Service",
  attribution: ATTRIBUTION,
  refreshSeconds: 600, // free-tier image tokens last ~10 min; re-pull on this cadence
  needsKey: true,
};

// --- Upstream shapes (only the fields we read) ------------------------------

export interface WindyImageSet {
  icon?: string;
  thumbnail?: string;
  preview?: string;
}

export interface WindyWebcam {
  webcamId?: number;
  title?: string;
  status?: string;
  lastUpdatedOn?: string;
  viewCount?: number;
  categories?: { id?: string; name?: string }[];
  images?: {
    current?: WindyImageSet;
    daylight?: WindyImageSet;
    sizes?: Record<string, { width?: number; height?: number }>;
  };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    country_code?: string;
    continent?: string;
    latitude?: number;
    longitude?: number;
  } | null;
  urls?: { detail?: string; edit?: string; provider?: string };
}

export interface WindyListResponse {
  total?: number;
  webcams?: WindyWebcam[];
}

// --- Normalization (pure — unit tested) -------------------------------------

/** One upstream webcam → our Webcam, or null when it can't be placed/identified. */
export function normalizeWindyWebcam(w: WindyWebcam): Webcam | null {
  const webcamId = w.webcamId;
  if (webcamId === undefined || webcamId === null) return null;

  const loc = w.location;
  if (!loc) return null;
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const cur = w.images?.current ?? {};
  const status = (w.status ?? "unknown").toString();
  const id = `windy:${webcamId}`;

  return {
    id,
    source: "windy",
    title: w.title?.trim() || `Webcam ${webcamId}`,
    lat,
    lon,
    country: loc.country_code ? loc.country_code.toUpperCase() : undefined,
    region: loc.region?.trim() || loc.city?.trim() || undefined,
    city: loc.city?.trim() || undefined,
    categories: (w.categories ?? []).map((c) => c.name?.trim()).filter((n): n is string => !!n),
    // Prefer the larger "preview"; fall back through thumbnail → icon.
    imageUrl: cur.preview || cur.thumbnail || cur.icon || undefined,
    thumbnailUrl: cur.thumbnail || cur.icon || undefined,
    // urls.detail is the canonical attribution link; synthesize it if absent.
    detailUrl: w.urls?.detail?.trim() || `https://www.windy.com/webcams/${webcamId}`,
    providerUrl: w.urls?.provider?.trim() || undefined,
    status,
    available: status === "active",
    lastUpdatedOn: w.lastUpdatedOn,
    license: WINDY_SOURCE.license,
    attribution: ATTRIBUTION,
  };
}

export function normalizeWindy(json: WindyListResponse): Webcam[] {
  const out: Webcam[] = [];
  for (const w of json.webcams ?? []) {
    const n = normalizeWindyWebcam(w);
    if (n) out.push(n);
  }
  return out;
}

// --- Network ----------------------------------------------------------------

const INCLUDE = "images,location,urls,categories";
// Exported so tests derive the expected request count from the registry instead
// of hard-coding "14 regions × 2" — a literal that silently rots the moment a
// region is added or given a `pages` override.
export const LIMIT = 50; // free-tier hard cap
export const PAGES_PER_REGION = 2; // 2 × 50 = up to 100 webcams/region (offset 0,50)
const REGION_CONCURRENCY = 6; // polite + bounded parallelism across page jobs
const MAX_WEBCAMS = 2000; // safety cap on the merged global sample — disclosed via lib/signals/coverage.ts, not silent

// 73k webcams can't be loaded (and offset is free-tier-capped at 1000), so we
// fan a small bbox query across world regions for a GLOBAL spread, then dedupe.
// bbox is [north, east, south, west].
export interface WindyRegion {
  name: string;
  bbox: [number, number, number, number];
  /**
   * Pages to request for THIS region, overriding the module default. A page is
   * `LIMIT` (50) webcams, so `pages` × 50 is the region's ceiling.
   *
   * Exists because the default of 2 is a global compromise that silently
   * truncates dense regions: every region is capped at 100 regardless of how
   * many webcams the bbox actually holds, and nothing reports the shortfall.
   * Splitting a dense bbox into smaller boxes is the tempting fix and it is the
   * wrong one — the split has to be re-tuned every time Windy's inventory moves.
   */
  pages?: number;
}

export const WINDY_REGIONS: WindyRegion[] = [
  { name: "uk-ireland", bbox: [59, 2, 50, -11] },
  { name: "w-europe", bbox: [60, 20, 41, -10] },
  { name: "scandinavia", bbox: [71, 31, 55, 4] },
  { name: "e-europe", bbox: [60, 41, 40, 20] },
  { name: "mediterranean", bbox: [46, 36, 30, -6] },
  { name: "na-west", bbox: [60, -100, 24, -130] },
  { name: "na-east", bbox: [50, -60, 24, -100] },
  { name: "latin-america", bbox: [25, -35, -56, -118] },
  // Brazil, overlapping `latin-america` deliberately — the fan-out dedupes by
  // webcamId, so an overlap costs requests, not correctness.
  //
  // Measured 2026-08-14 against api.windy.com: this bbox reports total=206, of
  // which 135 carry location.country === "Brazil" (the rest are Chile 35,
  // Argentina 23, Paraguay 9, Uruguay 2, Ecuador 1 — real webcams, kept). The
  // `latin-america` box already spans this area but at the default 2 pages it
  // ceilings at 100 for the whole continent, so Brazil was mostly invisible.
  //
  // 5 pages = 250 capacity against a measured 206, i.e. headroom rather than a
  // number tuned to today's inventory. Re-measure before changing it:
  //   curl -H "x-windy-api-key: $KEY" \
  //     "https://api.windy.com/webcams/api/v3/webcams?bbox=5.3,-34.7,-33.8,-74.0&limit=1"
  { name: "brazil", bbox: [5.3, -34.7, -33.8, -74.0], pages: 5 },
  // Belgium (with its border strip into NL/LU/DE/FR), for the same reason as
  // Brazil, only starker.
  //
  // Measured 2026-08-14: `w-europe` is the ONLY region whose bbox contains
  // Brussels, that bbox holds 19,204 webcams, and at the default 2 pages it
  // fetches 100 of them — 0.5%. Which 100 is not chosen, it is whatever the API
  // returns first, and on the day of measurement that was Italy 60 / France 18 /
  // Switzerland 8 / Czechia 5 / Germany 4 / Spain 2 and **zero Belgium**. So a
  // country with 114 webcams in the feed was rendering none at all.
  //
  // This bbox holds 225 (114 of them Belgian), so 5 pages = 250 capacity covers
  // it with headroom. Re-measure before changing:
  //   curl -H "x-windy-api-key: $KEY" \
  //     "https://api.windy.com/webcams/api/v3/webcams?bbox=51.55,6.45,49.45,2.5&limit=1"
  //
  // NOT A GENERAL FIX. The Netherlands and Luxembourg are starved by the same
  // 100-row ceiling, and so is everywhere else in w-europe that is not Italy.
  // Adding a region per country does not scale — the real fix is to stop
  // sampling a 19k-webcam box with 100 rows. Tracked, not solved here.
  { name: "belgium", bbox: [51.55, 6.45, 49.45, 2.5], pages: 5 },
  { name: "africa", bbox: [37, 52, -35, -18] },
  { name: "middle-east", bbox: [42, 63, 12, 34] },
  { name: "s-asia", bbox: [37, 92, 5, 60] },
  { name: "e-asia", bbox: [54, 146, 20, 100] },
  { name: "se-asia", bbox: [23, 141, -11, 92] },
  { name: "oceania", bbox: [-9, 180, -48, 110] },
];

/** One planned upstream request: which bbox, and which page of it. */
export interface WindyPageJob {
  region: string;
  bbox: [number, number, number, number];
  offset: number;
}

/**
 * Expand the region list into the flat list of page requests to make.
 *
 * Pure so the paging arithmetic — the part that decides whether a region is
 * silently truncated — is unit-testable without touching the network. Both
 * fan-outs (this module's `fetchWebcams` and lib/webcams/fetch.ts's
 * `fetchWebcamSample`) call this, so `WindyRegion.pages` cannot be honoured on
 * one path and ignored on the other.
 */
export function planPageJobs(
  regions: readonly WindyRegion[],
  defaultPages: number,
  limit: number,
): WindyPageJob[] {
  const jobs: WindyPageJob[] = [];
  for (const region of regions) {
    const pages = Math.max(0, Math.trunc(region.pages ?? defaultPages));
    for (let p = 0; p < pages; p++) {
      jobs.push({ region: region.name, bbox: region.bbox, offset: p * limit });
    }
  }
  return jobs;
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

function headers(apiKey: string): HeadersInit {
  return {
    "x-windy-api-key": apiKey,
    Accept: "application/json",
    "User-Agent": "TrafficNerd/2.0 (+https://github.com/011-sam-110/TrafficNerd-V2)",
  };
}

async function fetchPage(apiKey: string, bbox: [number, number, number, number], offset: number): Promise<WindyWebcam[]> {
  const url = `${BASE}?bbox=${bbox.join(",")}&limit=${LIMIT}&offset=${offset}&include=${INCLUDE}&lang=en`;
  const res = await fetch(url, { headers: headers(apiKey), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Windy webcams ${bbox.join(",")}@${offset}: ${res.status}`);
  const json = (await res.json()) as WindyListResponse;
  return json.webcams ?? [];
}

/**
 * Fetch a global sample of webcams (region bbox fan-out, deduped by id). Returns
 * [] — never throws — when no key is configured (the layer stays dormant). A
 * single failing region degrades gracefully (Promise.allSettled per page).
 *
 * TRUNCATION HONESTY: the MAX_WEBCAMS cap below used to trim the merged sample
 * silently, so a caller printing `webcams.length` had no way to know it was a
 * ceiling rather than a count of everything the region fan-out found. The
 * returned array now carries a `lib/signals/coverage.ts` record (applyCap /
 * carryCoverage — the repo's existing truncation-disclosure contract, reused
 * here rather than inventing a parallel one) so `readCoverage(result)` reports
 * the true deduped total and whether the cap actually bit.
 *
 * NOT YET WIRED IN: this function has no live caller today — /api/webcams goes
 * through lib/webcams/fetch.ts's fetchWebcamSample + lib/webcams/normalize.ts's
 * toWebcams instead, which apply their OWN MAX_WEBCAMS=2000 cap and do not read
 * this coverage record. Those two files are outside this change's ownership;
 * see the handoff note where this function is called from tests/consumers.
 */
export async function fetchWebcams(apiKey: string | undefined = process.env.WINDY_WEBCAMS_API_KEY): Promise<Webcam[]> {
  if (!apiKey) {
    console.warn("[windy] WINDY_WEBCAMS_API_KEY not set — webcams layer is dormant");
    return [];
  }

  const jobs = planPageJobs(WINDY_REGIONS, PAGES_PER_REGION, LIMIT);

  const pages = await mapPool(jobs, REGION_CONCURRENCY, (job) =>
    fetchPage(apiKey, job.bbox, job.offset).catch(() => [] as WindyWebcam[]),
  );

  // Dedupe by webcamId (overlapping bboxes) WITHOUT stopping early, so the true
  // pre-cap total is measured rather than guessed — then applyCap() keeps the
  // first MAX_WEBCAMS and records what that hid.
  const seen = new Set<number>();
  const deduped: WindyWebcam[] = [];
  for (const page of pages) {
    for (const w of page) {
      if (w.webcamId === undefined || seen.has(w.webcamId)) continue;
      seen.add(w.webcamId);
      deduped.push(w);
    }
  }
  const capped = applyCap(deduped, MAX_WEBCAMS, {
    noun: "webcams",
    rule: "first seen across the region fan-out (not ranked)",
  });

  const parsed = WebcamArray.parse(normalizeWindy({ webcams: capped }));
  // normalizeWindy()/WebcamArray.parse() both build fresh arrays, which drop the
  // side-channel coverage record — carry it onto the array we actually return.
  return carryCoverage(capped, parsed);
}

/**
 * Fetch ONE webcam's fresh detail (for the image proxy — its image URL token is
 * short-lived, so the proxy always re-resolves it server-side rather than trust
 * a cached/client URL). Returns null on any failure or missing key.
 */
export async function fetchWebcamById(
  webcamId: string,
  apiKey: string | undefined = process.env.WINDY_WEBCAMS_API_KEY,
): Promise<Webcam | null> {
  if (!apiKey) return null;
  // Accept either the namespaced id ("windy:123") or the raw numeric id.
  const raw = webcamId.startsWith("windy:") ? webcamId.slice("windy:".length) : webcamId;
  if (!/^\d+$/.test(raw)) return null;
  let res: Response;
  try {
    res = await fetch(`${BASE}/${raw}?include=images,location,urls,categories`, {
      headers: headers(apiKey),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  // The detail endpoint returns the webcam object directly (not wrapped).
  const w = (await res.json()) as WindyWebcam;
  return normalizeWindyWebcam(w);
}

/**
 * Every webcam Windy has inside one bounding box, plus Windy's OWN total for that
 * box.
 *
 * WHY THIS EXISTS SEPARATELY FROM fetchWebcams(). The layer above builds a GLOBAL
 * sample by fanning 14 fixed region boxes × 2 pages × 50 rows — an unranked ~2% of
 * the catalogue. Measured 2026-08-15: that sample returns 0 webcams for Madrid,
 * Paris, Barcelona and Amsterdam, while this endpoint returns 528 for Madrid alone
 * (including Puerta del Sol and Plaza Canalejas). A user searching for a city needs
 * the live answer, not our sample of it.
 *
 * `total` is Windy's count for the box, NOT our page size. Reporting the page size
 * as if it were the total is exactly the coverage lie lib/signals/coverage.ts exists
 * to prevent — "12 cameras in Madrid" would be a measurement we never made.
 *
 * Dormant-safe: no key, or any upstream failure, resolves to an empty result with
 * `dormant` set. Never throws, never a 5xx, never invented webcams.
 */
export async function fetchWebcamsInBbox(
  bbox: [number, number, number, number],
  opts: { apiKey?: string; limit?: number; offset?: number } = {},
): Promise<{ webcams: Webcam[]; total: number; dormant: boolean; note: string | null }> {
  const apiKey = opts.apiKey ?? process.env.WINDY_WEBCAMS_API_KEY;
  if (!apiKey) {
    return { webcams: [], total: 0, dormant: true, note: "Live webcam search is switched off — no Windy API key is configured." };
  }

  // The free tier caps `limit` at 50 and `offset` at 1000; asking for more is a 400,
  // not a bigger page.
  const limit = Math.min(LIMIT, Math.max(1, opts.limit ?? LIMIT));
  const offset = Math.min(1000, Math.max(0, opts.offset ?? 0));
  const url = `${BASE}?bbox=${bbox.join(",")}&limit=${limit}&offset=${offset}&include=${INCLUDE}&lang=en`;

  try {
    const res = await fetch(url, { headers: headers(apiKey), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return { webcams: [], total: 0, dormant: false, note: `Windy answered ${res.status} for this area.` };
    }
    const json = (await res.json()) as WindyListResponse;
    const webcams = normalizeWindy(json);
    // Fall back to what we actually received rather than claiming zero: a missing
    // `total` means Windy did not tell us, not that the box is empty.
    const total = typeof json.total === "number" && Number.isFinite(json.total) ? json.total : webcams.length;
    return { webcams, total, dormant: false, note: null };
  } catch {
    return { webcams: [], total: 0, dormant: false, note: "Could not reach Windy for this area." };
  }
}
