import { parseRss, mergeNews, type NewsItem, type NewsPayload } from "@/lib/news";
import { parseTelegram } from "@/lib/news/telegram";
import { toNewsItems } from "@/lib/news/ingest";
import { scrapedItems } from "@/lib/news/scrapedStore";

export const dynamic = "force-dynamic";

// GET /api/news — a merged, de-duplicated headline stream from a few reputable,
// keyless world-news RSS feeds, parsed server-side (no client XML, no key). A
// short server cache (≥5 min) keeps it light. Dormant-safe: each feed is fetched
// independently and a dead/slow one is simply skipped (never a 5xx).

interface Feed {
  url: string;
  source: string;
}

// All six confirmed live (RSS/RDF 2026-07-09). A dead one drops out silently.
// The extra European broadcasters (DW, France 24) widen cross-source story
// clustering and give the region/type facet matrix real diversity.
const FEEDS: Feed[] = [
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" },
  { url: "https://feeds.npr.org/1001/rss.xml", source: "NPR" },
  { url: "https://www.theguardian.com/world/rss", source: "The Guardian" },
  { url: "https://rss.dw.com/rdf/rss-en-world", source: "DW" },
  { url: "https://www.france24.com/en/rss", source: "France 24" },
];

// Keyless Telegram channels, scraped from their public t.me/s web preview (no API,
// no key). Merged into the same stream as the RSS feeds; attribution stays honest
// via lib/news/sources.ts ("OSINT monitor"). Add a channel = add a line here.
interface TgChannel {
  url: string;
  source: string;
}
const TELEGRAM: TgChannel[] = [
  { url: "https://t.me/s/liveuamap", source: "Liveuamap" },
];

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * How many headlines the rail serves.
 *
 * WAS 60, AND 60 WAS THROWING AWAY MOST OF THE FEED. Measured on 2026-09-16, the six
 * RSS feeds alone carried 143 items between them (Guardian 45, BBC 26, Al Jazeera 25,
 * France 24 24, DW 13, NPR 10) before the Telegram channel or a single pushed story.
 * Production served exactly 60 of them, so the cap was the binding constraint and the
 * supply was not. It was chosen when the docked card showed about twenty and the only
 * job of the surplus was to give the focus view something to cluster.
 *
 * That changed when this stream became the news feed rather than a widget behind it.
 *
 * THE THREE THINGS THAT BOUND THIS, ALL MEASURED RATHER THAN GUESSED:
 *   • Payload. A served item runs about 665 bytes, so 300 is roughly 200 KB raw and
 *     about 40 KB over the wire once compressed. Behind a 5-minute server cache and
 *     Cloudflare, that is a fair cost for the whole feed instead of a third of it.
 *   • Clustering. clusterNews is O(n^2) over small token sets: 60 items is ~1,800
 *     comparisons, 300 is ~45,000, which is still well under a frame in the browser.
 *   • Supply. There is no point going far past what the sources hold. 300 leaves
 *     headroom over today's ~143 for the Telegram channel and the pushed stories,
 *     without the cap pretending to a depth the feeds do not have.
 */
const LIMIT = 300;

/**
 * How many pushed stories join the merge. The scraper holds far more than the rail
 * can show; this is the candidate pool clustering gets to choose from, not a display
 * count — mergeNews still cuts the result to LIMIT.
 *
 * Raised with LIMIT, and it has to be: the merge sorts every candidate by time and
 * keeps the newest LIMIT. A pool smaller than the cap would quietly hand the RSS feeds
 * the difference, so the scraper would be throttled by this constant rather than by
 * how recent its stories actually are.
 */
const SCRAPED_POOL = 400;

let cache: NewsPayload | null = null;

async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return parseRss(await res.text(), feed.source);
  } catch {
    return []; // a dead feed contributes nothing
  }
}

async function fetchTelegram(ch: TgChannel): Promise<NewsItem[]> {
  try {
    // t.me/s serves its HTML only to browser-like clients, so use a browser UA.
    const res = await fetch(ch.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return parseTelegram(await res.text(), ch.source);
  } catch {
    return []; // a dead channel contributes nothing
  }
}

export async function GET() {
  if (cache && Date.now() - cache.generatedAt < CACHE_TTL_MS) {
    return Response.json(cache);
  }
  const lists = await Promise.all([
    ...FEEDS.map(fetchFeed),
    ...TELEGRAM.map(fetchTelegram),
  ]);
  // Stories pushed by the NewsScraper host join the same merge as the feeds. They
  // are ADDITIVE, not a replacement: the scraper covers Reuters and PBS, which have
  // no usable public feed, while the RSS set covers Al Jazeera, NPR, DW and France 24,
  // which it does not scrape. mergeNews de-duplicates on URL and headline, so a BBC
  // story arriving down both paths appears once.
  //
  // Dormant-safe by construction: before the first push, and after every restart of
  // this process, the store is empty and this contributes [] — exactly what a dead
  // feed contributes. Nothing here can fail a request.
  lists.push(toNewsItems(scrapedItems(SCRAPED_POOL)));
  const items = mergeNews(lists, LIMIT);
  // Keep the last good list if a transient outage emptied everything.
  if (items.length === 0 && cache && cache.items.length > 0) {
    return Response.json(cache);
  }
  cache = { generatedAt: Date.now(), items };
  return Response.json(cache);
}
