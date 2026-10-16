import { Camera, CameraArray, Source } from "@/lib/types";
import { FrameProber, clean, fetchJson, probeVerdict, validLatLon, type FrameProbe } from "@/lib/sources/feedKit";

// Toronto — City of Toronto Transportation Services, RESCU traffic cameras, from the
// city's open-data portal (keyless GeoJSON, MultiPoint geometry). Measured
// 2026-10-16: 336 cameras. 89 of them sit within 150 m of a camera 511 Ontario
// already relays, so this feed yields to `castlerock` there (registry.ts), and the
// map shows each junction once.
//
// LIVENESS: the stills carry a real Last-Modified, so a FrameProber dates them (at
// most every 20 minutes each). The city serves a 20,955-byte "Image Unavailable"
// card for a dead camera with HTTP 200 (1 of 40 sampled), so a still of exactly that
// size is unavailable whatever its date.
//
// Licence: Open Government Licence – Toronto (the portal licence; the dataset record
// itself says "License not specified").

const ENDPOINT =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/a3309088-5fd4-4d34-8297-77c8301840ac/resource/4a568300-c7f8-496d-b150-dff6f5dc6d4f/download/traffic-camera-list-4326.geojson";
const IMAGE_PREFIX = "https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/";
export const TORONTO_CARD_BYTES = 20_955;

export const TORONTO_SOURCE: Source = {
  id: "toronto",
  name: "City of Toronto — RESCU traffic cameras",
  license: "Open Government Licence – Toronto",
  attribution: "Traffic-camera images © City of Toronto (Transportation Services)",
  refreshSeconds: 120,
  needsKey: false,
};

export interface TorontoFeature {
  geometry?: { type?: string; coordinates?: number[] | number[][] } | null;
  properties?: { REC_ID?: number | string; IMAGEURL?: string; MAINROAD?: string; CROSSROAD?: string };
}

/** A Point's or a MultiPoint's first [lon, lat]. */
function firstPoint(g: TorontoFeature["geometry"]): [number, number] | null {
  const c = g?.coordinates;
  if (!Array.isArray(c) || c.length === 0) return null;
  const p = Array.isArray(c[0]) ? (c[0] as number[]) : (c as number[]);
  return p.length >= 2 ? [p[0], p[1]] : null;
}

/** Live, dead or unknown for one Toronto still. Pure. */
export function torontoVerdict(p: FrameProbe | undefined): boolean | undefined {
  if (p?.bytes === TORONTO_CARD_BYTES) return false;
  return probeVerdict(p);
}

export function normalizeToronto(body: { features?: TorontoFeature[] }, probes: ReadonlyMap<string, FrameProbe> = new Map()): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const f of body.features ?? []) {
    const p = f.properties ?? {};
    const pt = firstPoint(f.geometry);
    if (!pt) continue;
    const [lon, lat] = pt;
    if (!validLatLon(lat, lon)) continue;
    const rec = p.REC_ID == null ? "" : String(p.REC_ID);
    const image = clean(p.IMAGEURL)?.replace(/^http:\/\//, "https://");
    const main = clean(p.MAINROAD);
    if (!rec || !image || !main || !image.startsWith(IMAGE_PREFIX) || seen.has(rec)) continue;
    seen.add(rec);
    const id = `toronto:${rec}`;
    const probe = probes.get(id);
    const cross = clean(p.CROSSROAD);
    out.push({
      id,
      source: "toronto",
      country: "CA",
      region: "Toronto",
      name: cross ? `${main} at ${cross}` : main,
      lat,
      lon,
      road: main,
      imageUrl: image,
      mediaType: "jpeg",
      refreshSeconds: TORONTO_SOURCE.refreshSeconds,
      license: TORONTO_SOURCE.license,
      attribution: TORONTO_SOURCE.attribution,
      available: torontoVerdict(probe) ?? true,
      ...(probe?.lastModified ? { lastSampledAt: new Date(probe.lastModified).toISOString() } : {}),
    });
  }
  return out;
}

const prober = new FrameProber({ revisitMs: 20 * 60_000, concurrency: 8, waitMs: 3_000 });

export async function fetchRegistry(): Promise<Camera[]> {
  const body = await fetchJson<{ features?: TorontoFeature[] }>(ENDPOINT, { timeoutMs: 6_000 });
  const first = normalizeToronto(body);
  const probes = await prober.sweep(first.map((c) => ({ id: c.id, url: c.imageUrl! })));
  return CameraArray.parse(normalizeToronto(body, probes));
}
