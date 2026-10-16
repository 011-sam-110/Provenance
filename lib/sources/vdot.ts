import { Camera, CameraArray, Source } from "@/lib/types";
import { normalizeScdot, type ScFeature, type ScProfile } from "@/lib/sources/scdot";

// 511 Virginia (Virginia DOT). Keyless. The camera layer the 511 Virginia map itself
// loads, found in its network traffic on 2026-10-16: 1,708 cameras, all `active`,
// stills on snapshot.vdotcameras.com fresh to the minute.
//
// SAME SOFTWARE AS SCDOT. The GeoJSON is the Iteris camera layer SCDOT publishes, down
// to the `/thumbs/<id>.flv.png` still that 301s to `/<id>.png`, so this module is a
// profile for `normalizeScdot` rather than a second copy of it.
//
// STILLS ONLY. Each camera also carries HLS on media-sfsN.vdotcameras.com. That host is
// not on the HLS allowlist and video is its own decision, so the stream is not taken.
//
// TWO FACTS A REVIEWER SHOULD KNOW. The endpoint answers `Content-Type: text/html` with
// a JSON body, so it is read as text and parsed. And the still host's robots.txt is
// `Disallow: /`, the same as the SCDOT still host already served: the proxy fetches one
// still per viewer request, which is not a crawl, but it is stated here, not hidden.
// Some cameras belong to localities (Arlington County, City of Fairfax) and are
// published by VDOT on its own 511 map; the attribution names VDOT as the publisher.

export const VDOT_SOURCE: Source = {
  id: "vdot",
  name: "511 Virginia (Virginia DOT)",
  license: "No licence stated by VDOT for 511 Virginia camera data",
  attribution: "Live traffic camera data © Virginia DOT (511 Virginia)",
  refreshSeconds: 60,
  needsKey: false,
};

export const VDOT_PROFILE: ScProfile = {
  source: "vdot",
  region: "Virginia",
  label: "VDOT",
  license: VDOT_SOURCE.license,
  attribution: VDOT_SOURCE.attribution,
  refreshSeconds: VDOT_SOURCE.refreshSeconds,
  // `name` is the stream's hash; the numeric `id` is the camera.
  idField: "id",
  withStream: false,
};

export const VDOT_ENDPOINT = "https://511.vdot.virginia.gov/services/511/map/layers/map/cams";

export function normalizeVdot(geojson: { features?: ScFeature[] }): Camera[] {
  return normalizeScdot(geojson, VDOT_PROFILE);
}

export async function fetchRegistry(): Promise<Camera[]> {
  const res = await fetch(VDOT_ENDPOINT, {
    headers: { Accept: "application/json", "User-Agent": "TrafficNerd/2.0 (+https://github.com/011-sam-110/Provenance)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`VDOT cams: ${res.status}`);
  const json = JSON.parse(await res.text()) as { features?: ScFeature[] };
  if (!Array.isArray(json?.features)) throw new Error("VDOT cams: not GeoJSON");
  return CameraArray.parse(normalizeVdot(json));
}
