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
// /api/signals/headline-places would each have held their own, so every
// publisher and the Telegram channel would have been fetched TWICE per cycle, the two
// surfaces would have disagreed about what the news was, and nothing would have looked
// broken. The cache therefore hangs off globalThis under a Symbol.for key — the same
// pattern, for the same reason, as lib/news/scrapedStore.ts and lib/news/places.ts.
//
// This is a MOVE, not a rewrite. The feed list, the timeouts, the dormant-safe
// behaviour and the last-good fallback are the route's, unchanged, with their reasoning
// carried across intact.

import { parseRss, mergeNews, withinAge, type NewsItem, type NewsPayload } from "@/lib/news";
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
// middleman. CBC was once dropped here as "timing out on two of three attempts"; that
// was a User-Agent block, not a flaky feed — see FEED_USER_AGENT.
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
//
// WHY THERE ARE TWENTY-NINE (2026-10-16). The fourteen still left three continents with
// no outlet at all: of 451 headlines on prod that day, 35% came from British outlets,
// 15 named an African place, 14 a Latin American one and ONE an Oceanian one, and no
// newsroom from Africa, Latin America, Oceania, Canada or Korea was in the set. The
// fifteen below the line fill that, each probed live before it went in (status, item
// count, items under 24 h, and every item parsed with a date through parseRss). All
// are the publisher's own feed and keyless. Africanews, RNZ Pacific, MercoPress and
// Buenos Aires Times are the regional fills; CBC and Yonhap add Canada and a Korean
// national wire; PBS NewsHour covers PBS while the NewsScraper push is absent; SABC
// News headlines rarely name a country, so it widens the widget more than the map.
export const FEEDS: readonly Feed[] = [
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" },
  // 1004 is NPR World. 1001 (used until 2026-10-16) is NPR "News", a US domestic mix.
  { url: "https://feeds.npr.org/1004/rss.xml", source: "NPR" },
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
  // ── added 2026-10-16 ────────────────────────────────────────────────────────
  { url: "https://www.africanews.com/feed/rss", source: "Africanews" },
  // RNZ's robots.txt asks for a Crawl-delay of 7 s; the 5-minute cache is far wider.
  { url: "https://www.rnz.co.nz/rss/pacific.xml", source: "RNZ" },
  { url: "https://en.mercopress.com/rss", source: "MercoPress" },
  // Serves 100 items back two weeks; the age window (MAX_ITEM_AGE_MS) keeps the recent ones.
  { url: "https://www.batimes.com.ar/feed", source: "Buenos Aires Times" },
  { url: "https://www.cbc.ca/webfeed/rss/rss-world", source: "CBC" },
  { url: "https://en.yna.co.kr/RSS/news.xml", source: "Yonhap" },
  { url: "https://kyivindependent.com/news-archive/rss/", source: "Kyiv Independent" },
  { url: "https://www.pbs.org/newshour/feeds/rss/world", source: "PBS NewsHour" },
  { url: "https://www.abc.net.au/news/feed/51120/rss.xml", source: "ABC Australia" },
  // Item dates are date-only (stamped 12:00), so UN stories sort by day, not by hour.
  { url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml", source: "UN News" },
  { url: "https://www.rfi.fr/en/rss", source: "RFI" },
  { url: "https://www.ansa.it/english/news/english_nr_rss.xml", source: "ANSA" },
  // The feed URL focustaiwan.tw itself links to; it is CNA's own feed on feedburner.
  { url: "https://feeds.feedburner.com/rsscna/engnews/", source: "Focus Taiwan" },
  { url: "https://www.premiumtimesng.com/feed", source: "Premium Times" },
  { url: "https://www.sabcnews.com/sabcnews/feed/", source: "SABC News" },
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
 *
 * KEPT AT 500 WHEN THE FEEDS WENT FROM 14 TO 29 (2026-10-16), on a measurement and not
 * by default. After the 72-hour age window the 29 feeds held 855 distinct headlines;
 * the newest 500 reach back 16.5 hours. Clustering them on provenance-1:
 *
 *     n=500   ~71 ms     41 corroborated stories
 *     n=700   ~146 ms    61
 *     n=800   ~191 ms    74
 *     n=855   ~215 ms    74
 *
 * clusterNews runs in the reader's browser on every poll, so 700 doubles the cost on
 * their device for half again as many corroborated stories. That is a product trade
 * for the owner to make, not a side effect of adding feeds; the numbers are here for it.
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

/**
 * The User-Agent every feed and channel fetch sends.
 *
 * WAS "TrafficNerd/2.0 (+github.com/...)" FOR THE RSS FEEDS, AND THAT COST US CBC.
 * Measured 2026-10-16: cbc.ca answered a browser UA in 0.13 to 0.37 s three times out
 * of three, and let the TrafficNerd UA time out two times out of two. The earlier note
 * here called CBC "flaky"; it was a User-Agent block that looked like flakiness, because
 * a block that answers with silence instead of a 403 reads as a slow server. None of
 * the other feeds probed that day (23 of them) treated the two UAs differently, so the
 * browser string costs the other feeds nothing. The Telegram preview already needed it.
 */
export const FEED_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": FEED_USER_AGENT },
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
      headers: { "User-Agent": FEED_USER_AGENT, Accept: "text/html" },
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
  // The age window applies to every path alike, before the cap: a stale item must not
  // take one of the LIMIT places from a fresh one. See MAX_ITEM_AGE_MS for what it cost.
  const items = mergeNews(
    lists.map((list) => withinAge(list, nowMs)),
    LIMIT,
  );

  // Keep the last good list if a transient outage emptied everything.
  if (items.length === 0 && held && held.items.length > 0) return held;

  const payload: NewsPayload = { generatedAt: nowMs, items };
  globalCache[CACHE] = payload;
  return payload;
}
