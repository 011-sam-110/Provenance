import { Camera, CameraArray, Source } from "@/lib/types";
import { clean, envValue, fetchJson, validLatLon } from "@/lib/sources/feedKit";

// Slovenia — the road cameras of DARS d.d. (the motorway company) and DRSI (the state
// roads directorate), from the Slovenian National Access Point. About 470 cameras,
// images on kamere.dars.si, under CC BY-SA 4.0 (stated on the NAP dataset
// 30d9d764-649a-758e-93b0-a55e14b293de). Free NAP B2B registration; HTTP Basic.
//
// DORMANT UNTIL NAP_SLOVENIA_USER and NAP_SLOVENIA_PASS are set.
//
// THE SHAPE IS FROM THE AUDIT'S READING OF THE NAP DATASET (a GeoJSON whose features
// group cameras: each feature's properties carry an `items` list, one item per camera,
// with `image`, `title_eng` / `text_eng` and `KameraOwner`), not from a response: no
// account existed on 2026-10-16. The parser also accepts a flat feature per camera,
// and both spellings it has seen for each field. Check it against the first real
// response before trusting the count.
//
// The keyless fallback the audit found (promet.si's protobuf request answered with a
// Mapbox vector tile) is not built: it is brittle, and this is the licensed route.
//
// LIVENESS: `active` from the feed. Last-Modified on kamere.dars.si is the request
// time, so it cannot date a frame.

const ENDPOINT = "https://b2b.nap.si/data/b2b.cameras.geojson";
const IMAGE_HOST = "kamere.dars.si";

export const DARS_SI_SOURCE: Source = {
  id: "dars-si",
  name: "DARS and DRSI road cameras via NAP Slovenia",
  license: "CC BY-SA 4.0 — DARS d.d. / DRSI via NAP Slovenia",
  attribution: "Road-camera images © DARS d.d. and Direkcija RS za infrastrukturo (DRSI), via NAP Slovenia",
  refreshSeconds: 120,
  needsKey: true,
};

type Dict = Record<string, unknown>;

/** The Basic credential, or null while dormant. Never logged. */
export function napSloveniaAuthHeader(): string | null {
  const user = envValue("NAP_SLOVENIA_USER");
  const pass = envValue("NAP_SLOVENIA_PASS");
  if (!user || !pass) return null;
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

const pick = (o: Dict, ...names: string[]): unknown => {
  for (const n of names) if (o[n] != null && o[n] !== "") return o[n];
  return undefined;
};

export function normalizeDarsSi(body: { features?: { geometry?: { coordinates?: unknown[] } | null; properties?: Dict }[] }): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const f of body.features ?? []) {
    const props = f.properties ?? {};
    const [lon, lat] = (f.geometry?.coordinates ?? []) as number[];
    const items = (pick(props, "items", "Items") as Dict[] | undefined) ?? [props];
    for (const it of Array.isArray(items) ? items : []) {
      const ilat = Number(pick(it, "lat", "Lat", "latitude") ?? lat);
      const ilon = Number(pick(it, "lon", "Lon", "lng", "longitude") ?? lon);
      if (!validLatLon(ilat, ilon)) continue;
      const image = clean(pick(it, "image", "Image") as string);
      const name = clean(pick(it, "title_eng", "Title_eng", "title", "Title") as string);
      const id = clean(String(pick(it, "id", "Id", "ID") ?? ""));
      if (!image || !name || !id || seen.has(id)) continue;
      try {
        if (new URL(image).hostname !== IMAGE_HOST) continue;
      } catch {
        continue;
      }
      seen.add(id);
      const owner = clean(pick(it, "KameraOwner", "kameraOwner") as string);
      const active = pick(it, "active", "Active");
      out.push({
        id: `dars-si:${id}`,
        source: "dars-si",
        country: "SI",
        region: clean(pick(props, "title_eng", "Title", "title") as string) ?? "Slovenia",
        name,
        lat: ilat,
        lon: ilon,
        direction: clean(pick(it, "text_eng", "Text_eng") as string),
        imageUrl: image,
        mediaType: "jpeg",
        refreshSeconds: DARS_SI_SOURCE.refreshSeconds,
        license: DARS_SI_SOURCE.license,
        attribution: owner ? `${DARS_SI_SOURCE.attribution}. Camera owner: ${owner}` : DARS_SI_SOURCE.attribution,
        available: active === undefined ? true : active === true || active === "true" || active === 1,
      });
    }
  }
  return out;
}

export async function fetchRegistry(): Promise<Camera[]> {
  const auth = napSloveniaAuthHeader();
  if (!auth) return [];
  return CameraArray.parse(normalizeDarsSi(await fetchJson(ENDPOINT, { timeoutMs: 9_000, headers: { Authorization: auth } })));
}
