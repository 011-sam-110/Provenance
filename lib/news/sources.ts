// lib/news/sources.ts
// Source identity: display name → brand domain, region and outlet type. Powers
// the favicons + source badges on cluster mega-cards and the region/type filter
// matrix. PURE + node-testable.
//
// Honesty rules: only outlets we can actually attribute get a domain/region/type;
// an unknown source degrades to a domainless, region-"Other" meta (no favicon, no
// fabricated attribution). There is deliberately NO political-leaning axis — we
// cannot source that credibly, so we omit it rather than invent it.

export interface SourceMeta {
  name: string;
  /** Brand domain for the favicon, or null when we can't attribute the source. */
  domain: string | null;
  /** Coarse geographic home of the outlet. "Other" when unknown. */
  region: string;
  /** Honest outlet type (public broadcaster / newspaper / newswire / …). */
  type: string;
}

// Keyed by the lower-cased display name the feed carries. Kept small + honest.
// Extra well-known keyless outlets are pre-mapped so that IF a feed is added the
// badge/region/type already resolve — no fabrication, just attribution.
const TABLE: Record<string, Omit<SourceMeta, "name">> = {
  "bbc": { domain: "bbc.com", region: "UK", type: "Public broadcaster" },
  "bbc news": { domain: "bbc.com", region: "UK", type: "Public broadcaster" },
  "al jazeera": { domain: "aljazeera.com", region: "Middle East", type: "Broadcaster" },
  "npr": { domain: "npr.org", region: "US", type: "Public radio" },
  "the guardian": { domain: "theguardian.com", region: "UK", type: "Newspaper" },
  "guardian": { domain: "theguardian.com", region: "UK", type: "Newspaper" },
  "dw": { domain: "dw.com", region: "Europe", type: "Public broadcaster" },
  "deutsche welle": { domain: "dw.com", region: "Europe", type: "Public broadcaster" },
  "france 24": { domain: "france24.com", region: "Europe", type: "Public broadcaster" },
  "reuters": { domain: "reuters.com", region: "International", type: "Newswire" },
  "associated press": { domain: "apnews.com", region: "International", type: "Newswire" },
  "ap": { domain: "apnews.com", region: "International", type: "Newswire" },
  "cnn": { domain: "cnn.com", region: "US", type: "Broadcaster" },
  "al arabiya": { domain: "alarabiya.net", region: "Middle East", type: "Broadcaster" },
  "cbc": { domain: "cbc.ca", region: "North America", type: "Public broadcaster" },
  "sky news": { domain: "news.sky.com", region: "UK", type: "Broadcaster" },
  // Pushed by the NewsScraper host rather than pulled from a feed. Attribution works
  // the same either way — the badge describes the outlet, not how we reached it.
  "pbs newshour": { domain: "pbs.org", region: "US", type: "Public broadcaster" },
  "pbs": { domain: "pbs.org", region: "US", type: "Public broadcaster" },
  "the new york times": { domain: "nytimes.com", region: "US", type: "Newspaper" },
  "new york times": { domain: "nytimes.com", region: "US", type: "Newspaper" },
  // Open-source conflict monitor scraped from its keyless Telegram channel. Typed
  // "OSINT monitor" — NOT a vetted newswire — so the badge is honest about the
  // unverified, self-published provenance rather than implying wire-grade sourcing.
  "liveuamap": { domain: "liveuamap.com", region: "International", type: "OSINT monitor" },
};

/** Pure: display name → its attribution metadata (never throws; degrades to "Other"). */
export function sourceMeta(name: string): SourceMeta {
  const key = (name ?? "").trim().toLowerCase();
  const hit = TABLE[key];
  if (hit) return { name: name ?? "", ...hit };
  return { name: name ?? "", domain: null, region: "Other", type: "News" };
}

/** Keyless favicon URL for a brand domain, or null when unattributed. */
export function faviconUrl(domain: string | null, size = 32): string | null {
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

/** Single-letter monogram used as the graceful favicon fallback (drops a leading "The "). */
export function sourceInitial(name: string): string {
  const s = (name ?? "").trim().replace(/^the\s+/i, "");
  const m = s.match(/[a-z0-9]/i);
  return m ? m[0].toUpperCase() : "?";
}
