// lib/analytics/rollupView.ts
//
// Shaping the daily rollups into what a panel renders. Pure — no fs, no dates from the
// clock unless they are passed in — so every rule below is testable against fixtures.
//
// THE ONE THING THIS FILE REFUSES TO DO IS ADD UP VISITORS ACROSS DAYS. Each day's
// figure is the size of that day's set of salted (masked-address, user-agent) hashes,
// and those sets are deleted when the day is finalised, because keeping them for ever
// would be keeping a per-visitor record — which is the thing the whole design avoids.
// So the window's unique-visitor count is not merely unknown, it is unknowable from
// this data, and summing the days would answer a different question while looking like
// an answer to that one. Someone who visits every day would be counted seven times in a
// week. What is shown instead is the per-day figure, its mean and its peak, each of
// which is exactly true.

import { mergeDay, topN, type DayRollup, DURATION_EDGES_MS } from "@/lib/analytics/rollup";

export interface Row {
  key: string;
  count: number;
  /** Share of the total this row's map covers, 0-1. */
  share: number;
}

export interface DayPoint {
  date: string;
  pageviews: number;
  requests: number;
  visitors: number;
  bytes: number;
}

export interface WindowView {
  from: string;
  to: string;
  dayCount: number;
  totals: DayRollup;
  points: DayPoint[];
  /** Mean and peak of the per-day visitor figures. NEVER their sum. */
  visitorsMean: number;
  visitorsPeak: number;
  /** Mean page response time in milliseconds, or null when nothing was timed. */
  meanDurationMs: number | null;
}

/** Newest `count` days, oldest first. */
export function lastDays(days: DayRollup[], count: number): DayRollup[] {
  return days.slice(-Math.max(1, count));
}

export function buildWindow(days: DayRollup[]): WindowView | null {
  if (days.length === 0) return null;
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const totals = ordered.reduce((acc, d) => mergeDay(acc, d));
  const points: DayPoint[] = ordered.map((d) => ({
    date: d.date,
    pageviews: d.pageviews,
    requests: d.requests,
    visitors: d.visitors,
    bytes: d.bytes,
  }));
  const visitorNumbers = points.map((p) => p.visitors);
  return {
    from: ordered[0]!.date,
    to: ordered[ordered.length - 1]!.date,
    dayCount: ordered.length,
    totals,
    points,
    visitorsMean: Math.round(visitorNumbers.reduce((a, b) => a + b, 0) / visitorNumbers.length),
    visitorsPeak: Math.max(...visitorNumbers),
    meanDurationMs: totals.durationCount ? Math.round(totals.durationMsSum / totals.durationCount) : null,
  };
}

/**
 * Top rows with their share of the map's own total.
 *
 * The denominator is the sum of the WHOLE map, including the rows past `n` and
 * including "(other)". A share computed against the visible rows alone would add up to
 * 100% no matter how much was cut off, which is the specific way a truncated table
 * lies.
 */
export function rows(map: Record<string, number>, n: number): Row[] {
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  return topN(map, n).map(({ key, count }) => ({ key, count, share: total ? count / total : 0 }));
}

/** Bytes as a human figure. Decimal units, because that is what bandwidth is billed in. */
export function bytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export interface Bucket {
  label: string;
  count: number;
  share: number;
}

/** Response-time histogram, labelled from the edges rather than from a repeated list. */
export function durationBuckets(day: DayRollup): Bucket[] {
  const total = day.durationBuckets.reduce((a, b) => a + b, 0);
  return day.durationBuckets.map((count, i) => {
    const lower = i === 0 ? 0 : DURATION_EDGES_MS[i - 1]!;
    const upper = DURATION_EDGES_MS[i];
    return {
      label: upper === undefined ? `over ${lower} ms` : i === 0 ? `under ${upper} ms` : `${lower}–${upper} ms`,
      count,
      share: total ? count / total : 0,
    };
  });
}

/**
 * The proportion of requests that reached the origin without passing through Cloudflare.
 *
 * Not a vanity metric. Anything above roughly zero means some resolver is still handing
 * out the origin address, which is the exact condition that makes closing the origin
 * firewall an outage — see deploy/cloudflare-firewall.sh, which refuses to run while it
 * is true, and the day it was ignored.
 */
export function directShare(day: DayRollup): number {
  const total = day.viaCloudflare + day.direct;
  return total ? day.direct / total : 0;
}

/**
 * What share of the bytes leaving this box are API responses rather than pages.
 *
 * Measured at 93% on the first day. It is the number that decides whether a bandwidth
 * bill is caused by readers or by the console's own polling, and those have completely
 * different fixes.
 */
export function apiByteShare(day: DayRollup): number {
  return day.bytes ? day.apiBytes / day.bytes : 0;
}
