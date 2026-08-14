import { loadSitemapShards, sitemapUnavailable } from "@/lib/seo/sitemapData";
import { findShard } from "@/lib/seo/directory";
import { renderUrlset, sitemapHeaders } from "@/lib/seo/xml";

/**
 * GET /sitemap/<shard>.xml — one child sitemap listed by the index.
 *
 * The `.xml` suffix is part of the dynamic segment rather than a route directory,
 * because App Router segments cannot carry a literal extension after a `[param]`.
 * So the incoming value is "cameras-us.xml" and the extension is stripped here. It
 * is required, not optional: accepting both /sitemap/cameras-us and the .xml form
 * would serve one document at two URLs, which is duplicate content pointing at
 * itself.
 *
 * Unknown shard ids 404 rather than returning an empty urlset. An empty document is
 * a valid sitemap saying "there is nothing here", which would let a typo in the
 * index look like a genuinely empty country instead of a broken link.
 */
export const revalidate = 86_400;

/** Same cold-registry headroom as the index — see app/sitemap.xml/route.ts. */
export const maxDuration = 60;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ shard: string }> },
): Promise<Response> {
  const { shard: raw } = await ctx.params;

  if (!raw.toLowerCase().endsWith(".xml")) {
    return new Response("Not found", { status: 404 });
  }
  const id = raw.slice(0, -".xml".length);

  const { shards, registryOk } = await loadSitemapShards();

  // 503, not 404, when the registry did not answer. A 404 on a child the index
  // advertises tells a crawler that group is permanently gone; a 503 says come back.
  // Order matters — this must precede the not-found check, because a failed registry
  // makes every camera shard look non-existent.
  if (!registryOk) return sitemapUnavailable();

  const shard = findShard(shards, id);
  if (!shard || shard.entries.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(renderUrlset(shard.entries), { headers: sitemapHeaders() });
}
