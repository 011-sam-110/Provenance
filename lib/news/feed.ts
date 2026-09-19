// lib/news/feed.ts
// The merged headline stream, fetched once and shared by everything that reads it.
//
// WHY THIS MODULE EXISTS AT ALL. Until the headline-places layer there was exactly one
// reader — app/api/news/route.ts — so the feed list, the fetching and the cache all
// lived inside that route. A second reader in a different route turns that arrangement
// into a bug rather than a tidiness question, and the bug is not obvious:
//
// NEXT BUNDLES EACH ROUTE HANDLER SEPARATELY, SO MODULE STATE IS NOT SHARED. A
// `let cache` at the top of a route file is one cache per bundle. /api/news and
// /api/signals/headline-places would each have held their own, so the fourteen
// publishers and the Telegram channel would have been fetched TWICE per cycle, the two
// surfaces would have disagreed about what the news was, and nothing would have looked
// broken. The cache therefore hangs off globalThis under a Symbol.for key — the same
// pattern, for the same reason, as lib/news/scrapedStore.ts and lib/news/places.ts.
//
// This is a MOVE, not a rewrite. The feed list, the timeouts, the dormant-safe
// behaviour and the last-good fallback are the route's, unchanged, with their reasoning
// carried across intact.

import { parseRss, mergeNews, type NewsItem, type NewsPayload } from "@/lib/news";
import { parseTelegram } from "@/lib/news/telegram";
import { toNewsItems } from "@/lib/news/ingest";
import { scrapedItems } from "@/lib/news/scrapedStore";

interface Feed {
  url: string;
  source: string;
}

// Every feed below was fetched and parsed before being added (2026-09-18), and every
// URL is the PUBLISHER'S OWN. That second rule cost the Associated Press a place here:
// AP has no public feed of its own any more, and the mirrors that carry it are third
// parties republishing someone else's wire. A site whose whole argument is that you can
// check where a claim came from cannot source its news from an unattributable
// middleman. CBC was dropped for a duller reason — it timed out on two of three
// attempts, and a feed that usually is not there is not a source, it is latency.
//
// WHY THERE ARE FOURTEEN OF THEM. The focus view clusters these headlines into
// cross-source stories, and with the original six that view had almost nothing to show:
// measured against a live pull of 300 headlines, 93% of its "stories" had a single
// source, so the board was a chronological list wearing story cards. The cause was not
// the clustering — it was that six world feeds mostly cover different events.
// Re-measured on the same snapshot with these feeds added, the count of genuinely
// corroborated stories went from 19 to 52. No change to lib/news/cluster.ts came close
// to that, and several were tried.
//
// The additions are also deliberately not all Anglo-American. Blindspot detection
// (lib/news/diversity.ts) reports which parts of the world covered a story and which
// ignored it, and that report is worthless if the only outlets present are British and
// American — it would find a blindspot in every story on earth. SCMP, Times of India
// and the Jerusalem Post are there to give that measurement something real to measure.
export const FEEDS: readonly Feed[] = [
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" },
  { url: "https://feeds.npr.org/1001/rss.xml", source: "NPR" },
  { url: "https://www.theguardian.com/world/rss", source: "The Guardian" },
  { url: "https://rss.dw.com/rdf/rss-en-world", source: "DW" },
  { url: "https://www.france24.com/en/rss", source: "France 24" },
  { url: "https://feeds.skynews.com/feeds/rss/world.xml", source: "Sky News" },
  { url: "https://www.cbsnews.com/latest/rss/world", source: "CBS News" },
  { url: "https://abcnews.com/abcnews/internationalheadlines", source: "ABC News" },
  { url: "https://www.independent.co.uk/news/world/rss", source: "The Independent" },
  { url: "https://www.euronews.com/rss?level=theme&name=news", source: "Euronews" },
  { url: "https://www.scmp.com/rss/91/feed/", source: "SCMP" },
  { url: "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms", source: "Times of India" },
  { url: "https://www.jpost.com/rss/rssfeedsinternational", source: "The Jerusalem Post" },
];

// Keyless Telegram channels, scraped from their public t.me/s web preview (no API, no
// key). Merged into the same stream as the RSS feeds; attribution stays honest via
// lib/news/sources.ts ("OSINT monitor"). Add a channel = add a line here.
interface TgChannel {
  url: string;
  source: string;
}
const TELEGRAM: readonly TgChannel[] = [{ url: "https://t.me/s/liveuamap", source: "Liveuamap" }];

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
 *     comparisons, 500 is ~125,000 — measured at 88 ms through the real clusterer,
 *     once per two-minute poll rather than per frame.
 *   • Supply. There is no point going far past what the sources hold.
 *
 * RAISED FROM 300 TO 500 ON 2026-09-18, because with fourteen feeds the cap became the
 * binding constraint rather than the supply. The feeds now offer well over 500 recent
 * items between them, and mergeNews keeps the newest LIMIT — so the eight feeds added
 * that day were DISPLACING older headlines instead of adding to the pool, and a story's
 * second and third reports were being cut before the clusterer ever saw them. Measured
 * on one snapshot, clustering the newest n of a 545-item pool:
 *
 *     n=300   ~26 ms    25 corroborated stories
 *     n=400   ~48 ms    44
 *     n=500   ~88 ms    50
 *     n=545   ~91 ms    52
 *
 * The yield curve flattens after 500 and the cost curve does not, which is where the
 * number came from. It is a straight trade of 60 ms per poll for twice the corroborated
 * stories, and the whole point of this board is the corroborated ones.
 */
export const LIMIT = 500;

/**
 * How many pushed stories join the merge. The scraper holds far more than the rail can
 * show; this is the candidate pool clustering gets to choose from, not a display count
 * — mergeNews still cuts the result to LIMIT.
 *
 * Raised with LIMIT, and it has to be: the merge sorts every candidate by time and keeps
 * the newest LIMIT. A pool smaller than the cap would quietly hand the RSS feeds the
 * difference, so the scraper would be throttled by this constant rather than by how
 * recent its stories actually are.
 */
export const SCRAPED_POOL = 700;

/**
 * Shared across route bundles, for the reason in this file's header. A plain module
 * `let` here would be one cache per reader, which is the bug this module exists to
 * avoid rather than a detail of how it avoids it.
 */
const CACHE = Symbol.for("provenance.news.feedCache");
const globalCache = globalThis as unknown as { [CACHE]?: NewsPayload | null };

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

/**
 * The merged, de-duplicated headline stream, behind a shared 5-minute cache.
 *
 * Dormant-safe by construction: each upstream is fetched independently and a dead or
 * slow one contributes [] rather than failing the call, so this never throws and never
 * produces a 5xx for its callers.
 *
 * THE LAST-GOOD FALLBACK IS NOT AN OPTIMISATION. If every upstream fails at once — one
 * bad minute of network on the host — a naive implementation would cache the empty
 * result and serve an empty feed for five minutes. Returning the previous payload keeps
 * the stale-but-true answer instead of publishing a false "no news".
 */
export async function mergedNews(nowMs = Date.now()): Promise<NewsPayload> {
  const held = globalCache[CACHE];
  if (held && nowMs - held.generatedAt < CACHE_TTL_MS) return held;

  const lists = await Promise.all([...FEEDS.map(fetchFeed), ...TELEGRAM.map(fetchTelegram)]);

  // Stories pushed by the NewsScraper host join the same merge as the feeds. They are
  // ADDITIVE, not a replacement: the scraper covers Reuters and PBS, which have no
  // usable public feed, while the RSS set covers Al Jazeera, NPR, DW and France 24,
  // which it does not scrape. mergeNews de-duplicates on URL and headline, so a BBC
  // story arriving down both paths appears once.
  //
  // Dormant-safe by construction: before the first push, and after every restart of
  // this process, the store is empty and this contributes [] — exactly what a dead feed
  // contributes. Nothing here can fail a request.
  lists.push(toNewsItems(scrapedItems(SCRAPED_POOL)));
  const items = mergeNews(lists, LIMIT);

  // Keep the last good list if a transient outage emptied everything.
  if (items.length === 0 && held && held.items.length > 0) return held;

  const payload: NewsPayload = { generatedAt: nowMs, items };
  globalCache[CACHE] = payload;
  return payload;
}
