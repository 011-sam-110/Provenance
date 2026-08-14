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

/**
 * Response for a sitemap route that must not publish what it cannot vouch for.
 *
 * `Retry-After` is a real instruction, not decoration: it tells the crawler this is
 * transient and worth coming back for, which is the difference between a retry and
 * being dropped from the schedule.
 */
export function sitemapUnavailable(): Response {
  return new Response("Sitemap temporarily unavailable: camera registry did not answer.\n", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "600", "Cache-Control": "no-store" },
  });
}

export async function loadSitemapShards(): Promise<{
  origin: string;
  shards: SitemapShard[];
  result: SitemapResult;
  /** False when the registry threw or came back empty — the caller must NOT publish. */
  registryOk: boolean;
}> {
  const origin = siteUrl();

  // A SITEMAP IS THE ONE PLACE THE DORMANT-SAFE CONVENTION INVERTS.
  //
  // Everywhere else in this repo a failed upstream degrades to `[]` and never a
  // 5xx, because a user-facing route that errors is worse than one that is honestly
  // empty. This route is not user-facing, and for a crawler the two outcomes swap
  // places: serving a 200 index that lists only the static pages, when 20,000 camera
  // pages exist, does not read as "degraded" — it reads as a DELIBERATE STATEMENT
  // that those pages are gone. A sitemap is an assertion about what exists, so the
  // empty answer is the destructive one.
  //
  // A 5xx, by contrast, is a retry. Google refetches a sitemap that failed and, by
  // then, `getRegistry()`'s stale-while-revalidate cache is warm and the second
  // attempt succeeds. Failing loudly is self-healing here; succeeding quietly is not.
  //
  // Zero cameras counts as failure for the same reason. A genuinely camera-less
  // deployment is not a state worth optimising for, and treating it as success is
  // exactly how a transient outage would delist the whole directory.
  let cameras: Awaited<ReturnType<typeof getRegistry>> = [];
  let registryOk = true;
  try {
    cameras = await getRegistry();
    if (cameras.length === 0) {
      registryOk = false;
      console.error("[sitemap] registry returned zero cameras; refusing to publish a truncated sitemap");
    }
  } catch (err) {
    registryOk = false;
    console.error("[sitemap] camera registry unavailable; refusing to publish a truncated sitemap:", err);
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

  return { origin, shards, result, registryOk };
}
