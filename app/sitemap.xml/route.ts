import { loadSitemapShards, sitemapUnavailable } from "@/lib/seo/sitemapData";
import { renderSitemapIndex, sitemapHeaders } from "@/lib/seo/xml";
import { absoluteUrl } from "@/lib/seo/paths";

/**
 * GET /sitemap.xml — the sitemap INDEX.
 *
 * This replaced Next's built-in `app/sitemap.ts`. Two reasons, and the first is the
 * one that forced it: the built-in generator writes the XML itself and offers no
 * hook for the `<?xml-stylesheet?>` processing instruction, which has to precede the
 * root element. Second, hand-serialising is what lets this be an index over
 * per-country children rather than one flat file (see `buildSitemapShards`).
 *
 * `robots.txt` still points here and needs no change — a crawler pointed at a
 * sitemap URL accepts either a urlset or an index at that address.
 *
 * Regenerated daily rather than pinned at build time. The registry is a live thing:
 * feeds come and go, cameras appear, and `available` flips on its own. A sitemap
 * frozen at the last deploy would keep advertising cameras that have since gone and
 * would never mention the ones that arrived.
 */
export const revalidate = 86_400;

/**
 * Headroom for a COLD registry build, and it is not optional.
 *
 * Google reported "Couldn't fetch" against three children on the first read after
 * this shipped, including the two largest. The cause was a duration limit, not the
 * documents: with no `maxDuration` a route inherits Vercel's default (10-15 s),
 * while `getRegistry()` on a cold cache waits on the Castle Rock feed, whose
 * measured budget is 60 s (lib/sources/registry.ts). The children that succeeded
 * were the ones whose requests arrived AFTER the registry had warmed.
 *
 * The interaction is what made it invisible: before Castle Rock was repaired it
 * failed fast, so a cold sitemap build finished inside the default and nobody had
 * to think about this. Repairing the feed made the cold path six times slower.
 *
 * `app/api/planes/route.ts` sets its own limit for the same class of reason.
 */
export const maxDuration = 60;

export async function GET(): Promise<Response> {
  const { origin, shards, result, registryOk } = await loadSitemapShards();

  // Never publish an index we cannot vouch for. Advertising only the core shard
  // would tell a crawler the ~20,000 camera pages have been removed.
  if (!registryOk) return sitemapUnavailable();

  // An empty shard is omitted rather than advertised. A child sitemap containing
  // zero URLs is a valid document that tells a crawler nothing, and Search Console
  // reports it as an error against the index.
  const children = shards
    .filter((s) => s.entries.length > 0)
    .map((s) => ({ url: absoluteUrl(origin, `/sitemap/${s.id}.xml`) }));

  console.info(
    `[sitemap] index: ${children.length} shards, ${result.entries.length} URLs total (${result.skippedUnavailable} unavailable cameras not advertised)`,
  );

  return new Response(renderSitemapIndex(children), { headers: sitemapHeaders() });
}
