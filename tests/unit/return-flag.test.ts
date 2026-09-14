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
  VISIT_KEY,
  visitProperties,
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
  const fresh = { visit: { kind: "new" }, next: { first: today, last: today } };

  it("calls a browser with no record new, and starts the record today", () => {
    expect(classifyVisit(null, today)).toEqual(fresh);
  });

  it("calls a return returning, with the gap measured from the LAST visit", () => {
    expect(classifyVisit({ first: "2026-08-01", last: "2026-09-10" }, today)).toEqual({
      visit: { kind: "returning", gap: "2_7d" },
      next: { first: "2026-08-01", last: today },
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

describe("beginVisit", () => {
  const now = new Date(2026, 8, 14, 12, 0);

  it("classifies, saves the next record and returns the properties to register", () => {
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-01", last: "2026-09-13" }) });
    expect(beginVisit({ registered: undefined, now, storage: s })).toEqual({
      visit_kind: "returning",
      return_gap: "next_day",
    });
    expect(JSON.parse(s.map.get(VISIT_KEY)!)).toEqual({ v: 1, d: { first: "2026-09-01", last: "2026-09-14" } });
  });

  it("does not touch storage when this tab already registered a class", () => {
    // Without this, a reload in the same tab would turn a new visit into returning/same_day.
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-01", last: "2026-09-14" }) });
    expect(beginVisit({ registered: "new", now, storage: s })).toBeNull();
    expect(beginVisit({ registered: "returning", now, storage: s })).toBeNull();
    expect(s.writes).toEqual([]);
  });

  it("treats an old envelope version as no record", () => {
    const s = memoryStorage({ [VISIT_KEY]: JSON.stringify({ v: 0, d: { first: "2026-09-01", last: "2026-09-13" } }) });
    expect(beginVisit({ registered: undefined, now, storage: s })).toEqual({ visit_kind: "new", return_gap: "none" });
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
