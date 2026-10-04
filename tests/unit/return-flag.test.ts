// The return flag: can a browser tell a new visit from a return without sending
// anything that identifies it? These pin the bucket edges, the 13-month cap and the
// rule that a corrupt record is a new visit, never a crash and never a guess.

import { describe, it, expect } from "vitest";
import {
  beginVisit,
  classifyVisit,
  dayNumber,
  forgetVisit,
  gapBucket,
  localDay,
  MAX_LIFETIME_DAYS,
  VISIT_EVENT,
  VISIT_KEY,
  visitProperties,
  weekStart,
} from "@/lib/analytics/returnFlag";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const writes: string[] = [];
  return {
    map,
    writes,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(k);
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const stored = (d: unknown) => JSON.stringify({ v: 1, d });

describe("gap buckets", () => {
  it.each([
    [0, "same_day"],
    [1, "next_day"],
    [2, "2_7d"],
    [7, "2_7d"],
    [8, "8_30d"],
    [30, "8_30d"],
    [31, "over_30d"],
    [400, "over_30d"],
  ] as const)("%i days is %s", (days, bucket) => {
    expect(gapBucket(days)).toBe(bucket);
  });
});

describe("day arithmetic", () => {
  it("counts across a year boundary", () => {
    expect(dayNumber("2027-01-01")! - dayNumber("2026-12-31")!).toBe(1);
  });

  it("counts across a leap day", () => {
    expect(dayNumber("2028-03-01")! - dayNumber("2028-02-28")!).toBe(2);
  });

  it("rejects dates that do not exist", () => {
    for (const bad of ["2026-13-01", "2026-02-30", "2026-9-14", "0099-01-01", "yesterday", ""]) {
      expect(dayNumber(bad), bad).toBeNull();
    }
  });

  it("uses the browser's local calendar day, not UTC", () => {
    expect(localDay(new Date(2026, 8, 14, 0, 5))).toBe("2026-09-14");
    expect(localDay(new Date(2026, 8, 14, 23, 55))).toBe("2026-09-14");
  });

  it("keeps the lifetime at 13 months, because /privacy says 13 months", () => {
    expect(MAX_LIFETIME_DAYS).toBe(395);
  });
});

describe("classifyVisit", () => {
  const today = "2026-09-14";
  const t = dayNumber(today)!;
  const iso = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
  // 2026-09-14 is a Monday, so a browser that is new today is in the cohort of that week.
  const fresh = { visit: { kind: "new" }, next: { first: today, last: today }, cohortWeek: today };

  it("calls a browser with no record new, and starts the record today", () => {
    expect(classifyVisit(null, today)).toEqual(fresh);
  });

  it("calls a return returning, with the gap measured from the LAST visit", () => {
    expect(classifyVisit({ first: "2026-08-01", last: "2026-09-10" }, today)).toEqual({
      visit: { kind: "returning", gap: "2_7d" },
      next: { first: "2026-08-01", last: today },
      cohortWeek: "2026-07-27",
    });
  });

  it("keeps the first date, so visits cannot extend the 13 months", () => {
    expect(classifyVisit({ first: "2026-01-01", last: "2026-09-13" }, today).next.first).toBe("2026-01-01");
  });

  it("still counts a return 394 days after the first visit", () => {
    const record = { first: iso(t - (MAX_LIFETIME_DAYS - 1)), last: iso(t - 1) };
    expect(classifyVisit(record, today).visit).toEqual({ kind: "returning", gap: "next_day" });
  });

  it("resets to new 395 days after the first visit, even after a visit yesterday", () => {
    const record = { first: iso(t - MAX_LIFETIME_DAYS), last: iso(t - 1) };
    expect(classifyVisit(record, today)).toEqual(fresh);
  });

  it.each([
    ["a bare string", "2026-09-10"],
    ["a missing last date", { first: "2026-09-10" }],
    ["numbers", { first: 1, last: 2 }],
    ["an impossible date", { first: "2026-02-30", last: "2026-09-10" }],
    ["first after last", { first: "2026-09-12", last: "2026-09-10" }],
    ["a last visit in the future", { first: "2026-09-10", last: "2026-09-20" }],
  ])("resets %s to new", (_label, record) => {
    expect(classifyVisit(record, today)).toEqual(fresh);
  });
});

describe("weekStart", () => {
  // Monday of the week a date is in. 1970-01-05 was a Monday, so day number 4 is one.
  const isMonday = (date: string) => (dayNumber(date)! - 4) % 7 === 0;

  it("gives a Monday itself", () => {
    expect(weekStart("2026-09-14")).toBe("2026-09-14");
  });

  it("puts a Sunday in the week that began six days before", () => {
    expect(weekStart("2026-09-20")).toBe("2026-09-14");
  });

  it("crosses a year boundary", () => {
    expect(weekStart("2026-12-31")).toBe("2026-12-28");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });

  it("is null for anything that is not a date", () => {
    expect(weekStart("2026-02-30")).toBeNull();
    expect(weekStart("soon")).toBeNull();
  });

  it("is always a Monday, on or at most six days before the date", () => {
    const from = dayNumber("2026-01-01")!;
    for (let n = from; n < from + 400; n++) {
      const date = new Date(n * 86_400_000).toISOString().slice(0, 10);
      const week = weekStart(date)!;
      expect(isMonday(week), `${date} -> ${week}`).toBe(true);
      const back = n - dayNumber(week)!;
      expect(back >= 0 && back <= 6, `${date} -> ${week}`).toBe(true);
    }
  });
});

describe("the cohort week", () => {
  // The week of the FIRST visit, and only on a browser's first visit of a calendar week.
  // PostHog then gets one countable visit per browser per week, with no identifier.

  it("is this week for a new browser", () => {
    expect(classifyVisit(null, "2026-09-16").cohortWeek).toBe("2026-09-14");
  });

  it("is the week of the first visit when a browser comes back in a later week", () => {
    expect(classifyVisit({ first: "2026-08-01", last: "2026-09-10" }, "2026-09-16").cohortWeek).toBe("2026-07-27");
  });

  it("is not sent on a second visit in the same week", () => {
    const record = { first: "2026-09-14", last: "2026-09-15" };
    expect(classifyVisit(record, "2026-09-16")).toEqual({
      visit: { kind: "returning", gap: "next_day" },
      next: { first: "2026-09-14", last: "2026-09-16" },
      cohortWeek: null,
    });
  });

  it("is sent on a Monday after a visit on the Sunday, because the week changed", () => {
    const record = { first: "2026-09-08", last: "2026-09-13" };
    expect(classifyVisit(record, "2026-09-14").cohortWeek).toBe("2026-09-07");
  });

  it("starts again from this week after the 13-month reset", () => {
    const t = dayNumber("2026-09-16")!;
    const iso = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
    const record = { first: iso(t - MAX_LIFETIME_DAYS), last: iso(t - 1) };
    expect(classifyVisit(record, "2026-09-16").cohortWeek).toBe("2026-09-14");
  });
});

describe("beginVisit", () => {
  // Monday 14 September 2026, noon.
  const now = new Date(2026, 8, 14, 12, 0);

  it("names the event, because the dashboard counts it by this name", () => {
    expect(VISIT_EVENT).toBe("visit");
  });

  it("classifies, saves the next record and returns what to register and what to send", () => {
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-01", last: "2026-09-13" }) });
    expect(beginVisit({ registered: undefined, now, storage: s })).toEqual({
      properties: { visit_kind: "returning", return_gap: "next_day" },
      event: { cohort_week: "2026-08-31" },
    });
    expect(JSON.parse(s.map.get(VISIT_KEY)!)).toEqual({ v: 1, d: { first: "2026-09-01", last: "2026-09-14" } });
  });

  it("sends a new browser's visit with this week as its cohort", () => {
    const s = memoryStorage();
    expect(beginVisit({ registered: undefined, now, storage: s })).toEqual({
      properties: { visit_kind: "new", return_gap: "none" },
      event: { cohort_week: "2026-09-14" },
    });
  });

  it("sends a visit with no cohort week on a later day of the same week", () => {
    const tuesday = new Date(2026, 8, 15, 9, 0);
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-14", last: "2026-09-14" }) });
    expect(beginVisit({ registered: undefined, now: tuesday, storage: s })).toEqual({
      properties: { visit_kind: "returning", return_gap: "next_day" },
      event: {},
    });
  });

  it("sends no visit event from a second tab on the same day", () => {
    // The browser was counted already today. The tab still learns its class, for the
    // properties on its own events.
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-01", last: "2026-09-14" }) });
    expect(beginVisit({ registered: undefined, now, storage: s })).toEqual({
      properties: { visit_kind: "returning", return_gap: "same_day" },
      event: null,
    });
  });

  it("does not touch storage when this tab already registered a class today", () => {
    // Without this, a reload in the same tab would turn a new visit into returning/same_day.
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-01", last: "2026-09-14" }) });
    expect(beginVisit({ registered: "new", now, storage: s })).toBeNull();
    expect(beginVisit({ registered: "returning", now, storage: s })).toBeNull();
    expect(s.writes).toEqual([]);
  });

  it("classifies a registered tab again when the day has changed", () => {
    // A console tab left open is the most loyal visitor there is. Classified once, it
    // stayed "new" for as long as it lived and its returns were never counted.
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-10", last: "2026-09-13" }) });
    expect(beginVisit({ registered: "new", now, storage: s })).toEqual({
      properties: { visit_kind: "returning", return_gap: "next_day" },
      event: { cohort_week: "2026-09-07" },
    });
    expect(JSON.parse(s.map.get(VISIT_KEY)!)).toEqual({ v: 1, d: { first: "2026-09-10", last: "2026-09-14" } });
  });

  it("leaves a registered tab alone when the stored day is ahead of the clock", () => {
    // A traveller who crosses time zones westwards. Starting over would lose the first date.
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-01", last: "2026-09-15" }) });
    expect(beginVisit({ registered: "returning", now, storage: s })).toBeNull();
    expect(s.writes).toEqual([]);
  });

  it("starts a registered tab over as new when its record is gone", () => {
    const s = memoryStorage();
    expect(beginVisit({ registered: "returning", now, storage: s })).toEqual({
      properties: { visit_kind: "new", return_gap: "none" },
      event: { cohort_week: "2026-09-14" },
    });
    expect(s.writes).toEqual([VISIT_KEY]);
  });

  it("does nothing while the page is hidden", () => {
    // A tab restored in the background was loaded, not visited. It is classified when it is shown.
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-01", last: "2026-09-13" }) });
    expect(beginVisit({ registered: undefined, now, storage: s, visible: false })).toBeNull();
    expect(s.writes).toEqual([]);
  });

  it("treats an old envelope version as no record", () => {
    const s = memoryStorage({ [VISIT_KEY]: JSON.stringify({ v: 0, d: { first: "2026-09-01", last: "2026-09-13" } }) });
    expect(beginVisit({ registered: undefined, now, storage: s })?.properties).toEqual({
      visit_kind: "new",
      return_gap: "none",
    });
  });

  it("sends none as the gap of a new visit, so a breakdown has no blank bucket", () => {
    expect(visitProperties({ kind: "new" })).toEqual({ visit_kind: "new", return_gap: "none" });
  });

  it("forgetVisit deletes the record", () => {
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-01", last: "2026-09-13" }) });
    forgetVisit(s);
    expect(s.map.has(VISIT_KEY)).toBe(false);
  });
});
