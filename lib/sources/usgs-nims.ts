import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, fetchJson, frameFresh, num, validLatLon } from "@/lib/sources/feedKit";

// United States — US Geological Survey streamgage cameras (NIMS / HIVIS). One keyless
// GET of the documented NIMS API lists every camera with its coordinates, its NWIS
// site, a name and the time of its newest image; the image is `overlayDir + camId +
// "_newest.jpg"` on the agency's S3 bucket. Measured 2026-10-16: 1,375 cameras, 1,118
// not hidden, 864 updated within the hour.
//
// LIVENESS: `newestImageDT`. Many gauges post every 15 to 60 minutes, so the age rule
// here is two hours, not one, as the audit recommended.
//
// Licence: US Government work in the public domain (the NIMS OpenAPI info.license).

const ENDPOINT = "https://api.waterdata.usgs.gov/nims/v0/cameras";
const IMAGE_PREFIX = "https://usgs-nims-images.s3.amazonaws.com/overlay/";
export const NIMS_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export const USGS_NIMS_SOURCE: Source = {
  id: "usgs-nims",
  name: "US Geological Survey — streamgage cameras (NIMS)",
  license: "US Government work, public domain (USGS)",
  attribution: "Streamgage camera images: U.S. Geological Survey",
  refreshSeconds: 900,
  needsKey: false,
};

export interface NimsCamera {
  camId?: string;
  nwisId?: string;
  camName?: string;
  stateAbrv?: string;
  lat?: string | number;
  lng?: string | number;
  newestImageDT?: string;
  hideCam?: boolean;
  overlayDir?: string;
}

export function normalizeNims(rows: readonly NimsCamera[], now: number = Date.now()): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.hideCam === true) continue;
    const camId = clean(r.camId);
    const name = clean(r.camName);
    const dir = clean(r.overlayDir);
    const lat = num(r.lat);
    const lon = num(r.lng);
    if (!camId || !name || !dir || !validLatLon(lat, lon) || seen.has(camId)) continue;
    if (!dir.startsWith(IMAGE_PREFIX) || !/^[A-Za-z0-9_.-]+$/.test(camId)) continue;
    seen.add(camId);
    const frameAt = r.newestImageDT ? Date.parse(r.newestImageDT) : NaN;
    out.push({
      id: `usgs-nims:${camId}`,
      source: "usgs-nims",
      country: "US",
      region: clean(r.stateAbrv) ?? "United States",
      name,
      lat,
      lon,
      road: r.nwisId ? `USGS site ${r.nwisId}` : undefined,
      imageUrl: `${dir.endsWith("/") ? dir : dir + "/"}${camId}_newest.jpg`,
      mediaType: "jpeg",
      refreshSeconds: USGS_NIMS_SOURCE.refreshSeconds,
      license: USGS_NIMS_SOURCE.license,
      attribution: USGS_NIMS_SOURCE.attribution,
      available: frameFresh(Number.isFinite(frameAt) ? frameAt : null, now, NIMS_MAX_AGE_MS),
      ...(Number.isFinite(frameAt) ? { lastSampledAt: new Date(frameAt).toISOString() } : {}),
    });
  }
  return out;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const rows = await fetchJson<NimsCamera[]>(ENDPOINT, { timeoutMs: 9_000 });
  return CameraArray.parse(normalizeNims(Array.isArray(rows) ? rows : []));
}
