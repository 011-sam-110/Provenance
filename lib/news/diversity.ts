// lib/news/diversity.ts
// Who covered a story, who did not, and what kind of newsroom each one is.
// PURE + node-testable.
//
// ── What a blindspot claim is allowed to mean here ────────────────────────────
// The tempting version of this feature says "ignored by the right" or "unreported
// in Asia". We cannot say either. What we can see is one thing, and it is worth
// being exact about it:
//
//   For each outlet whose feed we are holding right now, did this story appear in
//   the headlines that feed gave us?
//
// That is an observation about a FEED, not about a newsroom. A world RSS feed
// carries an editor's selection of the last few dozen items; a story can be
// missing from it because the outlet did not cover the event, because it covered
// it in a section this feed does not carry, or simply because it has since
// scrolled off. Those are very different facts and this module cannot tell them
// apart — so the wording it produces says "not in their latest headlines", and
// `caveat` carries the reason in full for the UI to print next to it. Anything
// stronger would be a claim about editorial judgement built out of a truncated
// XML file.
//
// The comparison is also only as wide as the feed list. With six Anglo-American
// feeds, "no Asian outlet carried this" was true of nearly every story and
// therefore told a reader nothing. app/api/news/route.ts now carries fourteen
// feeds across six regions for this reason; `universeFrom` reports the spread it
// actually has so the UI can decline to draw a conclusion the feed set cannot
// support.

import type { NewsItem } from "@/lib/news";
import type { Cluster } from "@/lib/news/cluster";
import { sourceMeta, type Funding } from "@/lib/news/sources";

/** Everything the current pull could possibly have told us about. */
export interface Universe {
  /** Distinct source display names present in the pull. */
  sources: string[];
  /** Distinct regions represented, excluding the unattributed "Other". */
  regions: string[];
  /** Distinct outlet types represented. */
  types: string[];
  /** How many headlines each source contributed — a source with one item is thin evidence. */
  countsBySource: Record<string, number>;
}

/** The universe of outlets a story could have been compared against. */
export function universeFrom(items: readonly NewsItem[]): Universe {
  const countsBySource: Record<string, number> = {};
  const regions = new Set<string>();
  const types = new Set<string>();
  for (const it of items) {
    countsBySource[it.source] = (countsBySource[it.source] ?? 0) + 1;
    const m = sourceMeta(it.source);
    if (m.region !== "Other") regions.add(m.region);
    types.add(m.type);
  }
  return {
    sources: Object.keys(countsBySource),
    regions: [...regions].sort(),
    types: [...types].sort(),
    countsBySource,
  };
}

/** One slice of the diversity bar: a kind of newsroom, and how many carried the story. */
export interface DiversitySegment {
  label: string;
  count: number;
}

export interface CoverageProfile {
  sourceCount: number;
  /** Outlet types that carried it, most-represented first. */
  byType: DiversitySegment[];
  /** Regions that carried it, most-represented first. */
  byRegion: DiversitySegment[];
  /** How many of the carrying outlets are funded by a government. */
  stateFunded: number;
  /** Funding models represented, for the ownership readout. */
  byFunding: DiversitySegment[];
  /**
   * One line for the diversity bar's label, e.g.
   * "7 sources: 3 public broadcasters, 2 newswires, 2 newspapers".
   */
  summary: string;
}

function tally(values: string[]): DiversitySegment[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** English plural for an outlet-type label ("Newswire" → "newswires"). */
function plural(label: string, n: number): string {
  const l = label.toLowerCase();
  if (n === 1) return l;
  if (l.endsWith("s")) return l;
  if (l.endsWith("y")) return `${l.slice(0, -1)}ies`;
  return `${l}s`;
}

/** What kinds of newsroom carried this story. */
export function coverageProfile(cluster: Cluster): CoverageProfile {
  const metas = cluster.sources.map((s) => sourceMeta(s));
  const byType = tally(metas.map((m) => m.type));
  const byRegion = tally(metas.filter((m) => m.region !== "Other").map((m) => m.region));
  const byFunding = tally(metas.map((m) => m.funding as Funding as string));
  const n = cluster.sourceCount;
  const parts = byType.map((s) => `${s.count} ${plural(s.label, s.count)}`);
  return {
    sourceCount: n,
    byType,
    byRegion,
    byFunding,
    stateFunded: metas.filter((m) => m.stateFunded).length,
    summary: `${n} ${n === 1 ? "source" : "sources"}: ${parts.join(", ")}`,
  };
}

export interface BlindspotReport {
  /** True when the pull is too narrow or the story too thin to say anything. */
  inconclusive: boolean;
  /** Regions represented in the pull that this story did not appear in. */
  missingRegions: string[];
  /** Regions that carried it. */
  coveredRegions: string[];
  /** Named outlets in the pull whose latest headlines do not include this story. */
  absentSources: string[];
  /** A sentence safe to print, or null when `inconclusive`. */
  claim: string | null;
  /** Always printed alongside `claim`. Never omit it — see the header note. */
  caveat: string;
}

export const BLINDSPOT_CAVEAT =
  "Absence means the story was not among the latest headlines in that outlet's feed. A feed carries an editor's selection of recent items, so this is not proof the outlet did not cover the event.";

/**
 * How wide the comparison has to be before a blindspot claim is worth printing.
 *
 * Under three regions in the pull, "no Asian outlet carried this" is a statement
 * about our feed list rather than about the story, and it would be true of almost
 * every story — a finding that fires on everything tells a reader nothing.
 */
const MIN_REGIONS_FOR_A_CLAIM = 3;

/** Which parts of the represented world are missing from a story's coverage. */
export function blindspotReport(cluster: Cluster, universe: Universe): BlindspotReport {
  const covered = new Set(
    cluster.sources.map((s) => sourceMeta(s).region).filter((r) => r !== "Other"),
  );
  const coveredRegions = [...covered].sort();
  const missingRegions = universe.regions.filter((r) => !covered.has(r));
  const inSource = new Set(cluster.sources);
  const absentSources = universe.sources.filter((s) => !inSource.has(s)).sort();

  // A single-source story has nothing to compare, and a narrow pull cannot
  // support the comparison however many sources the story has.
  const inconclusive = cluster.sourceCount < 2 || universe.regions.length < MIN_REGIONS_FOR_A_CLAIM;

  let claim: string | null = null;
  if (!inconclusive && missingRegions.length > 0) {
    const list =
      missingRegions.length === 1
        ? missingRegions[0]
        : `${missingRegions.slice(0, -1).join(", ")} and ${missingRegions[missingRegions.length - 1]}`;
    claim = `Carried by outlets in ${coveredRegions.join(", ")}. Not in the latest headlines from ${list}.`;
  } else if (!inconclusive) {
    claim = `Carried across every region in this pull (${coveredRegions.join(", ")}).`;
  }

  return { inconclusive, missingRegions, coveredRegions, absentSources, claim, caveat: BLINDSPOT_CAVEAT };
}
