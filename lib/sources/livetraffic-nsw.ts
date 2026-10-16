import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, fetchJson, validLatLon } from "@/lib/sources/feedKit";

// New South Wales — Transport for NSW, Live Traffic NSW cameras. The keyless site
// JSON the Live Traffic map itself loads (all-feeds-web.json) holds every map feature;
// the cameras are the rows with eventType "liveCams". Measured 2026-10-16: 250 of
// 1,963 features, each with a title, a view description, a direction and a still on
// webcams.transport.nsw.gov.au updated about every minute. The documented API
// (api.transport.nsw.gov.au/v1/live/cameras) needs a free key and is the same data.
//
// THE IMAGE HOST REFUSES NON-BROWSER USER AGENTS with a 200 and a small HTML page
// ("The camera image you are looking for is temporarily unavailable"). It serves the
// picture to an agent written in the standard crawler form, "Mozilla/5.0 (compatible;
// Name/1.0; +url)", so the media proxy sends exactly that for this host, naming
// Provenance: an identified agent, not a disguised browser. See lib/proxy/allowlist.ts.
//
// LIVENESS: the image's Last-Modified is the request time, so it cannot date a frame;
// the list is trusted.
//
// Licence: Creative Commons Attribution (data.nsw.gov.au "Live Traffic Cameras").

const ENDPOINT = "https://www.livetraffic.com/datajson/all-feeds-web.json";
const IMAGE_HOST = "webcams.transport.nsw.gov.au";

export const LIVETRAFFIC_NSW_SOURCE: Source = {
  id: "livetraffic-nsw",
  name: "Transport for NSW — Live Traffic NSW cameras",
  license: "Creative Commons Attribution (Transport for NSW, data.nsw.gov.au)",
  attribution: "Traffic-camera images © Transport for NSW (Live Traffic NSW)",
  refreshSeconds: 60,
  needsKey: false,
};

export interface NswFeature {
  id?: string;
  eventType?: string;
  geometry?: { coordinates?: [number, number] } | null;
  properties?: { region?: string; title?: string; view?: string; direction?: string; href?: string };
}

const REGION: Record<string, string> = {
  SYD_MET: "Sydney",
  SYD_NORTH: "Sydney North",
  SYD_SOUTH: "Sydney South",
  SYD_WEST: "Sydney West",
  REG_NORTH: "Regional NSW North",
  REG_SOUTH: "Regional NSW South",
  REG_WEST: "Regional NSW West",
};

export function normalizeNsw(features: readonly NswFeature[]): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    if (f.eventType !== "liveCams") continue;
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!validLatLon(lat, lon)) continue;
    const id = clean(f.id);
    const name = clean(p.title);
    const href = clean(p.href);
    if (!id || !name || !href || seen.has(id)) continue;
    try {
      if (new URL(href).hostname !== IMAGE_HOST) continue;
    } catch {
      continue;
    }
    seen.add(id);
    out.push({
      id: `livetraffic-nsw:${id}`,
      source: "livetraffic-nsw",
      country: "AU",
      region: (p.region && REGION[p.region]) || "New South Wales",
      name,
      lat,
      lon: lon as number,
      direction: clean(p.view) ?? clean(p.direction),
      imageUrl: href,
      mediaType: "jpeg",
      refreshSeconds: LIVETRAFFIC_NSW_SOURCE.refreshSeconds,
      license: LIVETRAFFIC_NSW_SOURCE.license,
      attribution: LIVETRAFFIC_NSW_SOURCE.attribution,
      available: true,
    });
  }
  return out;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const body = await fetchJson<NswFeature[]>(ENDPOINT, { timeoutMs: 8_000 });
  return CameraArray.parse(normalizeNsw(Array.isArray(body) ? body : []));
}
