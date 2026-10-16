import { Camera, CameraArray, Source } from "@/lib/types";
import { FrameProber, clean, fetchJson, probeVerdict, validLatLon, type FrameProbe } from "@/lib/sources/feedKit";

// New South Wales — Bellingen Shire Council flood cameras. The council's own ArcGIS
// layer "Flood_Camera_Network" (keyless) lists 6 cameras with site, road, locality
// and the image link; the images are hosted for the council by its flood-warning
// supplier on public.disasterwatch-iotp.com.au (the council's platform, not a
// third-party relay). Queued in data/discovery/candidates.json before the audit,
// which measured a frame 20 minutes old on 2026-10-16.
//
// LIVENESS: the stills carry a real Last-Modified; a FrameProber dates them and the
// 60-minute rule applies.
//
// Licence: none is stated; recorded as such.

const ENDPOINT =
  "https://services7.arcgis.com/kkiBaYsUIhK1wEpz/arcgis/rest/services/Flood_Camera_Network/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json";
const IMAGE_PREFIX = "https://public.disasterwatch-iotp.com.au/";

export const BELLINGEN_SOURCE: Source = {
  id: "bellingen",
  name: "Bellingen Shire Council — flood cameras",
  license: "Bellingen Shire Council — no stated licence",
  attribution: "Flood-camera images © Bellingen Shire Council",
  refreshSeconds: 600,
  needsKey: false,
};

export interface BellingenFeature {
  attributes?: { OBJECTID?: number; Site?: string; Road_Name?: string; Locaility?: string; Hyperlink?: string };
  geometry?: { x?: number; y?: number };
}

export function normalizeBellingen(body: { features?: BellingenFeature[] }, probes: ReadonlyMap<string, FrameProbe> = new Map()): Camera[] {
  const out: Camera[] = [];
  for (const f of body.features ?? []) {
    const a = f.attributes ?? {};
    const lat = f.geometry?.y;
    const lon = f.geometry?.x;
    if (!validLatLon(lat, lon) || a.OBJECTID == null) continue;
    const site = clean(a.Site);
    const link = clean(a.Hyperlink);
    if (!site || !link || !link.startsWith(IMAGE_PREFIX)) continue;
    const id = `bellingen:${a.OBJECTID}`;
    const probe = probes.get(id);
    const locality = clean(a.Locaility);
    out.push({
      id,
      source: "bellingen",
      country: "AU",
      region: locality ? locality.charAt(0) + locality.slice(1).toLowerCase() : "Bellingen Shire",
      name: site,
      lat,
      lon: lon as number,
      road: clean(a.Road_Name),
      imageUrl: link,
      mediaType: "jpeg",
      refreshSeconds: BELLINGEN_SOURCE.refreshSeconds,
      license: BELLINGEN_SOURCE.license,
      attribution: BELLINGEN_SOURCE.attribution,
      available: probeVerdict(probe) ?? true,
      ...(probe?.lastModified ? { lastSampledAt: new Date(probe.lastModified).toISOString() } : {}),
    });
  }
  return out;
}

const prober = new FrameProber({ revisitMs: 10 * 60_000, concurrency: 3, waitMs: 3_000 });

export async function fetchRegistry(): Promise<Camera[]> {
  const body = await fetchJson<{ features?: BellingenFeature[] }>(ENDPOINT, { timeoutMs: 6_000 });
  const first = normalizeBellingen(body);
  const probes = await prober.sweep(first.map((c) => ({ id: c.id, url: c.imageUrl! })));
  return CameraArray.parse(normalizeBellingen(body, probes));
}
