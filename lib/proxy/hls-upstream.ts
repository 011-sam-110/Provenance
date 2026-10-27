// The one upstream fetch for HLS: /api/hls and the server's play checker both call it.
//
// WHY ONE FUNCTION. The play checker (lib/liveness/playcheck.ts) decides which cameras
// the map calls video. If it asked an operator with different headers from the proxy,
// it could see a stream play that a visitor's player then cannot load (or the other way
// round): Caltrans' wzmedia refuses a request without its own page as the Referer. So
// the checker does not build a request of its own. It calls this, with the Referer the
// allowlist rule declares, and nothing else.

import { isHlsAllowed } from "@/lib/proxy/hls-allowlist";

/** Sent on every upstream HLS request. */
export const HLS_USER_AGENT = "TrafficNerd/2.0 (+https://github.com/011-sam-110/TrafficNerd-V2)";

/** How long one upstream HLS request may take before it is abandoned. */
export const HLS_UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * The request options for one upstream HLS read. Pure, so a test can pin them.
 *
 * `referer` is the allowlist rule's own value (`isHlsAllowed(url).referer`). An absent
 * one is sent as an empty header, which is what /api/hls has always sent.
 */
export function hlsUpstreamInit(
  referer: string | undefined,
  range?: string | null,
  timeoutMs: number = HLS_UPSTREAM_TIMEOUT_MS,
): RequestInit {
  return {
    headers: {
      Referer: referer ?? "",
      "User-Agent": HLS_USER_AGENT,
      Accept: "*/*",
      ...(range ? { Range: range } : {}),
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  };
}

/**
 * Fetch one allowlisted HLS URL. The caller has already checked the allowlist and
 * passes the rule's Referer; this function does not check it again.
 */
export function fetchHlsUpstream(
  target: URL,
  referer: string | undefined,
  range?: string | null,
): Promise<Response> {
  const verdict = isHlsAllowed(target);
  if (!verdict.ok) {
    throw new Error("forbidden host");
  }
  return fetch(target.toString(), hlsUpstreamInit(referer, range));
}
