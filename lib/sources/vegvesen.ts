import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, fetchJson, validLatLon } from "@/lib/sources/feedKit";

// Norway — Statens vegvesen (Norwegian Public Roads Administration) road cameras.
// One keyless GET of the operator's own GeoServer WFS, layer CctvSimple_v2, already in
// WGS84. Measured 2026-10-16: 899 cameras at 739 sites; 865 "videoOrImagesAvailable"
// and 34 "UnavailableDueToCameraFault". The DATEX node for the same data needs an
// account; this WFS does not.
//
// LIVENESS is the operator's own status field. The image host sends no Last-Modified,
// so there is no header to date a frame by; on the audit sample 11 of 14 stills carried
// an EXIF time under a minute old and the 2 faulted cameras served a 2023 placeholder,
// which is what the status field already says.
//
// Licence: NLOD (Norsk lisens for offentlige data), per dataut.vegvesen.no/en/dataset/webkamera.

const ENDPOINT =
  "https://ogckart-sn1.atlas.vegvesen.no/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=datex_3_1:CctvSimple_v2&outputFormat=application/json&srsName=EPSG:4326";

export const VEGVESEN_SOURCE: Source = {
  id: "vegvesen",
  name: "Statens vegvesen (Norway)",
  license: "NLOD — Norsk lisens for offentlige data (Statens vegvesen)",
  attribution: "Road-camera images © Statens vegvesen",
  refreshSeconds: 300,
  needsKey: false,
};

export interface VegvesenFeature {
  geometry?: { coordinates?: [number, number] } | null;
  properties?: {
    CAMERA_ID?: string;
    DESCRIPTION?: string;
    ORIENTATION_DESCRIPTION?: string;
    STATUS_STILL_IMAGE_AVAILABILITY?: string;
    STILL_IMAGE_URL?: string;
    ROAD_NUMBER?: string;
    LAST_UPDATE_TIME?: string;
  };
}

export function normalizeVegvesen(body: { features?: VegvesenFeature[] }): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const f of body.features ?? []) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!validLatLon(lat, lon)) continue;
    const id = clean(p.CAMERA_ID);
    const name = clean(p.DESCRIPTION);
    const image = clean(p.STILL_IMAGE_URL);
    if (!id || !name || !image || seen.has(id)) continue;
    if (!image.startsWith("https://kamera.atlas.vegvesen.no/")) continue;
    seen.add(id);
    out.push({
      id: `vegvesen:${id}`,
      source: "vegvesen",
      country: "NO",
      region: "Norway",
      name,
      lat,
      lon: lon as number,
      road: clean(p.ROAD_NUMBER),
      direction: clean(p.ORIENTATION_DESCRIPTION),
      imageUrl: image,
      mediaType: "jpeg",
      refreshSeconds: VEGVESEN_SOURCE.refreshSeconds,
      license: VEGVESEN_SOURCE.license,
      attribution: VEGVESEN_SOURCE.attribution,
      // LAST_UPDATE_TIME is when the record was published, not when the frame was
      // taken, so it is deliberately not offered as a frame time.
      available: p.STATUS_STILL_IMAGE_AVAILABILITY === "videoOrImagesAvailable",
    });
  }
  return out;
}

export async function fetchRegistry(): Promise<Camera[]> {
  return CameraArray.parse(normalizeVegvesen(await fetchJson(ENDPOINT, { timeoutMs: 9_000 })));
}
