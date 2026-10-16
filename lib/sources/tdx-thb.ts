import { Camera, CameraArray, Source } from "@/lib/types";
import { COMPATIBLE_UA, clean, fetchJson, validLatLon } from "@/lib/sources/feedKit";

// Taiwan — Highway Bureau (THB), MOTC: the provincial-highway CCTV, through TDX, the
// ministry's own transport data platform. Keyless. Measured 2026-10-16: 2,396 cameras,
// 2,348 with a JPEG snapshot on one of eight cctv-ss0N.thb.gov.tw hosts, each with
// coordinates, road and a Chinese description of the section.
//
// QUOTA. TDX's anonymous quota is reported as 50 calls per day per IP, and the list
// itself says it changes every six hours (UpdateInterval 21600). So the list is read
// at most once every six hours and held in memory; between reads the registry serves
// the held copy. A failed read keeps the held copy.
//
// LIVENESS. The snapshot hosts send no Last-Modified and answer HEAD with 404 (GET
// works), so there is nothing to date a frame by from here; the frame carries a
// burned-in clock. The list is trusted.
//
// The national freeways (NFB) are on TDX too, but only as MJPEG streams, which this
// map has no player for; they are not built.
//
// Licence: Open Government Data License, version 1.0 (data.gov.tw MOTC CCTV listings).

const ENDPOINT = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Highway?$format=JSON";
const LIST_TTL_MS = 6 * 60 * 60 * 1000;

export const TDX_THB_SOURCE: Source = {
  id: "tdx-thb",
  name: "Highway Bureau, MOTC (Taiwan) via TDX",
  license: "Open Government Data License, version 1.0 (Taiwan)",
  attribution: "CCTV snapshots © Highway Bureau, MOTC (Taiwan), via TDX",
  refreshSeconds: 120,
  needsKey: false,
};

export interface TdxCctv {
  CCTVID?: string;
  VideoImageURL?: string;
  PositionLon?: number;
  PositionLat?: number;
  SurveillanceDescription?: string;
  RoadName?: string;
  RoadDirection?: string;
  LocationMile?: string;
}

/** The snapshot URL with its explicit :443 normalised away, or null if not a THB host. */
export function thbSnapshot(raw: string | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !/^cctv-ss0[1-9]\.thb\.gov\.tw$/.test(u.hostname) || u.port !== "") return null;
  if (!u.pathname.endsWith("/snapshot")) return null;
  return u.toString();
}

export function normalizeTdxThb(body: { CCTVs?: TdxCctv[] }): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const c of body.CCTVs ?? []) {
    const id = clean(c.CCTVID);
    const lat = c.PositionLat;
    const lon = c.PositionLon;
    const image = thbSnapshot(c.VideoImageURL);
    const desc = clean(c.SurveillanceDescription);
    const road = clean(c.RoadName);
    if (!id || !image || !validLatLon(lat, lon) || seen.has(id)) continue;
    const name = desc ?? (road && c.LocationMile ? `${road} ${c.LocationMile}` : undefined);
    if (!name) continue;
    seen.add(id);
    out.push({
      id: `tdx-thb:${id}`,
      source: "tdx-thb",
      country: "TW",
      region: "Taiwan",
      name,
      lat,
      lon: lon as number,
      road: road ? (c.LocationMile ? `${road} ${c.LocationMile}` : road) : undefined,
      direction: clean(c.RoadDirection),
      imageUrl: image,
      mediaType: "jpeg",
      refreshSeconds: TDX_THB_SOURCE.refreshSeconds,
      license: TDX_THB_SOURCE.license,
      attribution: TDX_THB_SOURCE.attribution,
      available: true,
    });
  }
  return out;
}

let held: { at: number; cameras: Camera[] } | null = null;
let lastFailure = 0;
/** After a failed read, wait this long before asking again, so outages do not spend the quota. */
const RETRY_AFTER_MS = 30 * 60 * 1000;

export async function fetchRegistry(): Promise<Camera[]> {
  if (held && Date.now() - held.at < LIST_TTL_MS) return held.cameras;
  if (Date.now() - lastFailure < RETRY_AFTER_MS) {
    if (held) return held.cameras;
    throw new Error("TDX: backing off after a failed read, to spare the anonymous quota");
  }
  try {
    const cameras = CameraArray.parse(normalizeTdxThb(
        // TDX's anonymous tier refuses a non-browser agent with 401; see COMPATIBLE_UA.
        await fetchJson(ENDPOINT, { timeoutMs: 9_000, headers: { "User-Agent": COMPATIBLE_UA } }),
      ));
    if (cameras.length) held = { at: Date.now(), cameras };
    return cameras.length ? cameras : (held?.cameras ?? []);
  } catch (e) {
    lastFailure = Date.now();
    if (held) return held.cameras;
    throw e;
  }
}
