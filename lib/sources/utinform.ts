import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, fetchJson, frameFresh, validLatLon } from "@/lib/sources/feedKit";

// Hungary — Magyar Közút Nonprofit Zrt., the state road operator, through its own
// traffic portal Útinform. One keyless GET returns every camera place with the
// operator's own coordinates, and per camera a view direction and the time of its
// last image. Measured 2026-10-16: 352 places, 640 cameras, 611 of them with a frame
// under an hour old (median 3.7 minutes).
//
// Images are on cdnuiwebcams.utinform.hu as {placeId}_{cameraNum}.jpg and are served
// as application/octet-stream; /api/proxy already labels a non-image content type
// as image/jpeg.
//
// LIVENESS: `lastImage` against the usual 60-minute rule (the site's own rule is 15).
// LICENCE: there is no open licence. Útinform's legal notice (sections 8 and 14) bars
// use for direct profit or commercial purposes; it does not bar non-commercial
// display. The licence string says exactly that.

const ENDPOINT = "https://www.utinform.hu/api/public/webcam/all";

export const UTINFORM_SOURCE: Source = {
  id: "utinform-hu",
  name: "Magyar Közút — Útinform webcams (Hungary)",
  license: "Magyar Közút Nonprofit Zrt. — Útinform public webcams (no open licence; terms bar commercial use)",
  attribution: "Road-camera images © Magyar Közút Nonprofit Zrt. (Útinform)",
  refreshSeconds: 300,
  needsKey: false,
};

export interface UtinformWebcam {
  cameraPlaceId?: string;
  cameraNum?: number;
  cameraView?: string;
  published?: boolean;
  lastImage?: number;
}

export interface UtinformPlace {
  geometry?: { coordinates?: [number, number] } | null;
  properties?: {
    id?: string;
    placeName?: string;
    roadNumber?: string;
    county?: string;
    published?: boolean;
    active?: boolean;
    webcams?: UtinformWebcam[];
  };
}

export function utinformImageUrl(placeId: string, cameraNum: number): string {
  return `https://cdnuiwebcams.utinform.hu/webcamimages/${encodeURIComponent(placeId)}_${cameraNum}.jpg`;
}

export function normalizeUtinform(body: { features?: UtinformPlace[] }, now: number = Date.now()): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const f of body.features ?? []) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!validLatLon(lat, lon)) continue;
    const place = clean(p.placeName);
    if (!place || p.published === false) continue;
    for (const w of p.webcams ?? []) {
      const placeId = clean(w.cameraPlaceId) ?? clean(p.id);
      const n = w.cameraNum;
      if (!placeId || typeof n !== "number" || !Number.isInteger(n) || w.published === false) continue;
      const id = `${placeId}_${n}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const frameAt = typeof w.lastImage === "number" && Number.isFinite(w.lastImage) ? w.lastImage : null;
      const view = clean(w.cameraView);
      out.push({
        id: `utinform-hu:${id}`,
        source: "utinform-hu",
        country: "HU",
        region: clean(p.county) ?? "Hungary",
        name: place,
        lat,
        lon: lon as number,
        road: clean(p.roadNumber),
        direction: view ? `towards ${view}` : undefined,
        imageUrl: utinformImageUrl(placeId, n),
        mediaType: "jpeg",
        refreshSeconds: UTINFORM_SOURCE.refreshSeconds,
        license: UTINFORM_SOURCE.license,
        attribution: UTINFORM_SOURCE.attribution,
        available: p.active !== false && frameFresh(frameAt, now),
        ...(frameAt !== null ? { lastSampledAt: new Date(frameAt).toISOString() } : {}),
      });
    }
  }
  return out;
}

export async function fetchRegistry(): Promise<Camera[]> {
  return CameraArray.parse(normalizeUtinform(await fetchJson(ENDPOINT, { timeoutMs: 9_000 })));
}
