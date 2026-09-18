// lib/news/framing.ts
// Where two newsrooms reporting the same event chose different words.
// PURE + node-testable.
//
// This is the deterministic half of the comparison feature, and it is deliberate
// that it is the half that ships switched on. Asking a language model to
// characterise how outlets frame a story produces a fluent paragraph that the
// reader cannot check, about newsrooms that did not agree to be characterised,
// and it goes dark the moment the gateway is unreachable. What this module does
// instead is show the reader the actual words:
//
//   • SHARED terms — the vocabulary every outlet in the story used. In practice
//     this is the event itself: the place, the number, the thing that happened.
//   • DISTINCTIVE terms — words that appear in exactly ONE outlet's coverage and
//     in none of the others'. That is where framing lives. "Strike" against
//     "attack", "militant" against "fighter", one outlet reaching for "economy"
//     and another for "sovereignty".
//
// A reader can verify every one of these against the headlines printed directly
// underneath, which is the whole point. The AI synthesis in lib/news/synthesis.ts
// still exists and still adds something on top — it is just no longer the only
// thing standing between the reader and an answer.
//
// TWO THINGS THIS DOES NOT DO. It does not score a term as loaded, biased or
// emotive; there is no sentiment lexicon behind it, and a word appearing in one
// outlet only is not evidence of anything beyond word choice. And it does not
// compare more than the text we hold — an RSS title plus a one-line summary is a
// thin sample of an article, so a term missing here is missing from the summary,
// not necessarily from the reporting.

import type { NewsItem } from "@/lib/news";
import type { Cluster } from "@/lib/news/cluster";
import { titleTokens } from "@/lib/news/cluster";

/**
 * Words too common, or too structural, to be evidence of framing.
 *
 * Wider than the clusterer's stop list on purpose: that one exists to stop two
 * stories fusing, this one exists to stop a comparison panel filling up with
 * "according", "including" and "years". A term surviving this list still has to
 * be unique to one outlet before it is shown.
 */
const NOT_FRAMING = new Set(
  ("according including also another back because been before being between both called come could " +
    "does down during each even every first from further going good great high just know last late " +
    "later left like line long look made make many more most much near need next night now off old " +
    "once only other out over own part people place point right same say see seen several show since " +
    "some still such take than that their them then there these thing think this those three time " +
    "today told took two under until upon used using very want week well were what when where which " +
    "while will with without work world would year years yesterday")
    .split(/\s+/),
);

/** The text of one item that a comparison is allowed to read. */
function itemText(it: NewsItem): string {
  return `${it.title} ${it.description ?? ""}`;
}

/** Significant terms in one item, filtered for the comparison panel. */
export function framingTerms(it: NewsItem): Set<string> {
  const out = new Set<string>();
  for (const w of titleTokens(itemText(it))) {
    if (w.length >= 4 && !NOT_FRAMING.has(w) && !/^\d+$/.test(w)) out.add(w);
  }
  return out;
}

export interface SourceFraming {
  source: string;
  /** Every item this source contributed to the story. */
  items: NewsItem[];
  /** Terms this source used that NO other source in the story used, longest first. */
  distinctive: string[];
}

export interface FramingComparison {
  /** Terms used by every source in the story — the agreed facts. */
  shared: string[];
  /** One entry per source, in the cluster's first-seen source order. */
  bySource: SourceFraming[];
  /** False when there is only one source, so there is nothing to compare. */
  comparable: boolean;
}

/**
 * Split a story's vocabulary into what every outlet agreed on and what each one
 * reached for alone.
 *
 * Terms are grouped PER SOURCE rather than per item, so an outlet that filed
 * three pieces on a story is one column, not three, and a word it repeated across
 * them is not counted as three outlets using it.
 */
export function compareFraming(cluster: Cluster): FramingComparison {
  const bySourceTerms = new Map<string, Set<string>>();
  const bySourceItems = new Map<string, NewsItem[]>();
  for (const it of cluster.items) {
    const terms = bySourceTerms.get(it.source) ?? new Set<string>();
    for (const t of framingTerms(it)) terms.add(t);
    bySourceTerms.set(it.source, terms);
    bySourceItems.set(it.source, [...(bySourceItems.get(it.source) ?? []), it]);
  }

  // How many DISTINCT sources used each term.
  const usedBy = new Map<string, number>();
  for (const terms of bySourceTerms.values()) {
    for (const t of terms) usedBy.set(t, (usedBy.get(t) ?? 0) + 1);
  }
  const n = bySourceTerms.size;

  const shared = [...usedBy.entries()]
    .filter(([, c]) => n > 1 && c === n)
    .map(([t]) => t)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));

  const bySource: SourceFraming[] = cluster.sources.map((source) => ({
    source,
    items: bySourceItems.get(source) ?? [],
    distinctive: [...(bySourceTerms.get(source) ?? [])]
      .filter((t) => usedBy.get(t) === 1)
      .sort((a, b) => b.length - a.length || a.localeCompare(b))
      .slice(0, 8),
  }));

  return { shared, bySource, comparable: n > 1 };
}

/**
 * Split a headline into runs for rendering, marking which words to highlight.
 *
 * Returns the ORIGINAL text in order — punctuation, capitals and all — so the
 * comparison panel can emphasise a term without retyping the headline. Matching
 * is done on the same normalisation the terms were built with, so "Strikes" is
 * marked when the term is "strikes".
 */
export function markTerms(text: string, terms: readonly string[]): { text: string; mark: boolean }[] {
  const wanted = new Set(terms);
  const out: { text: string; mark: boolean }[] = [];
  for (const piece of (text ?? "").split(/(\s+)/)) {
    if (!piece) continue;
    const bare = piece.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]/g, "");
    const mark = bare.length > 0 && wanted.has(bare);
    const prev = out[out.length - 1];
    if (prev && prev.mark === mark) prev.text += piece;
    else out.push({ text: piece, mark });
  }
  return out;
}
