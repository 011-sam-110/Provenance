import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, fetchJson, frameFresh, validLatLon } from "@/lib/sources/feedKit";

// Lithuania — Via Lietuva, the state road administration, through its own traffic
// portal eismoinfo.lt. Two keyless endpoints joined on the camera id: the camera
// table (name, road, kilometre, last frame time, image) and the map layer "VKR"
// (Vaizdo kameros) that carries each camera's WGS84 point. The table's own x/y are
// LKS94 metres and are not used. Measured 2026-10-16: 313 cameras, median frame 9.7
// minutes old, 9 older than an hour.
//
// LIVENESS: the table's `date` (the last frame) against the usual 60-minute rule.
// Licence: none is stated anywhere on eismoinfo.lt; recorded as such, the same way
// cetsp records the same gap.

const TABLE_URL = "https://eismoinfo.lt/eismoinfo-backend-v2/camera-info-table";
const LAYER_URL = "https://eismoinfo.lt/eismoinfo-backend-v2/layer-static-features/VKR";
const IMAGE_PREFIX = "https://eismoinfo.lt/eismoinfo-backend-v2/image-provider/camera/last?id=";

export const EISMOINFO_SOURCE: Source = {
  id: "eismoinfo",
  name: "Via Lietuva — eismoinfo.lt road cameras (Lithuania)",
  license: "Via Lietuva (eismoinfo.lt) — no stated licence",
  attribution: "Road-camera images © Via Lietuva (eismoinfo.lt)",
  refreshSeconds: 300,
  needsKey: false,
};

export interface EismoinfoRow {
  id?: number | string;
  name?: string;
  roadNr?: string;
  roadName?: string;
  date?: number;
  image?: string;
}

export interface EismoinfoLayer {
  layer?: string;
  features?: { id?: string | number; points?: { point?: [number, number] }[] }[];
}

export function normalizeEismoinfo(
  rows: readonly EismoinfoRow[],
  layers: readonly EismoinfoLayer[],
  now: number = Date.now(),
): Camera[] {
  const points = new Map<string, [number, number]>();
  for (const l of layers) {
    if (l.layer !== "VKR") continue;
    for (const f of l.features ?? []) {
      const pt = f.points?.[0]?.point; // [lat, lon]
      if (f.id != null && pt) points.set(String(f.id), pt);
    }
  }
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = r.id == null ? "" : String(r.id);
    const pt = points.get(id);
    const name = clean(r.name);
    if (!id || !pt || !name || seen.has(id)) continue;
    const [lat, lon] = pt;
    if (!validLatLon(lat, lon)) continue;
    seen.add(id);
    const frameAt = typeof r.date === "number" && Number.isFinite(r.date) ? r.date : null;
    out.push({
      id: `eismoinfo:${id}`,
      source: "eismoinfo",
      country: "LT",
      region: "Lithuania",
      name,
      lat,
      lon,
      road: clean(r.roadNr) ?? clean(r.roadName),
      // Built from the id rather than trusted, so the image is always on the operator's host.
      imageUrl: `${IMAGE_PREFIX}${encodeURIComponent(id)}`,
      mediaType: "jpeg",
      refreshSeconds: EISMOINFO_SOURCE.refreshSeconds,
      license: EISMOINFO_SOURCE.license,
      attribution: EISMOINFO_SOURCE.attribution,
      available: frameFresh(frameAt, now),
      ...(frameAt !== null ? { lastSampledAt: new Date(frameAt).toISOString() } : {}),
    });
  }
  return out;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const [rows, layers] = await Promise.all([
    fetchJson<EismoinfoRow[]>(TABLE_URL, { timeoutMs: 8_000 }),
    fetchJson<EismoinfoLayer[]>(LAYER_URL, { timeoutMs: 8_000 }),
  ]);
  return CameraArray.parse(normalizeEismoinfo(rows, layers));
}
