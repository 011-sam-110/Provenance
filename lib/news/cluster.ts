// lib/news/cluster.ts
// Story clustering: group headlines that describe the SAME event into one parent
// "mega-card" carrying every source that reported it. PURE + node-testable.
//
// ── Why this was rewritten ────────────────────────────────────────────────────
// The first version scored two headlines by Jaccard similarity over their
// significant tokens and fused at 0.26. Measured against a live /api/news pull
// (300 headlines, 10 sources, 2026-09-18) it put 93% of headlines in a cluster of
// one. A board of single-source "stories" is just a chronological list with extra
// steps, which is exactly what it looked like.
//
// The failure is not the threshold, it is what Jaccard measures. Jaccard is a
// RATIO, so it cannot tell a shared word apart from a shared fact:
//
//   "New cat species identified for first time in more than a century in Bolivia"
//   "US interest rates raised for first time in three years"
//
// share {first, time} and score 0.17 — the same score as two real reports of the
// UN Iran finding, which share {grounds, believe, war, crimes, iran}. Any flat
// threshold either fuses the first pair or splits the second. Lowering it, raising
// it, and swapping in the overlap coefficient were all measured; none separated
// them, because the distinguishing property is absent from the score.
//
// ── What it measures now ──────────────────────────────────────────────────────
// How much INFORMATION two headlines share, in absolute terms, not what fraction
// of their words match. Each token is weighted by inverse document frequency over
// the batch being clustered, normalised so one unit is "a token seen once in this
// batch". Two headlines fuse only when the tokens they share carry at least
// `minMass` units between them — "first" and "time" are everywhere and are worth
// almost nothing; "bolivia" and "measles" are worth nearly a full unit each.
//
// Three further rules, each of which earned its place against the live corpus:
//
//   • SCORE AGAINST THE LEAD, NEVER A GROWING CENTROID. Accumulating every
//     member's tokens into the thing new items are compared with was measured at
//     higher recall and visibly worse precision: a Philippines school shooting
//     acquired a Kyiv drone strike, and a story about a US data-centre power bill
//     pulled in a Russia sanctions bill, because a wide token set attracts
//     loosely-related items. The lead headline stays the definition of the story.
//
//   • DESCRIPTIONS ARE NOT SCORED. Folding the RSS summary into the token bag
//     raised the multi-source rate from 7% to 12% and bought it with false merges
//     — "White House's Wiles says she is free of cancer" fused with "Obama family
//     dog Sunny dies". Summaries share boilerplate and topic vocabulary that
//     headlines do not. Measured, rejected, recorded here so it is not retried.
//
//   • A STORY IS AN EVENT IN TIME. Two headlines more than `windowMs` apart are
//     not the same report however well they match, which lets the token gate sit
//     lower than it otherwise could. Items with no parseable date are exempt
//     rather than excluded — a missing timestamp is not evidence of anything.
//
// On this product a FALSE merge costs more than a missed one. Fusing two stories
// claims two newsrooms corroborated each other when they did not, on a site whose
// entire argument is that you can check where a claim came from. The gates below
// are therefore tuned for precision: against the live corpus, every multi-source
// cluster they produced was a genuine co-report.
//
// Recall is bounded by something this file cannot fix: with six world feeds most
// headlines genuinely have no counterpart, because the outlets mostly cover
// different events. No tuning of the gates below came close to the effect of
// widening the feed list and raising the item cap — together those moved
// corroborated stories from 19 to 50 on the same snapshot. Both live in
// app/api/news/route.ts, which carries the measurements. Reach for them first.

import type { NewsItem } from "@/lib/news";

// Function words + newsroom filler that carry no event identity.
const STOP = new Set(
  ("a an the of to in on at for and or but with from by as is are was were be been being this that " +
    "these those over under after before amid into out up down not no more most least new latest " +
    "breaking live update updates report reports says say said will would could can may might has have " +
    "had its it he she they them his her their you we our us who what when where why how than then " +
    "about across against among around between during through per via amid off onto upon")
    .split(/\s+/),
);

// Publisher suffixes RSS titles sometimes append, e.g. " - BBC News", " | Reuters".
const SUFFIX_RE =
  /\s*[-|–—:]\s*(bbc(?:\s?news)?|al\s?jazeera|npr|the\s?guardian|guardian|dw|deutsche\s?welle|france\s?24|reuters|associated\s?press|ap|cnn|sky\s?news|cbs\s?news|abc\s?news|euronews|scmp|the\s?independent|independent|jerusalem\s?post|times\s?of\s?india)\s*$/i;

/** Pure: title → lower-cased, de-suffixed, punctuation-stripped canonical form. */
export function normalizeTitle(title: string): string {
  return (title ?? "")
    .replace(SUFFIX_RE, "")
    .toLowerCase()
    // Possessives are dropped BEFORE punctuation is stripped, so "the country's
    // third shooting" and "the country" share a token. Stripping the apostrophe
    // first turned it into "countrys", a word no other outlet ever writes — two
    // newsrooms using the same noun read as different vocabulary, which fragments
    // clusters and shows up in the framing comparison as a fake distinctive term.
    // It also catches contractions ("it's" → "it"), which is harmless here because
    // every word that produces is already a stop word.
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pure: title → set of significant tokens (≥3 chars, stop-words removed). */
export function titleTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const w of normalizeTitle(title).split(" ")) {
    if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return out;
}

/**
 * Similarity between two token sets:
 *  - `score`  = Jaccard (shared / union)
 *  - `shared` = raw shared-token count
 *  - `coeff`  = overlap coefficient (shared / min-size)
 *
 * No longer the merge decision — see `evidence()` — but kept because it is the
 * honest way to describe how alike two headlines are as TEXT, and the detail view
 * uses it to rank the members of a cluster by how closely each matches the lead.
 */
export function overlap(a: Set<string>, b: Set<string>): { score: number; shared: number; coeff: number } {
  if (a.size === 0 || b.size === 0) return { score: 0, shared: 0, coeff: 0 };
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  const minSize = Math.min(a.size, b.size);
  return { score: union === 0 ? 0 : shared / union, shared, coeff: minSize === 0 ? 0 : shared / minSize };
}

/**
 * Batches smaller than this get uniform weights instead of measured ones.
 *
 * Document frequency describes a token's rarity by counting the headlines that
 * use it, which stops meaning anything when there are barely any headlines to
 * count. Worse, it is actively misleading at small N: five outlets reporting one
 * event push their shared tokens' frequency up, so the words that IDENTIFY the
 * story are scored as the batch's most common — the measurement is bent by the
 * very thing it is meant to detect. In a four-headline batch the effect is total
 * (every token of a three-source story reads as "common"), and the clusterer
 * pulls that story apart.
 *
 * At production sizes (the route serves up to 500 headlines) one story's members are
 * a rounding error and the counts are trustworthy again. Below the line, uniform
 * weights are used, and `minMass` then reads as a plain count of shared
 * significant tokens — a blunter rule, but one that cannot be bent by cluster
 * size and does not silently change meaning with the size of the pull.
 */
export const MIN_WEIGHTED_BATCH = 150;

/**
 * Token weights for one batch: how rare each token is within it.
 *
 * Normalised so a token used by exactly one headline weighs 1.0 at EVERY batch
 * size. Without that anchor the whole scale drifts with N — a token seen once is
 * worth 0.84 in a 545-headline pull and 0.77 in a 60-headline one — so a fixed
 * `minMass` would quietly get stricter as the feed got smaller, and the widget
 * and the focus view would cluster the same feed differently. The unit here is
 * "a token nobody else used", which is a property of the token, not the batch.
 *
 * Returns an empty map below MIN_WEIGHTED_BATCH, which `evidence()` reads as
 * uniform 1.0 — see the constant above for why that is the honest answer rather
 * than a fallback.
 */
export function buildWeights(titles: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = titles.length;
  if (n < MIN_WEIGHTED_BATCH) return out;
  const df = new Map<string, number>();
  for (const t of titles) for (const w of titleTokens(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const max = Math.log((n + 1) / 1.5); // anchor: a token seen exactly once weighs 1.0
  for (const [w, c] of df) out.set(w, max <= 0 ? 1 : Math.log((n + 1) / (c + 0.5)) / max);
  return out;
}

/** Shared information between two token sets, in "rare token" units. */
export function evidence(
  a: Set<string>,
  b: Set<string>,
  weights: Map<string, number>,
): { mass: number; shared: number; ratio: number } {
  let mass = 0;
  let shared = 0;
  for (const w of a) {
    if (!b.has(w)) continue;
    mass += weights.get(w) ?? 1;
    shared++;
  }
  let na = 0;
  let nb = 0;
  for (const w of a) na += weights.get(w) ?? 1;
  for (const w of b) nb += weights.get(w) ?? 1;
  const denom = Math.sqrt(na * nb);
  return { mass, shared, ratio: denom === 0 ? 0 : mass / denom };
}

export interface Cluster {
  /** Stable-ish id — the lead (newest) headline's URL. */
  id: string;
  /** Lead (newest) headline's title, used as the card headline. */
  title: string;
  lead: NewsItem;
  /** Every member, newest-first (includes the lead). */
  items: NewsItem[];
  /** Distinct source display names, first-seen order. */
  sources: string[];
  sourceCount: number;
  latestTs: number;
  earliestTs: number;
}

export interface ClusterOptions {
  /**
   * Shared information required to fuse, in "rare token" units (default 2.05).
   *
   * Roughly: two tokens nobody else in the batch used, or three or four
   * moderately common ones. Below ~1.8 the live corpus starts fusing headlines
   * that share only newsroom filler; above ~2.4 it splits real co-reports whose
   * wording diverges.
   */
  minMass?: number;
  /** Shared mass as a fraction of the two headlines' own mass (default 0.16). */
  minRatio?: number;
  /** Minimum shared significant tokens, so one word can never fuse two stories (default 2). */
  minShared?: number;
  /** How far apart two reports of the same event can be (default 48h). 0 disables. */
  windowMs?: number;
  /**
   * Pre-computed token weights. Pass the weights for a WIDER corpus when
   * clustering a filtered subset, so a token does not look rare merely because
   * the filter removed the other headlines that used it.
   */
  weights?: Map<string, number>;
}

interface Work {
  items: NewsItem[];
  /** The LEAD headline's tokens — fixed, never widened. See the header note. */
  toks: Set<string>;
  leadTs: number;
}

function finalize(w: Work): Cluster {
  const items = [...w.items].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const lead = items[0];
  const sources: string[] = [];
  for (const it of items) if (!sources.includes(it.source)) sources.push(it.source);
  const tss = items.map((i) => i.ts || 0).filter((n) => n > 0);
  return {
    id: lead.url,
    title: lead.title,
    lead,
    items,
    sources,
    sourceCount: sources.length,
    latestTs: tss.length ? Math.max(...tss) : 0,
    earliestTs: tss.length ? Math.min(...tss) : 0,
  };
}

const DAY = 86_400_000;

/**
 * Pure: headlines → event clusters, newest-first (ties broken by source count).
 * Deterministic for a given input ordering.
 */
export function clusterNews(items: NewsItem[], opts: ClusterOptions = {}): Cluster[] {
  const minMass = opts.minMass ?? 2.05;
  const minRatio = opts.minRatio ?? 0.16;
  const minShared = opts.minShared ?? 2;
  const windowMs = opts.windowMs ?? 2 * DAY;
  const weights = opts.weights ?? buildWeights(items.map((i) => i.title));

  const sorted = [...items].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const work: Work[] = [];
  for (const it of sorted) {
    const toks = titleTokens(it.title);
    let best: Work | null = null;
    let bestRatio = 0;
    for (const w of work) {
      // Both dated and too far apart → not the same report. A missing date is
      // not evidence either way, so an undated item is never rejected here.
      if (windowMs > 0 && it.ts && w.leadTs && Math.abs(it.ts - w.leadTs) > windowMs) continue;
      const e = evidence(toks, w.toks, weights);
      if (e.shared < minShared || e.mass < minMass || e.ratio < minRatio) continue;
      if (e.ratio > bestRatio) {
        bestRatio = e.ratio;
        best = w;
      }
    }
    if (best) best.items.push(it);
    else work.push({ items: [it], toks, leadTs: it.ts || 0 });
  }
  return work.map(finalize).sort((a, b) => b.latestTs - a.latestTs || b.sourceCount - a.sourceCount);
}
