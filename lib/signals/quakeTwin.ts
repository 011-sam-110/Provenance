// lib/signals/quakeTwin.ts
// When two catalogues list the same earthquake.
//
// HISTORY. Until 2026-10-16 USGS ("earthquakes") and EMSC ("emsc-quakes") were two
// layers, and the panel of a quake in one said whether the other listed it (#279).
// Measured that day, the two drew about 54 quakes a day twice. The layers are now ONE
// layer fed by several catalogues (lib/signals/earthquakes.ts), and this rule moved
// to the server: it decides which rows are one event, so the map draws it once and
// its panel says which catalogues reported it.
//
// WHAT A MATCH IS NOT. Two catalogues listing one event is not two measurements.
// Measured 2026-10-08 on the live layers: of 36 EMSC entries that USGS also lists,
// 24 were credited by a US network (NEIC, AK, HV, SCSN, PR, TX, NN), the contributors
// USGS publishes itself, 11 by EMSC and 1 by INET (Nicaragua). So the words never say
// "confirmed" or "independent"; they say "reported by".
//
// THE RULE. Same moment (TWIN_MAX_SECONDS), same place (TWIN_MAX_KM), magnitudes
// within TWIN_MAX_MAG_DIFF. Chosen from that same snapshot: of 221 USGS events, the
// 38 pairs the rule joins sit within 90 s, 42 km and 0.8 magnitude, and USGS M>=4.5
// pairs 14 of 14. One day, one snapshot: widen it only with a measurement.
//
// A SWARM puts several events seconds apart, so pairs are joined closest first, a
// group holds at most one row per catalogue, and every two rows of a group must fit
// the rule (not just a chain of neighbours). An entry two events could both claim
// goes to the closer one; the other event keeps its own dot.
//
// Pure, type-only imports: the client bundle and node tests can both import it.

import type { SignalFeature } from "@/lib/signals/types";

export const TWIN_MAX_SECONDS = 120;
export const TWIN_MAX_KM = 60;
export const TWIN_MAX_MAG_DIFF = 0.8;

/** The three things a comparison reads off an event. */
export interface QuakeFacts {
  id?: string;
  lat: number;
  lon: number;
  ts?: string;
  magnitude?: number;
}

export function quakeFacts(f: Pick<SignalFeature, "id" | "lat" | "lon" | "ts" | "props">): QuakeFacts {
  const m = f.props?.magnitude;
  return { id: f.id, lat: f.lat, lon: f.lon, ts: f.ts, magnitude: typeof m === "number" ? m : undefined };
}

/** The adapters turn a missing magnitude into 0, so 0 means "not given" here. */
export const knownMagnitude = (m: number | undefined): m is number =>
  typeof m === "number" && Number.isFinite(m) && m !== 0;

export interface QuakeGap {
  seconds: number;
  km: number;
  magDiff: number | null;
  /** Each limit's share used, squared and summed. Lower is closer. */
  score: number;
}

function haversineKm(a: QuakeFacts, b: QuakeFacts): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The gap between two events when it is inside the rule; null when it is not (or cannot be read). */
export function quakeGap(a: QuakeFacts, b: QuakeFacts): QuakeGap | null {
  const ta = a.ts ? Date.parse(a.ts) : Number.NaN;
  const tb = b.ts ? Date.parse(b.ts) : Number.NaN;
  if (![ta, tb, a.lat, a.lon, b.lat, b.lon].every(Number.isFinite)) return null;
  const seconds = Math.abs(ta - tb) / 1000;
  if (seconds > TWIN_MAX_SECONDS) return null;
  const km = haversineKm(a, b);
  if (km > TWIN_MAX_KM) return null;
  const magDiff = knownMagnitude(a.magnitude) && knownMagnitude(b.magnitude) ? Math.abs(a.magnitude - b.magnitude) : null;
  if (magDiff !== null && magDiff > TWIN_MAX_MAG_DIFF + 1e-9) return null;
  const score = (seconds / TWIN_MAX_SECONDS) ** 2 + (km / TWIN_MAX_KM) ** 2 + ((magDiff ?? 0) / TWIN_MAX_MAG_DIFF) ** 2;
  return { seconds, km, magDiff, score };
}

/** One row of one catalogue, as the clustering sees it. */
export interface QuakeEntry {
  row: SignalFeature;
  /** Which catalogue listed it. A group holds at most one row per catalogue. */
  catalogue: string;
  /** Lower is preferred as the group's shown row. Ties keep input order. */
  rank: number;
}

/**
 * Pure: group rows that are one event. Returns every input entry exactly once, in
 * groups, each group ordered preferred first (rank, then input order). Groups come
 * out in the order of their first member in the input.
 */
export function clusterQuakes(entries: readonly QuakeEntry[]): QuakeEntry[][] {
  const n = entries.length;
  const facts = entries.map((e) => quakeFacts(e.row));
  const times = facts.map((f) => (f.ts ? Date.parse(f.ts) : Number.NaN));

  // Candidate pairs, found through a time-sorted sweep: only rows within
  // TWIN_MAX_SECONDS of each other can fit, so each row looks a short way ahead.
  const byTime = [...Array(n).keys()].filter((i) => Number.isFinite(times[i])).sort((a, b) => times[a]! - times[b]!);
  const edges: { a: number; b: number; score: number }[] = [];
  for (let x = 0; x < byTime.length; x++) {
    const i = byTime[x]!;
    for (let y = x + 1; y < byTime.length; y++) {
      const j = byTime[y]!;
      if (times[j]! - times[i]! > TWIN_MAX_SECONDS * 1000) break;
      if (entries[i]!.catalogue === entries[j]!.catalogue) continue;
      const gap = quakeGap(facts[i]!, facts[j]!);
      if (gap) edges.push({ a: Math.min(i, j), b: Math.max(i, j), score: gap.score });
    }
  }
  edges.sort((p, q) => p.score - q.score || p.a - q.a || p.b - q.b);

  // Closest pairs first. Two groups join only when they share no catalogue and every
  // row of one fits every row of the other.
  const group = [...Array(n).keys()].map((i) => [i]);
  const owner = [...Array(n).keys()];
  for (const { a, b } of edges) {
    const ga = owner[a]!;
    const gb = owner[b]!;
    if (ga === gb) continue;
    const A = group[ga]!;
    const B = group[gb]!;
    const cats = new Set(A.map((i) => entries[i]!.catalogue));
    if (B.some((j) => cats.has(entries[j]!.catalogue))) continue;
    if (!A.every((i) => B.every((j) => quakeGap(facts[i]!, facts[j]!) !== null))) continue;
    for (const j of B) owner[j] = ga;
    A.push(...B);
    group[gb] = [];
  }

  const out: QuakeEntry[][] = [];
  const emitted = new Set<number>();
  for (let i = 0; i < n; i++) {
    const g = owner[i]!;
    if (emitted.has(g)) continue;
    emitted.add(g);
    const members = [...group[g]!].sort((p, q) => entries[p]!.rank - entries[q]!.rank || p - q);
    out.push(members.map((m) => entries[m]!));
  }
  return out;
}
