import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, fetchJson, frameFresh, validLatLon } from "@/lib/sources/feedKit";

// Alaska — Alaska Volcano Observatory (USGS, University of Alaska Fairbanks and the
// Alaska Division of Geological & Geophysical Surveys), its documented Ashcam API.
// Keyless. Measured 2026-10-16: 398 webcams, of which 235 are FAA weather cameras
// AVO mirrors (`faaInd: "Y"`). Those belong to the FAA, so they are left out here:
// only AVO's own 163 cameras are served, 62 of them with an image in the last day.
//
// LIVENESS: `lastImageTimestamp` (epoch seconds). Many AVO cameras post hourly or
// less often, so the age rule is two hours.
//
// Licence: none is stated by the Ashcam API; recorded as such.

const ENDPOINT = "https://avo.alaska.edu/ashcam-api/webcamApi/webcams";
const IMAGE_PREFIX = "https://avo.alaska.edu/ashcam-api/images/";
export const AVO_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export const AVO_SOURCE: Source = {
  id: "avo",
  name: "Alaska Volcano Observatory — Ashcam",
  license: "Alaska Volcano Observatory (USGS/UAF/ADGGS) — no stated licence",
  attribution: "Webcam images: Alaska Volcano Observatory (USGS, UAF Geophysical Institute, ADGGS)",
  refreshSeconds: 600,
  needsKey: false,
};

export interface AvoWebcam {
  webcamCode?: string;
  webcamName?: string;
  latitude?: number;
  longitude?: number;
  bearingDeg?: number | null;
  faaInd?: string;
  isPublic?: string | boolean;
  vName?: string;
  lastImageTimestamp?: number | null;
  currentImageUrl?: string;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function normalizeAvo(body: { webcams?: AvoWebcam[] }, now: number = Date.now()): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const w of body.webcams ?? []) {
    if (w.faaInd === "Y") continue; // the FAA's camera, mirrored: not AVO's to credit
    if (w.isPublic === "N" || w.isPublic === false) continue;
    const code = clean(w.webcamCode);
    const name = clean(w.webcamName);
    const image = clean(w.currentImageUrl);
    if (!code || !name || !image || !image.startsWith(IMAGE_PREFIX) || seen.has(code)) continue;
    if (!validLatLon(w.latitude, w.longitude)) continue;
    seen.add(code);
    const frameAt =
      typeof w.lastImageTimestamp === "number" && Number.isFinite(w.lastImageTimestamp) ? w.lastImageTimestamp * 1000 : null;
    const b = typeof w.bearingDeg === "number" && Number.isFinite(w.bearingDeg) ? w.bearingDeg : null;
    const volcano = clean(w.vName);
    out.push({
      id: `avo:${code}`,
      source: "avo",
      country: "US",
      region: volcano ? `${volcano} (Alaska)` : "Alaska",
      name,
      lat: w.latitude as number,
      lon: w.longitude as number,
      direction: b !== null ? `looking ${COMPASS[Math.round((((b % 360) + 360) % 360) / 45) % 8]}` : undefined,
      imageUrl: image,
      mediaType: "jpeg",
      refreshSeconds: AVO_SOURCE.refreshSeconds,
      license: AVO_SOURCE.license,
      attribution: AVO_SOURCE.attribution,
      available: frameFresh(frameAt, now, AVO_MAX_AGE_MS),
      ...(frameAt !== null ? { lastSampledAt: new Date(frameAt).toISOString() } : {}),
    });
  }
  return out;
}

export async function fetchRegistry(): Promise<Camera[]> {
  return CameraArray.parse(normalizeAvo(await fetchJson(ENDPOINT, { timeoutMs: 9_000 })));
}
