// Shared loader for the sitemap routes.
//
// Both /sitemap.xml (the index) and /sitemap/<shard>.xml (a child) need the same
// thing: the live camera registry, sharded. Keeping that in one place means the two
// routes cannot drift into disagreeing about which shards exist — an index
// advertising a child that 404s is the specific failure that makes a crawler give
// up on the whole set.

import { siteUrl } from "@/lib/brand";
import { getRegistry } from "@/lib/sources/registry";
import { buildSitemapShards, type SitemapShard, type SitemapResult } from "@/lib/seo/directory";

/** Static pages that are not part of the camera directory. */
export const STATIC_PATHS = ["/app", "/locate"];

export async function loadSitemapShards(): Promise<{
  origin: string;
  shards: SitemapShard[];
  result: SitemapResult;
}> {
  const origin = siteUrl();

  // Dormant-safe, matching the convention every adapter in this repo follows: a
  // failed registry must not serve a 5xx. A sitemap listing only the static pages is
  // a degraded answer; an error page is not an answer at all, and a crawler that
  // gets a 5xx from a sitemap backs off the whole set rather than retrying one file.
  let cameras: Awaited<ReturnType<typeof getRegistry>> = [];
  try {
    cameras = await getRegistry();
  } catch (err) {
    console.warn("[sitemap] camera registry unavailable, emitting static pages only:", err);
  }

  const { shards, result } = buildSitemapShards(cameras, origin, STATIC_PATHS);

  // No silent caps. Sharding raised the ceiling from 50k URLs total to 50k PER
  // SHARD, so this should now be unreachable — if it ever prints, a single country
  // has outgrown one file and that country needs paginating, not a larger constant.
  if (result.dropped > 0) {
    console.warn(
      `[sitemap] ${result.total} URLs exceeded the per-file protocol limit; ${result.dropped} dropped.`,
    );
  }

  return { origin, shards, result };
}
