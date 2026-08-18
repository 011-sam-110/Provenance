// Streaming hosts are separate from the still-image allowlist: each rule also
// carries the Referer to inject (Caltrans' wzmedia is hotlink-protected).
// `referer` is optional because not every host is hotlink-protected: MUP serves
// its playlists and segments to a bare request, and sending an empty Referer
// where none is wanted is a claim we do not need to make.
type HlsRule = { match: (host: string) => boolean; prefix: string; referer?: string };

const RULES: HlsRule[] = [
  { match: (h) => h === "wzmedia.dot.ca.gov", prefix: "/", referer: "https://cwwp2.dot.ca.gov/" },
  { match: (h) => h.endsWith(".us-east-1.skyvdn.com"), prefix: "/rtplive/", referer: "https://www.511sc.org/" },
  // Serbia — MUP border crossings. Playlists carry ABSOLUTE segment URLs on the
  // same host, and no Referer is required (measured).
  { match: (h) => h === "kamere.mup.gov.rs", prefix: "/" },
  // Serbia — JP Putevi Srbije toll plazas. cam.bitinfo.co.rs 403s without a
  // Referer, and the TRAILING SLASH matters: "https://kamere.toll4all.com"
  // alone is refused. jpps.bitinfo.co.rs does NOT enforce it (measured: 200
  // with no Referer) and is covered by the same rule anyway, because sending
  // one where it is not required is harmless and a second rule would only be
  // one more thing to keep in step. Segment URIs are relative, so
  // rewritePlaylist resolves them onto the same host and they come back
  // through this rule.
  {
    match: (h) => h === "cam.bitinfo.co.rs" || h === "jpps.bitinfo.co.rs",
    prefix: "/",
    referer: "https://kamere.toll4all.com/",
  },
];

export function isHlsAllowed(url: URL): { ok: boolean; referer?: string } {
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false };
  for (const r of RULES) {
    if (r.match(url.hostname) && url.pathname.startsWith(r.prefix)) {
      return { ok: true, referer: r.referer };
    }
  }
  return { ok: false };
}

/**
 * Whether a camera's stream is a LIVE feed our proxy can actually play. Used to
 * decide the video-vs-still icon and player. A camera whose only "video" is an
 * MP4 clip on a non-allowlisted host (e.g. TfL JamCams) returns false → still.
 */
export function isLiveStreamUrl(streamUrl?: string): boolean {
  if (!streamUrl) return false;
  try {
    return isHlsAllowed(new URL(streamUrl)).ok;
  } catch {
    return false;
  }
}
