import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, envValue, fetchJson, frameFresh, num, validLatLon } from "@/lib/sources/feedKit";

// North East England — the Tyne and Wear UTMC Open Data Service (Newcastle City
// Council as lead authority, with Gateshead, Sunderland, North and South Tyneside,
// Northumberland and Durham). About 370 cameras with the operator's own coordinates,
// under the Open Government Licence v3.0. Free self-serve sign-up; the API uses HTTP
// Basic with the account's credentials.
//
// DORMANT UNTIL NE_UTMC_USER and NE_UTMC_PASS are set. Without them this answers []
// and registry.ts reports the feed as dormant, not failed.
//
// THE SHAPE IS FROM THE OPERATOR'S DOCUMENTATION (netraveldata.co.uk, "CCTV"), not
// from a response: no account existed on 2026-10-16. Two feeds joined on
// systemCodeNumber:
//   /api/v2/cctv/static   shortDescription, longDescription, point {easting,
//                         northing (EPSG:27700), latitude, longitude}, lastUpdated
//   /api/v2/cctv/dynamic  image (URL of the JPEG), lastUpdated (every 60 to 300 s
//                         for UTMC cameras, 900 to 1,800 s for Vaisala ones)
// The documentation labels latitude/longitude "EPSG:3857". The parser accepts degrees,
// and converts Web-Mercator metres if that is what arrives; a point that is neither
// is dropped. Fields are read either at the top level or from the first entry of
// `definitions` / `dynamics`, the two shapes the service's other feeds use. Check
// both against the first real response before trusting the count.
//
// The image URL needs the same credentials, so /api/proxy adds Basic auth for the
// image host on the server (lib/proxy/allowlist.ts); no credential reaches a browser.
//
// LIVENESS: the dynamic `lastUpdated` against a 60-minute rule (Vaisala cameras post
// every 15 to 30 minutes, inside it). The audit saw 25 of 370 more than a day old.

const BASE = "https://www.netraveldata.co.uk/api/v2/cctv";
export const NE_UTMC_ENV = ["NE_UTMC_USER", "NE_UTMC_PASS"] as const;

export const NE_UTMC_SOURCE: Source = {
  id: "ne-utmc",
  name: "Tyne and Wear UTMC Open Data Service",
  license: "Open Government Licence v3.0 (Tyne and Wear UTMC)",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Tyne and Wear UTMC / Newcastle City Council",
  refreshSeconds: 120,
  needsKey: true,
};

/** The Basic credential, or null while dormant. Never logged. */
export function neUtmcAuthHeader(): string | null {
  const user = envValue("NE_UTMC_USER");
  const pass = envValue("NE_UTMC_PASS");
  if (!user || !pass) return null;
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

interface NePoint {
  latitude?: number | string;
  longitude?: number | string;
}
interface NeDefinition {
  shortDescription?: string;
  longDescription?: string;
  point?: NePoint;
}
export interface NeStatic extends NeDefinition {
  systemCodeNumber?: string;
  definitions?: NeDefinition[];
}
interface NeDynamic0 {
  image?: string;
  lastUpdated?: string;
}
export interface NeDynamic extends NeDynamic0 {
  systemCodeNumber?: string;
  dynamics?: NeDynamic0[];
}

/** Degrees as they are, or Web-Mercator metres converted; null if neither. Pure. */
export function neLatLon(p: NePoint | undefined): [number, number] | null {
  const a = num(p?.latitude);
  const b = num(p?.longitude);
  if (validLatLon(a, b)) return [a, b];
  if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) > 180) {
    // EPSG:3857 metres (x = longitude axis, y = latitude axis).
    const R = 6378137;
    const lon = (b / R) * (180 / Math.PI);
    const lat = (2 * Math.atan(Math.exp(a / R)) - Math.PI / 2) * (180 / Math.PI);
    if (validLatLon(lat, lon)) return [lat, lon];
  }
  return null;
}

const UK_NE = (lat: number, lon: number) => lat > 54.3 && lat < 55.9 && lon > -2.8 && lon < -1.0;

export function normalizeNeUtmc(statics: readonly NeStatic[], dynamics: readonly NeDynamic[], now: number = Date.now()): Camera[] {
  const dyn = new Map<string, NeDynamic0>();
  for (const d of dynamics) {
    const code = clean(d.systemCodeNumber);
    if (code) dyn.set(code, d.dynamics?.[0] ?? d);
  }
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const s of statics) {
    const code = clean(s.systemCodeNumber);
    const def = s.definitions?.[0] ?? s;
    const pt = neLatLon(def.point);
    const name = clean(def.longDescription) ?? clean(def.shortDescription);
    const d = code ? dyn.get(code) : undefined;
    const image = clean(d?.image);
    if (!code || !pt || !name || !image || seen.has(code)) continue;
    if (!UK_NE(pt[0], pt[1])) continue; // a coordinate outside the North East is a parse error, not a camera
    let host: string;
    try {
      host = new URL(image).hostname;
    } catch {
      continue;
    }
    if (host !== "www.netraveldata.co.uk") continue;
    seen.add(code);
    const at = d?.lastUpdated ? Date.parse(d.lastUpdated) : NaN;
    out.push({
      id: `ne-utmc:${code}`,
      source: "ne-utmc",
      country: "GB",
      region: "Tyne and Wear and the North East",
      name,
      lat: pt[0],
      lon: pt[1],
      imageUrl: image,
      mediaType: "jpeg",
      refreshSeconds: NE_UTMC_SOURCE.refreshSeconds,
      license: NE_UTMC_SOURCE.license,
      attribution: NE_UTMC_SOURCE.attribution,
      available: frameFresh(Number.isFinite(at) ? at : null, now),
      ...(Number.isFinite(at) ? { lastSampledAt: new Date(at).toISOString() } : {}),
    });
  }
  return out;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const auth = neUtmcAuthHeader();
  if (!auth) return [];
  const opts = { timeoutMs: 8_000, headers: { Authorization: auth } };
  const [statics, dynamics] = await Promise.all([
    fetchJson<NeStatic[]>(`${BASE}/static`, opts),
    fetchJson<NeDynamic[]>(`${BASE}/dynamic`, opts),
  ]);
  return CameraArray.parse(normalizeNeUtmc(Array.isArray(statics) ? statics : [], Array.isArray(dynamics) ? dynamics : []));
}
