import { Camera, CameraArray, Source } from "@/lib/types";
import { FrameProber, type FrameProbe } from "@/lib/sources/feedKit";

// Tamar Crossings — the Tamar Bridge and Torpoint Ferry Joint Committee (Plymouth City
// Council and Cornwall Council), the six webcams on its own travel page. Keyless:
// each camera is one PHP URL, webcam-load.php?camid=N, returning a JPEG. robots.txt
// allows all with Crawl-delay 10, so the proxy refresh is 60 s and the liveness probe
// is one HEAD per camera every ten minutes.
//
// THE LIST IS A COMMITTED TABLE, read off the operator's page on 2026-10-16 (the
// audit named five; the page now carries a sixth, 4677). The page publishes no
// coordinates, so each camera is pinned to the named OpenStreetMap element its label
// describes:
//   Tamar Bridge                          way 155866686  (cameras 87, 84, 4677)
//   Saltash Tunnel                        way 5008773    (camera 4676)
//   Torpoint Ferry terminal, Torpoint     node 1119900401 (camera 86)
//   Torpoint Ferry Queues (Devonport)     way 40856613   (camera 85)
//
// LIVENESS: the PHP sends no Last-Modified, so the HEAD's Content-Length decides: on
// audit day one camera answered with an empty body while its label read "Webcam is
// currently unavailable". An empty or tiny body is unavailable.
//
// Licence: none is stated; recorded as such.

const IMAGE = (camid: number) => `https://www.tamarcrossings.org.uk/wp-content/themes/tamar/php/webcam-load.php?camid=${camid}`;

export const TAMAR_SOURCE: Source = {
  id: "tamar",
  name: "Tamar Crossings (Tamar Bridge and Torpoint Ferry Joint Committee)",
  license: "Tamar Bridge and Torpoint Ferry Joint Committee — no stated licence",
  attribution: "Webcam images © Tamar Crossings (Tamar Bridge and Torpoint Ferry Joint Committee)",
  refreshSeconds: 60,
  needsKey: false,
};

export interface TamarCamera {
  camid: number;
  name: string;
  direction?: string;
  lat: number;
  lon: number;
  /** The OSM element the pin was taken from. */
  osm: string;
}

export const TAMAR_CAMERAS: readonly TamarCamera[] = [
  { camid: 87, name: "Plymouth from Bridge Tower", direction: "east, towards Plymouth", lat: 50.4082, lon: -4.20356, osm: "way 155866686 (Tamar Bridge)" },
  { camid: 84, name: "Saltash from Bridge Tower", direction: "west, towards Saltash", lat: 50.4082, lon: -4.20356, osm: "way 155866686 (Tamar Bridge)" },
  { camid: 4677, name: "Plymouth A38", direction: "from Tamar Bridge towards Plymouth", lat: 50.4082, lon: -4.20356, osm: "way 155866686 (Tamar Bridge)" },
  { camid: 4676, name: "Saltash A38", direction: "Saltash Tunnel, looking up the A38", lat: 50.41154, lon: -4.21455, osm: "way 5008773 (Saltash Tunnel)" },
  { camid: 86, name: "Torpoint Ferry, Torpoint Waiting Area", direction: "traffic waiting to board eastbound", lat: 50.37522, lon: -4.19249, osm: "node 1119900401 (Torpoint Ferry terminal)" },
  { camid: 85, name: "Torpoint Ferry, Devonport Waiting Area", direction: "traffic waiting to board westbound", lat: 50.37605, lon: -4.18174, osm: "way 40856613 (Torpoint Ferry Queues, Devonport)" },
];

/** A body under this many bytes is not a picture. */
const MIN_IMAGE_BYTES = 1_000;

/** Live, dead or unknown for one Tamar camera. Pure. */
export function tamarVerdict(p: FrameProbe | undefined): boolean | undefined {
  if (!p || p.status === 0) return undefined;
  if (p.status < 200 || p.status >= 300) return false;
  return (p.bytes ?? 0) >= MIN_IMAGE_BYTES;
}

export function normalizeTamar(probes: ReadonlyMap<string, FrameProbe> = new Map(), cams: readonly TamarCamera[] = TAMAR_CAMERAS): Camera[] {
  return cams.map((c) => {
    const id = `tamar:${c.camid}`;
    return {
      id,
      source: "tamar",
      country: "GB",
      region: "Tamar Crossings (Plymouth / Saltash)",
      name: c.name,
      lat: c.lat,
      lon: c.lon,
      road: "A38",
      direction: c.direction,
      imageUrl: IMAGE(c.camid),
      mediaType: "jpeg",
      refreshSeconds: TAMAR_SOURCE.refreshSeconds,
      license: TAMAR_SOURCE.license,
      attribution: TAMAR_SOURCE.attribution,
      available: tamarVerdict(probes.get(id)) ?? true,
    };
  });
}

const prober = new FrameProber({ revisitMs: 10 * 60_000, concurrency: 1, waitMs: 4_000 });

export async function fetchRegistry(): Promise<Camera[]> {
  const probes = await prober.sweep(TAMAR_CAMERAS.map((c) => ({ id: `tamar:${c.camid}`, url: IMAGE(c.camid) })));
  return CameraArray.parse(normalizeTamar(probes));
}
