import { loadSitemapShards } from "@/lib/seo/sitemapData";
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

export async function GET(): Promise<Response> {
  const { origin, shards, result } = await loadSitemapShards();

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
