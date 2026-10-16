import { Camera, CameraArray, Source } from "@/lib/types";
import { fetchRoadWeather } from "@/lib/sources/digitraffic.weather";
import { DIGITRAFFIC_JOIN } from "@/lib/sources/digitraffic.join.data";
import type { SurfaceReading } from "@/lib/cameras/surface";

// Fintraffic Digitraffic — Finland's national weather-camera network. Keyless,
// well-documented, reliable (the PRD's "cleanest source"). One quirk: the API
// REQUIRES `Accept-Encoding: gzip` or it 406s. Each station has several camera
// "presets" (views); we surface one pin per station using its first active
// preset's image at https://weathercam.digitraffic.fi/<presetId>.jpg.

export const DIGITRAFFIC_SOURCE: Source = {
  id: "digitraffic",
  name: "Fintraffic Digitraffic (Finland)",
  license: "CC BY 4.0 (Fintraffic)",
  attribution: "Live weather-camera data © Fintraffic / Digitraffic",
  refreshSeconds: 300, // weather cams update slowly
  needsKey: false,
};

export interface DigiStation {
  id?: string;
  geometry?: { coordinates?: [number, number, number?] } | null;
  properties?: {
    id?: string;
    name?: string;
    collectionStatus?: string; // "GATHERING" when active
    presets?: { id?: string; inCollection?: boolean }[];
  };
}

/**
 * How old a station's newest frame may be and still count as live.
 *
 * The same 60 minutes cetsp, bihamk and act-pr use. Digitraffic presets publish
 * every few minutes (median 6.8 min on 2026-10-16), so this only catches cameras
 * that have really stopped: that evening 19 of 814 pins showed a frame older than
 * an hour, from 7 hours up to about 283 days, and 17 of them were still GATHERING,
 * so the old rule called them live.
 */
export const MAX_FRAME_AGE_MS = 60 * 60 * 1000;

/** `/stations/data` → measured time (epoch ms) per preset id. Pure. */
export function presetFrameTimes(body: {
  stations?: { presets?: { id?: string; measuredTime?: string }[] }[];
}): Map<string, number> {
  const out = new Map<string, number>();
  for (const st of body.stations ?? []) {
    for (const p of st.presets ?? []) {
      const t = p.measuredTime ? Date.parse(p.measuredTime) : NaN;
      if (p.id && Number.isFinite(t)) out.set(p.id, t);
    }
  }
  return out;
}

/**
 * @param frameTimes measured time per preset id, from `/stations/data`. Empty when
 *   that read failed, and then the old rule (first preset in collection, live while
 *   GATHERING) applies unchanged.
 */
export function normalizeDigitraffic(
  geojson: { features?: DigiStation[] },
  frameTimes: ReadonlyMap<string, number> = new Map(),
  now: number = Date.now(),
): Camera[] {
  const cams: Camera[] = [];
  for (const f of geojson.features ?? []) {
    const p = f.properties ?? {};
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const presets = p.presets ?? [];
    // The freshest preset in collection when frame times are known (a station can
    // have one dead view beside live ones); else the first one, as before.
    const timed = presets
      .filter((x) => x.inCollection && x.id && frameTimes.has(x.id))
      .sort((a, b) => frameTimes.get(b.id!)! - frameTimes.get(a.id!)!);
    const preset = timed[0] ?? presets.find((x) => x.inCollection && x.id) ?? presets[0];
    if (!preset?.id) continue;
    const frameAt = frameTimes.get(preset.id);
    const fresh = frameAt === undefined || now - frameAt <= MAX_FRAME_AGE_MS;
    const stationId = (f.id ?? p.id ?? "").toString().trim();
    if (!stationId) continue;
    cams.push({
      id: `digitraffic:${stationId}`,
      source: "digitraffic",
      country: "FI",
      region: "Finland",
      name: p.name?.trim() || `Digitraffic ${stationId}`,
      lat,
      lon,
      imageUrl: `https://weathercam.digitraffic.fi/${preset.id}.jpg`,
      mediaType: "jpeg",
      refreshSeconds: DIGITRAFFIC_SOURCE.refreshSeconds,
      license: DIGITRAFFIC_SOURCE.license,
      attribution: DIGITRAFFIC_SOURCE.attribution,
      available: p.collectionStatus === "GATHERING" && fresh,
      ...(frameAt !== undefined ? { lastSampledAt: new Date(frameAt).toISOString() } : {}),
    });
  }
  return cams;
}

export async function fetchRegistry(): Promise<Camera[]> {
  // Started first and read in parallel, so the frame times cost no extra wall time.
  const frameTimes = safeFetchFrameTimes();
  const res = await fetch("https://tie.digitraffic.fi/api/weathercam/v1/stations", {
    headers: {
      // Mandatory — the API 406s without it (undici still auto-decompresses).
      "Accept-Encoding": "gzip",
      "Digitraffic-User": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Digitraffic stations: ${res.status}`);
  const json = (await res.json()) as { features?: DigiStation[] };
  const cameras = normalizeDigitraffic(json, await frameTimes);
  attachRoadWeather(cameras, await safeFetchRoadWeather());
  return CameraArray.parse(cameras);
}

/**
 * Frame times per preset. A failure here must not cost Finland its cameras, so it
 * resolves to an empty map and the station flag alone decides, as it did before.
 */
async function safeFetchFrameTimes(): Promise<Map<string, number>> {
  try {
    const res = await fetch("https://tie.digitraffic.fi/api/weathercam/v1/stations/data", {
      headers: {
        "Accept-Encoding": "gzip",
        "Digitraffic-User": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return new Map();
    return presetFrameTimes(await res.json());
  } catch {
    return new Map();
  }
}

/**
 * `fetchRoadWeather()` already resolves to an empty Map on any failure rather than
 * throwing — this wrapper is a second, independent layer against the same class of
 * bug, so a future edit to that promise cannot take the whole camera feed down with
 * it. A thrown feed trips the last-good path in lib/sources/registry.ts; a missing
 * surface reading should never cost Finland its cameras.
 */
async function safeFetchRoadWeather(): Promise<Map<number, SurfaceReading>> {
  try {
    return await fetchRoadWeather();
  } catch (e) {
    console.warn("Digitraffic road weather unavailable:", e);
    return new Map();
  }
}

/**
 * Attaches `surface` to each camera whose station has a JOIN ROW — the operator's
 * own `nearestWeatherStationId`, not a guess of ours (see digitraffic.join.data.ts).
 * A camera whose station is absent from the join table, or whose declared weather
 * station has no current reading, gets NO surface. There is no nearest-neighbour
 * fallback: the whole point of using the operator's declared pairing is that we
 * never substitute our own.
 *
 * `station` (the weather station's name) is deliberately left unset here: naming it
 * would require fetching the weather-station list on every registry refresh just for
 * a label, and this function has only the sensor data, not that list. Unset beats
 * invented.
 */
function attachRoadWeather(cameras: Camera[], weather: Map<number, SurfaceReading>): void {
  if (weather.size === 0) return;
  const joinByStation = new Map(DIGITRAFFIC_JOIN.map((row) => [row.station, row]));
  for (const cam of cameras) {
    const stationId = cam.id.slice("digitraffic:".length);
    const join = joinByStation.get(stationId);
    if (!join) continue;
    const reading = weather.get(join.weatherStationId);
    // Guards CameraArray.parse below: SurfaceSchema requires a non-empty `state`, and
    // an upstream sensor with a value but no sensorValueDescriptionEn (not observed as
    // of 2026-09-03, but not contractually ruled out) would otherwise throw and take
    // the whole feed down with it — the opposite of "weather failure ≠ camera failure".
    if (!reading || !reading.state) continue;
    cam.surface = { ...reading, km: join.km };
  }
}
