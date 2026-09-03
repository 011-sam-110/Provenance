// Camera slot — the pure rules. No React, no DOM, no fetch, so every rule here is
// unit-testable in the node environment the rest of tests/unit uses.
//
// WHY VALIDATION LIVES HERE AND IS CALLED TWICE. A widget's `config` rides inside
// the `?c=` share link: lib/console/share.ts base64s the whole ShellLayout, and
// lib/console/sanitize.ts copies `config` through on nothing more than
// `typeof o.config === "object"`. So a stranger's link can carry any JSON at all
// into this widget. These functions are the only thing between that and a render,
// and they are applied at BOTH boundaries — sanitizeLayout (the choke point every
// link passes) and the component itself (which is also the path a live
// `configure()` call takes).

export type StreamRef =
  | { k: "cam"; id: string }
  /** `t` is a DISPLAY FALLBACK, not a source of truth. The cached webcam directory
   *  only covers an unranked ~2% sample, so a webcam added from the live bbox search
   *  — or seeded onto the default board from it — has no title to look up and would
   *  otherwise render as "Webcam 1606332744". We keep the title we saw at the moment
   *  it was added. The directory always wins when it has an answer; this is only
   *  consulted on a miss. Display-only, escaped by React, never used to fetch. */
  | { k: "webcam"; id: string; t?: string }
  | { k: "yt"; videoId: string };

export interface CamslotConfig {
  streams: StreamRef[];
  intervalMs: number;
  name?: string;
  fit?: "cover" | "contain";
  /** The conditions overlay is ON by default. The only value this key may ever hold
   *  is the literal string "off" — see `sanitizeCamslotConfig` and `conditionsOn`
   *  for why the default is encoded as the KEY'S ABSENCE, not as `"on"`. */
  conditions?: "off";
}

export const DEFAULT_INTERVAL_MS = 5000;
/** Below ~3s a wall is unreadable, and `setInterval(fn, 0)` clamps to ~4ms —
 *  which is a share-link DoS, not a preference. */
export const MIN_INTERVAL_MS = 3000;
export const MAX_INTERVAL_MS = 300_000;
/** A wall nobody can watch is not a selection. Also bounds the share-link payload. */
export const MAX_STREAMS = 60;
const MAX_ID_LEN = 128;
const MAX_NAME_LEN = 80;
const MAX_TITLE_LEN = 120;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Camera and webcam ids are our own registry keys (`tfl:JamCams_00001`,
 *  `windy:1420893641`). They are never interpolated into a URL host — /api/proxy
 *  and /api/webcam-image re-derive the upstream URL server-side and pin the host
 *  against lib/proxy/allowlist.ts — so the charset here is about sanity, not SSRF. */
const SOURCE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

/**
 * A YouTube VIDEO id, or null. Channel refs are deliberately unsupported in v1:
 * resolving one costs 100 units of a shared 10,000/day quota and negatives are not
 * cached, so a single shared link carrying 100 channel ids would spend the whole
 * day's allowance and break the News and Brazil livecams boards sitewide.
 */
export function parseYouTubeVideoId(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (VIDEO_ID.test(s)) return s;

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  let candidate: string | null = null;

  if (host === "youtu.be") {
    candidate = url.pathname.slice(1);
  } else if (YT_HOSTS.has(host)) {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v");
    else if (url.pathname.startsWith("/live/")) candidate = url.pathname.slice("/live/".length);
    else if (url.pathname.startsWith("/embed/")) candidate = url.pathname.slice("/embed/".length);
  }

  if (!candidate) return null;
  const id = candidate.split("/")[0];
  return VIDEO_ID.test(id) ? id : null;
}

/** The ONLY way an iframe src is ever built. Takes an id, never a URL. */
export function embedUrl(videoId: string): string {
  if (!VIDEO_ID.test(videoId)) throw new Error("embedUrl called with an unvalidated id");
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1`;
}

export function parseStreamRef(raw: unknown): StreamRef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  if (o.k === "cam") {
    const id = typeof o.id === "string" ? o.id : "";
    if (id.length > MAX_ID_LEN || !SOURCE_ID.test(id)) return null;
    return { k: "cam", id };
  }
  if (o.k === "webcam") {
    const id = typeof o.id === "string" ? o.id : "";
    if (id.length > MAX_ID_LEN || !SOURCE_ID.test(id)) return null;
    const t = typeof o.t === "string" ? o.t.trim().slice(0, MAX_TITLE_LEN) : "";
    return t ? { k: "webcam", id, t } : { k: "webcam", id };
  }
  if (o.k === "yt") {
    const v = typeof o.videoId === "string" ? o.videoId : "";
    return VIDEO_ID.test(v) ? { k: "yt", videoId: v } : null;
  }
  return null;
}

export function streamKey(s: StreamRef): string {
  return s.k === "yt" ? `yt:${s.videoId}` : `${s.k}:${s.id}`;
}

function clampInterval(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(n)));
}

/** Coerce untrusted config into something renderable. Never throws, never returns
 *  null — an unusable slot is worse than an empty one. */
export function sanitizeCamslotConfig(raw: unknown): CamslotConfig {
  if (!raw || typeof raw !== "object") {
    return { streams: [], intervalMs: DEFAULT_INTERVAL_MS };
  }
  const o = raw as Record<string, unknown>;

  const streams: StreamRef[] = [];
  if (Array.isArray(o.streams)) {
    for (const item of o.streams) {
      if (streams.length >= MAX_STREAMS) break;
      const ref = parseStreamRef(item);
      if (ref) streams.push(ref);
    }
  }

  const out: CamslotConfig = {
    streams,
    intervalMs: "intervalMs" in o ? clampInterval(o.intervalMs) : DEFAULT_INTERVAL_MS,
  };
  if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim().slice(0, MAX_NAME_LEN);
  if (o.fit === "cover" || o.fit === "contain") out.fit = o.fit;
  // Only the literal string "off" is accepted — anything else (true, 1, "yes", an
  // object) is dropped entirely, and the key is left absent for every other value,
  // including a deliberate "on". That is what keeps the default state (overlay
  // showing) written as NO key: layoutSignature() JSON.stringifies the whole config,
  // JSON.stringify drops `undefined`, so a board nobody has touched keeps a
  // byte-identical signature and the "customised" dot stays dark. Writing an
  // explicit `conditions: "on"` here would make turning the overlay back on look
  // like an edit, which is exactly the bug this encoding avoids.
  if (o.conditions === "off") out.conditions = "off";
  return out;
}

/** Whether the conditions overlay should render. Absence of the key — the state an
 *  untouched config and an explicitly-restored default both share — means on. */
export function conditionsOn(cfg: CamslotConfig): boolean {
  return cfg.conditions !== "off";
}

/**
 * Rotation position. Safe for empty and single-item playlists, and for an index
 * that is already out of range — which happens every time a playlist shrinks under
 * a running rotation. Starting over is the only sensible answer there; advancing
 * modulo the new length would land somewhere arbitrary.
 */
export function nextIndex(i: number, len: number): number {
  if (len <= 1) return 0;
  if (!Number.isInteger(i) || i < 0 || i >= len) return 0;
  return (i + 1) % len;
}
