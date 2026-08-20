// The retention-window maths, and the one rule this dashboard exists to keep:
// a day we were never allowed to ask about must never render as a day with no traffic.
//
// The daily fixture below is REAL. It is the response Vercel returned for
// projectId prj_PEFRuo9AZYtxN9WmY3a1cyiWlGRQ grouped by day on 2026-08-19, trimmed
// to the rows these assertions need. Nothing in this file is invented traffic.

import { describe, it, expect } from "vitest";
import {
  clampToWindow,
  dayKey,
  retentionFloor,
  toContinuousDaily,
  totals,
  type DailyRow,
} from "@/lib/analytics/window";
import { HOBBY_WINDOW_DAYS } from "@/lib/analytics/limits";

const NOW = new Date("2026-08-19T12:00:00.000Z");

/** Captured live 2026-08-19. Note the gap: no row exists for 2026-08-04. */
const REAL_DAILY: DailyRow[] = [
  { timestamp: "2026-08-05T00:00:00.000Z", visitors: 1, pageviews: 1 },
  { timestamp: "2026-08-06T00:00:00.000Z", visitors: 1, pageviews: 1 },
  { timestamp: "2026-08-13T00:00:00.000Z", visitors: 99, pageviews: 301 },
  { timestamp: "2026-08-14T00:00:00.000Z", visitors: 488, pageviews: 1199 },
];

describe("retentionFloor", () => {
  it("is 31 days inclusive of today, so it spans exactly the window the plan sells", () => {
    const floor = retentionFloor(NOW);
    expect(dayKey(floor)).toBe("2026-07-20");
    const days = Math.round((Date.UTC(2026, 7, 19) - floor.getTime()) / 86_400_000) + 1;
    expect(days).toBe(HOBBY_WINDOW_DAYS);
  });

  it("ignores the time of day, so a query at 23:59 covers the same dates as one at 00:01", () => {
    expect(dayKey(retentionFloor(new Date("2026-08-19T00:01:00Z")))).toBe(
      dayKey(retentionFloor(new Date("2026-08-19T23:59:00Z"))),
    );
  });
});

describe("clampToWindow", () => {
  it("pulls an out-of-range request forward and says that it did", () => {
    const r = clampToWindow(new Date("2026-05-01T00:00:00Z"), NOW, NOW);
    expect(r.clamped).toBe(true);
    expect(dayKey(r.since)).toBe("2026-07-20");
    // The original ask survives, so the UI can say what was refused rather than
    // silently redrawing a narrower chart.
    expect(dayKey(r.requestedSince)).toBe("2026-05-01");
  });

  it("leaves an in-range request alone", () => {
    const r = clampToWindow(new Date("2026-08-10T00:00:00Z"), NOW, NOW);
    expect(r.clamped).toBe(false);
    expect(dayKey(r.since)).toBe("2026-08-10");
  });
});

describe("toContinuousDaily", () => {
  const since = new Date("2026-08-05T00:00:00Z");
  const until = new Date("2026-08-14T00:00:00Z");
  const series = toContinuousDaily(REAL_DAILY, since, until);

  it("emits one point per day across the range, with no holes", () => {
    expect(series).toHaveLength(10);
    expect(series[0].day).toBe("2026-08-05");
    expect(series[9].day).toBe("2026-08-14");
  });

  it("carries the real rows through untouched", () => {
    expect(series.find((p) => p.day === "2026-08-14")).toMatchObject({
      visitors: 488,
      pageviews: 1199,
      filled: false,
    });
  });

  it("marks an interior gap as filled, so a zero is never mistaken for a measurement", () => {
    const gap = series.find((p) => p.day === "2026-08-09")!;
    expect(gap.pageviews).toBe(0);
    expect(gap.filled).toBe(true);
  });

  // THE TEST THIS FILE EXISTS FOR. Extending the series past the range would draw a
  // flat line at zero across dates the API refuses to answer for, turning "we are not
  // allowed to know" into "nobody visited" — in a chart, which is where a wrong number
  // is believed hardest.
  it("never emits a day outside the range it was given", () => {
    const wide = toContinuousDaily(REAL_DAILY, new Date("2026-08-13T00:00:00Z"), new Date("2026-08-14T00:00:00Z"));
    expect(wide.map((p) => p.day)).toEqual(["2026-08-13", "2026-08-14"]);
    expect(wide.some((p) => p.day < "2026-08-13")).toBe(false);
  });

  it("drops a row with an unparseable timestamp rather than dating it to 1970", () => {
    const withJunk = [...REAL_DAILY, { timestamp: "not-a-date", visitors: 9, pageviews: 9 }];
    const s = toContinuousDaily(withJunk, since, until);
    expect(s.reduce((n, p) => n + p.pageviews, 0)).toBe(1502);
  });

  it("cannot be made to hang or allocate unboundedly by a silly range", () => {
    const s = toContinuousDaily([], new Date("2020-01-01T00:00:00Z"), new Date("2030-01-01T00:00:00Z"));
    expect(s.length).toBeLessThanOrEqual(400);
  });
});

describe("totals", () => {
  const series = toContinuousDaily(REAL_DAILY, new Date("2026-08-05T00:00:00Z"), new Date("2026-08-14T00:00:00Z"));

  it("adds up pageviews, which are additive across days", () => {
    expect(totals(series).pageviews).toBe(1502);
  });

  it("counts days that recorded nothing, separately from days covered", () => {
    const t = totals(series);
    expect(t.daysCovered).toBe(10);
    expect(t.daysWithTraffic).toBe(4);
  });

  // Naming, not arithmetic: the field is visitorDaysSum because adding Vercel's daily
  // visitor column does NOT give unique people over the period, and a field called
  // `visitors` would be quoted as if it did.
  it("keeps the summed visitor column under a name that cannot be read as unique visitors", () => {
    const t = totals(series);
    expect(t.visitorDaysSum).toBe(589);
    expect(Object.keys(t)).not.toContain("visitors");
  });
});
