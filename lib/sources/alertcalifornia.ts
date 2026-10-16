import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, fetchJson, frameFresh, validLatLon } from "@/lib/sources/feedKit";

// California — ALERTCalifornia, the wildfire camera network run by UC San Diego with
// CAL FIRE (many cameras are sponsored by utilities, but ALERTCalifornia operates and
// publishes them). One keyless GeoJSON list; the image is
// cameras.alertcalifornia.org/public-camera-data/{id}/latest-frame.jpg. Measured
// 2026-10-16: 2,283 features, 1,316 with coordinates, 1,257 with a frame under an
// hour old. A feature with no coordinates has no honest place on a map and is skipped.
//
// LIVENESS: `last_frame_ts` (epoch seconds) against the usual 60-minute rule.
// LICENCE: ALERTCalifornia's FAQ makes the imagery available to the public for
// NON-COMMERCIAL use with the credit "ALERTCalifornia | UC San Diego"; the string
// says so, word for word where it matters.

const ENDPOINT = "https://cameras.alertcalifornia.org/public-camera-data/all_cameras-v3.json";
const IMAGE = (id: string) =>
  `https://cameras.alertcalifornia.org/public-camera-data/${encodeURIComponent(id)}/latest-frame.jpg`;

export const ALERTCALIFORNIA_SOURCE: Source = {
  id: "alertcalifornia",
  name: "ALERTCalifornia (UC San Diego with CAL FIRE)",
  license: "ALERTCalifornia: public non-commercial use with credit",
  attribution: "ALERTCalifornia | UC San Diego",
  refreshSeconds: 120,
  needsKey: false,
};

export interface AlertCaFeature {
  geometry?: { coordinates?: (number | null)[] } | null;
  properties?: {
    id?: string;
    name?: string;
    last_frame_ts?: number | null;
    state?: string;
    county?: string;
    az_current?: number | null;
  };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function normalizeAlertCa(body: { features?: AlertCaFeature[] }, now: number = Date.now()): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const f of body.features ?? []) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!validLatLon(lat, lon)) continue;
    const id = clean(p.id);
    const name = clean(p.name);
    if (!id || !name || seen.has(id) || !/^[A-Za-z0-9_.-]+$/.test(id)) continue;
    seen.add(id);
    const frameAt = typeof p.last_frame_ts === "number" && Number.isFinite(p.last_frame_ts) ? p.last_frame_ts * 1000 : null;
    const az = typeof p.az_current === "number" && Number.isFinite(p.az_current) ? p.az_current : null;
    const county = clean(p.county);
    out.push({
      id: `alertcalifornia:${id}`,
      source: "alertcalifornia",
      country: "US",
      region: county ? `${county.replace(/\b\w/g, (c) => c.toUpperCase())} County` : (clean(p.state) ?? "California"),
      name,
      lat,
      lon: lon as number,
      // The camera pans, so this is where it pointed when the list was written.
      direction: az !== null ? `looking ${COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8]}` : undefined,
      imageUrl: IMAGE(id),
      mediaType: "jpeg",
      refreshSeconds: ALERTCALIFORNIA_SOURCE.refreshSeconds,
      license: ALERTCALIFORNIA_SOURCE.license,
      attribution: ALERTCALIFORNIA_SOURCE.attribution,
      available: frameFresh(frameAt, now),
      ...(frameAt !== null ? { lastSampledAt: new Date(frameAt).toISOString() } : {}),
    });
  }
  return out;
}

export async function fetchRegistry(): Promise<Camera[]> {
  return CameraArray.parse(normalizeAlertCa(await fetchJson(ENDPOINT, { timeoutMs: 9_000 })));
}
