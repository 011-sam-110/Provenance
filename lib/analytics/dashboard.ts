// lib/analytics/dashboard.ts
// Composes every query the dashboard needs, so app/admin/analytics/page.tsx stays a
// thin render and this stays testable. A Next page module may export only the names
// Next recognises, so helpers cannot live in the page file even if it would be tidier.
//
// The UTM query is issued DELIBERATELY, knowing it is refused on this plan. Quoting a
// hardcoded refusal would be quoting our memory of Vercel; issuing the request means
// the sentence on screen is whatever Vercel says today, and the panel corrects itself
// for free on the day someone upgrades.

import {
  aggregateVisits,
  countVisits,
  type AggregateRow,
  type AnalyticsResult,
  type VisitsCount,
} from "@/lib/analytics/vercelApi";
import { HOBBY_WINDOW_DAYS, MAX_DISTINCT_PER_QUERY } from "@/lib/analytics/limits";
import { clampToWindow, retentionFloor, toContinuousDaily, type DailyRow } from "@/lib/analytics/window";

/** How many distinct values each grouped panel asks for. */
export const PANEL_LIMITS = {
  routes: 25,
  cameraPaths: MAX_DISTINCT_PER_QUERY,
  referrers: 25,
  countries: 15,
  devices: 10,
  browsers: 10,
} as const;

/** The route pattern the ~20k generated camera pages render under. */
export const CAMERA_ROUTE_FILTER = "route eq '/camera/[id]'";

export interface DashboardData {
  since: Date;
  until: Date;
  windowDays: number;
  totals: AnalyticsResult<VisitsCount>;
  daily: AnalyticsResult<AggregateRow[]>;
  routes: AnalyticsResult<AggregateRow[]>;
  cameraPaths: AnalyticsResult<AggregateRow[]>;
  referrers: AnalyticsResult<AggregateRow[]>;
  countries: AnalyticsResult<AggregateRow[]>;
  devices: AnalyticsResult<AggregateRow[]>;
  browsers: AnalyticsResult<AggregateRow[]>;
  /** Issued on purpose so the refusal shown is the live one. Success here means someone upgraded. */
  utm: AnalyticsResult<AggregateRow[]>;
}

export async function loadDashboard(
  now: Date,
  env?: Record<string, string | undefined>,
  windowDays: number = HOBBY_WINDOW_DAYS,
): Promise<DashboardData> {
  const until = now;
  const { since } = clampToWindow(retentionFloor(now, windowDays), until, now, windowDays);
  const range = { since, until };

  const [totals, daily, routes, cameraPaths, referrers, countries, devices, browsers, utm] = await Promise.all([
    countVisits(range, env),
    aggregateVisits({ ...range, by: ["day"], limit: MAX_DISTINCT_PER_QUERY }, env),
    aggregateVisits({ ...range, by: ["route"], limit: PANEL_LIMITS.routes }, env),
    aggregateVisits(
      { ...range, by: ["requestPath"], filter: CAMERA_ROUTE_FILTER, limit: PANEL_LIMITS.cameraPaths },
      env,
    ),
    aggregateVisits({ ...range, by: ["referrerHostname"], limit: PANEL_LIMITS.referrers }, env),
    aggregateVisits({ ...range, by: ["country"], limit: PANEL_LIMITS.countries }, env),
    aggregateVisits({ ...range, by: ["deviceType"], limit: PANEL_LIMITS.devices }, env),
    aggregateVisits({ ...range, by: ["browserName"], limit: PANEL_LIMITS.browsers }, env),
    aggregateVisits({ ...range, by: ["utmSource"], limit: PANEL_LIMITS.referrers }, env),
  ]);

  return { since, until, windowDays, totals, daily, routes, cameraPaths, referrers, countries, devices, browsers, utm };
}

/** Narrow the day-grouped rows and fill interior gaps. Kept here so the page does no maths. */
export function dailySeries(rows: AggregateRow[], since: Date, until: Date) {
  const typed: DailyRow[] = rows
    .filter((r) => typeof r.timestamp === "string")
    .map((r) => ({ timestamp: String(r.timestamp), visitors: r.visitors, pageviews: r.pageviews }));
  return toContinuousDaily(typed, since, until);
}
