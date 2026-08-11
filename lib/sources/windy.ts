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
const LIMIT = 50; // free-tier hard cap
const PAGES_PER_REGION = 2; // 2 × 50 = up to 100 webcams/region (offset 0,50)
const REGION_CONCURRENCY = 6; // polite + bounded parallelism across page jobs
const MAX_WEBCAMS = 2000; // safety cap on the merged global sample — disclosed via lib/signals/coverage.ts, not silent

// 73k webcams can't be loaded (and offset is free-tier-capped at 1000), so we
// fan a small bbox query across world regions for a GLOBAL spread, then dedupe.
// bbox is [north, east, south, west].
export interface WindyRegion {
  name: string;
  bbox: [number, number, number, number];
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
  { name: "africa", bbox: [37, 52, -35, -18] },
  { name: "middle-east", bbox: [42, 63, 12, 34] },
  { name: "s-asia", bbox: [37, 92, 5, 60] },
  { name: "e-asia", bbox: [54, 146, 20, 100] },
  { name: "se-asia", bbox: [23, 141, -11, 92] },
  { name: "oceania", bbox: [-9, 180, -48, 110] },
];

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

  const jobs: { bbox: [number, number, number, number]; offset: number }[] = [];
  for (const region of WINDY_REGIONS) {
    for (let p = 0; p < PAGES_PER_REGION; p++) jobs.push({ bbox: region.bbox, offset: p * LIMIT });
  }

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
