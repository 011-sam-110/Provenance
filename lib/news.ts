// Hand-rolled RSS/Atom parser — zero new deps. Reputable world-news feeds are
// plain, well-formed XML, so a small tag-scanning parser (no DOMParser, no heavy
// XML lib) is enough and keeps the bundle lean. Pure + isomorphic so it
// unit-tests in node against a captured fixture.
//
// Feeds confirmed live 2026-06-27 (all RSS 2.0 with <item><title><link><pubDate>):
//   BBC World      http://feeds.bbci.co.uk/news/world/rss.xml
//   Al Jazeera     https://www.aljazeera.com/xml/rss/all.xml
//   NPR News       https://feeds.npr.org/1001/rss.xml
//   The Guardian   https://www.theguardian.com/world/rss
// Atom (<entry>/<link href>/<updated>) is handled defensively too.

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  ts: number; // epoch ms (0 when the feed omits a parseable date)
  /** Cleaned RSS <description>/<summary> snippet, when the feed provides one. */
  description?: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** Strip CDATA + surrounding tags/whitespace and decode entities. */
function cleanText(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<[^>]+>/g, " "); // drop literal inline markup (CDATA HTML)
  s = decodeEntities(s); // entity-encoded markup (e.g. Guardian's &lt;p&gt;) becomes real tags…
  s = s.replace(/<[^>]+>/g, " "); // …strip those too, else raw <p>/<a href> leak into the snippet
  return s.replace(/\s+/g, " ").trim();
}

/** First inner value of <tag>…</tag> within `block`, or undefined. */
function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : undefined;
}

/** Atom <link href="…"/> (prefers rel="alternate"), else the RSS <link> text. */
function extractLink(block: string): string | undefined {
  const rss = tag(block, "link");
  if (rss && rss.trim()) return cleanText(rss);
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return decodeEntities(alt[1]);
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return any ? decodeEntities(any[1]) : undefined;
}

/** Parse a date from RSS pubDate / Atom updated|published → epoch ms (0 if none). */
function parseDate(block: string): number {
  const raw = tag(block, "pubDate") ?? tag(block, "updated") ?? tag(block, "published") ?? tag(block, "dc:date");
  if (!raw) return 0;
  const t = Date.parse(cleanText(raw));
  return Number.isFinite(t) ? t : 0;
}

/**
 * The element that opens a feed entry, and the two lookaheads are load-bearing.
 *
 * `<(item|entry)` ALONE ALSO MATCHES `<items>`, and RSS 1.0 (RDF) opens its channel
 * with exactly that: an `<items><rdf:Seq>…</rdf:Seq></items>` table of contents. The
 * lazy body then ran to the first `</item`, which is inside `</items>` — so the very
 * first "entry" parsed out of a DW feed was a 2,880-character block spanning the Seq,
 * the closing `</channel>`, the feed's `<image>` element and THE FIRST REAL STORY.
 *
 * Both halves of that were wrong and only one of them was visible. The visible half
 * was a headline reading "DW" linking to dw.com, picked up from the `<image>` title.
 * The silent half is the one that mattered: the first story of the feed was eaten
 * every time, on every refresh, and nothing could have noticed — a feed that serves
 * 12 of its 13 items looks exactly like a feed that has 12.
 *
 * So the open tag must be followed by whitespace, `/` or `>`, and the close tag may
 * only carry whitespace before its own `>`.
 */
const FEED_ENTRY = /<(item|entry)(?=[\s/>])[\s\S]*?<\/\1\s*>/gi;

/**
 * Pure: one feed's XML → NewsItem[]. Tolerates RSS <item> and Atom <entry>.
 * Skips entries with no title or no http(s) link. `source` is the display name.
 */
export function parseRss(xml: string | null | undefined, source: string): NewsItem[] {
  if (!xml) return [];
  const out: NewsItem[] = [];
  const blocks = xml.match(FEED_ENTRY) ?? [];
  for (const block of blocks) {
    const title = cleanText(tag(block, "title"));
    const url = extractLink(block);
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;
    const descRaw = tag(block, "description") ?? tag(block, "summary");
    const description = cleanText(descRaw) || undefined;
    out.push({ title, source, url: url.trim(), ts: parseDate(block), description });
  }
  return out;
}

/**
 * Pure: merge per-feed lists → newest-first, de-duplicated, capped. Dedupe is by
 * URL first, then by a normalised title (different feeds carrying the same story).
 */
export function mergeNews(lists: NewsItem[][], limit = 30): NewsItem[] {
  const all = lists.flat().sort((a, b) => b.ts - a.ts);
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of all) {
    const url = it.url.replace(/[#?].*$/, "").toLowerCase();
    const titleKey = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenUrl.has(url) || (titleKey && seenTitle.has(titleKey))) continue;
    seenUrl.add(url);
    if (titleKey) seenTitle.add(titleKey);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

export interface NewsPayload {
  generatedAt: number;
  items: NewsItem[];
}
