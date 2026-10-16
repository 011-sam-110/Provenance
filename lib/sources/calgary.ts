import { Camera, CameraArray, Source } from "@/lib/types";
import { FrameProber, clean, fetchJson, probeVerdict, validLatLon, type FrameProbe } from "@/lib/sources/feedKit";

// Calgary — City of Calgary traffic cameras, from the city's Socrata open-data
// portal (keyless JSON). Measured 2026-10-16: 216 cameras; 10 of 10 images answered,
// 9 of them seconds old and 1 about 10 hours old. Where 511 Alberta (castlerock) also
// carries a camera within 150 m, this feed yields to it (registry.ts); the overlap
// could not be measured on audit day because 511 Alberta's list was answering 500.
//
// The catalogue writes the image URLs as http://; https was measured to work
// (https://trafficcam.calgary.ca/loc86.jpg answered 200), so they are upgraded.
//
// LIVENESS: a FrameProber dates the stills by Last-Modified (at most every 20 minutes
// each) and the 60-minute rule applies.
//
// Licence: Open Government Licence – City of Calgary.

const ENDPOINT = "https://data.calgary.ca/resource/k7p9-kppz.json?$limit=2000";
const IMAGE_HOST = "trafficcam.calgary.ca";

export const CALGARY_SOURCE: Source = {
  id: "calgary",
  name: "City of Calgary traffic cameras",
  license: "Open Government Licence – City of Calgary",
  attribution: "Traffic-camera images © City of Calgary",
  refreshSeconds: 120,
  needsKey: false,
};

export interface CalgaryRow {
  camera_url?: { url?: string; description?: string };
  quadrant?: string;
  camera_location?: string;
  point?: { coordinates?: [number, number] };
}

export function normalizeCalgary(rows: readonly CalgaryRow[], probes: ReadonlyMap<string, FrameProbe> = new Map()): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const [lon, lat] = r.point?.coordinates ?? [];
    if (!validLatLon(lat, lon)) continue;
    const name = clean(r.camera_location);
    const raw = clean(r.camera_url?.url);
    if (!name || !raw) continue;
    let u: URL;
    try {
      u = new URL(raw.replace(/^http:\/\//, "https://"));
    } catch {
      continue;
    }
    if (u.hostname !== IMAGE_HOST) continue;
    const file = u.pathname.split("/").pop()?.replace(/\.jpg$/i, "");
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const id = `calgary:${file}`;
    const probe = probes.get(id);
    out.push({
      id,
      source: "calgary",
      country: "CA",
      region: clean(r.quadrant) ? `Calgary ${clean(r.quadrant)}` : "Calgary",
      name,
      lat,
      lon: lon as number,
      imageUrl: u.toString(),
      mediaType: "jpeg",
      refreshSeconds: CALGARY_SOURCE.refreshSeconds,
      license: CALGARY_SOURCE.license,
      attribution: CALGARY_SOURCE.attribution,
      available: probeVerdict(probe) ?? true,
      ...(probe?.lastModified ? { lastSampledAt: new Date(probe.lastModified).toISOString() } : {}),
    });
  }
  return out;
}

const prober = new FrameProber({ revisitMs: 20 * 60_000, concurrency: 8, waitMs: 3_000 });

export async function fetchRegistry(): Promise<Camera[]> {
  const rows = await fetchJson<CalgaryRow[]>(ENDPOINT, { timeoutMs: 6_000 });
  const first = normalizeCalgary(Array.isArray(rows) ? rows : []);
  const probes = await prober.sweep(first.map((c) => ({ id: c.id, url: c.imageUrl! })));
  return CameraArray.parse(normalizeCalgary(Array.isArray(rows) ? rows : [], probes));
}
