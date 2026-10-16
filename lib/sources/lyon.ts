import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, fetchJson, frameFresh, validLatLon } from "@/lib/sources/feedKit";

// France — Métropole de Lyon, the web cameras of its Criter traffic-control system.
// One keyless GET of the Métropole's own GeoServer WFS (WGS84). Measured 2026-10-16:
// 15 cameras, each with a named junction, a direction, a still on
// download.data.grandlyon.com and its own `last_update` (all under a minute old).
// Small, and kept as its own feed so last-good is per network.
//
// LIVENESS: the row's own `last_update` against the usual 60-minute rule.
// Licence: Licence Ouverte v2.0 (data.gouv.fr "cameras-web-criter-de-la-metropole-de-lyon").

const ENDPOINT =
  "https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=metropole-de-lyon:pvo_patrimoine_voirie.pvocameracriter&outputFormat=application/json&SRSNAME=EPSG:4326";
const IMAGE_PREFIX = "https://download.data.grandlyon.com/files/rdata/pvo_patrimoine_voirie.pvocameracriter/";

export const LYON_SOURCE: Source = {
  id: "lyon-criter",
  name: "Métropole de Lyon — Criter web cameras",
  license: "Licence Ouverte v2.0 (Métropole de Lyon)",
  attribution: "Traffic-camera images © Métropole de Lyon (Criter)",
  refreshSeconds: 120,
  needsKey: false,
};

export interface LyonFeature {
  geometry?: { coordinates?: [number, number] } | null;
  properties?: {
    nom?: string;
    libellelong?: string;
    identifiant?: number | string;
    url?: string;
    last_update?: string;
  };
}

export function normalizeLyon(body: { features?: LyonFeature[] }, now: number = Date.now()): Camera[] {
  const out: Camera[] = [];
  for (const f of body.features ?? []) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!validLatLon(lat, lon)) continue;
    const id = clean(String(p.identifiant ?? ""));
    const place = clean(p.libellelong);
    const url = clean(p.url);
    if (!id || !place || !url || !url.startsWith(IMAGE_PREFIX)) continue;
    const updated = p.last_update ? Date.parse(p.last_update) : NaN;
    const toward = clean(p.nom);
    out.push({
      id: `lyon-criter:${id}`,
      source: "lyon-criter",
      country: "FR",
      region: "Métropole de Lyon",
      name: place,
      lat,
      lon: lon as number,
      direction: toward ? `towards ${toward}` : undefined,
      imageUrl: url,
      mediaType: "jpeg",
      refreshSeconds: LYON_SOURCE.refreshSeconds,
      license: LYON_SOURCE.license,
      attribution: LYON_SOURCE.attribution,
      available: frameFresh(Number.isFinite(updated) ? updated : null, now),
      ...(Number.isFinite(updated) ? { lastSampledAt: new Date(updated).toISOString() } : {}),
    });
  }
  return out;
}

export async function fetchRegistry(): Promise<Camera[]> {
  return CameraArray.parse(normalizeLyon(await fetchJson(ENDPOINT, { timeoutMs: 8_000 })));
}
