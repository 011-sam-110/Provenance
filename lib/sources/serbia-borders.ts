import { Camera, CameraArray, Source } from "@/lib/types";
import {
  SERBIA_BORDER_SITES,
  decodeHtmlEntities,
  isBareIpHost,
} from "@/lib/sources/serbia.data";

// Serbia — MUP (Ministarstvo unutrašnjih poslova) border-crossing cameras. 32
// live HLS streams at 16 crossings, two per crossing, published by the ministry
// on its own portal. Keyless.
//
// WHY WE READ THE PORTAL AND NOT AN AGGREGATOR. This feed was suggested via
// kameresrbije.rs, a third-party directory that lists ~203 Serbian cameras. That
// site's own privacy page states it "only relays publicly available video
// streams from external sources" and that it does "not hold the rights to these
// streams" — so it cannot grant a redistribution right it says it does not have.
// It is a good POINTER and a bad SOURCE OF RECORD, so every camera here is read
// from the operator that actually publishes it. Same reason the Camera rows
// below are attributed to MUP and not to the directory.
//
// THE URL, AND THE SCRIPT IT DECIDES. The portal is WebSphere Portal, and the
// link you get by clicking through carries an `!ut/p/z1/...` navigational state
// token that is not stable. The bare path below returns the same 16 crossings
// and the same 32 streams without one, so that is what we request.
//
// It also decides the ALPHABET, which is worth knowing before you read a name
// here and think something is broken. The state-token URL renders Latin
// ("Granični prelaz Horgoš"); the bare path renders Cyrillic ("Гранични прелаз
// Хоргош"), which is Serbia's official script and the ministry's own default.
// There is no stable way to ask for Latin — `?locale=sr-Latn-RS`, `?lang=lat`
// and a `/sr-lat/` path were all tried and all still answer Cyrillic — so we
// take the operator's wording as published, the way every other adapter does.
// Nothing else varies with it: the crossing key, the camera number and the
// coordinate all come from the URL and the gazetteer, never from the label.
//
// WHY THE CAMERAS ARE NUMBERED AND NOT LABELLED. Each crossing exposes two
// streams and the portal labels NEITHER — it has one link per crossing that
// toggles both. The obvious guess is entry/exit, and the page order does not
// support it: Đala lists `djala2` first and Kotroman lists `kotroman2` first,
// so position does not encode direction. The number therefore comes from the
// operator's own filename and claims nothing more than that.
//
// NO STILL IMAGE. MUP publishes HLS only, so these are `mediaType: "video"`
// with no `imageUrl`. The camera wall already handles that: `live` cameras get
// the ▶ Live button and the HLS player instead of a refreshing <img>.
//
// To re-check the portal by hand:
//   curl -s "https://www.mup.gov.rs/wps/portal/sr/kamer%D0%B5/kamer%D0%B5GP" | grep -o 'toggleCamera([^)]*)'

const PORTAL_URL = "https://www.mup.gov.rs/wps/portal/sr/kamer%D0%B5/kamer%D0%B5GP";
/** The only host this adapter will emit a stream for. */
const STREAM_HOST = "kamere.mup.gov.rs";

export const SERBIA_BORDERS_SOURCE: Source = {
  id: "mup-rs",
  name: "MUP Republike Srbije — border-crossing cameras",
  // No open-data licence is published for this portal. Saying so is more useful
  // than inventing a licence name, and matches how cetsp records the same gap.
  license: "MUP Republike Srbije — public border-crossing camera viewer (no stated licence)",
  attribution:
    "Live border-crossing cameras © Ministarstvo unutrašnjih poslova Republike Srbije (MUP)",
  // Live HLS. 60s mirrors the other live-stream feeds (caltrans, scdot) — it is
  // the still-frame cadence the UI assumes, not a claim about the stream.
  refreshSeconds: 60,
  needsKey: false,
};

/** One stream lifted off the portal, before it is joined to a coordinate. */
export interface MupPortalStream {
  /** Path segment identifying the crossing, e.g. `MaliZvornik`. */
  key: string;
  /** The crossing's name exactly as the portal prints it. */
  name: string;
  /** 1 or 2, taken from the operator's own filename. */
  index: number;
  streamUrl: string;
}

/** Accept only an https .m3u8 on the ministry's own streaming host. */
function usableStream(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (isBareIpHost(raw)) return null;
  if (u.protocol !== "https:") return null;
  if (u.hostname !== STREAM_HOST) return null;
  if (!u.pathname.toLowerCase().endsWith(".m3u8")) return null;
  return u;
}

/**
 * Pull every `toggleCamera('<uuid>','<url1>', '<url2>')` off the portal.
 *
 * Pure, so the parse is unit-testable against a captured page without network.
 * The crossing key and the camera number both come from the STREAM URL rather
 * than from the markup order, because the order is not meaningful (see header).
 */
export function parseMupPortal(html: string): MupPortalStream[] {
  const out: MupPortalStream[] = [];
  const seen = new Set<string>();
  const re = /toggleCamera\('[^']*',\s*'([^']+)'\s*,\s*'([^']+)'\)[^>]*>\s*([^<]+)/g;
  for (const m of html.matchAll(re)) {
    const name = decodeHtmlEntities(m[3]).replace(/\s+/g, " ").trim();
    if (!name) continue;
    for (const raw of [m[1], m[2]]) {
      const u = usableStream(raw);
      if (!u) continue;
      const parts = u.pathname.split("/").filter(Boolean);
      const key = parts.at(-2);
      const file = parts.at(-1) ?? "";
      if (!key) continue;
      const digits = file.replace(/\.m3u8$/i, "").match(/(\d+)$/);
      const index = digits ? Number(digits[1]) : 0;
      if (!index) continue;
      const id = `${key}-${index}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ key, name, index, streamUrl: u.toString() });
    }
  }
  return out;
}

/**
 * Join parsed streams to the verified gazetteer. A crossing with no row in
 * SERBIA_BORDER_SITES is DROPPED, not placed at a guessed point — if MUP adds a
 * seventeenth crossing it stays off the map until somebody geolocates it.
 */
export function normalizeSerbiaBorders(streams: MupPortalStream[]): Camera[] {
  const sites = new Map(SERBIA_BORDER_SITES.map((s) => [s.key.toLowerCase(), s]));
  const cams: Camera[] = [];
  for (const s of streams) {
    const site = sites.get(s.key.toLowerCase());
    if (!site) continue;
    cams.push({
      id: `mup-rs:${s.key.toLowerCase()}-${s.index}`,
      source: "mup-rs",
      country: "RS",
      region: "Border crossings",
      name: `${s.name} (kamera ${s.index})`,
      lat: site.lat,
      lon: site.lon,
      streamUrl: s.streamUrl,
      mediaType: "video",
      refreshSeconds: SERBIA_BORDERS_SOURCE.refreshSeconds,
      license: SERBIA_BORDERS_SOURCE.license,
      attribution: SERBIA_BORDERS_SOURCE.attribution,
      available: true,
    });
  }
  return cams;
}

export async function fetchRegistry(): Promise<Camera[]> {
  // 15s is the house default for a page fetch. Measured over five runs the
  // portal answers in 0.78-1.25s for ~104 KB, so this is headroom and not a
  // budget the feed is expected to use. No per-feed budgetMs in registry.ts for
  // the same reason: the 10s default already clears it by ~8x.
  const res = await fetch(PORTAL_URL, {
    headers: {
      Accept: "text/html",
      "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`MUP border cameras: ${res.status}`);
  const cams = normalizeSerbiaBorders(parseMupPortal(await res.text()));
  // A 200 that parses to nothing means the portal's markup moved. Throwing lets
  // registry.ts keep this feed's last-good cameras instead of silently emptying
  // Serbia's border layer.
  if (cams.length === 0) throw new Error("MUP border cameras: portal returned no parseable streams");
  return CameraArray.parse(cams);
}
