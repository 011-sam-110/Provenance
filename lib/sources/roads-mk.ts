import { Camera, CameraArray, Source } from "@/lib/types";
import { FEED_UA, clean, fetchJson, fetchText, validLatLon } from "@/lib/sources/feedKit";
import { probePlaylist } from "@/lib/sources/serbia-borders";
import { decodeHtmlEntities, isBareIpHost } from "@/lib/sources/serbia.data";

// North Macedonia — ЈП за државни патишта (Public Enterprise for State Roads), its
// own camera page roads.org.mk/patna-mreza/video-kameri/. Keyless. The page carries a
// `data-markers` list of sites with the operator's own coordinates; each site's popup
// (a WordPress REST call) names it and lists its HLS streams, which the enterprise's
// ISP Neotel hosts on streaming1.neotel.net.mk. AMSM's camera page embeds this same
// page. Measured 2026-10-16: 21 sites, 33 playlists, 33 answering 200.
//
// COST. The site list changes rarely, so the page and its popups are read at most
// every six hours (about 22 requests). Each refresh then GETs every playlist (a few
// hundred bytes each) and a playlist that is refused marks its camera unavailable,
// the same rule as the Serbian border cameras.
//
// Licence: none is stated on roads.org.mk; recorded as such.

const PAGE_URL = "https://roads.org.mk/patna-mreza/video-kameri/";
const POPUP_URL = (id: number) =>
  `https://roads.org.mk/wp-json/jet-engine/v2/get-map-marker-info/?listing_id=10771&post_id=${id}&source=posts`;
const STREAM_HOST = "streaming1.neotel.net.mk";
const SITE_TTL_MS = 6 * 60 * 60 * 1000;

export const ROADS_MK_SOURCE: Source = {
  id: "roads-mk",
  name: "ЈП за државни патишта (North Macedonia)",
  license: "Public Enterprise for State Roads (roads.org.mk) — no stated licence",
  attribution: "Live road cameras © ЈП за државни патишта (Public Enterprise for State Roads, North Macedonia)",
  refreshSeconds: 60,
  needsKey: false,
};

export interface MkMarker {
  id: number;
  lat: number;
  lon: number;
}

export interface MkSite extends MkMarker {
  name: string;
  streams: string[];
}

/** The `data-markers` list off the camera page. Pure. */
export function parseMkMarkers(html: string): MkMarker[] {
  const m = html.match(/data-markers="([^"]+)"/);
  if (!m) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(decodeHtmlEntities(m[1]));
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const out: MkMarker[] = [];
  for (const r of rows as { id?: unknown; latLang?: { lat?: unknown; lng?: unknown } }[]) {
    const lat = Number(r.latLang?.lat);
    const lon = Number(r.latLang?.lng);
    if (typeof r.id !== "number" || !validLatLon(lat, lon)) continue;
    out.push({ id: r.id, lat, lon });
  }
  return out;
}

/** A site's name and streams out of its popup HTML. Pure. */
export function parseMkPopup(html: string): { name?: string; streams: string[] } {
  const h2 = html.match(/<h2[^>]*>([^<]+)<\/h2>/);
  const streams: string[] = [];
  for (const m of html.matchAll(/streamer(?:_m)?\.html\?src=(https:\/\/[^"'\s<>]+\.m3u8)/g)) {
    let u: URL;
    try {
      u = new URL(m[1]);
    } catch {
      continue;
    }
    if (u.hostname !== STREAM_HOST || isBareIpHost(m[1]) || !u.pathname.startsWith("/stream/")) continue;
    if (!streams.includes(u.toString())) streams.push(u.toString());
  }
  return { name: h2 ? clean(decodeHtmlEntities(h2[1])) : undefined, streams };
}

export function normalizeRoadsMk(
  sites: readonly MkSite[],
  probes: ReadonlyMap<string, boolean> = new Map(),
  probedAt?: number,
): Camera[] {
  const out: Camera[] = [];
  for (const s of sites) {
    s.streams.forEach((url, i) => {
      const file = new URL(url).pathname.split("/").pop()!.replace(/\.m3u8$/, "");
      const ok = probes.get(url);
      out.push({
        id: `roads-mk:${s.id}-${file}`,
        source: "roads-mk",
        country: "MK",
        region: "North Macedonia",
        name: s.streams.length > 1 ? `${s.name} (${i + 1})` : s.name,
        lat: s.lat,
        lon: s.lon,
        streamUrl: url,
        mediaType: "video",
        refreshSeconds: ROADS_MK_SOURCE.refreshSeconds,
        license: ROADS_MK_SOURCE.license,
        attribution: ROADS_MK_SOURCE.attribution,
        available: ok ?? true,
        ...(ok === true && probedAt !== undefined ? { lastSampledAt: new Date(probedAt).toISOString() } : {}),
      });
    });
  }
  return out;
}

let siteCache: { at: number; sites: MkSite[] } | null = null;

async function loadSites(): Promise<MkSite[]> {
  if (siteCache && Date.now() - siteCache.at < SITE_TTL_MS) return siteCache.sites;
  const markers = parseMkMarkers(await fetchText(PAGE_URL, { timeoutMs: 8_000 }));
  const sites: MkSite[] = [];
  // Four at a time: this is a small WordPress site, not a CDN.
  for (let i = 0; i < markers.length; i += 4) {
    const batch = await Promise.all(
      markers.slice(i, i + 4).map(async (mk) => {
        try {
          const body = await fetchJson<{ html?: string }>(POPUP_URL(mk.id), {
            timeoutMs: 6_000,
            headers: { "User-Agent": FEED_UA },
          });
          const { name, streams } = parseMkPopup(body.html ?? "");
          return name && streams.length ? { ...mk, name, streams } : null;
        } catch {
          return null;
        }
      }),
    );
    for (const s of batch) if (s) sites.push(s);
  }
  if (sites.length) siteCache = { at: Date.now(), sites };
  else if (siteCache) return siteCache.sites;
  return sites;
}

let loading: Promise<MkSite[]> | null = null;

/**
 * The site list, without making the registry wait for a cold read: about 22 requests
 * to a small WordPress site took 12.5 s on 2026-10-16, past the 10 s feed budget. A
 * cold read runs in the background and this waits at most 7 s for it; the next round
 * uses what it found.
 */
async function sitesWithin(ms: number): Promise<MkSite[]> {
  if (siteCache && Date.now() - siteCache.at < SITE_TTL_MS) return siteCache.sites;
  if (!loading) {
    loading = loadSites()
      .catch(() => siteCache?.sites ?? [])
      .finally(() => {
        loading = null;
      });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), ms);
  });
  const got = await Promise.race([loading, timeout]);
  if (timer) clearTimeout(timer);
  if (got) return got;
  if (siteCache) return siteCache.sites;
  throw new Error("North Macedonia cameras: the first read of the site list is still running");
}

export async function fetchRegistry(): Promise<Camera[]> {
  const sites = await sitesWithin(7_000);
  const urls = sites.flatMap((s) => s.streams);
  const probedAt = Date.now();
  const results = await Promise.all(urls.map((u) => probePlaylist(u)));
  const probes = new Map<string, boolean>();
  urls.forEach((u, i) => {
    if (results[i] !== undefined) probes.set(u, results[i]!);
  });
  return CameraArray.parse(normalizeRoadsMk(sites, probes, probedAt));
}
