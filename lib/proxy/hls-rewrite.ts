// Rewrite an HLS playlist so every nested URI routes back through /api/hls.
// Relative URIs are resolved against the upstream playlist URL first.
/**
 * `proxyPath` exists so the dev-only review deck can reuse this unchanged. A candidate
 * stream is not in the registry and its host is not on the HLS allowlist, so it cannot
 * go through /api/hls; its segments have to come back through the review proxy instead.
 * Defaulted, so every existing caller is untouched.
 */
export function rewritePlaylist(body: string, upstreamUrl: string, proxyPath = "/api/hls"): string {
  const proxy = (abs: string) => `${proxyPath}?u=${encodeURIComponent(abs)}`;
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === "") return line;
      if (trimmed.startsWith("#")) {
        // Tags like EXT-X-KEY / EXT-X-MAP can carry URI="...".
        const m = trimmed.match(/URI="([^"]+)"/);
        if (m) {
          const abs = new URL(m[1], upstreamUrl).toString();
          return line.replace(m[1], proxy(abs));
        }
        return line;
      }
      const abs = new URL(trimmed, upstreamUrl).toString();
      return proxy(abs);
    })
    .join("\n");
}
