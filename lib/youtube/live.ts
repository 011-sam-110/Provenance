// Resolve "which video is this channel live-streaming right now" — server-side.
//
// WHY THIS EXISTS
//
// Pinning a YouTube LIVE VIDEO id does not work. Broadcasters restart their
// 24/7 streams and the id changes, which lib/console/help.ts has documented for
// a while ("a rotated preset simply plays nothing"). Measured 2026-08-14:
//   • 8 of the 12 pinned news presets were already dead — "Video unavailable",
//     "This live stream recording is not available", one gone private.
//   • Across seven live cameras, uptimes were 8h, 8h, 7d, 13d, 14d, 18d, 86d.
//     Two of seven had restarted within 10 hours.
//
// The obvious keyless fix does NOT work either. `youtube.com/embed/live_stream
// ?channel={id}` is retired: loaded in a real browser it renders "Error 153 —
// Video player configuration error" and builds a link to `watch?v=live_stream`,
// i.e. it treats the literal string as a video id. That endpoint is still in
// this repo (satellites.detail.tsx) and is a dead player for every user today.
//
// So: channel id in, current live video id out, resolved server-side.
//
// QUOTA — the reason this is not just a search call per channel.
//
// The YouTube Data API gives 10,000 units/day free. search.list costs 100 units
// and is the ONLY endpoint that discovers a channel's current live video, so
// "search every channel every refresh" would cost 59 channels × 100 = 5,900
// units per refresh and allow barely one refresh a day.
//
// videos.list costs 1 unit for up to 50 ids. So we VALIDATE CHEAPLY and
// REDISCOVER RARELY: keep the last-known video id per channel, confirm the whole
// set is still live in one 1-unit call, and only pay 100 units for a channel
// whose stream actually rotated. At the measured ~29%/day rotation rate that is
// roughly 1,900 units/day against the 10,000 allowance.
//
// NOT LIVE-VERIFIED: the request/response shapes below are from Google's
// published API reference, not from a call against a real key — there is no
// YOUTUBE_API_KEY on this project yet. The parsers are defensive and unit-tested
// against captured-shape fixtures, and the whole module is dormant-safe, so a
// shape surprise degrades to "unresolved" rather than to a crash or a lie.

const API = "https://www.googleapis.com/youtube/v3";

/** videos.list accepts up to 50 ids per call, and that call costs 1 unit. */
export const VIDEOS_LIST_BATCH = 50;
export const COST_VIDEOS_LIST = 1;
export const COST_SEARCH_LIST = 100;

export interface ChannelRequest {
  channelId: string;
  /**
   * Case-insensitive substring preferred when a channel runs SEVERAL concurrent
   * live streams. A soft preference, not a filter: if nothing matches we still
   * take the channel's first live stream, because a playing stream from the
   * right channel beats an empty panel. NASA is the live example — it runs both
   * ISS feeds at once, so "NASA TV" and "ISS Live" would otherwise be the same
   * video.
   */
  match?: string;
}

export interface LiveVideo {
  videoId: string;
  channelId: string;
  title: string;
}

export interface Resolution {
  channelId: string;
  /** Echoed back so a caller can tell two requests on the same channel apart. */
  match?: string;
  videoId: string | null;
  title: string | null;
  /** How we got it — "cached" cost ~0 units, "search" cost 100. */
  via: "cached" | "search" | "unresolved";
}

/**
 * Identity of a request. NOT just the channel id: one channel can back two
 * different entries via different `match` hints (NASA runs both ISS feeds at
 * once and backs both "NASA TV" and "ISS Live"). Keying on channelId alone made
 * the second entry silently inherit the first one's video.
 */
export function requestKey(req: ChannelRequest): string {
  return `${req.channelId}::${req.match?.trim().toLowerCase() ?? ""}`;
}

export interface ResolveResult {
  resolutions: Resolution[];
  /** Quota units this round actually spent. */
  quotaSpent: number;
  /** True only when no API key is configured — legitimately switched off. */
  dormant: boolean;
  note: string | null;
}

/** Split into fixed-size chunks. Exported for the batching test. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Pull the still-live videos out of a videos.list response.
 *
 * `liveBroadcastContent` is the field that matters: a video id stays valid long
 * after its stream ends, coming back as "none". Treating a 200 as "still live"
 * is the same mistake as treating an HTTP 200 JPEG as a live camera.
 */
export function parseVideosList(json: unknown): LiveVideo[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const out: LiveVideo[] = [];
  for (const raw of items) {
    const item = raw as {
      id?: unknown;
      snippet?: { title?: unknown; channelId?: unknown; liveBroadcastContent?: unknown };
    };
    const videoId = typeof item?.id === "string" ? item.id : null;
    const channelId = typeof item?.snippet?.channelId === "string" ? item.snippet.channelId : null;
    if (!videoId || !channelId) continue;
    if (item.snippet?.liveBroadcastContent !== "live") continue;
    out.push({
      videoId,
      channelId,
      title: typeof item.snippet?.title === "string" ? item.snippet.title : "",
    });
  }
  return out;
}

/** Pull live videos out of a search.list response (ids are nested under id.videoId). */
export function parseSearchList(json: unknown): LiveVideo[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const out: LiveVideo[] = [];
  for (const raw of items) {
    const item = raw as {
      id?: { videoId?: unknown };
      snippet?: { title?: unknown; channelId?: unknown };
    };
    const videoId = typeof item?.id?.videoId === "string" ? item.id.videoId : null;
    const channelId = typeof item?.snippet?.channelId === "string" ? item.snippet.channelId : null;
    if (!videoId || !channelId) continue;
    out.push({
      videoId,
      channelId,
      title: typeof item.snippet?.title === "string" ? item.snippet.title : "",
    });
  }
  return out;
}

/**
 * Choose one live video for a channel, preferring a title that contains `match`.
 * Returns null when the channel has nothing live.
 */
export function pickLiveVideo(
  candidates: readonly LiveVideo[],
  request: ChannelRequest,
): LiveVideo | null {
  const mine = candidates.filter((c) => c.channelId === request.channelId);
  if (mine.length === 0) return null;
  const wanted = request.match?.trim().toLowerCase();
  if (wanted) {
    const hit = mine.find((c) => c.title.toLowerCase().includes(wanted));
    if (hit) return hit;
  }
  return mine[0];
}

/**
 * Work out which channels the cheap validation round already answered and which
 * still need an expensive per-channel search. Pure, so the quota arithmetic —
 * the part that decides whether this design fits in the free tier — is testable
 * without touching the network.
 */
export function planRediscovery(
  requests: readonly ChannelRequest[],
  validated: readonly LiveVideo[],
): { resolved: Resolution[]; needSearch: ChannelRequest[] } {
  const resolved: Resolution[] = [];
  const needSearch: ChannelRequest[] = [];
  for (const req of requests) {
    const hit = pickLiveVideo(validated, req);
    if (hit) {
      resolved.push({ channelId: req.channelId, match: req.match, videoId: hit.videoId, title: hit.title, via: "cached" });
    } else {
      needSearch.push(req);
    }
  }
  return { resolved, needSearch };
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Resolve every requested channel to its current live video.
 *
 * Never throws and never invents a video id: an unreachable API, a rejected key
 * or an unexpected shape all come back as `via: "unresolved"` with a null
 * videoId, and the caller decides what to show. Serving a stale id as if it were
 * live is exactly the failure this module exists to remove.
 */
export async function resolveLiveVideos(
  requests: readonly ChannelRequest[],
  lastKnown: ReadonlyMap<string, string>,
  apiKey: string | undefined = process.env.YOUTUBE_API_KEY,
): Promise<ResolveResult> {
  const key = (apiKey ?? "").trim();
  if (!key) {
    return {
      resolutions: requests.map((r) => ({ channelId: r.channelId, videoId: null, title: null, via: "unresolved" as const })),
      quotaSpent: 0,
      dormant: true,
      note: "YOUTUBE_API_KEY is not set — live channel resolution is switched off.",
    };
  }

  let quotaSpent = 0;

  // Round 1 — one cheap call per 50 known ids, to see what is still running.
  const knownIds = requests.map((r) => lastKnown.get(requestKey(r))).filter((v): v is string => !!v);
  const validated: LiveVideo[] = [];
  for (const batch of chunk([...new Set(knownIds)], VIDEOS_LIST_BATCH)) {
    if (batch.length === 0) continue;
    const url = `${API}/videos?part=snippet&id=${batch.join(",")}&maxResults=${VIDEOS_LIST_BATCH}&key=${encodeURIComponent(key)}`;
    const json = await getJson(url);
    quotaSpent += COST_VIDEOS_LIST;
    if (json) validated.push(...parseVideosList(json));
  }

  const { resolved, needSearch } = planRediscovery(requests, validated);

  // Round 2 — only for channels whose stream actually rotated. 100 units each.
  for (const req of needSearch) {
    const url =
      `${API}/search?part=snippet&channelId=${encodeURIComponent(req.channelId)}` +
      `&eventType=live&type=video&maxResults=10&key=${encodeURIComponent(key)}`;
    const json = await getJson(url);
    quotaSpent += COST_SEARCH_LIST;
    const hit = json ? pickLiveVideo(parseSearchList(json), req) : null;
    resolved.push(
      hit
        ? { channelId: req.channelId, match: req.match, videoId: hit.videoId, title: hit.title, via: "search" }
        : { channelId: req.channelId, match: req.match, videoId: null, title: null, via: "unresolved" },
    );
  }

  // Preserve caller order — callers render these next to fixed UI labels.
  const byKey = new Map(resolved.map((r) => [requestKey(r), r]));
  const resolutions = requests.map(
    (r) =>
      byKey.get(requestKey(r)) ?? {
        channelId: r.channelId,
        match: r.match,
        videoId: null,
        title: null,
        via: "unresolved" as const,
      },
  );

  const unresolved = resolutions.filter((r) => r.videoId === null).length;
  return {
    resolutions,
    quotaSpent,
    dormant: false,
    note: unresolved > 0 ? `${unresolved} of ${resolutions.length} channels had nothing live.` : null,
  };
}
