import { Camera, CameraArray, Source } from "@/lib/types";

// DriveBC — British Columbia Ministry of Transportation & Infrastructure highway
// webcams. Keyless and clean: the API returns a flat JSON ARRAY of camera objects
// (not GeoJSON). ~1,058 cameras province-wide. Two gotchas:
//   1. `location.coordinates` is GeoJSON order `[lon, lat]` — LONGITUDE FIRST.
//      Swapping it puts every camera in the Indian Ocean, so we read [0]=lon,[1]=lat.
//   2. Dead/old feeds are flagged `marked_stale` / `marked_delayed` (and `is_on`),
//      which we surface as `available:false` rather than hiding — honest freshness.
// Snapshot JPEGs live at https://www.drivebc.ca + `links.imageDisplay`
// (e.g. `/images/717.jpg`); we drop the volatile `?t=` cache-bust for a stable URL
// (the media proxy already fetches with `cache: no-store`).

const ORIGIN = "https://www.drivebc.ca";

export const DRIVEBC_SOURCE: Source = {
  id: "drivebc",
  name: "DriveBC (BC Ministry of Transportation & Infrastructure)",
  license: "Open Government Licence – British Columbia",
  attribution:
    "Live webcam data © DriveBC / BC Ministry of Transportation and Infrastructure",
  refreshSeconds: 180, // snapshots refresh on the order of minutes
  needsKey: false,
};

export interface DriveBcWebcam {
  id?: number | string;
  name?: string;
  caption?: string;
  name_override?: string;
  caption_override?: string;
  links?: { imageDisplay?: string } | null;
  highway?: string;
  highway_display?: string;
  region_name?: string;
  orientation?: string;
  marked_stale?: boolean;
  marked_delayed?: boolean;
  is_on?: boolean;
  location?: { type?: string; coordinates?: [number, number] } | null;
  /** HTML. Sometimes names who owns the pictures ("Images courtesy of TransLink"). */
  credit?: string | null;
  /** The operator's time of the last frame that actually changed, ISO with offset. */
  last_update_modified?: string | null;
}

/**
 * The image owner a camera's `credit` names, as plain text, or undefined.
 *
 * Measured 2026-10-16 over 1,067 cameras: 985 empty, 8 "Images courtesy of
 * TransLink", 7 "Images provided by Parks Canada and Alberta Motor Association", and
 * 28 notices about solar power or satellite delays. Only the first two kinds say
 * who owns the picture, so only a credit that opens with "Images courtesy of" or
 * "Images provided by" joins the attribution. The delay notices are not credits.
 */
export function imageCredit(credit: string | null | undefined): string | undefined {
  if (!credit) return undefined;
  const text = credit.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return /^images (courtesy of|provided by) /i.test(text) ? text.replace(/\.$/, "") : undefined;
}

export function normalizeDriveBc(webcams: DriveBcWebcam[]): Camera[] {
  const cams: Camera[] = [];
  for (const w of Array.isArray(webcams) ? webcams : []) {
    const coords = w.location?.coordinates;
    if (!coords) continue;
    // GeoJSON order is [longitude, latitude] — LON FIRST.
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const nativeId = (w.id ?? "").toString().trim();
    if (!nativeId) continue;
    const rel = w.links?.imageDisplay?.trim();
    if (!rel) continue;
    // Prefix the origin onto the relative path; strip the `?t=` cache-bust so the
    // cached imageUrl is stable across refreshes.
    const path = rel.split("?")[0];
    const imageUrl = /^https?:\/\//.test(path)
      ? path
      : `${ORIGIN}${path.startsWith("/") ? "" : "/"}${path}`;
    const name =
      w.name_override?.trim() ||
      w.name?.trim() ||
      w.caption_override?.trim() ||
      w.caption?.trim() ||
      `DriveBC ${nativeId}`;
    const credit = imageCredit(w.credit);
    const modified = w.last_update_modified ? Date.parse(w.last_update_modified) : NaN;
    cams.push({
      id: `drivebc:${nativeId}`,
      source: "drivebc",
      country: "CA",
      region: w.region_name?.trim() || "British Columbia",
      name,
      lat,
      lon,
      road: (w.highway_display ?? w.highway)?.toString().trim() || undefined,
      direction: w.orientation?.trim() || undefined,
      imageUrl,
      mediaType: "jpeg",
      refreshSeconds: DRIVEBC_SOURCE.refreshSeconds,
      license: DRIVEBC_SOURCE.license,
      // A camera whose pictures belong to someone else (8 are TransLink's) says so.
      attribution: credit ? `${DRIVEBC_SOURCE.attribution}. ${credit}` : DRIVEBC_SOURCE.attribution,
      // The operator's own "last real frame" time, for the provenance panel.
      ...(Number.isFinite(modified) ? { lastSampledAt: new Date(modified).toISOString() } : {}),
      // Stale / delayed / switched-off cams are kept but flagged not-live.
      available: w.marked_stale !== true && w.marked_delayed !== true && w.is_on !== false,
    });
  }
  return cams;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const res = await fetch(`${ORIGIN}/api/webcams/`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DriveBC webcams: ${res.status}`);
  const json = (await res.json()) as DriveBcWebcam[];
  return CameraArray.parse(normalizeDriveBc(json));
}
