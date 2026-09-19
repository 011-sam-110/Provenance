import { mergedNews } from "@/lib/news/feed";

export const dynamic = "force-dynamic";

// GET /api/news — a merged, de-duplicated headline stream from a few reputable, keyless
// world-news RSS feeds and a public Telegram channel, parsed server-side (no client XML,
// no key), plus whatever the NewsScraper host has pushed.
//
// THE FEED LIST AND THE CACHE MOVED TO lib/news/feed.ts, and the move was not tidying.
// The headline-places map layer reads the same stream from a different route bundle, and
// Next gives each bundle its own module state — so a cache living in this file would have
// been one cache per reader, fetching every publisher twice per cycle and letting the map
// and the rail disagree about what the news was. That file explains the shape; this route
// is now just the HTTP door onto it.

export async function GET() {
  return Response.json(await mergedNews());
}
