import { loadSitemapShards } from "@/lib/seo/sitemapData";
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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ shard: string }> },
): Promise<Response> {
  const { shard: raw } = await ctx.params;

  if (!raw.toLowerCase().endsWith(".xml")) {
    return new Response("Not found", { status: 404 });
  }
  const id = raw.slice(0, -".xml".length);

  const { shards } = await loadSitemapShards();
  const shard = findShard(shards, id);
  if (!shard || shard.entries.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(renderUrlset(shard.entries), { headers: sitemapHeaders() });
}
