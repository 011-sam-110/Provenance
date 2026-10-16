import { Camera, CameraArray, Source } from "@/lib/types";

// Washington State DOT. Keyless: the camera list the WSDOT travel-centre map loads,
// an ESRI FeatureSet of 1,706 cameras (read 2026-10-16). WSDOT's documented REST API
// needs an AccessCode; this file does not, and it is the operator's own.
//
// THREE TRAPS, each measured.
// 1. The geometry is Web Mercator METRES (wkid 102100 / 3857), and there are no
//    degree attributes beside it the way TripCheck has. So x/y are converted here,
//    by `mercatorToLonLat`, and a test pins one camera to the place its title names.
// 2. The file is Windows-1252, not UTF-8: one title carries byte 0x96 (an en dash),
//    which a strict UTF-8 `res.json()` rejects, failing the whole feed for one
//    character. It is decoded as windows-1252 (`decodeWsdot`).
// 3. Not every row is WSDOT's. 63 + 2 point at Oregon's TripCheck, which the
//    `tripcheck` feed already serves (re-serving them would double-count), and 8 at
//    third parties (Seattle DOT, an airport, a lodge, the NPS). Only stills on
//    images.wsdot.wa.gov are kept: 1,631 of the 1,706.

export const WSDOT_SOURCE: Source = {
  id: "wsdot",
  name: "WSDOT traffic cameras (Washington State DOT)",
  license: "No licence stated by WSDOT for its traffic camera data",
  attribution: "Live traffic camera data © Washington State DOT",
  refreshSeconds: 120,
  needsKey: false,
};

export const WSDOT_ENDPOINT = "https://data.wsdot.wa.gov/travelcenter/Cameras.json";
const IMAGE_HOST = "images.wsdot.wa.gov";
const EARTH_RADIUS_M = 6378137;

export interface WsdotFeature {
  attributes?: {
    CameraID?: number | string;
    CompassDirection?: string | null;
    CameraTitle?: string | null;
    ImageURL?: string | null;
  } | null;
  geometry?: { x?: number; y?: number } | null;
}

/** Web Mercator metres -> WGS84 degrees. Pure. */
export function mercatorToLonLat(x: number, y: number): { lon: number; lat: number } {
  const lon = (x / EARTH_RADIUS_M) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) * (180 / Math.PI);
  return { lon, lat };
}

/** The upstream bytes as JSON. The file is windows-1252 (see trap 2). Pure. */
export function decodeWsdot(bytes: ArrayBuffer | Uint8Array): unknown {
  return JSON.parse(new TextDecoder("windows-1252").decode(bytes));
}

const COMPASS: Record<string, string> = { N: "North", S: "South", E: "East", W: "West" };

/** "I-5 at MP 3.2: Main St" -> "I-5"; "SR 167 at ..." -> "SR 167". Undefined if none. */
export function roadFromTitle(title: string): string | undefined {
  const m = title.match(/^((?:I|SR|US)[- ]?\d+[A-Z]?)\b/);
  return m ? m[1] : undefined;
}

export function normalizeWsdot(featureset: { features?: WsdotFeature[] }): Camera[] {
  const cams: Camera[] = [];
  for (const f of featureset.features ?? []) {
    const a = f.attributes ?? {};
    const raw = a.ImageURL?.trim();
    if (!raw) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.hostname !== IMAGE_HOST) continue; // TripCheck duplicates and third parties
    url.protocol = "https:";
    const x = Number(f.geometry?.x);
    const y = Number(f.geometry?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const { lon, lat } = mercatorToLonLat(x, y);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue;
    const nativeId = (a.CameraID ?? "").toString().trim();
    if (!nativeId) continue;
    const title = a.CameraTitle?.trim() || "";
    cams.push({
      id: `wsdot:${nativeId}`,
      source: "wsdot",
      country: "US",
      region: "Washington",
      name: title || `WSDOT camera ${nativeId}`,
      lat,
      lon,
      road: roadFromTitle(title),
      direction: COMPASS[a.CompassDirection?.trim() ?? ""],
      imageUrl: url.toString(),
      mediaType: "jpeg",
      refreshSeconds: WSDOT_SOURCE.refreshSeconds,
      license: WSDOT_SOURCE.license,
      attribution: WSDOT_SOURCE.attribution,
      // The file carries no status field; a listed camera is a published one.
      available: true,
    });
  }
  return cams;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const res = await fetch(WSDOT_ENDPOINT, {
    headers: { Accept: "application/json", "User-Agent": "TrafficNerd/2.0 (+https://github.com/011-sam-110/Provenance)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`WSDOT cameras: ${res.status}`);
  const json = decodeWsdot(await res.arrayBuffer()) as { features?: WsdotFeature[] };
  if (!Array.isArray(json?.features)) throw new Error("WSDOT cameras: not a FeatureSet");
  return CameraArray.parse(normalizeWsdot(json));
}
