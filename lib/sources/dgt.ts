import { Camera, CameraArray, Source } from "@/lib/types";
import { FrameProber, clean, fetchText, probeVerdict, validLatLon, type FrameProbe } from "@/lib/sources/feedKit";

// Spain — Dirección General de Tráfico (DGT), the state road network's cameras,
// from the DGT National Access Point as DATEX II v3.7. Keyless. Measured 2026-10-16:
// 1,960 cameras, each with coordinates, road, kilometre point, province and a still
// at etraffic.dgt.es. It does not cover the Basque Country or Catalonia, which run
// their own traffic services.
//
// THE FILE IS 3.7 MB OF XML and this repo has no XML parser, so the device blocks are
// read with a regular expression over a fixed, documented shape. A block that does not
// carry every field we need is skipped, never guessed.
//
// LIVENESS. The publication has no per-camera status, but the stills carry a real
// Last-Modified (10 of 10 sampled were 3 to 14 minutes old). Heading 1,960 stills
// every five minutes would be a nuisance to DGT, so a FrameProber asks about each
// still at most every 30 minutes, a slice per refresh, and a still older than an
// hour when we looked is shown as unavailable. A still not yet asked about is shown
// as available, because the operator still publishes it.
//
// Licence: Creative Commons Attribution, stated on the NAP resource page
// nap.dgt.es/en/dataset/camaras-dgt-datex2-v3-7.

const ENDPOINT = "https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v37.xml";
const IMAGE_PREFIX = "https://etraffic.dgt.es/camarasEtraffic/";

export const DGT_SOURCE: Source = {
  id: "dgt",
  name: "Dirección General de Tráfico (Spain)",
  license: "CC BY — Dirección General de Tráfico (DGT National Access Point)",
  attribution: "Traffic-camera images © Dirección General de Tráfico (DGT)",
  refreshSeconds: 300,
  needsKey: false,
};

/** One camera as the DATEX II publication carries it. */
export interface DgtDevice {
  id: string;
  road?: string;
  destination?: string;
  province?: string;
  km?: number;
  lat: number;
  lon: number;
  imageUrl: string;
}

const tag = (block: string, name: string): string | undefined => {
  const m = block.match(new RegExp(`<[\\w]+:${name}>([^<]*)</[\\w]+:${name}>`));
  return m ? clean(m[1]) : undefined;
};

const title = (s: string | undefined): string | undefined =>
  s ? s.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) : undefined;

/** Read every camera device out of the publication. Pure. */
export function parseDgt(xml: string): DgtDevice[] {
  const out: DgtDevice[] = [];
  for (const m of xml.matchAll(/<(\w+):device\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/\1:device>/g)) {
    const [, , id, block] = m;
    if (tag(block, "typeOfDevice") !== "camera") continue;
    const lat = Number(tag(block, "latitude"));
    const lon = Number(tag(block, "longitude"));
    const imageUrl = tag(block, "deviceUrl");
    if (!validLatLon(lat, lon) || !imageUrl || !imageUrl.startsWith(IMAGE_PREFIX)) continue;
    const km = Number(tag(block, "kilometerPoint"));
    out.push({
      id,
      road: tag(block, "roadName"),
      destination: tag(block, "roadDestination"),
      province: tag(block, "province"),
      km: Number.isFinite(km) ? km : undefined,
      lat,
      lon,
      imageUrl,
    });
  }
  return out;
}

export function normalizeDgt(devices: readonly DgtDevice[], probes: ReadonlyMap<string, FrameProbe> = new Map()): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const d of devices) {
    // A camera needs a road to be named after; the publication has no other label.
    if (!d.road || seen.has(d.id)) continue;
    seen.add(d.id);
    const id = `dgt:${d.id}`;
    const where = [d.km !== undefined ? `km ${d.km.toFixed(1)}` : undefined, title(d.province)]
      .filter(Boolean)
      .join(", ");
    out.push({
      id,
      source: "dgt",
      country: "ES",
      region: title(d.province) ?? "Spain",
      name: where ? `${d.road}, ${where}` : d.road,
      lat: d.lat,
      lon: d.lon,
      road: d.road,
      direction: d.destination ? `towards ${title(d.destination)}` : undefined,
      imageUrl: d.imageUrl,
      mediaType: "jpeg",
      refreshSeconds: DGT_SOURCE.refreshSeconds,
      license: DGT_SOURCE.license,
      attribution: DGT_SOURCE.attribution,
      available: probeVerdict(probes.get(id)) ?? true,
      ...(probes.get(id)?.lastModified ? { lastSampledAt: new Date(probes.get(id)!.lastModified!).toISOString() } : {}),
    });
  }
  return out;
}

const prober = new FrameProber({ revisitMs: 30 * 60_000, concurrency: 12, waitMs: 3_000 });

export async function fetchRegistry(): Promise<Camera[]> {
  const devices = parseDgt(await fetchText(ENDPOINT, { timeoutMs: 6_000 }));
  const first = normalizeDgt(devices);
  const probes = await prober.sweep(first.map((c) => ({ id: c.id, url: c.imageUrl! })));
  return CameraArray.parse(normalizeDgt(devices, probes));
}
