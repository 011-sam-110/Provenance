import { Camera, CameraArray, Source } from "@/lib/types";
import { FrameProber, clean, fetchJson, probeVerdict, validLatLon, type FrameProbe } from "@/lib/sources/feedKit";

// Queensland — Department of Transport and Main Roads (TMR), QLDTraffic. The static
// GeoJSON files the QLDTraffic map itself loads, keyless (the documented API needs a
// key). Two files, two feeds, so each keeps its own last-good:
//   webcameras.geojson   137 traffic cameras (this module)
//   floodcameras.geojson 120 flood cameras (./qldtraffic-flood.ts), some of whose
//                        images come from a council, named per row in
//                        `image_sourced_from`
// Coordinates are GDA2020 (EPSG:7844), within about 1.5 m of WGS84: good enough for
// a pin, so they are used as they are.
//
// LIVENESS: a FrameProber dates each still by HEAD (the hosts send a real
// Last-Modified; webcam frames were under a minute old on 2026-10-16). Flood cameras
// at night were 10.7 to 10.9 hours old, and the 60-minute rule shows them as
// unavailable, which is what they are at that moment.
//
// Licence: TMR's "State controlled roads traffic cameras" is CC BY 3.0 AU on
// data.gov.au; the QLDTraffic API specification itself is CC BY-SA 3.0 AU. Which one
// governs the images was not confirmed with TMR, so the string names both.

export const QLD_LICENSE =
  "CC BY 3.0 AU (data.gov.au, TMR traffic cameras); QLDTraffic API specification CC BY-SA 3.0 AU";

export const QLDTRAFFIC_SOURCE: Source = {
  id: "qldtraffic",
  name: "QLDTraffic — Department of Transport and Main Roads (Queensland)",
  license: QLD_LICENSE,
  attribution: "Traffic-camera images © State of Queensland (Department of Transport and Main Roads), QLDTraffic",
  refreshSeconds: 120,
  needsKey: false,
};

const IMAGE_HOST = "cameras.qldtraffic.qld.gov.au";

export interface QldFeature {
  geometry?: { coordinates?: [number, number] } | null;
  properties?: {
    id?: number | string;
    description?: string;
    direction?: string;
    district?: string;
    locality?: string;
    image_url?: string;
    image_sourced_from?: string | null;
  };
}

/** Shared by both QLDTraffic feeds. Pure. */
export function normalizeQld(
  key: "qldtraffic" | "qldtraffic-flood",
  body: { features?: QldFeature[] },
  source: Source,
  probes: ReadonlyMap<string, FrameProbe> = new Map(),
): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const f of body.features ?? []) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!validLatLon(lat, lon)) continue;
    const nativeId = p.id == null ? "" : String(p.id);
    const name = clean(p.description);
    const image = clean(p.image_url);
    if (!nativeId || !name || !image || seen.has(nativeId)) continue;
    try {
      if (new URL(image).hostname !== IMAGE_HOST) continue;
    } catch {
      continue;
    }
    seen.add(nativeId);
    const id = `${key}:${nativeId}`;
    const probe = probes.get(id);
    const council = clean(p.image_sourced_from ?? undefined);
    out.push({
      id,
      source: key,
      country: "AU",
      region: clean(p.district) ?? "Queensland",
      name,
      lat,
      lon: lon as number,
      direction: clean(p.direction),
      imageUrl: image,
      mediaType: "jpeg",
      refreshSeconds: source.refreshSeconds,
      license: source.license,
      attribution: council ? `${source.attribution}. Image from ${council}` : source.attribution,
      available: probeVerdict(probe) ?? true,
      ...(probe?.lastModified ? { lastSampledAt: new Date(probe.lastModified).toISOString() } : {}),
    });
  }
  return out;
}

/** Fetch one QLDTraffic file, date its stills, normalise. */
export async function fetchQld(
  key: "qldtraffic" | "qldtraffic-flood",
  url: string,
  source: Source,
  prober: FrameProber,
): Promise<Camera[]> {
  const body = await fetchJson<{ features?: QldFeature[] }>(url, { timeoutMs: 6_000 });
  const first = normalizeQld(key, body, source);
  const probes = await prober.sweep(first.map((c) => ({ id: c.id, url: c.imageUrl! })));
  return CameraArray.parse(normalizeQld(key, body, source, probes));
}

const prober = new FrameProber({ revisitMs: 15 * 60_000, concurrency: 8, waitMs: 2_500 });

export async function fetchRegistry(): Promise<Camera[]> {
  return fetchQld("qldtraffic", "https://data.qldtraffic.qld.gov.au/webcameras.geojson", QLDTRAFFIC_SOURCE, prober);
}
