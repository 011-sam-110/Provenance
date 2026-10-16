import { Camera, CameraArray, Source } from "@/lib/types";

// Mi Drive (Michigan DOT). Keyless: `GET /MiDrive/camera/list` on MDOT's own server,
// the list its map loads. 804 cameras on 2026-10-16, stills fresh to the minute.
//
// THE DATA IS HTML IN JSON. Each row is display markup: the coordinate and the camera
// id live in a "Go to" link inside `county`
// (`Wayne County <a href="/MiDrive/map?...&lat=42.49&lon=-83.04&zoom=15&id=1129">`),
// and the still in an `<img src="...">` inside `image`. They are read with anchored
// patterns and a row missing either is dropped, never guessed.
//
// THE STILL REDIRECTS. `micamerasimages.net/thumbs/<name>.flv.jpg` answers 301 to
// `/<name>.jpg`, and the proxy refuses redirects (SSRF), so the adapter stores the
// resolved form, exactly as scdot.ts does for its host. The weather-station stills on
// MDOT's own server and the `?bucket=ftp` stills do not redirect and are kept as given.
// The still host's robots.txt is `Disallow: /`; the proxy fetches one still per viewer
// request, which is not a crawl, but it is stated here rather than hidden.

export const MIDRIVE_SOURCE: Source = {
  id: "midrive",
  name: "Mi Drive (Michigan DOT)",
  license: "No licence stated by MDOT for Mi Drive camera data",
  attribution: "Live traffic camera data © Michigan DOT (Mi Drive)",
  refreshSeconds: 60,
  needsKey: false,
};

export const MIDRIVE_ENDPOINT = "https://mdotjboss.state.mi.us/MiDrive/camera/list";

export interface MiDriveRow {
  route?: string;
  county?: string;
  location?: string;
  direction?: string;
  image?: string;
}

/** Pull lat, lon and the camera id out of the row's "Go to" link. Pure. */
export function parseCountyLink(county: string): { county: string; lat: number; lon: number; id: string } | null {
  const href = county.match(/href="([^"]*)"/i)?.[1];
  if (!href) return null;
  const q = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
  const params = new URLSearchParams(q.replace(/&amp;/g, "&"));
  const latRaw = params.get("lat")?.trim();
  const lonRaw = params.get("lon")?.trim();
  const id = params.get("id")?.trim();
  // An absent parameter must not become Number(null) === 0.
  if (!id || !latRaw || !lonRaw) return null;
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { county: county.split("<")[0].trim(), lat, lon, id };
}

/** The `<img src>` in the row, with the /thumbs/ redirect resolved. Pure. */
export function stillUrl(image: string): string | undefined {
  const src = image.match(/<img\b[^>]*\bsrc="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&").trim();
  if (!src) return undefined;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (url.hostname === "micamerasimages.net") {
    url.pathname = url.pathname.replace(/^\/thumbs\//, "/").replace(/\.flv\.jpg$/, ".jpg");
  }
  return url.toString();
}

/** "Traffic closest to camera is traveling north." -> "North". Pure. */
function directionWord(text: string | undefined): string | undefined {
  const m = text?.match(/traveling (north|south|east|west)/i)?.[1];
  return m ? m[0].toUpperCase() + m.slice(1).toLowerCase() : undefined;
}

export function normalizeMiDrive(rows: MiDriveRow[]): Camera[] {
  const cams: Camera[] = [];
  for (const r of rows ?? []) {
    const link = parseCountyLink(r.county ?? "");
    if (!link) continue;
    const { lat, lon } = link;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue;
    const imageUrl = stillUrl(r.image ?? "");
    if (!imageUrl) continue;
    const road = r.route?.trim() || undefined;
    const place = r.location?.trim() || undefined;
    cams.push({
      id: `midrive:${link.id}`,
      source: "midrive",
      country: "US",
      region: "Michigan",
      // "11 Mile" + "@ Mound NB" -> "11 Mile @ Mound NB"; the county when both are absent.
      name: [road, place].filter(Boolean).join(" ") || link.county || `Mi Drive camera ${link.id}`,
      lat,
      lon,
      road,
      direction: directionWord(r.direction),
      imageUrl,
      mediaType: "jpeg",
      refreshSeconds: MIDRIVE_SOURCE.refreshSeconds,
      license: MIDRIVE_SOURCE.license,
      attribution: MIDRIVE_SOURCE.attribution,
      // The list carries no status; a listed camera is a published one.
      available: true,
    });
  }
  return cams;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const res = await fetch(MIDRIVE_ENDPOINT, {
    headers: { Accept: "application/json", "User-Agent": "TrafficNerd/2.0 (+https://github.com/011-sam-110/Provenance)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Mi Drive cameras: ${res.status}`);
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) throw new Error("Mi Drive cameras: not an array");
  return CameraArray.parse(normalizeMiDrive(json as MiDriveRow[]));
}
