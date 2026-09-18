// lib/news/sources.ts
// Source identity: display name → brand domain, region, outlet type, and who owns
// or funds the newsroom. Powers the favicons and source badges on story cards, the
// region/type facet matrix, the ownership tooltip, and the diversity and blindspot
// readouts in lib/news/diversity.ts. PURE + node-testable.
//
// ── The honesty rule, and what it does and does not forbid ────────────────────
// Only outlets we can actually attribute get a domain, a region, a type and an
// owner; an unknown source degrades to a domainless, region-"Other" meta rather
// than a plausible guess. Nothing here is inferred from the outlet's coverage.
//
// WHAT IS RECORDED is corporate and constitutional fact: who owns the company,
// where the money comes from, which country it is based in. Those are matters of
// public record, they change rarely, and a reader can check every one of them.
// The table is maintained by hand for exactly that reason, and an outlet that
// changes hands needs its row changed with it.
//
// WHAT IS NOT RECORDED is a political-leaning score. The owner asked for one —
// Left / Centre / Right tags beside each source. There is no keyless, citable
// dataset of those: the credible ones (AllSides, Ad Fontes Media, Media Bias/Fact
// Check) are licensed products, and the alternative is this file inventing a
// political judgment about a newsroom and presenting it in the same typeface as
// its registered ownership. On this site that is the one thing that must not
// happen, so `leaning` exists as a typed, documented slot that is empty, and the
// UI hides the axis entirely rather than painting every outlet "unrated".
//
// The request behind it is still met, by measurement instead of assertion:
// ownership, funding and state control are shown per outlet, and the blindspot
// readout reports which regions and which kinds of newsroom covered a story and
// which did not. That is computed from the feed in front of the reader, so it can
// be checked against the very page it appears on.

/** How a newsroom is paid for. Public record, not a judgement about output. */
export type Funding =
  | "Licence fee"
  | "State budget"
  | "Public donations"
  | "Commercial"
  | "Trust"
  | "Cooperative"
  | "Unknown";

/**
 * A political-leaning grade.
 *
 * Declared so the UI and the tests can be written against the shape, and so the
 * day a licensed dataset is bought there is one obvious place to load it. See
 * LEANINGS below — it is empty on purpose.
 */
export type Leaning = "left" | "centre-left" | "centre" | "centre-right" | "right";

export interface SourceMeta {
  name: string;
  /** Brand domain for the favicon, or null when we can't attribute the source. */
  domain: string | null;
  /** Coarse geographic home of the outlet. "Other" when unknown. */
  region: string;
  /** Honest outlet type (public broadcaster / newspaper / newswire / …). */
  type: string;
  /** Who owns or funds the newsroom, as one readable clause. Null when unknown. */
  owner: string | null;
  /** Where the money comes from. */
  funding: Funding;
  /** Funded by a government. Not a claim about editorial independence. */
  stateFunded: boolean;
  /** Always null today — see the header note. */
  leaning: Leaning | null;
}

type Row = Omit<SourceMeta, "name" | "leaning">;

// Keyed by the lower-cased display name the feed carries. Extra well-known
// keyless outlets are pre-mapped so that IF a feed is added the badge, region,
// type and ownership already resolve — no fabrication, just attribution.
const TABLE: Record<string, Row> = {
  // ── United Kingdom ─────────────────────────────────────────────────────────
  bbc: { domain: "bbc.com", region: "UK", type: "Public broadcaster", owner: "The BBC, a public corporation operating under Royal Charter", funding: "Licence fee", stateFunded: true },
  "bbc news": { domain: "bbc.com", region: "UK", type: "Public broadcaster", owner: "The BBC, a public corporation operating under Royal Charter", funding: "Licence fee", stateFunded: true },
  "the guardian": { domain: "theguardian.com", region: "UK", type: "Newspaper", owner: "Guardian Media Group, owned by the Scott Trust", funding: "Trust", stateFunded: false },
  guardian: { domain: "theguardian.com", region: "UK", type: "Newspaper", owner: "Guardian Media Group, owned by the Scott Trust", funding: "Trust", stateFunded: false },
  "sky news": { domain: "news.sky.com", region: "UK", type: "Broadcaster", owner: "Sky Group, owned by Comcast", funding: "Commercial", stateFunded: false },
  "the independent": { domain: "independent.co.uk", region: "UK", type: "Newspaper", owner: "Independent Digital News & Media; shareholders include Evgeny Lebedev and Saudi-linked investor SMG", funding: "Commercial", stateFunded: false },
  independent: { domain: "independent.co.uk", region: "UK", type: "Newspaper", owner: "Independent Digital News & Media; shareholders include Evgeny Lebedev and Saudi-linked investor SMG", funding: "Commercial", stateFunded: false },

  // ── United States ──────────────────────────────────────────────────────────
  npr: { domain: "npr.org", region: "US", type: "Public radio", owner: "National Public Radio, a non-profit owned by its member stations", funding: "Public donations", stateFunded: false },
  cnn: { domain: "cnn.com", region: "US", type: "Broadcaster", owner: "Warner Bros. Discovery", funding: "Commercial", stateFunded: false },
  "cbs news": { domain: "cbsnews.com", region: "US", type: "Broadcaster", owner: "Paramount", funding: "Commercial", stateFunded: false },
  "abc news": { domain: "abcnews.com", region: "US", type: "Broadcaster", owner: "The Walt Disney Company", funding: "Commercial", stateFunded: false },
  "pbs newshour": { domain: "pbs.org", region: "US", type: "Public broadcaster", owner: "US public broadcasting; produced by WETA", funding: "Public donations", stateFunded: false },
  pbs: { domain: "pbs.org", region: "US", type: "Public broadcaster", owner: "US public broadcasting; produced by WETA", funding: "Public donations", stateFunded: false },
  "the new york times": { domain: "nytimes.com", region: "US", type: "Newspaper", owner: "The New York Times Company; the Ochs-Sulzberger family holds control through Class B shares", funding: "Commercial", stateFunded: false },
  "new york times": { domain: "nytimes.com", region: "US", type: "Newspaper", owner: "The New York Times Company; the Ochs-Sulzberger family holds control through Class B shares", funding: "Commercial", stateFunded: false },

  // ── Europe ─────────────────────────────────────────────────────────────────
  dw: { domain: "dw.com", region: "Europe", type: "Public broadcaster", owner: "Deutsche Welle, Germany's international broadcaster", funding: "State budget", stateFunded: true },
  "deutsche welle": { domain: "dw.com", region: "Europe", type: "Public broadcaster", owner: "Deutsche Welle, Germany's international broadcaster", funding: "State budget", stateFunded: true },
  "france 24": { domain: "france24.com", region: "Europe", type: "Public broadcaster", owner: "France Médias Monde, owned by the French state", funding: "State budget", stateFunded: true },
  euronews: { domain: "euronews.com", region: "Europe", type: "Broadcaster", owner: "Majority-owned by Alpac Capital", funding: "Commercial", stateFunded: false },

  // ── Middle East ────────────────────────────────────────────────────────────
  "al jazeera": { domain: "aljazeera.com", region: "Middle East", type: "Broadcaster", owner: "Al Jazeera Media Network, funded by the government of Qatar", funding: "State budget", stateFunded: true },
  "al arabiya": { domain: "alarabiya.net", region: "Middle East", type: "Broadcaster", owner: "MBC Group, Saudi Arabia", funding: "Commercial", stateFunded: false },
  "the jerusalem post": { domain: "jpost.com", region: "Middle East", type: "Newspaper", owner: "The Jerusalem Post Group, owned by Mirkaei Tikshoret", funding: "Commercial", stateFunded: false },
  "jerusalem post": { domain: "jpost.com", region: "Middle East", type: "Newspaper", owner: "The Jerusalem Post Group, owned by Mirkaei Tikshoret", funding: "Commercial", stateFunded: false },

  // ── Asia ───────────────────────────────────────────────────────────────────
  scmp: { domain: "scmp.com", region: "Asia", type: "Newspaper", owner: "South China Morning Post, owned by Alibaba Group", funding: "Commercial", stateFunded: false },
  "south china morning post": { domain: "scmp.com", region: "Asia", type: "Newspaper", owner: "South China Morning Post, owned by Alibaba Group", funding: "Commercial", stateFunded: false },
  "times of india": { domain: "timesofindia.indiatimes.com", region: "Asia", type: "Newspaper", owner: "Bennett, Coleman & Co. (The Times Group)", funding: "Commercial", stateFunded: false },

  // ── North America (non-US) ─────────────────────────────────────────────────
  cbc: { domain: "cbc.ca", region: "North America", type: "Public broadcaster", owner: "Canadian Broadcasting Corporation, a federal Crown corporation", funding: "State budget", stateFunded: true },

  // ── Wires ──────────────────────────────────────────────────────────────────
  reuters: { domain: "reuters.com", region: "International", type: "Newswire", owner: "Thomson Reuters; the Thomson family holds a controlling stake through Woodbridge", funding: "Commercial", stateFunded: false },
  "associated press": { domain: "apnews.com", region: "International", type: "Newswire", owner: "The Associated Press, a non-profit cooperative owned by its member newsrooms", funding: "Cooperative", stateFunded: false },
  ap: { domain: "apnews.com", region: "International", type: "Newswire", owner: "The Associated Press, a non-profit cooperative owned by its member newsrooms", funding: "Cooperative", stateFunded: false },

  // Open-source conflict monitor scraped from its keyless Telegram channel. Typed
  // "OSINT monitor" — NOT a vetted newswire — so the badge is honest about the
  // unverified, self-published provenance rather than implying wire-grade sourcing.
  liveuamap: { domain: "liveuamap.com", region: "International", type: "OSINT monitor", owner: "Liveuamap, an independent open-source monitoring project", funding: "Commercial", stateFunded: false },
};

/**
 * Political leaning per outlet. EMPTY, and that is the feature.
 *
 * Populating it by hand would mean this file asserting a political judgement
 * about a newsroom with nothing behind it, rendered with the same authority as
 * that newsroom's registered ownership two lines above. If a licensed rating set
 * is ever bought, load it here — keyed the same way as TABLE — and every
 * consumer picks it up, because they all read `hasLeaningData()` first.
 */
const LEANINGS: Record<string, Leaning> = {};

/** Whether ANY leaning data is loaded. The UI hides the axis when it is not. */
export function hasLeaningData(): boolean {
  return Object.keys(LEANINGS).length > 0;
}

const UNKNOWN: Row = {
  domain: null,
  region: "Other",
  type: "News",
  owner: null,
  funding: "Unknown",
  stateFunded: false,
};

/** Pure: display name → its attribution metadata (never throws; degrades to "Other"). */
export function sourceMeta(name: string): SourceMeta {
  const key = (name ?? "").trim().toLowerCase();
  const hit = TABLE[key] ?? UNKNOWN;
  return { name: name ?? "", ...hit, leaning: LEANINGS[key] ?? null };
}

/** Every display name the table can attribute — used by the tests and the docs. */
export function attributedSourceNames(): string[] {
  return Object.keys(TABLE);
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
