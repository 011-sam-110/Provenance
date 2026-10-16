import { Camera, CameraArray } from "@/lib/types";
import { isAllowed } from "@/lib/proxy/allowlist";

// CARS ("Condition Acquisition and Reporting System") — the traveller-information
// platform a pooled group of state DOTs runs together, and the software behind the
// new generation of state 511 sites. ONE adapter, one feed key PER STATE, all keyless.
//
// WHY ONE KEY PER STATE. `registry.ts` keeps last-good per feed key, so a shared
// "cars" key would let one state's outage discard every other state's cameras in the
// same round. Same reasoning as discovered.ts and the two Serbian feeds.
//
// TWO SHAPES. The states on the older stack (MN, IA, IN, KS, CO) answer
// `GET https://{xx}tg.carsprogram.org/cameras_v1/api/cameras` with a bare ARRAY, the
// coordinate in `location.latitude/longitude` and `cameraOwner` as an object. New York
// is on the newer 511x stack: `GET .../cameras/map-features` answers GeoJSON, the
// coordinate in `geometry.coordinates` as [lon, lat], and `cameraOwner` as a string.
// Both were read on 2026-10-16 (NY 2,738 features, MN 1,539, IA 863, IN 749, KS 608,
// CO 1,029).
//
// STILLS ONLY, ON PURPOSE. A view is either a STILL_IMAGE (its `url` is the picture) or
// a video view ("WMP": `url` is an HLS playlist and `videoPreviewUrl` is a still taken
// from it). Every camera here is served as its still. The HLS hosts (state video
// servers, some behind tokens that expire in five minutes) are a separate decision,
// not one to make by accident inside a camera-count change.
//
// THE PICTURE MUST BE ONE OUR PROXY SERVES. A view is used only when its still passes
// `isAllowed`, so this adapter cannot put a pin on the map that opens a 403. That is
// also what drops what we chose not to serve: NYC DOT's 992 stills on nyctmc.org (they
// time out from outside the US, so nobody has seen one load), any TrafficLand relay,
// and the odd third-party still (one Colorado Springs camera).
//
// LICENCE. None of these states publishes a licence or terms for this data that we
// could find; each About page is an accuracy disclaimer. Each row says so in words
// rather than inventing a licence name.

export interface CarsSystem {
  /** Feed key in the registry, and the `source` on every camera. */
  key: string;
  system: string;
  endpoint: string;
  shape: "array" | "geojson";
  /** Fallback region when a camera's state FIPS code is absent or unknown. */
  region: string;
  agency: string;
  license: string;
}

export const CARS_SYSTEMS: CarsSystem[] = [
  {
    key: "cars-ny",
    system: "ny",
    endpoint: "https://api-511x-nysdot.carsprogram.org/cameras/map-features",
    shape: "geojson",
    region: "New York",
    agency: "NYSDOT (511NY)",
    license: "No licence stated by NYSDOT for 511NY camera data",
  },
  {
    key: "cars-mn",
    system: "mn",
    endpoint: "https://mntg.carsprogram.org/cameras_v1/api/cameras",
    shape: "array",
    region: "Minnesota",
    agency: "MnDOT (511MN)",
    license: "No licence stated by MnDOT for 511MN camera data",
  },
  {
    key: "cars-ia",
    system: "ia",
    endpoint: "https://iatg.carsprogram.org/cameras_v1/api/cameras",
    shape: "array",
    region: "Iowa",
    agency: "Iowa DOT (511IA)",
    license: "No licence stated by Iowa DOT for 511IA camera data",
  },
  {
    key: "cars-in",
    system: "in",
    endpoint: "https://intg.carsprogram.org/cameras_v1/api/cameras",
    shape: "array",
    region: "Indiana",
    agency: "INDOT (TrafficWise 511IN)",
    license: "No licence stated by INDOT for 511IN camera data",
  },
  {
    key: "cars-ks",
    system: "ks",
    endpoint: "https://kstg.carsprogram.org/cameras_v1/api/cameras",
    shape: "array",
    region: "Kansas",
    agency: "KDOT and KC Scout (KanDrive)",
    license: "No licence stated by KDOT for KanDrive camera data",
  },
  {
    key: "cars-co",
    system: "co",
    endpoint: "https://cotg.carsprogram.org/cameras_v1/api/cameras",
    shape: "array",
    region: "Colorado",
    agency: "Colorado DOT (COtrip)",
    license: "No licence stated by CDOT for COtrip camera data",
  },
];

/** CARS stills refresh every one to five minutes; asking more often buys nothing. */
const REFRESH_SECONDS = 120;

/**
 * A still older than this is shown, but not as online. Measured 2026-10-16: most
 * stills are minutes old, a few (one MN camera, some KDOT weather-station stills) are
 * one to two days old, and calling those "live" would be the false claim.
 */
export const STALE_STILL_MS = 24 * 60 * 60 * 1000;

/**
 * US state FIPS code -> name. A KanDrive camera can stand in Missouri (KC Scout runs
 * both sides of Kansas City), so the region comes from the camera's own `fips` rather
 * than from the system that published it.
 */
const STATE_FIPS: Record<number, string> = {
  1: "Alabama", 2: "Alaska", 4: "Arizona", 5: "Arkansas", 6: "California", 8: "Colorado",
  9: "Connecticut", 10: "Delaware", 11: "District of Columbia", 12: "Florida", 13: "Georgia",
  15: "Hawaii", 16: "Idaho", 17: "Illinois", 18: "Indiana", 19: "Iowa", 20: "Kansas",
  21: "Kentucky", 22: "Louisiana", 23: "Maine", 24: "Maryland", 25: "Massachusetts",
  26: "Michigan", 27: "Minnesota", 28: "Mississippi", 29: "Missouri", 30: "Montana",
  31: "Nebraska", 32: "Nevada", 33: "New Hampshire", 34: "New Jersey", 35: "New Mexico",
  36: "New York", 37: "North Carolina", 38: "North Dakota", 39: "Ohio", 40: "Oklahoma",
  41: "Oregon", 42: "Pennsylvania", 44: "Rhode Island", 45: "South Carolina",
  46: "South Dakota", 47: "Tennessee", 48: "Texas", 49: "Utah", 50: "Vermont",
  51: "Virginia", 53: "Washington", 54: "West Virginia", 55: "Wisconsin", 56: "Wyoming",
};

export interface CarsView {
  name?: string;
  type?: string;
  url?: string;
  videoPreviewUrl?: string;
  imageTimestamp?: number;
  broken?: boolean;
}

export interface CarsCamera {
  id?: number | string;
  public?: boolean;
  active?: boolean;
  name?: string;
  location?: {
    fips?: number;
    latitude?: number;
    longitude?: number;
    routeId?: string;
    cityReference?: string;
  };
  views?: CarsView[];
}

export interface CarsFeature {
  geometry?: { coordinates?: [number, number] } | null;
  properties?: CarsCamera & { route?: string };
}

/** The still a view offers: the picture itself for a still, the preview for video. */
export function viewStill(v: CarsView): string | undefined {
  const raw = v.type === "STILL_IMAGE" ? v.url : v.videoPreviewUrl;
  const u = raw?.trim();
  return u ? u : undefined;
}

/** The first view whose still our proxy serves. Pure. */
export function pickView(views: CarsView[] | undefined): { view: CarsView; imageUrl: string } | null {
  for (const view of views ?? []) {
    if (view.broken === true) continue;
    const imageUrl = viewStill(view);
    if (!imageUrl) continue;
    let url: URL;
    try {
      url = new URL(imageUrl);
    } catch {
      continue;
    }
    if (url.protocol === "https:" && isAllowed(url)) return { view, imageUrl };
  }
  return null;
}

/** One camera from either shape, with its coordinate already resolved. Pure. */
function toCamera(
  c: CarsCamera,
  lat: number,
  lon: number,
  road: string | undefined,
  system: CarsSystem,
  now: number,
): Camera | null {
  if (c.public === false) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (lat === 0 && lon === 0) return null;
  // Every CARS state is west of Greenwich. A positive longitude is an upstream sign
  // slip (one NY portable camera and one INDOT camera on 2026-10-16, both pinned in
  // Asia), so the row is dropped; flipping the sign would be a guess about the place.
  if (lon >= 0) return null;
  const nativeId = (c.id ?? "").toString().trim();
  if (!nativeId) return null;
  const picked = pickView(c.views);
  if (!picked) return null;
  const ts = picked.view.imageTimestamp;
  const stale = typeof ts === "number" && now - ts > STALE_STILL_MS;
  const fips = c.location?.fips;
  return {
    id: `${system.key}:${nativeId}`,
    source: system.key,
    country: "US",
    region: (fips !== undefined && STATE_FIPS[fips]) || system.region,
    name: c.name?.trim() || picked.view.name?.trim() || `${system.region} camera ${nativeId}`,
    lat,
    lon,
    road: road?.trim() || undefined,
    imageUrl: picked.imageUrl,
    mediaType: "jpeg",
    refreshSeconds: REFRESH_SECONDS,
    license: system.license,
    attribution: `Live traffic camera data © ${system.agency}`,
    available: c.active !== false && !stale,
  };
}

/** The array shape (MN, IA, IN, KS, CO). Pure; `now` dates the stills. */
export function normalizeCarsArray(rows: CarsCamera[], system: CarsSystem, now: number): Camera[] {
  const out: Camera[] = [];
  for (const c of rows ?? []) {
    const cam = toCamera(
      c,
      Number(c.location?.latitude),
      Number(c.location?.longitude),
      c.location?.routeId,
      system,
      now,
    );
    if (cam) out.push(cam);
  }
  return out;
}

/** The GeoJSON shape (NY). Coordinates are [lon, lat]. Pure; `now` dates the stills. */
export function normalizeCarsGeojson(
  body: { features?: CarsFeature[] },
  system: CarsSystem,
  now: number,
): Camera[] {
  const out: Camera[] = [];
  for (const f of body.features ?? []) {
    const p = f.properties ?? {};
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    const cam = toCamera(p, Number(coords[1]), Number(coords[0]), p.location?.routeId ?? p.route, system, now);
    if (cam) out.push(cam);
  }
  return out;
}

/** Fetch one state. Throws on a failed or misshapen answer, so the registry keeps last-good. */
export async function fetchCarsSystem(system: CarsSystem): Promise<Camera[]> {
  const res = await fetch(system.endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TrafficNerd/2.0 (+https://github.com/011-sam-110/Provenance)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`CARS ${system.system}: ${res.status}`);
  const body = (await res.json()) as unknown;
  const now = Date.now();
  if (system.shape === "geojson") {
    if (!body || typeof body !== "object" || !Array.isArray((body as { features?: unknown }).features)) {
      throw new Error(`CARS ${system.system}: not GeoJSON`);
    }
    return CameraArray.parse(normalizeCarsGeojson(body as { features: CarsFeature[] }, system, now));
  }
  if (!Array.isArray(body)) throw new Error(`CARS ${system.system}: not an array`);
  return CameraArray.parse(normalizeCarsArray(body as CarsCamera[], system, now));
}

/** One `CameraFeed`-shaped entry per state, for `registry.ts`. */
export function carsCameraFeeds(): Array<{ key: string; fetch: () => Promise<Camera[]> }> {
  return CARS_SYSTEMS.map((system) => ({ key: system.key, fetch: () => fetchCarsSystem(system) }));
}
