import { Camera, CameraArray, Source } from "@/lib/types";
import { humaniseOperatorCode, type SurfaceReading } from "@/lib/cameras/surface";

// Estonia — Tark Tee (Transpordiamet / Estonian Transport Administration) national
// road-weather cameras (~180, highway + rural). Keyless. We query the ArcGIS
// `tram/road_cameras` layer (the root layer is frozen/stale) with `outSR=4326`, so
// geometry comes back as plain WGS84: `geometry.x`=longitude, `geometry.y`=latitude.
// THE GOTCHA: the snapshot `image_path` embeds a fresh timestamp on every update
// (`94/94_202606270441.jpg`), so we rebuild `imageUrl` on each registry refresh
// rather than caching a path that will 404 — image host is
// https://tarktee.transpordiamet.ee/images/{image_path}.

const QUERY_URL =
  "https://tarktee.transpordiamet.ee/tarktee/rest/services/tram/road_cameras/MapServer/0/query?where=1=1&outFields=*&outSR=4326&f=json";
const IMAGE_ORIGIN = "https://tarktee.transpordiamet.ee/images";

export const ESTONIA_SOURCE: Source = {
  id: "estonia",
  name: "Tark Tee (Estonian Transport Administration)",
  license: "Transpordiamet (Tark Tee) — Open Data Terms of Use",
  attribution:
    "Live road-camera data © Transpordiamet (Estonian Transport Administration) / Tark Tee",
  refreshSeconds: 300, // road-weather cams update slowly
  needsKey: false,
};

export interface EstoniaFeature {
  attributes?: {
    objectid?: number | string;
    site_name?: string;
    weather_station_id?: number | string;
    image_path?: string | null; // timestamped, changes each update
    image_time?: number;
    // ── Road-weather, already on the wire ────────────────────────────────────
    // `outFields=*` above has always returned these; we simply never read them.
    // Tark Tee pairs each camera with a road-weather station and publishes the
    // station's name, its distance in km, and the surface state it is reporting.
    // That makes Estonia the only network here that hands us a measured road
    // surface with no extra request and no join of our own devising.
    closest_weather_station?: string | null;
    distance?: number | null; // km, camera → station, per the operator
    air_temp?: number | null;
    road_temp?: number | null;
    /** The operator's own surface state: DRY / MOIST / WET, or null for no reading. */
    road_status?: string | null;
    /** The operator's verdict ON the reading: OK, COLD_WET_SURFACE, OVER_2_HOURS.
     *  OVER_2_HOURS is Tark Tee telling us the value is too old to use. */
    road_status_aggregate?: string | null;
    weather_time?: number; // epoch ms — when the STATION read, not when we fetched
  } | null;
  geometry?: { x?: number; y?: number } | null; // outSR=4326 → x=lon, y=lat
}

/**
 * The surface reading for one Tark Tee camera, or undefined when it has none.
 *
 * Deliberately does not judge: a stale or distant reading still comes back here with
 * the operator's flag and distance attached, and `surfaceValidity` decides whether it
 * may be shown. Discarding it at this layer would throw away the reason.
 *
 * `road_status` is null on 10 of the 180 cameras (measured 2026-09-03). That means no
 * reading, so we emit nothing at all — "unknown" is a claim we have not earned.
 */
export function normalizeEstoniaSurface(
  a: NonNullable<EstoniaFeature["attributes"]>,
): SurfaceReading | undefined {
  const raw = (a.road_status ?? "").trim();
  if (!raw) return undefined;

  const reading: SurfaceReading = { state: humaniseOperatorCode(raw) };

  if (Number.isFinite(a.road_temp as number)) reading.roadTempC = a.road_temp as number;
  if (Number.isFinite(a.air_temp as number)) reading.airTempC = a.air_temp as number;
  if (Number.isFinite(a.distance as number)) reading.km = a.distance as number;
  if (Number.isFinite(a.weather_time as number)) reading.observedAt = a.weather_time as number;

  const station = (a.closest_weather_station ?? "").trim();
  if (station) reading.station = station;

  // `OK` is the operator saying the reading is fine, so it is not a flag. Anything
  // else is the operator qualifying its own value and we carry it through verbatim
  // rather than deciding which qualifications matter.
  const agg = (a.road_status_aggregate ?? "").trim();
  if (agg && agg.toUpperCase() !== "OK") reading.operatorFlag = agg;

  return reading;
}

export function normalizeEstonia(featureset: { features?: EstoniaFeature[] }): Camera[] {
  const cams: Camera[] = [];
  for (const f of featureset.features ?? []) {
    const a = f.attributes ?? {};
    // outSR=4326 → geometry is plain WGS84 degrees: x = longitude, y = latitude.
    const lon = Number(f.geometry?.x);
    const lat = Number(f.geometry?.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue; // null-island guard
    const path = a.image_path?.trim();
    if (!path) continue;
    const nativeId = (a.objectid ?? a.weather_station_id ?? "").toString().trim();
    if (!nativeId) continue;
    const surface = normalizeEstoniaSurface(a);
    cams.push({
      id: `estonia:${nativeId}`,
      source: "estonia",
      country: "EE",
      region: "Estonia",
      name: a.site_name?.trim() || `Tark Tee ${nativeId}`,
      lat,
      lon,
      // image_path is timestamped → rebuilt every refresh (never cache the path).
      imageUrl: `${IMAGE_ORIGIN}/${path.replace(/^\/+/, "")}`,
      mediaType: "jpeg",
      refreshSeconds: ESTONIA_SOURCE.refreshSeconds,
      license: ESTONIA_SOURCE.license,
      attribution: ESTONIA_SOURCE.attribution,
      available: true,
      // image_time is the operator's own stamp on THIS frame, so Estonian cameras can
      // say "shot 3m ago" rather than "we pulled it 3m ago" — a different claim.
      ...(Number.isFinite(a.image_time as number)
        ? { lastSampledAt: new Date(a.image_time as number).toISOString() }
        : {}),
      ...(surface ? { surface } : {}),
    });
  }
  return cams;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const res = await fetch(QUERY_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Tark Tee cameras: ${res.status}`);
  const json = (await res.json()) as { features?: EstoniaFeature[] };
  return CameraArray.parse(normalizeEstonia(json));
}
