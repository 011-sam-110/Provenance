import { Camera, CameraArray, Source } from "@/lib/types";
import { FrameProber, clean, fetchText, probeVerdict, validLatLon, type FrameProbe } from "@/lib/sources/feedKit";

// Hong Kong — Transport Department (TD), HKSAR Government, traffic snapshots via
// DATA.GOV.HK. One keyless XML list (key, region, district, description, lat/lon,
// image URL), images on tdcctv.data.one.gov.hk with a real Last-Modified. Measured
// 2026-10-16: 1,013 cameras; 25 of 25 sampled images 0 to 3.1 minutes old.
//
// LIVENESS: a FrameProber dates each still by HEAD at most every 30 minutes, a slice
// per refresh; a still older than an hour when looked at is unavailable. A still not
// yet looked at is shown as available, because the operator lists it.
//
// Licence: DATA.GOV.HK Terms and Conditions (free use, attribution required).

const ENDPOINT = "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml";
const IMAGE_HOST = "tdcctv.data.one.gov.hk";

export const HKTD_SOURCE: Source = {
  id: "hktd",
  name: "Transport Department, HKSAR Government",
  license: "DATA.GOV.HK Terms and Conditions (free use with attribution)",
  attribution: "Traffic snapshots © Transport Department, HKSAR Government, via DATA.GOV.HK",
  refreshSeconds: 120,
  needsKey: false,
};

export interface HktdImage {
  key: string;
  region?: string;
  district?: string;
  description?: string;
  lat: number;
  lon: number;
  url: string;
}

const field = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? clean(m[1].replace(/&amp;/g, "&")) : undefined;
};

/** Read every `<image>` row of the list. Pure. */
export function parseHktd(xml: string): HktdImage[] {
  const out: HktdImage[] = [];
  for (const m of xml.matchAll(/<image>([\s\S]*?)<\/image>/g)) {
    const b = m[1];
    const key = field(b, "key");
    const url = field(b, "url");
    const lat = Number(field(b, "latitude"));
    const lon = Number(field(b, "longitude"));
    if (!key || !url || !validLatLon(lat, lon)) continue;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (host !== IMAGE_HOST) continue;
    out.push({ key, region: field(b, "region"), district: field(b, "district"), description: field(b, "description"), lat, lon, url });
  }
  return out;
}

export function normalizeHktd(rows: readonly HktdImage[], probes: ReadonlyMap<string, FrameProbe> = new Map()): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.key) || !r.description) continue;
    seen.add(r.key);
    const id = `hktd:${r.key}`;
    const p = probes.get(id);
    out.push({
      id,
      source: "hktd",
      country: "HK",
      region: r.district ?? r.region ?? "Hong Kong",
      // The description ends with the key in brackets; the key is already the id.
      name: r.description.replace(/\s*\[[^\]]+\]\s*$/, "") || r.description,
      lat: r.lat,
      lon: r.lon,
      imageUrl: r.url,
      mediaType: "jpeg",
      refreshSeconds: HKTD_SOURCE.refreshSeconds,
      license: HKTD_SOURCE.license,
      attribution: HKTD_SOURCE.attribution,
      available: probeVerdict(p) ?? true,
      ...(p?.lastModified ? { lastSampledAt: new Date(p.lastModified).toISOString() } : {}),
    });
  }
  return out;
}

const prober = new FrameProber({ revisitMs: 30 * 60_000, concurrency: 12, waitMs: 3_000 });

export async function fetchRegistry(): Promise<Camera[]> {
  const rows = parseHktd(await fetchText(ENDPOINT, { timeoutMs: 6_000 }));
  const probes = await prober.sweep(rows.map((r) => ({ id: `hktd:${r.key}`, url: r.url })));
  return CameraArray.parse(normalizeHktd(rows, probes));
}
