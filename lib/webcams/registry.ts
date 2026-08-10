import { fetchWebcamSample, type WebcamSample } from "@/lib/webcams/fetch";

// Server-side webcams cache — the Windy analogue of lib/sources/registry.ts, but
// kept DELIBERATELY SHORT (8 min, under the free-tier ~10 min image-token expiry)
// so a marker's image URL is never served stale enough to have expired. Webcams
// are a distinct layer, so this lives apart from the camera registry and never
// touches camera counts.
//
// A failed refresh must never LOOK like an empty world: if we have a last-good
// sample we keep serving it, and the sample carries its own honest note about
// what happened (see describeWebcamSample).

const TTL_MS = 8 * 60 * 1000;

let cache: { sample: WebcamSample; at: number } | null = null;
let inflight: Promise<WebcamSample> | null = null;

const EMPTY: WebcamSample = {
  webcams: [],
  dormant: false,
  pagesOk: 0,
  pagesFailed: 0,
  statuses: [],
  mapping: null,
};

async function refresh(): Promise<WebcamSample> {
  const sample = await fetchWebcamSample();
  // Only replace a good sample with another good one; a total upstream failure
  // keeps the last-good markers on the map rather than blanking the layer.
  if (sample.webcams.length > 0 || sample.dormant || !cache || cache.sample.webcams.length === 0) {
    cache = { sample, at: Date.now() };
  } else {
    cache = { sample: cache.sample, at: Date.now() };
  }
  return cache.sample;
}

/**
 * Fresh-or-revalidate: a fresh cache returns instantly; a stale cache returns
 * instantly while a single shared refresh runs behind it. Only a cold call waits.
 * fetchWebcamSample never throws, so this is safe.
 */
export async function getWebcams(): Promise<WebcamSample> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.sample;
  if (!inflight) {
    inflight = refresh()
      .catch(() => cache?.sample ?? EMPTY)
      .finally(() => {
        inflight = null;
      });
  }
  return cache ? cache.sample : inflight;
}
