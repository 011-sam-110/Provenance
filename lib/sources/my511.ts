import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, envValue, fetchJson, validLatLon } from "@/lib/sources/feedKit";

// The keyed Castle Rock "My511" developer API, shared by three provincial and
// territorial 511 systems: Manitoba, Newfoundland and Labrador, and Yukon. Each one is
// its own feed (./my511-mb.ts, ./my511-nl.ts, ./my511-yt.ts) with its own key and its
// own last-good; this file is the client and the normaliser they share.
//
// WHY THE KEYED API AND NOT THE ROUTE `castlerock` USES. Every Castle Rock 511 site's
// robots.txt disallows /List/GetData/, the DataTables endpoint castlerock.ts posts
// to. The documented route is GET /api/v2/get/cameras?key=…&format=json with a free
// My511 developer key, throttled to 10 calls a minute; one call per refresh is far
// inside that. The images stay at https://{site}/map/Cctv/{viewId}, which robots.txt
// allows.
//
// DORMANT UNTIL each system's key is set (MANITOBA_511_KEY, NL_511_KEY, YUKON_511_KEY).
//
// THE SHAPE is the one the operator documents on /help/endpoint/cameras (the sample
// there is a test fixture): Id, Source, Roadway, Direction, Latitude, Longitude,
// Location, Views[{Id, Url, Status, Description}]. One camera per VIEW, because each
// view is its own picture.
//
// LIVENESS: the view's own Status ("Enabled" / "Disabled"). Do not HEAD these images:
// the hosts answer HEAD with Content-Length 0 and a Last-Modified of "now".

export interface My511System {
  key: string;
  host: string;
  env: string;
  country: "CA";
  region: string;
  source: Source;
}

export interface My511Camera {
  Id?: number;
  Roadway?: string;
  Direction?: string;
  Latitude?: number;
  Longitude?: number;
  Location?: string;
  Views?: { Id?: number; Url?: string; Status?: string; Description?: string }[];
}

export function normalizeMy511(sys: My511System, rows: readonly My511Camera[]): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if (!validLatLon(r.Latitude, r.Longitude)) continue;
    const place = clean(r.Location) ?? clean(r.Roadway);
    if (!place) continue;
    for (const v of r.Views ?? []) {
      if (typeof v.Id !== "number" || seen.has(v.Id)) continue;
      const url = clean(v.Url);
      if (!url) continue;
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        continue;
      }
      if (u.hostname !== sys.host || !u.pathname.startsWith("/map/Cctv/")) continue;
      seen.add(v.Id);
      const desc = clean(v.Description);
      const dir = clean(r.Direction);
      out.push({
        id: `${sys.key}:${v.Id}`,
        source: sys.key,
        country: sys.country,
        region: sys.region,
        name: desc && desc !== place ? `${place} — ${desc}` : place,
        lat: r.Latitude as number,
        lon: r.Longitude as number,
        road: clean(r.Roadway),
        direction: dir && !/^(none|unknown)$/i.test(dir) ? dir : undefined,
        imageUrl: `https://${sys.host}${u.pathname}`,
        mediaType: "jpeg",
        refreshSeconds: sys.source.refreshSeconds,
        license: sys.source.license,
        attribution: sys.source.attribution,
        available: v.Status === "Enabled",
      });
    }
  }
  return out;
}

export async function fetchMy511(sys: My511System): Promise<Camera[]> {
  const key = envValue(sys.env);
  if (!key) return [];
  const url = `https://${sys.host}/api/v2/get/cameras?key=${encodeURIComponent(key)}&format=json`;
  const rows = await fetchJson<My511Camera[]>(url, { timeoutMs: 8_000 });
  return CameraArray.parse(normalizeMy511(sys, Array.isArray(rows) ? rows : []));
}
