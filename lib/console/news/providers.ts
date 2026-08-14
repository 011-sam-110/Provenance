export interface NewsProvider {
  id: string;
  name: string;
  category: string;
  kind: "youtube" | "hls";
  /**
   * Last-known video id (YouTube) or stream URL (HLS). For YouTube this is now
   * a FALLBACK only — see `channelId`.
   */
  ref: string;
  /**
   * The channel that actually broadcasts this feed. Durable: unlike a video id
   * it survives the broadcaster restarting their stream. Resolved to a current
   * live video by lib/youtube/live.ts.
   */
  channelId?: string;
  /**
   * Title preference when a channel runs several concurrent live streams — a
   * soft hint, not a filter. NASA is why: it broadcasts both ISS feeds at once,
   * so "NASA TV" and "ISS Live" would otherwise resolve to the same video.
   */
  match?: string;
  favorite?: boolean;
}

// 24/7 news and space channels.
//
// PINNED VIDEO IDS DO NOT SURVIVE. Audited 2026-08-14 with yt-dlp against the
// twelve ids this list used to carry: EIGHT WERE ALREADY DEAD — DW, France 24,
// TRT, NHK, Bloomberg, NASA TV and ISS Live all returned "Video unavailable" or
// "This live stream recording is not available", and Sky News had gone private.
// Only Al Jazeera, Euronews, CNA and ABC (AU) still played. lib/console/help.ts
// has described this failure for a while; this is the measurement of it.
//
// So `channelId` is now the registered handle and `ref` is only a fallback for
// when resolution is dormant (no YOUTUBE_API_KEY) — in which case a stale id
// behaves exactly as it does today rather than any worse.
//
// Every channelId below was resolved from the broadcaster's own handle and
// confirmed to have a live stream at the time of writing. To re-check one:
//   yt-dlp --flat-playlist -J "https://www.youtube.com/channel/<id>/streams"
export const NEWS_PROVIDERS: NewsProvider[] = [
  { id: "aljazeera", name: "Al Jazeera English", category: "World", kind: "youtube", channelId: "UCNye-wNBqNL5ZzHSJj3l8Bg", ref: "gCNeDWCI0vo", favorite: true },
  { id: "dw", name: "DW News", category: "World", kind: "youtube", channelId: "UCknLrEdhRCp1aegoMqRaCZg", ref: "tQwQfNuvb1A", favorite: true },
  { id: "france24", name: "France 24", category: "World", kind: "youtube", channelId: "UCQfwfsi5VrQ8yKZ-UWmAEFg", ref: "h3MuIUNCCzI", favorite: true },
  { id: "sky", name: "Sky News", category: "World", kind: "youtube", channelId: "UCoMdktPbSTixAyNGwb-UYkQ", ref: "9Auq9mYxFEE" },
  { id: "euronews", name: "Euronews", category: "World", kind: "youtube", channelId: "UCSrZ3UV4jOidv8ppoVuvW9Q", ref: "pykpO5kQJ98" },
  { id: "cna", name: "CNA", category: "World", kind: "youtube", channelId: "UC83jt4dlz1Gjl58fzQrrKZg", ref: "XWq5kBlakcQ" },
  { id: "trt", name: "TRT World", category: "World", kind: "youtube", channelId: "UC7fWeaHhqgM4Ry-RMpM2YYw", ref: "Wp0_Dk0nJOk" },
  { id: "nhk", name: "NHK World", category: "World", kind: "youtube", channelId: "UCSPEjw8F2nQDtmUKPFNF7_A", ref: "f0lYkdg2DZw" },
  { id: "abcau", name: "ABC News (AU)", category: "World", kind: "youtube", channelId: "UCVgO39Bk5sMo66-6o6Spn6Q", ref: "vOTiJkg1voo" },
  { id: "bloomberg", name: "Bloomberg TV", category: "Business", kind: "youtube", channelId: "UCIALMKvObZNtJ6AmdCLP7Lg", ref: "iEpJwprxDdk" },
  // NASA runs both ISS feeds concurrently, hence the `match` hints.
  { id: "nasa", name: "NASA TV", category: "Space", kind: "youtube", channelId: "UCLA_DiR1FfKNvjuUpBHmylQ", match: "Official NASA", ref: "21X5lGlDOfg" },
  { id: "iss", name: "ISS Live", category: "Space", kind: "youtube", channelId: "UCLA_DiR1FfKNvjuUpBHmylQ", match: "High-Definition", ref: "DIgkvm2nmHc" },
];

/** The channels worth asking the resolver about, deduped, in list order. */
export function newsChannelRequests(
  providers: readonly NewsProvider[] = NEWS_PROVIDERS,
): { channelId: string; match?: string }[] {
  const seen = new Set<string>();
  const out: { channelId: string; match?: string }[] = [];
  for (const p of providers) {
    if (p.kind !== "youtube" || !p.channelId) continue;
    // A channel serving two providers (NASA/ISS) is requested once per distinct
    // match hint — the resolver picks a different video for each.
    const key = `${p.channelId}::${p.match ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.match ? { channelId: p.channelId, match: p.match } : { channelId: p.channelId });
  }
  return out;
}

const YT_ID = /(?:v=|youtu\.be\/|\/live\/|\/embed\/)([A-Za-z0-9_-]{11})/;

export function parseCustomStream(url: string): NewsProvider | null {
  const u = url.trim();
  // Check HLS first — a .m3u8 URL may contain /live/ in its path which would
  // otherwise trip the YouTube regex below.
  if (/^https?:\/\/\S+\.m3u8(\?\S*)?$/i.test(u)) return { id: `custom-hls`, name: "Custom (HLS)", category: "Custom", kind: "hls", ref: u };
  const yt = u.match(YT_ID);
  if (yt) return { id: `custom-${yt[1]}`, name: "Custom (YouTube)", category: "Custom", kind: "youtube", ref: yt[1] };
  return null;
}

/**
 * The video id to actually play: the freshly resolved one when /api/youtube-live
 * answered, otherwise the pinned `ref`. The fallback is deliberate — with no API
 * key the console behaves exactly as it does today rather than going blank.
 */
export function playableRef(p: NewsProvider, liveVideoId?: string | null): string {
  return p.kind === "youtube" && liveVideoId ? liveVideoId : p.ref;
}

export function resolveEmbed(
  p: NewsProvider,
  liveVideoId?: string | null,
): { kind: "youtube" | "hls"; src: string } {
  if (p.kind === "youtube") {
    const id = playableRef(p, liveVideoId);
    return { kind: "youtube", src: `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1` };
  }
  return { kind: "hls", src: /^https?:\/\//i.test(p.ref) ? p.ref : "" };
}

/** Keyless YouTube thumbnail for a provider, or null for HLS (no free thumbnail). */
export function providerThumb(p: NewsProvider, liveVideoId?: string | null): string | null {
  return p.kind === "youtube" ? `https://img.youtube.com/vi/${playableRef(p, liveVideoId)}/hqdefault.jpg` : null;
}
