import { createHash } from "node:crypto";
import { Camera, CameraArray, Source } from "@/lib/types";
import { showsPlaceholder } from "@/lib/sources/placeholderMemo";

// Scotland — Traffic Scotland (Transport Scotland trunk-road & motorway cameras,
// ~414 nationwide). Keyless. The list endpoint `GET /tsis/cameras` returns
// `{ results: [{ sid, title, lat, lng, roadname, region }] }` with coordinates as
// strings. THE GOTCHA: there is NO direct snapshot .jpg — each camera's image is a
// base64 `data:image/jpeg;base64,...` URI embedded in the per-camera HTML page at
// `/tsis/camerahtml?sid={sid}`. We point `imageUrl` at that HTML page; the media
// proxy (app/api/proxy) special-cases this host and calls `extractScotlandImage`
// (below) to pull the JPEG bytes out. Keeping the adapter dumb (build the page URL
// only) keeps images LAZY — we never fetch 414 HTML pages at registry-build time.

const ORIGIN = "https://www.traffic.gov.scot";

export const TRAFFICSCOTLAND_SOURCE: Source = {
  id: "trafficscotland",
  name: "Traffic Scotland (Transport Scotland)",
  // NOT the Open Government Licence, which this string claimed until 2026-10-16. The
  // operator's copyright page says the Scottish Government "retains the full
  // copyright of all live traffic camera images" and forbids hyperlinking straight
  // to them; its licensed route for re-use is the registration-only Live Traffic
  // Camera FTP Service (Crown copyright credit, no fee). Moving onto that service is
  // a follow-up that needs a box-side FTP mirror.
  license: "Crown copyright, Scottish Government (Traffic Scotland). Not an open licence",
  attribution: "Live traffic-camera data © Traffic Scotland / Transport Scotland",
  refreshSeconds: 120, // trunk-road snapshots refresh every couple of minutes
  needsKey: false,
};

export interface ScotlandCamera {
  sid?: string | number;
  title?: string;
  lat?: string | number; // string in the live feed, e.g. "55.852826000000"
  lng?: string | number;
  roadname?: string;
  region?: string;
}

/**
 * md5 of the operator's "Currently Unavailable" card, as the proxy decodes it out of
 * the camera page. One byte-identical JPEG (8,860 bytes) for every dead camera: 10 of
 * 50 sampled on 2026-10-16, and 5 of the first 60 cameras that evening.
 */
export const SCOTLAND_CARD_MD5 = "8c781abbaca28889b9d99d78c24df5f2";

/** Whether decoded image bytes are the operator's "Currently Unavailable" card. */
export function isScotlandCard(bytes: Uint8Array): boolean {
  return createHash("md5").update(bytes).digest("hex") === SCOTLAND_CARD_MD5;
}

/**
 * @param showsCard whether a camera was last seen serving the operator's card (see
 *   lib/sources/placeholderMemo.ts). The list itself carries no status, so without
 *   a sighting a camera is taken as available.
 */
export function normalizeTrafficScotland(
  payload: { results?: ScotlandCamera[] },
  showsCard: (id: string) => boolean = () => false,
): Camera[] {
  const cams: Camera[] = [];
  for (const r of payload.results ?? []) {
    // Coords arrive as strings; an empty string would coerce to 0 (NOT NaN), so
    // reject blank values explicitly before Number() to avoid a null-island pin.
    const latRaw = r.lat == null ? "" : String(r.lat).trim();
    const lonRaw = r.lng == null ? "" : String(r.lng).trim();
    if (latRaw === "" || lonRaw === "") continue;
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue; // null-island guard
    const nativeId = (r.sid ?? "").toString().trim();
    if (!nativeId) continue;
    cams.push({
      id: `trafficscotland:${nativeId}`,
      source: "trafficscotland",
      country: "GB",
      region: r.region?.trim() || "Scotland",
      name: r.title?.trim() || `Traffic Scotland ${nativeId}`,
      lat,
      lon,
      road: r.roadname?.trim() || undefined,
      // NOT a direct image: the media proxy fetches this HTML page and extracts the
      // embedded base64 JPEG (see extractScotlandImage). sid is always numeric in
      // practice; encodeURIComponent guards a malformed value anyway.
      imageUrl: `${ORIGIN}/tsis/camerahtml?sid=${encodeURIComponent(nativeId)}`,
      mediaType: "jpeg",
      refreshSeconds: TRAFFICSCOTLAND_SOURCE.refreshSeconds,
      license: TRAFFICSCOTLAND_SOURCE.license,
      attribution: TRAFFICSCOTLAND_SOURCE.attribution,
      available: !showsCard(`trafficscotland:${nativeId}`),
    });
  }
  return cams;
}

export interface ExtractedImage {
  contentType: string;
  base64: string;
}

// Pull the first `data:image/...;base64,...` URI out of a Traffic Scotland camera
// HTML page. Returned as the raw base64 + content type so the caller decodes it
// (keeps this pure + Buffer-free, hence trivially unit-testable).
export function extractScotlandImage(html: string): ExtractedImage | null {
  const m = html.match(/data:image\/(jpe?g|png|gif);base64,([A-Za-z0-9+/=]+)/i);
  if (!m) return null;
  const fmt = m[1].toLowerCase();
  const contentType = fmt === "png" ? "image/png" : fmt === "gif" ? "image/gif" : "image/jpeg";
  return { contentType, base64: m[2] };
}

export async function fetchRegistry(): Promise<Camera[]> {
  const res = await fetch(`${ORIGIN}/tsis/cameras`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Traffic Scotland cameras: ${res.status}`);
  const json = (await res.json()) as { results?: ScotlandCamera[] };
  return CameraArray.parse(normalizeTrafficScotland(json, (id) => showsPlaceholder(id)));
}
