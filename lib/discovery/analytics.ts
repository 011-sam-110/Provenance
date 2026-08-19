/**
 * Analytics over the curation pipeline: what discovery found, what a human did with
 * it, and what the camera estate looks like as a result.
 *
 * These are the numbers this product can produce that a page-view tool cannot, and
 * they are the ones that answer the questions actually worth asking about a data
 * product: which portals are worth the request budget, how much of a discovery run
 * survives contact with a person, and which of the reasons a camera gets rejected is
 * the one to go and fix.
 *
 * Pure. Every function takes the queue, the ledger and (optionally) the live registry
 * and returns numbers, so the whole dashboard is unit-testable without a server.
 *
 * ONE RULE THROUGHOUT: a stage with nothing in it returns 0 and says so, and no
 * function here ever divides by an unchecked denominator to produce a percentage. An
 * analytics page whose numbers are silently NaN or silently invented is worse than no
 * analytics page, because it gets quoted.
 */

import type { Camera } from "@/lib/types";
import type { Candidate, ReviewLedger } from "@/lib/discovery/types";

export interface FunnelStage {
  key: string;
  label: string;
  n: number;
  /** What this stage means, shown under the bar so a drop is never a mystery. */
  note: string;
}

/**
 * The pipeline as a funnel, from what is queued to what is on the map.
 *
 * `queued` is deliberately the first stage rather than "catalogue hits": those are a
 * property of one RUN and this is a property of the current state, and mixing the two
 * produces a funnel whose top row changes when nothing about the queue has.
 */
export function discoveryFunnel(candidates: Candidate[], ledger: ReviewLedger, admittedFeeds: number): FunnelStage[] {
  const passing = candidates.filter((c) => !c.gates.some((g) => g.status === "fail"));
  const reviewedIds = new Set(ledger.cameras.map((v) => v.candidateId));
  const reviewed = passing.filter((c) => reviewedIds.has(c.id));
  const admitted = ledger.feeds.filter((f) => f.verdict === "admit");
  return [
    { key: "queued", label: "Candidates queued", n: candidates.length, note: "feeds a run parsed into cameras" },
    {
      key: "admissible",
      label: "Past the gates",
      n: passing.length,
      note: "no relay, no bare-IP host, not already served",
    },
    { key: "reviewed", label: "A person has looked", n: reviewed.length, note: "at least one camera judged" },
    { key: "admitted", label: "Admitted", n: admitted.length, note: "feed verdict recorded" },
    { key: "live", label: "On the map", n: admittedFeeds, note: "written into discovered.data.ts" },
  ];
}

/** How many cameras a reviewer judged, and how they came out. */
export function verdictBreakdown(ledger: ReviewLedger): Array<{ verdict: string; n: number }> {
  const counts = new Map<string, number>();
  for (const v of ledger.cameras) counts.set(v.verdict, (counts.get(v.verdict) ?? 0) + 1);
  return [...counts].map(([verdict, n]) => ({ verdict, n })).sort((a, b) => b.n - a.n);
}

/**
 * Which gate is doing the rejecting.
 *
 * The useful reading here is not "the gates work". It is which rule the catalogues
 * keep tripping: a run where `overlap` dominates means the portals are re-offering
 * networks already served and the query needs narrowing, while one where `relay`
 * dominates means the search terms are surfacing directories rather than operators.
 * Those call for opposite fixes, and the count is the only thing that tells them apart.
 */
export function gatePressure(candidates: Candidate[]): Array<{ gate: string; fail: number; warn: number }> {
  const rows = new Map<string, { fail: number; warn: number }>();
  for (const c of candidates) {
    for (const g of c.gates) {
      if (g.status === "pass") continue;
      const row = rows.get(g.gate) ?? { fail: 0, warn: 0 };
      row[g.status]++;
      rows.set(g.gate, row);
    }
  }
  return [...rows]
    .map(([gate, v]) => ({ gate, ...v }))
    .sort((a, b) => b.fail - a.fail || b.warn - a.warn);
}

/** Per-portal yield: hits offered against candidates that survived to the queue. */
export function portalYield(candidates: Candidate[]): Array<{ portal: string; candidates: number; admissible: number }> {
  const rows = new Map<string, { candidates: number; admissible: number }>();
  for (const c of candidates) {
    const portal = hostOf(c.provenance.discoveredVia) || c.provenance.probe;
    const row = rows.get(portal) ?? { candidates: 0, admissible: 0 };
    row.candidates++;
    if (!c.gates.some((g) => g.status === "fail")) row.admissible++;
    rows.set(portal, row);
  }
  return [...rows].map(([portal, v]) => ({ portal, ...v })).sort((a, b) => b.admissible - a.admissible);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export interface EstateStats {
  total: number;
  byCountry: Array<{ country: string; n: number }>;
  bySource: Array<{ source: string; n: number }>;
  byMedia: Array<{ mediaType: string; n: number }>;
  /** Cameras whose licence string is the honest "no licence stated" form. */
  unlicensed: number;
  /** Cameras served over plain http, which a browser blocks inside an https page. */
  insecureMedia: number;
  /** Distinct refresh cadences, so a feed claiming an implausible one is visible. */
  refreshSeconds: Array<{ seconds: number; n: number }>;
}

/**
 * What the live camera estate is actually made of.
 *
 * NOT a time series and it must never be presented as one. `registry.ts` keeps its
 * cache and last-good map in module-level state, so on serverless every instance holds
 * its own copy and two consecutive reads can differ by thousands with no deploy in
 * between. A total here is one instance's answer at one moment; it is a composition,
 * not a measurement of growth.
 */
export function estateStats(cameras: Camera[]): EstateStats {
  const tally = <T extends string | number>(pick: (c: Camera) => T) => {
    const m = new Map<T, number>();
    for (const c of cameras) m.set(pick(c), (m.get(pick(c)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  return {
    total: cameras.length,
    byCountry: tally((c) => c.country).map(([country, n]) => ({ country, n })),
    bySource: tally((c) => c.source).map(([source, n]) => ({ source, n })),
    byMedia: tally((c) => c.mediaType).map(([mediaType, n]) => ({ mediaType, n })),
    unlicensed: cameras.filter((c) => /no (?:stated |)licence|no licence stated/i.test(c.license)).length,
    insecureMedia: cameras.filter((c) => c.imageUrl?.startsWith("http://") || c.streamUrl?.startsWith("http://")).length,
    refreshSeconds: tally((c) => c.refreshSeconds).map(([seconds, n]) => ({ seconds: Number(seconds), n })),
  };
}
