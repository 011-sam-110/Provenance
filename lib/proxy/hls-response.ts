// How /api/hls answers when the upstream does not return the bytes we asked for.
//
// WHY THIS EXISTS. The route used to collapse every non-OK upstream response into a
// single `502 upstream error`. Measured on prod over 80 minutes on 2026-09-09: 389
// responses of 502, ALL of them /api/hls, and 376 of the 382 distinct upstream URLs
// behind them were `.ts` SEGMENTS on wzmedia.dot.ca.gov. Fetching one of those from
// the box returns 404 in ~0.35 s; a segment still inside the live window returns 200
// in ~0.6 s. So the upstream was healthy and reachable the whole time.
//
// A live HLS stream keeps a rolling window of a few segments and drops the rest. A
// player that stalls — a backgrounded phone tab, and this site's traffic is mostly
// mobile — comes back and asks for a segment that has since rolled off. The upstream
// says 404, which is the correct and expected answer. Reporting that as 502 claims
// OUR gateway failed, which is false, and it buried the error budget: 100% of the
// site's 502s were this, so a real one had nowhere to show up.
//
// WHAT THIS DOES NOT CLAIM. Passing the status through does not stop players asking
// for expired segments — that is inherent to proxying live HLS to mobile clients, and
// the request count is unchanged. What changes is that the answer is now true, and a
// 502 in the log once again means a gateway actually failed.

/**
 * The status /api/hls should serve, given what the upstream returned.
 *
 * - 2xx passes through unchanged, which keeps `206 Partial Content` intact for range
 *   requests. Collapsing that to 200 would break seeking.
 * - 4xx passes through unchanged. The upstream is answering; it is telling us this
 *   resource is not available to this request. 404 on a rolled-off segment is the
 *   case that motivated this file, and 403 (hotlink protection refusing our Referer)
 *   is a fault worth seeing as itself rather than as a generic gateway error.
 * - Everything else — 5xx, and any 3xx that somehow arrives despite `redirect:
 *   "error"` — is a genuine bad gateway.
 */
export function statusForUpstream(status: number): number {
  if (status >= 200 && status < 300) return status;
  if (status >= 400 && status < 500) return status;
  return 502;
}

/** Whether `statusForUpstream` treats this upstream status as a body worth serving. */
export function isServableUpstream(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Cache policy for a SEGMENT (or any non-playlist body).
 *
 * A segment URL names immutable bytes: `media_w929062248_4042.ts` is one fixed piece
 * of video and re-requesting it can never legitimately return anything else. The
 * previous `max-age=5` was therefore far shorter than the content allows, and it made
 * every viewer of the same camera pull every segment through this box again — 48,845
 * requests and 21.81 GB of origin egress on 2026-09-08 alone.
 *
 * Freshness is not at risk, because the PLAYLIST is `no-store`: a player always learns
 * the current segment list from the upstream, and only then asks for the segments in
 * it. A cached segment cannot make a stream look newer than it is.
 *
 * The shared TTL is deliberately longer than the upstream's own retention. Once a
 * segment rolls off, the upstream answers 404 — so a cached copy is the difference
 * between a late player getting its bytes and getting nothing.
 */
export const SEGMENT_BROWSER_TTL_SECONDS = 60;
export const SEGMENT_SHARED_TTL_SECONDS = 600;

/**
 * Cache policy for a PLAYLIST. Never cached, at any layer.
 *
 * A playlist IS the freshness statement of a live stream — it names which segments
 * exist right now. Serving a stale one hands the player a window that has already
 * moved, which produces exactly the expired-segment requests this file exists to stop
 * misreporting.
 */
export const PLAYLIST_CACHE_CONTROL = "no-store";

/**
 * Whether the upstream response is an HLS playlist rather than a media segment.
 *
 * Content-Type is checked first because it is what the upstream actually asserts;
 * the path suffix is the fallback for servers that answer `.m3u8` with a generic
 * type. Both were in the original route and both are load-bearing.
 */
export function isPlaylistResponse(contentType: string | null, pathname: string): boolean {
  if (contentType?.includes("mpegurl")) return true;
  return pathname.toLowerCase().endsWith(".m3u8");
}

/** A short, non-throwing description of a failed fetch, for the log line. */
export function describeFetchError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeCode =
      cause && typeof cause === "object" && "code" in cause
        ? ` (${String((cause as { code: unknown }).code)})`
        : "";
    return `${err.name}: ${err.message}${causeCode}`;
  }
  return String(err);
}
