// lib/analytics/window.ts
// The retention-window maths, kept pure so it is node-testable and so the one rule
// that matters can be tested directly: a day we were never allowed to ask about
// must never be drawn as a day with no traffic.
//
// The Hobby plan serves the latest 31 days. Ask for the 32nd and the API does not
// return an empty series, it returns HTTP 400 (see lib/analytics/limits.ts for the
// verbatim message). So every query has to be clamped before it is sent, and the UI
// has to be told that the clamp happened — otherwise the chart's left edge silently
// becomes an assertion that Provenance had no visitors before that date.

import { HOBBY_WINDOW_DAYS } from "@/lib/analytics/limits";

/** A single day of the visits series. */
export interface DailyPoint {
  /** UTC midnight of the day, as YYYY-MM-DD. */
  day: string;
  visitors: number;
  pageviews: number;
  /**
   * True when this day carried no rows in the API response. It is a real zero —
   * inside the retention window, so we were allowed to ask and the answer was
   * nothing — as distinct from a day outside the window, which is never emitted.
   */
  filled: boolean;
}

/** UTC midnight of the day containing `d`, as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC midnight `days` before `now`. The oldest date the plan will serve. */
export function retentionFloor(now: Date, windowDays: number = HOBBY_WINDOW_DAYS): Date {
  const floor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  floor.setUTCDate(floor.getUTCDate() - (windowDays - 1));
  return floor;
}

/** The outcome of clamping a requested range to what the plan will actually serve. */
export interface ClampedRange {
  since: Date;
  until: Date;
  /** True when the caller asked for more history than the plan allows. */
  clamped: boolean;
  /** The date the caller asked for, kept so the UI can say what was refused. */
  requestedSince: Date;
}

/**
 * Clamp a requested range to the retention window.
 *
 * Sending an unclamped `since` is not a soft failure — the whole request 400s and
 * the panel renders nothing, which is the failure mode most likely to be misread as
 * "no traffic". Clamping keeps the data flowing and hands the UI the fact that it
 * happened.
 */
export function clampToWindow(
  requestedSince: Date,
  until: Date,
  now: Date,
  windowDays: number = HOBBY_WINDOW_DAYS,
): ClampedRange {
  const floor = retentionFloor(now, windowDays);
  const clamped = requestedSince.getTime() < floor.getTime();
  return {
    since: clamped ? floor : requestedSince,
    until,
    clamped,
    requestedSince,
  };
}

/** A row as the aggregate endpoint returns it when grouped by day. */
export interface DailyRow {
  timestamp: string;
  visitors: number;
  pageviews: number;
}

/**
 * Turn the API's sparse daily rows into a continuous series across [since, until].
 *
 * A day absent from the response genuinely recorded nothing, so emitting it as zero
 * is accurate rather than invented — and `filled` marks it so the UI never has to
 * guess which is which. The series is generated ONLY between the two bounds it is
 * given, so a caller that passes the clamped `since` cannot accidentally draw
 * zeroes across days the plan refused to serve.
 */
export function toContinuousDaily(rows: DailyRow[], since: Date, until: Date): DailyPoint[] {
  const byDay = new Map<string, DailyRow>();
  for (const r of rows) {
    const t = new Date(r.timestamp);
    if (Number.isNaN(t.getTime())) continue;
    byDay.set(dayKey(t), r);
  }

  const out: DailyPoint[] = [];
  const cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const end = Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate());
  // A guard rather than a while(true): a bad range should yield a short series, not hang a render.
  for (let i = 0; i < 400 && cursor.getTime() <= end; i++) {
    const key = dayKey(cursor);
    const hit = byDay.get(key);
    out.push({
      day: key,
      visitors: hit ? hit.visitors : 0,
      pageviews: hit ? hit.pageviews : 0,
      filled: !hit,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Totals across a daily series. Summing pageviews is sound; summing visitors is not. */
export interface DailyTotals {
  pageviews: number;
  /**
   * The sum of each day's visitor count. This is NOT the number of unique people
   * over the period — anyone visiting on three days is counted three times. Vercel
   * de-duplicates visitors only within whichever range you ask about, so the honest
   * unique-visitor figure comes from a separate unranged count query, never from
   * adding this column up. Named to make the wrong reading hard to reach for.
   */
  visitorDaysSum: number;
  daysWithTraffic: number;
  daysCovered: number;
}

export function totals(points: DailyPoint[]): DailyTotals {
  let pageviews = 0;
  let visitorDaysSum = 0;
  let daysWithTraffic = 0;
  for (const p of points) {
    pageviews += p.pageviews;
    visitorDaysSum += p.visitors;
    if (p.pageviews > 0) daysWithTraffic++;
  }
  return { pageviews, visitorDaysSum, daysWithTraffic, daysCovered: points.length };
}
