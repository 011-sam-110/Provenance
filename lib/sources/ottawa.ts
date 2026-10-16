import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, envValue, fetchJson, validLatLon } from "@/lib/sources/feedKit";

// Ottawa — City of Ottawa traffic cameras. The camera LIST is keyless
// (traffic.ottawa.ca/map/service/camera: number, name, French name, coordinates,
// owner); the IMAGES for third parties come from /opendata/camera, which needs a
// certificate the City issues by email on request. Measured 2026-10-16: 428 cameras,
// 29 of them MTO's (the province's), which 511 Ontario already carries; those are
// left out here, and every other camera within 150 m of a 511 Ontario one yields to
// it (registry.ts).
//
// DORMANT UNTIL OTTAWA_CAMERA_CERT is set: the list alone is no use without pictures,
// so without the certificate this answers [] and registry.ts reports it dormant.
//
// THE CERTIFICATE NEVER LEAVES THE SERVER. `imageUrl` carries no certificate;
// /api/proxy adds it when it fetches (lib/proxy/allowlist.ts). The City asks for at
// least 60 seconds between requests for one camera, and the proxy's cache headers
// for a 60-second refresh give exactly that to every viewer.
//
// LIVENESS: the list has no status, so it is trusted.
// Licence: none is stated on traffic.ottawa.ca/en/opendata (registration only).

const LIST_URL = "https://traffic.ottawa.ca/map/service/camera";
export const OTTAWA_IMAGE_BASE = "https://traffic.ottawa.ca/opendata/camera";

export const OTTAWA_SOURCE: Source = {
  id: "ottawa",
  name: "City of Ottawa traffic cameras",
  license: "City of Ottawa — no stated licence (traffic.ottawa.ca open data, registration required)",
  attribution: "Traffic-camera images © City of Ottawa",
  refreshSeconds: 60,
  needsKey: true,
};

export interface OttawaCamera {
  cameraOwner?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  name_french?: string;
  camera_number?: number;
  id?: number;
}

/** Undo double-encoded UTF-8 ("KichiÂ ZÄ«bÄ«" style), leaving clean text alone. Pure. */
export function fixMojibake(s: string): string {
  if (!/[ÃÄÅÂ][\u0080-ÿ]/.test(s)) return s;
  try {
    const bytes = Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded;
  } catch {
    return s;
  }
}

/** The image URL as the registry stores it: no certificate. */
export function ottawaImageUrl(cameraNumber: number): string {
  return `${OTTAWA_IMAGE_BASE}?c=${cameraNumber}`;
}

export function normalizeOttawa(body: { cameras?: OttawaCamera[] }): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<number>();
  for (const c of body.cameras ?? []) {
    if (c.cameraOwner && c.cameraOwner !== "CITY") continue; // MTO cameras: 511 Ontario has them
    const n = c.camera_number;
    const name = clean(c.name);
    if (typeof n !== "number" || !Number.isInteger(n) || !name || seen.has(n)) continue;
    if (!validLatLon(c.latitude, c.longitude)) continue;
    seen.add(n);
    out.push({
      id: `ottawa:${n}`,
      source: "ottawa",
      country: "CA",
      region: "Ottawa",
      name: fixMojibake(name),
      lat: c.latitude as number,
      lon: c.longitude as number,
      imageUrl: ottawaImageUrl(n),
      mediaType: "jpeg",
      refreshSeconds: OTTAWA_SOURCE.refreshSeconds,
      license: OTTAWA_SOURCE.license,
      attribution: OTTAWA_SOURCE.attribution,
      available: true,
    });
  }
  return out;
}

/** The certificate parameters the proxy appends, or null while dormant. */
export function ottawaCertParams(): Record<string, string> | null {
  const cert = envValue("OTTAWA_CAMERA_CERT");
  return cert ? { certificate: cert, id: "provenance" } : null;
}

export async function fetchRegistry(): Promise<Camera[]> {
  if (!ottawaCertParams()) return [];
  return CameraArray.parse(normalizeOttawa(await fetchJson(LIST_URL, { timeoutMs: 8_000 })));
}
