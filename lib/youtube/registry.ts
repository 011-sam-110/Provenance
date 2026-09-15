import {
  resolveLiveVideos,
  listChannelLive,
  requestKey,
  type ChannelRequest,
  type ResolveResult,
  type Resolution,
  type ChannelLive,
} from "@/lib/youtube/live";

// Server-side cache for channel → current live video, the YouTube analogue of
// lib/webcams/registry.ts.
//
// The last-known map is the whole point of the cheap-validate/rare-rediscover
// design (see live.ts): without it every refresh would have to pay 100 quota
// units per channel. It is deliberately module-level and process-local — a cold
// serverless instance simply pays for one round of rediscovery and repopulates.
//
// TTL is 10 minutes. Long enough that a warm instance spends almost nothing;
// short enough that a broadcaster restarting a stream is picked up quickly.

const TTL_MS = 10 * 60 * 1000;

const lastKnown = new Map<string, string>();
let cache: { result: ResolveResult; at: number } | null = null;
let inflight: Promise<ResolveResult> | null = null;

/** Exposed for tests — resets the module-level memory between cases. */
export function __resetYoutubeRegistry(): void {
  lastKnown.clear();
  cache = null;
  inflight = null;
  channelCache.clear();
  channelInflight.clear();
}

/**
 * Fold a finished round back into the last-known map.
 *
 * Only positive results are written. A channel that resolved to nothing KEEPS
 * its previous id, so a single flaky API round does not force a 100-unit
 * rediscovery on the next one — the cheap validation call will simply report it
 * dead again if it really is.
 */
export function rememberResolutions(resolutions: readonly Resolution[]): void {
  for (const r of resolutions) {
    if (r.videoId) lastKnown.set(requestKey(r), r.videoId);
  }
}

// Per-channel cache for the live-cams board. Separate from the resolution cache
// above because it answers a different question ("everything this channel is
// running") and is populated ON DEMAND, one channel at a time — see
// listChannelLive for why eager resolution would be unaffordable.
const channelCache = new Map<string, { value: ChannelLive; at: number; ttlMs: number }>();
const channelInflight = new Map<string, Promise<ChannelLive>>();

/** How long a "nothing live" answer is held. See channelTtlMs. */
export const EMPTY_CHANNEL_TTL_MS = 2 * 60 * 1000;

/**
 * A positive (or dormant) answer is held for the full TTL. "Nothing live" is held
 * for two minutes only. Ten minutes would hide a stream that started soon after, but
 * holding it for NO time made each open of a quiet channel cost a 100-unit
 * search.list: 100 opens spent the whole 10,000-unit daily quota, and after that the
 * shared news-channel resolution failed too.
 */
export function channelTtlMs(value: ChannelLive): number {
  return value.videos.length > 0 || value.dormant ? TTL_MS : EMPTY_CHANNEL_TTL_MS;
}

export async function getChannelLive(channelId: string): Promise<ChannelLive> {
  const hit = channelCache.get(channelId);
  if (hit && Date.now() - hit.at < hit.ttlMs) return hit.value;

  let pending = channelInflight.get(channelId);
  if (!pending) {
    pending = listChannelLive(channelId)
      .then((value) => {
        channelCache.set(channelId, { value, at: Date.now(), ttlMs: channelTtlMs(value) });
        return value;
      })
      .finally(() => channelInflight.delete(channelId));
    channelInflight.set(channelId, pending);
  }
  return pending;
}

async function refresh(requests: readonly ChannelRequest[]): Promise<ResolveResult> {
  const result = await resolveLiveVideos(requests, lastKnown);
  rememberResolutions(result.resolutions);
  cache = { result, at: Date.now() };
  return result;
}

/**
 * Fresh-or-revalidate. A warm cache answers instantly; a stale one answers
 * instantly too while a single shared refresh runs behind it. resolveLiveVideos
 * never throws, so there is no failure path to guard here.
 */
export async function getLiveVideos(requests: readonly ChannelRequest[]): Promise<ResolveResult> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.result;
  if (!inflight) {
    inflight = refresh(requests).finally(() => {
      inflight = null;
    });
  }
  return cache ? cache.result : inflight;
}
