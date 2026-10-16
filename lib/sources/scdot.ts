import { Camera, CameraArray, Source } from "@/lib/types";

export const SCDOT_SOURCE: Source = {
  id: "scdot",
  name: "SCDOT 511 (South Carolina DOT)",
  license: "SCDOT 511 Terms of Use",
  attribution: "Live traffic data © SCDOT / 511sc.org",
  refreshSeconds: 60,
  needsKey: false,
};

export interface ScFeature {
  geometry?: { coordinates?: [number, number] } | null;
  properties?: {
    id?: string | number; name?: string; description?: string; route?: string; direction?: string;
    https_url?: string; ios_url?: string; image_url?: string;
    active?: boolean; problem_stream?: boolean;
  };
}

/**
 * Who published a feed of this shape. SCDOT's 511 and VDOT's 511 Virginia run the same
 * Iteris camera-layer software, so one normaliser serves both and the profile carries
 * what differs: the names, the id field, and whether the stream URL is taken.
 */
export interface ScProfile {
  source: string;
  region: string;
  label: string;
  license: string;
  attribution: string;
  refreshSeconds: number;
  /** Which property holds the stable camera id. */
  idField: "name" | "id";
  /** Take `https_url`/`ios_url` as the stream. False = stills only. */
  withStream: boolean;
}

export const SCDOT_PROFILE: ScProfile = {
  source: "scdot",
  region: "South Carolina",
  label: "SCDOT",
  license: SCDOT_SOURCE.license,
  attribution: SCDOT_SOURCE.attribution,
  refreshSeconds: SCDOT_SOURCE.refreshSeconds,
  idField: "name",
  withStream: true,
};

export function normalizeScdot(geojson: { features?: ScFeature[] }, profile: ScProfile = SCDOT_PROFILE): Camera[] {
  const cams: Camera[] = [];
  for (const f of geojson.features ?? []) {
    const p = f.properties ?? {};
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    // The advertised thumb URL (/thumbs/<id>.flv.png) 301-redirects to the real
    // snapshot at the host root (/<id>.png); pre-resolve it so our proxy (which
    // refuses redirects for SSRF safety) fetches the image directly.
    const rawImage = p.image_url?.trim() || undefined;
    const imageUrl = rawImage?.replace("/thumbs/", "/").replace(/\.flv\.png$/, ".png");
    const streamUrl = profile.withStream ? p.https_url?.trim() || p.ios_url?.trim() || undefined : undefined;
    if (!imageUrl && !streamUrl) continue;
    const nativeId = (profile.idField === "id" ? p.id ?? p.name : p.name ?? p.id ?? "")?.toString().trim();
    if (!nativeId) continue;
    cams.push({
      id: `${profile.source}:${nativeId}`,
      source: profile.source,
      country: "US",
      region: profile.region,
      // VDOT's `name` is a stream hash, not a place, so it is never shown as one.
      name: p.description?.trim() || (profile.idField === "name" ? p.name?.trim() : "") || `${profile.label} ${nativeId}`,
      lat, lon,
      road: p.route?.trim() || undefined,
      direction: p.direction?.trim() || undefined,
      imageUrl,
      streamUrl,
      mediaType: streamUrl ? "both" : "jpeg",
      refreshSeconds: profile.refreshSeconds,
      license: profile.license,
      attribution: profile.attribution,
      available: p.active === true && p.problem_stream !== true,
    });
  }
  return cams;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const res = await fetch("https://sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson", {
    headers: { Accept: "application/json", Referer: "https://www.511sc.org/" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`SCDOT GeoJSON: ${res.status}`);
  const json = (await res.json()) as { features?: ScFeature[] };
  return CameraArray.parse(normalizeScdot(json));
}
