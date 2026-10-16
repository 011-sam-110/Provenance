import { Camera, CameraArray, Source } from "@/lib/types";

// Iceland — Vegagerðin (Icelandic Road & Coastal Administration) road-weather and
// mountain-pass webcams (~160 stations, nationwide ring road + passes). Keyless.
// `GET /api/vefmyndavelar2014_1` (http → https 302) returns a FLAT array of rows —
// one row per camera VIEW, with several views sharing a station (`Maelist_nr`). We
// GROUP by `Maelist_nr` into ONE marker per station, taking its first view that has
// a usable image. Coordinates are `Breidd`=latitude, `Lengd`=longitude (ignore the
// `PntX`/`PntY` ISN93 metres). `Slod` is a full JPEG URL on www.vegagerdin.is.

export const ICELAND_SOURCE: Source = {
  id: "iceland",
  name: "Vegagerðin (Icelandic Road & Coastal Administration)",
  // The operator's own terms (vegagerdin.is, "Terms and conditions" for its web
  // services) put data AND photographs, road-camera images included, under CC BY 4.0
  // with credit to IRCA. This string said "Open Data Terms of Use" until 2026-10-16.
  license: "CC BY 4.0 (Vegagerðin / IRCA)",
  attribution:
    "Live road-camera data © Vegagerðin (Icelandic Road & Coastal Administration)",
  refreshSeconds: 300, // road-weather cams update slowly
  needsKey: false,
};

export interface IcelandRow {
  Maelist_nr?: number | string; // station id — group key (one marker per station)
  Myndavel?: string; // station name
  Vegheiti?: string; // road name
  NrVegur?: string | number; // road number
  Skyring?: string; // view description
  Slod?: string; // full JPEG URL
  Breidd?: number | string; // latitude
  Lengd?: number | string; // longitude
}

export function normalizeIceland(rows: IcelandRow[]): Camera[] {
  const cams: Camera[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const stationId = (r.Maelist_nr ?? "").toString().trim();
    if (!stationId || seen.has(stationId)) continue; // one marker per station
    const lat = Number(r.Breidd); // Breidd = latitude
    const lon = Number(r.Lengd); // Lengd  = longitude
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const image = r.Slod?.trim();
    if (!image || !/^https?:\/\//.test(image)) continue;
    // Only commit the station once a fully-usable view is found, so a station whose
    // first row lacks an image still maps off a later (valid) view.
    seen.add(stationId);
    cams.push({
      id: `iceland:${stationId}`,
      source: "iceland",
      country: "IS",
      region: "Iceland",
      name: r.Myndavel?.trim() || `Vegagerðin ${stationId}`,
      lat,
      lon,
      road: r.Vegheiti?.trim() || (r.NrVegur != null ? r.NrVegur.toString().trim() : undefined) || undefined,
      imageUrl: image.split("?")[0], // drop any cache-bust query for a stable URL
      mediaType: "jpeg",
      refreshSeconds: ICELAND_SOURCE.refreshSeconds,
      license: ICELAND_SOURCE.license,
      attribution: ICELAND_SOURCE.attribution,
      available: true,
    });
  }
  return cams;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const res = await fetch("https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1", {
    headers: {
      Accept: "application/json",
      "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Iceland cameras: ${res.status}`);
  const json = (await res.json()) as IcelandRow[];
  return CameraArray.parse(normalizeIceland(json));
}
