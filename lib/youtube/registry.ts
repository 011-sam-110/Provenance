import {
  resolveLiveVideos,
  requestKey,
  type ChannelRequest,
  type ResolveResult,
  type Resolution,
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
