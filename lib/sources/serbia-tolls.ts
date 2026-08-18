import { Camera, CameraArray, Source } from "@/lib/types";
import {
  SERBIA_TOLL_PLAZAS,
  decodeHtmlEntities,
  isBareIpHost,
} from "@/lib/sources/serbia.data";

// Serbia — JP Putevi Srbije motorway toll-plaza cameras. The viewer at
// kamere.toll4all.com is the roads company's own: it is titled "Kamere | JP
// Putevi Srbije" and carries their logo, and OSM independently records the same
// plazas with `operator=ЈП „Путеви Србије“`. Keyless.
//
// 38 cameras across 19 plazas, entry and exit at each. We ship 30 of them: four
// plazas are dropped because their coordinate could not be established, and the
// reasoning for each is written down in serbia.data.ts rather than here.
//
// EVERY CAMERA HAS BOTH A STILL AND A STREAM, which is why these are
// `mediaType: "both"` while the MUP border cameras are video-only. The markup
// carries `poster` (a JPEG regenerated continuously — measured Last-Modified 7s
// behind the request) and `src` (HLS).
//
// THE HOTLINK GOTCHA. bitinfo serves the poster JPEG to anyone, but
// answers 403 on the .m3u8 unless a Referer is sent, and it is picky about the
// exact value: "https://kamere.toll4all.com/" works and "https://kamere.toll4all.com"
// (no trailing slash) does not. That Referer lives in lib/proxy/hls-allowlist.ts
// with the Caltrans wzmedia rule that has the same shape. The playlist's segment
// URIs are RELATIVE ("501.ts"), which rewritePlaylist already resolves against
// the upstream URL before proxying.
//
// To re-check the viewer by hand:
//   curl -s https://kamere.toll4all.com/ | grep -o 'class="cam-item"[^>]*'

const VIEWER_URL = "https://kamere.toll4all.com/";

/**
 * The operator's media hosts. TWO of them, and the split is not cosmetic: the
 * 24 `front_pan_cam*` posters sit on cam.bitinfo.co.rs while all 14
 * `side_pan_cam*` posters sit on jpps.bitinfo.co.rs, even though every one of
 * the 38 STREAMS is on cam.bitinfo.co.rs. Pinning this adapter to one host
 * looked right against the camera list that pointed us here and would have
 * dropped Niš, Novi Sad, Smederevo, Požarevac, Pakovraće and Leskovac without
 * saying so.
 *
 * The two hosts are NOT configured alike, and the original version of this
 * comment said they were. Measured:
 *
 *   cam .../index.m3u8   no Referer -> 403      with Referer -> 200
 *   jpps.../index.m3u8   no Referer -> 200      with Referer -> 200
 *   jpps.../index.jpg    no Referer -> 200
 *
 * So only cam enforces hotlink protection; jpps accepts the Referer we send but
 * does not require it. That costs nothing today - every one of the 38 streams
 * is on cam, so no camera reaches jpps over HLS at all, and an unnecessary
 * Referer is harmless - but "under the same Referer rule" was a claim nobody had
 * measured, and a comment that overstates what was checked is how the next
 * person inherits a wrong assumption.
 */
const MEDIA_HOSTS = new Set(["cam.bitinfo.co.rs", "jpps.bitinfo.co.rs"]);

export const SERBIA_TOLLS_SOURCE: Source = {
  id: "putevi-rs",
  name: "JP Putevi Srbije — motorway toll-plaza cameras",
  license: "JP Putevi Srbije — public toll-plaza camera viewer (no stated licence)",
  attribution: "Live toll-plaza cameras © JP Putevi Srbije",
  // The poster is regenerated continuously upstream, so this is OUR ceiling on
  // how often we ask for one, not a claim about the operator's cadence. 60s
  // matches the other live-stream feeds and bounds /api/proxy's Cache-Control.
  refreshSeconds: 60,
  needsKey: false,
};

/** One tile lifted off the viewer, before it is joined to a coordinate. */
export interface TollViewerCamera {
  /** Path segment identifying the camera, e.g. `front_pan_cam1`. */
  slug: string;
  /** The tile's label exactly as the viewer prints it, e.g. `Stara Pazova Izlaz`. */
  label: string;
  /** The label with the direction word removed — the gazetteer join key. */
  station: string;
  /** The operator's own direction word: `Ulaz` (entry) or `Izlaz` (exit). */
  direction?: string;
  imageUrl: string;
  streamUrl: string;
}

/** Accept only an https URL on one of the operator's media hosts with the wanted suffix. */
function usableMedia(raw: string, suffix: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (isBareIpHost(raw)) return null;
  if (u.protocol !== "https:") return null;
  if (!MEDIA_HOSTS.has(u.hostname)) return null;
  if (!u.pathname.toLowerCase().endsWith(suffix)) return null;
  return u;
}

/** The `front_pan_cam1` in `https://host/front_pan_cam1/index.jpg`. */
function cameraSlug(u: URL): string | undefined {
  return u.pathname.split("/").filter(Boolean).at(-2);
}

/**
 * Pull every `<div class="cam-item" poster=… src=…><span>Name</span>` off the
 * viewer. Pure, so it is unit-testable against a captured page without network.
 *
 * A tile is kept only when its poster and its stream agree on the same camera
 * SLUG — deliberately not on the same host, since the operator splits those
 * (see MEDIA_HOSTS). The page also carries one loose `cam1.m3u8` outside any
 * tile, with no name and no place; requiring the pair keeps it out without a
 * special case.
 */
export function parseTollViewer(html: string): TollViewerCamera[] {
  const out: TollViewerCamera[] = [];
  const seen = new Set<string>();
  const re =
    /<div class="cam-item"\s+poster="([^"]+)"\s+src="([^"]+)"\s*>\s*<span>([^<]+)<\/span>/g;
  for (const m of html.matchAll(re)) {
    const image = usableMedia(m[1], ".jpg");
    const stream = usableMedia(m[2], ".m3u8");
    if (!image || !stream) continue;
    const slug = cameraSlug(image);
    if (!slug || slug !== cameraSlug(stream)) continue;
    if (seen.has(slug)) continue;
    const label = decodeHtmlEntities(m[3]).replace(/\s+/g, " ").trim();
    if (!label) continue;
    const dir = label.match(/\s(Ulaz|Izlaz)$/i);
    seen.add(slug);
    out.push({
      slug,
      label,
      station: dir ? label.slice(0, dir.index).trim() : label,
      direction: dir ? dir[1] : undefined,
      imageUrl: image.toString(),
      streamUrl: stream.toString(),
    });
  }
  return out;
}

/**
 * Join parsed tiles to the verified gazetteer. A plaza with no row in
 * SERBIA_TOLL_PLAZAS is DROPPED rather than placed at a guessed point — that is
 * what removes Leskovac, Ruma, Vrba and Vrčin, and it is also what will happen
 * to any plaza the operator adds before somebody geolocates it.
 */
export function normalizeSerbiaTolls(tiles: TollViewerCamera[]): Camera[] {
  const plazas = new Map(SERBIA_TOLL_PLAZAS.map((p) => [p.station.toLowerCase(), p]));
  const cams: Camera[] = [];
  for (const t of tiles) {
    const plaza = plazas.get(t.station.toLowerCase());
    if (!plaza) continue;
    cams.push({
      id: `putevi-rs:${t.slug}`,
      source: "putevi-rs",
      country: "RS",
      region: "Motorway tolls",
      name: t.label,
      lat: plaza.lat,
      lon: plaza.lon,
      direction: t.direction,
      imageUrl: t.imageUrl,
      streamUrl: t.streamUrl,
      mediaType: "both",
      refreshSeconds: SERBIA_TOLLS_SOURCE.refreshSeconds,
      license: SERBIA_TOLLS_SOURCE.license,
      attribution: SERBIA_TOLLS_SOURCE.attribution,
      available: true,
    });
  }
  return cams;
}

export async function fetchRegistry(): Promise<Camera[]> {
  // Measured over five runs: 0.30-0.62s for ~16 KB. 15s is headroom, and the
  // 10s default in registry.ts clears it by more than an order of magnitude, so
  // this feed declares no budgetMs.
  const res = await fetch(VIEWER_URL, {
    headers: {
      Accept: "text/html",
      "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Putevi Srbije toll cameras: ${res.status}`);
  const cams = normalizeSerbiaTolls(parseTollViewer(await res.text()));
  // A 200 that parses to nothing means the viewer's markup moved. Throwing lets
  // registry.ts keep this feed's last-good cameras rather than silently emptying
  // the motorway layer.
  if (cams.length === 0) {
    throw new Error("Putevi Srbije toll cameras: viewer returned no parseable tiles");
  }
  return CameraArray.parse(cams);
}
