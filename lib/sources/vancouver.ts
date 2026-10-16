import { Camera, CameraArray, Source } from "@/lib/types";
import { FrameProber, clean, fetchJson, fetchText, probeVerdict, validLatLon, type FrameProbe } from "@/lib/sources/feedKit";
import { decodeHtmlEntities } from "@/lib/sources/serbia.data";

// Vancouver — City of Vancouver traffic cameras. The open-data dataset
// "web-cam-url-links" (keyless) gives each of 219 sites a name, a coordinate and a
// link to an HTML page on trafficcams.vancouver.ca; the page, not the dataset, names
// the one to four directional JPEGs at that site. Measured 2026-10-16: 219 sites, 217
// of them more than 150 m from any DriveBC camera.
//
// COST. Reading 219 pages is a crawl, so it is done at most once a day, one page at
// a time with a pause between, in the background; the registry is never made to
// wait for it. Until the first crawl has finished the feed answers with an error,
// so the registry shows nothing rather than a partial city. Afterwards the previous
// day's map serves while the next crawl runs.
//
// LIVENESS: the stills carry a real Last-Modified, so a FrameProber dates them (at
// most every 30 minutes each) and the 60-minute rule applies.
//
// Licence: Open Government Licence – Vancouver (stated on the dataset).

const DATASET = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/web-cam-url-links/exports/json";
const PAGE_HOST = "trafficcams.vancouver.ca";
const CRAWL_EVERY_MS = 24 * 60 * 60 * 1000;
const PAGE_GAP_MS = 1_000;

export const VANCOUVER_SOURCE: Source = {
  id: "vancouver",
  name: "City of Vancouver traffic cameras",
  license: "Open Government Licence – Vancouver",
  attribution: "Traffic-camera images © City of Vancouver",
  refreshSeconds: 120,
  needsKey: false,
};

export interface VancouverSite {
  mapid?: string;
  name?: string;
  url?: string;
  geo_local_area?: string;
  geo_point_2d?: { lat?: number; lon?: number };
}

export interface VancouverView {
  /** Absolute JPEG URL on trafficcams.vancouver.ca/cameraimages/. */
  image: string;
  /** The operator's `alt` text, e.g. "Cambie Bridge - North". */
  alt: string;
}

/** The camera stills named on one site page. Pure. */
export function parseVancouverPage(html: string, pageUrl: string): VancouverView[] {
  const out: VancouverView[] = [];
  for (const m of html.matchAll(/<img\s+src="(cameraimages\/[^"]+\.jpg)"\s+alt="([^"]*)"/gi)) {
    let u: URL;
    try {
      u = new URL(m[1], pageUrl);
    } catch {
      continue;
    }
    if (u.hostname !== PAGE_HOST) continue;
    const alt = clean(decodeHtmlEntities(m[2])) ?? "";
    if (!out.some((v) => v.image === u.toString())) out.push({ image: u.toString(), alt });
  }
  return out;
}

export function normalizeVancouver(
  sites: readonly VancouverSite[],
  views: ReadonlyMap<string, VancouverView[]>,
  probes: ReadonlyMap<string, FrameProbe> = new Map(),
): Camera[] {
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const s of sites) {
    const mapid = clean(s.mapid);
    const siteName = clean(s.name);
    const lat = s.geo_point_2d?.lat;
    const lon = s.geo_point_2d?.lon;
    if (!mapid || !siteName || !s.url || !validLatLon(lat, lon)) continue;
    for (const v of views.get(s.url) ?? []) {
      const file = v.image.split("/").pop()!.replace(/\.jpg$/i, "");
      const id = `vancouver:${mapid}-${file}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const dir = v.alt.match(/\s-\s*([A-Za-z ]+)$/);
      const probe = probes.get(id);
      out.push({
        id,
        source: "vancouver",
        country: "CA",
        region: clean(s.geo_local_area) ?? "Vancouver",
        name: siteName,
        lat,
        lon: lon as number,
        direction: dir ? dir[1].trim() : undefined,
        imageUrl: v.image,
        mediaType: "jpeg",
        refreshSeconds: VANCOUVER_SOURCE.refreshSeconds,
        license: VANCOUVER_SOURCE.license,
        attribution: VANCOUVER_SOURCE.attribution,
        available: probeVerdict(probe) ?? true,
        ...(probe?.lastModified ? { lastSampledAt: new Date(probe.lastModified).toISOString() } : {}),
      });
    }
  }
  return out;
}

let crawled: { at: number; sites: VancouverSite[]; views: Map<string, VancouverView[]> } | null = null;
let crawling: Promise<void> | null = null;

async function crawl(): Promise<void> {
  const sites = await fetchJson<VancouverSite[]>(DATASET, { timeoutMs: 15_000 });
  const views = new Map<string, VancouverView[]>();
  for (const s of Array.isArray(sites) ? sites : []) {
    if (!s.url) continue;
    try {
      if (new URL(s.url).hostname !== PAGE_HOST) continue;
      views.set(s.url, parseVancouverPage(await fetchText(s.url, { timeoutMs: 10_000 }), s.url));
    } catch {
      // One page failing costs that site, not the city.
    }
    await new Promise((r) => setTimeout(r, PAGE_GAP_MS));
  }
  if (views.size) crawled = { at: Date.now(), sites, views };
}

const prober = new FrameProber({ revisitMs: 30 * 60_000, concurrency: 6, waitMs: 2_500 });

export async function fetchRegistry(): Promise<Camera[]> {
  if ((!crawled || Date.now() - crawled.at > CRAWL_EVERY_MS) && !crawling) {
    crawling = crawl()
      .catch(() => undefined)
      .finally(() => {
        crawling = null;
      });
  }
  if (!crawled) throw new Error("Vancouver cameras: first daily crawl of the site pages is still running");
  const first = normalizeVancouver(crawled.sites, crawled.views);
  const probes = await prober.sweep(first.map((c) => ({ id: c.id, url: c.imageUrl! })));
  return CameraArray.parse(normalizeVancouver(crawled.sites, crawled.views, probes));
}
