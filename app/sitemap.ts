import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/brand";
import { getRegistry } from "@/lib/sources/registry";
import { buildSitemap } from "@/lib/seo/directory";

/**
 * Regenerated daily rather than pinned at build time. The registry is a live thing:
 * feeds come and go, cameras appear, and `available` flips on its own. A sitemap
 * frozen at the last deploy would keep advertising cameras that have since gone and
 * would never mention the ones that arrived.
 */
export const revalidate = 86_400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();

  // Dormant-safe, matching the convention every adapter in this repo follows: a
  // failed registry must not fail the build or serve a 5xx. A sitemap listing only
  // the static pages is a degraded answer; a broken deploy is not an answer at all.
  let cameras: Awaited<ReturnType<typeof getRegistry>> = [];
  try {
    cameras = await getRegistry();
  } catch (err) {
    console.warn("[sitemap] camera registry unavailable, emitting static pages only:", err);
  }

  const result = buildSitemap(cameras, origin, ["/app", "/locate"]);

  // No silent caps. If either of these ever prints, the single-file design has been
  // outgrown and the fix is generateSitemaps(), not a larger constant.
  if (result.dropped > 0) {
    console.warn(
      `[sitemap] ${result.total} URLs exceeds the per-file protocol limit; ${result.dropped} were dropped. Split with generateSitemaps().`,
    );
  }
  console.info(
    `[sitemap] ${result.entries.length} URLs from ${cameras.length} cameras (${result.skippedUnavailable} unavailable, not advertised)`,
  );

  return result.entries;
}
