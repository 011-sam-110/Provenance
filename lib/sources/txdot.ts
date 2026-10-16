import { Camera, CameraArray, Source } from "@/lib/types";

// TxDOT ITS (Texas DOT). Keyless: the endpoints behind its.txdot.gov's own map. One
// request per district (`GetCctvStatusListByDistrict?districtCode=XXX`), all 25 of the
// codes the page's own config lists; 4,351 cameras on 2026-10-16, every one with a
// snapshot.
//
// THE PICTURE IS NOT A FILE. `GetCctvSnapshotByIcdId?icdId=&districtCode=` answers
// JSON whose `snippet` is a base64 JPEG (1920x1080, ~270 KB) and whose
// `timestampFormatted` is a Central-time clock reading. So a camera's `imageUrl` is
// that endpoint, and `/api/proxy` has a branch for this host that decodes the JSON
// into image bytes (`extractTxdotSnapshot`), as it already does for Traffic Scotland's
// embedded JPEG. The camera's native key is its `icd_Id`, a display string such as
// "IH20 @ Dallas-Tarrant CL"; it is URL-encoded wherever it travels.
//
// THE HOUSTON NETWORK HAS NO PICTURE HERE. Every camera carries a `netId`, and the
// 1,292 on the "HOUSTON" network (all of the HOU district, plus parts of BMT, BRY,
// YKM and AUS) answered the snapshot endpoint with a bare `null` in 8 of 8 samples on
// 2026-10-16, while every other network answered 2 of 2 with a JPEG. Those cameras
// are run through Houston TranStar, which this registry already serves (admitted
// through discovery; 421 of the HOU district's cameras stand within 60 m of one of
// TranStar's), so they are left out here: a pin with no picture would be the false
// claim, and the rest would be a double count. 3,059 cameras remain.
//
// No robots.txt is published (the path answers the site's HTML shell). The terms the
// page links (a txdot.gov disclaimer) now 404, so the licence line says none is stated.

export const TXDOT_SOURCE: Source = {
  id: "txdot",
  name: "TxDOT ITS (Texas DOT)",
  license: "No licence stated by TxDOT for ITS camera data",
  attribution: "Live traffic camera data © Texas DOT (TxDOT ITS)",
  refreshSeconds: 120,
  needsKey: false,
};

/** The district codes its.txdot.gov's own `__APP_CONFIG__` lists (2026-10-16). */
export const TXDOT_DISTRICTS = [
  "ABL", "AMA", "ATL", "AUS", "BMT", "BWD", "BRY", "CHS", "CRP", "DAL", "ELP", "FTW", "HOU",
  "LRD", "LBB", "LFK", "ODA", "PAR", "PHR", "SJT", "SAT", "TYL", "WAC", "WFS", "YKM",
] as const;

const BASE = "https://its.txdot.gov/its/DistrictIts";
/** The camera network whose snapshots this API does not serve (see above). */
export const NO_SNAPSHOT_NETWORKS = new Set(["HOUSTON"]);

export interface TxdotCctv {
  icd_Id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  hasSnapshot?: boolean;
  statusDescription?: string;
  netId?: string;
  equipLoc?: { roadway?: string | null } | null;
}

export interface TxdotDistrictBody {
  roadwayCctvStatuses?: Record<string, TxdotCctv[]> | null;
}

/** The snapshot endpoint for one camera. Pure. */
export function snapshotUrl(district: string, icdId: string): string {
  return `${BASE}/GetCctvSnapshotByIcdId?icdId=${encodeURIComponent(icdId)}&districtCode=${encodeURIComponent(district)}`;
}

export function normalizeTxdot(body: TxdotDistrictBody, district: string): Camera[] {
  const cams: Camera[] = [];
  const seen = new Set<string>();
  for (const [roadway, rows] of Object.entries(body.roadwayCctvStatuses ?? {})) {
    for (const c of rows ?? []) {
      const icd = c.icd_Id?.trim();
      if (!icd || c.hasSnapshot === false) continue;
      if (c.netId && NO_SNAPSHOT_NETWORKS.has(c.netId)) continue;
      const lat = Number(c.latitude);
      const lon = Number(c.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      if (lat === 0 && lon === 0) continue;
      const id = `txdot:${district}:${icd}`;
      // A camera can sit under two roadways' lists (one BRY camera did on 2026-10-16).
      if (seen.has(id)) continue;
      seen.add(id);
      cams.push({
        id,
        source: "txdot",
        country: "US",
        region: "Texas",
        name: c.name?.trim() || icd,
        lat,
        lon,
        road: c.equipLoc?.roadway?.trim() || roadway.trim() || undefined,
        imageUrl: snapshotUrl(district, icd),
        mediaType: "jpeg",
        refreshSeconds: TXDOT_SOURCE.refreshSeconds,
        license: TXDOT_SOURCE.license,
        attribution: TXDOT_SOURCE.attribution,
        available: c.statusDescription === "Device Online",
      });
    }
  }
  return cams;
}

/** One snapshot answer -> image bytes. Null when there is no picture in it. Pure. */
export function extractTxdotSnapshot(body: unknown): { base64: string; contentType: string } | null {
  const snippet = (body as { snippet?: unknown } | null)?.snippet;
  if (typeof snippet !== "string" || snippet.length < 16) return null;
  const s = snippet.trim();
  if (!/^[A-Za-z0-9+/=\s]+$/.test(s)) return null;
  if (s.startsWith("/9j/")) return { base64: s, contentType: "image/jpeg" };
  if (s.startsWith("iVBOR")) return { base64: s, contentType: "image/png" };
  return null;
}

const UA = "TrafficNerd/2.0 (+https://github.com/011-sam-110/Provenance)";

async function fetchDistrict(district: string): Promise<Camera[]> {
  const res = await fetch(`${BASE}/GetCctvStatusListByDistrict?districtCode=${district}`, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`TxDOT ${district}: ${res.status}`);
  const body = (await res.json()) as TxdotDistrictBody;
  if (!body || typeof body.roadwayCctvStatuses !== "object") throw new Error(`TxDOT ${district}: bad shape`);
  return normalizeTxdot(body, district);
}

/**
 * Last read per district, so one district's failed request does not delete it from
 * the round. A district that answers with no usable camera (HOU, see above) simply
 * keeps contributing nothing.
 */
const lastByDistrict = new Map<string, Camera[]>();

export async function fetchRegistry(): Promise<Camera[]> {
  const reads = await Promise.allSettled(TXDOT_DISTRICTS.map((d) => fetchDistrict(d)));
  const cams = TXDOT_DISTRICTS.flatMap((d, i) => {
    const r = reads[i];
    if (r.status === "fulfilled") {
      lastByDistrict.set(d, r.value);
      return r.value;
    }
    return lastByDistrict.get(d) ?? [];
  });
  return CameraArray.parse(cams);
}
