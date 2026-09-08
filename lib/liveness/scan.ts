/**
 * Finding stream URLs in things that were not written for us.
 *
 * Twelve of this project seventeen camera adapters never ask their upstream for a
 * stream. Whether those upstreams publish one has never been checked, and the check is
 * awkward because there is no convention: the field is called `video`, `streamUrl`,
 * `hlsUrl`, `url_hls`, or nothing at all because the stream only appears in the HTML of
 * the page that plays it. So rather than teach a sniffer field names — which produces a
 * sniffer that only finds feeds you have already seen — this looks at VALUES and asks
 * what they are.
 *
 * Two admission rules from lib/discovery/gates.ts and lib/sources/serbia.data.ts are
 * applied here rather than downstream, because a URL that can never be admitted should
 * not reach a probe and waste a request against somebody infrastructure:
 *
 *   - Bare-IP hosts are refused BY RULE. An unsecured stream on IP:port is somebody
 *     leaked camera, and indexing those turns this product from infrastructure
 *     transparency into a leaked-camera index.
 *   - Relay hosts are refused. A directory republishing an operator video cannot
 *     license it and cannot be attributed honestly.
 *
 * Pure. No fetch.
 */

import { isRelayHost } from "@/lib/discovery/gates";
import { isBareIpHost } from "@/lib/sources/serbia.data";

export type StreamKind = "hls" | "dash" | "mjpeg" | "rtsp" | "rtmp";

export interface StreamHit {
  /** Where in the payload it was found, as a dot path. `page` for an HTML scan. */
  path: string;
  url: string;
  kind: StreamKind;
}

/**
 * What a browser in the review deck can actually show.
 *
 * RTSP and RTMP are recorded rather than dropped on purpose. "This operator publishes
 * RTSP" is a real finding — it means the cameras exist and are streamed, just not in a
 * form we can serve — and a report that silently discarded them would say the operator
 * publishes nothing, which is a different and false claim.
 */
export function isPlayableKind(kind: StreamKind): boolean {
  return kind === "hls" || kind === "dash" || kind === "mjpeg";
}

/** A value has to look like a locator, not like prose that mentions one. */
const ABSOLUTE = /^(?:https?|rtsps?|rtmps?):\/\//i;
const PATH_LIKE = /^(?:\/\/|\/|\.\/|\.\.\/)/;

export function classifyStreamUrl(raw: string): StreamKind | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  if (!ABSOLUTE.test(value) && !PATH_LIKE.test(value)) return null;

  const lower = value.toLowerCase();
  if (lower.startsWith("rtsp://") || lower.startsWith("rtsps://")) return "rtsp";
  if (lower.startsWith("rtmp://") || lower.startsWith("rtmps://")) return "rtmp";

  // Strip query and fragment before the extension test, so `live.m3u8?token=abc` is
  // still HLS and `photo.jpg?v=live.m3u8` is still not.
  const pathPart = lower.split("#")[0].split("?")[0];
  if (/\.m3u8$/.test(pathPart)) return "hls";
  if (/\.mpd$/.test(pathPart)) return "dash";
  if (/mjpe?g/.test(pathPart)) return "mjpeg";
  return null;
}

/** Both admission rules in one place, so the walker and the text scanner agree. */
function admissible(url: string): boolean {
  if (isBareIpHost(url)) return false;
  if (isRelayHost(url)) return false;
  return true;
}

/** A payload big enough to be a denial of service against ourselves is a mistake. */
const MAX_NODES = 500_000;

export function scanJsonForStreams(payload: unknown): StreamHit[] {
  const hits: StreamHit[] = [];
  const seenUrls = new Set<string>();
  // A cycle in a payload is unusual but not impossible, and a stack overflow halfway
  // through a twelve-feed run loses the eleven feeds that had not been written yet.
  const seenNodes = new WeakSet<object>();
  let nodes = 0;

  const walk = (node: unknown, path: string): void => {
    if (nodes++ > MAX_NODES) return;

    if (typeof node === "string") {
      const kind = classifyStreamUrl(node);
      if (!kind) return;
      const url = node.trim();
      if (!admissible(url)) return;
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      hits.push({ path, url, kind });
      return;
    }

    if (node === null || typeof node !== "object") return;
    if (seenNodes.has(node)) return;
    seenNodes.add(node);

    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, path ? `${path}.${i}` : String(i)));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  };

  walk(payload, "");
  return hits;
}

/**
 * The second level of the search: the viewer page.
 *
 * Many operator portals publish only coordinates through their API and put the stream in
 * the page that plays it, usually as an argument to `hls.loadSource`. Without this, such
 * a feed reads as stream-free and gets recorded as having nothing — the exact false
 * negative that makes the whole measurement worthless.
 *
 * Absolute URLs only. A relative path in a page cannot be resolved without knowing the
 * page own URL, and guessing a base is how a wrong URL enters the queue and burns a
 * human review slot.
 */
const TEXT_URL = /(?:https?|rtsps?|rtmps?):\/\/[^\s"'`<>()\\[\]{}]+/gi;

export function scanTextForStreams(text: string): StreamHit[] {
  if (typeof text !== "string" || !text) return [];
  const hits: StreamHit[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(TEXT_URL)) {
    // Trailing punctuation belongs to the prose around the URL, not to the URL.
    const url = match[0].replace(/[.,;:]+$/, "");
    const kind = classifyStreamUrl(url);
    if (!kind) continue;
    if (!admissible(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    hits.push({ path: `page@${match.index ?? 0}`, url, kind });
  }
  return hits;
}
