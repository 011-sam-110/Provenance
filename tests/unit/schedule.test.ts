import { expect, test } from "vitest";
import { countdown, dayOffsetUTC, scheduleHeading, scheduleClock, isVagueSchedule, netLabel, precisionRank } from "@/lib/console/signals/schedule";

const NOW = Date.parse("2026-07-10T12:00:00Z");

test("countdown formats days / hours / minutes ahead", () => {
  expect(countdown("2026-07-12T15:00:00Z", NOW).label).toBe("T- 2d 3h");
  expect(countdown("2026-07-10T16:30:00Z", NOW).label).toBe("T- 4h 30m");
  expect(countdown("2026-07-10T12:18:00Z", NOW).label).toBe("T- 18m");
});

test("countdown escalates state as the clock approaches zero", () => {
  expect(countdown("2026-07-12T15:00:00Z", NOW).state).toBe("scheduled");
  expect(countdown("2026-07-10T15:00:00Z", NOW).state).toBe("soon"); // 3h out
  expect(countdown("2026-07-10T12:10:00Z", NOW).state).toBe("imminent"); // 10m out
});

test("countdown treats a just-passed time as in progress, older as launched", () => {
  const live = countdown("2026-07-10T11:30:00Z", NOW); // 30m ago
  expect(live.state).toBe("imminent");
  expect(live.label).toBe("in progress");
  const done = countdown("2026-07-10T08:00:00Z", NOW); // 4h ago
  expect(done.state).toBe("past");
  expect(done.label).toBe("launched");
});

test("countdown is honest about a missing/invalid scheduled time", () => {
  expect(countdown(undefined, NOW)).toEqual({ label: "Unscheduled", state: "unknown", ms: null });
  expect(countdown("not-a-date", NOW).state).toBe("unknown");
});

test("dayOffsetUTC counts whole UTC days", () => {
  expect(dayOffsetUTC(Date.parse("2026-07-10T23:00:00Z"), NOW)).toBe(0);
  expect(dayOffsetUTC(Date.parse("2026-07-11T01:00:00Z"), NOW)).toBe(1);
  expect(dayOffsetUTC(Date.parse("2026-07-09T23:00:00Z"), NOW)).toBe(-1);
});

test("scheduleHeading buckets into Today / Tomorrow / Earlier / a dated header", () => {
  expect(scheduleHeading("2026-07-10T20:00:00Z", NOW)).toBe("Today");
  expect(scheduleHeading("2026-07-11T02:00:00Z", NOW)).toBe("Tomorrow");
  expect(scheduleHeading("2026-07-09T20:00:00Z", NOW)).toBe("Earlier");
  expect(scheduleHeading("2026-07-15T09:00:00Z", NOW)).toBe("Wed, Jul 15");
  expect(scheduleHeading(undefined, NOW)).toBe("Unscheduled");
});

test("scheduleClock renders a stable UTC clock", () => {
  expect(scheduleClock("2026-07-10T14:30:00Z")).toBe("14:30 UTC");
  expect(scheduleClock("2026-07-10T09:05:00Z")).toBe("09:05 UTC");
  expect(scheduleClock(undefined)).toBe("");
});

// --- date precision (LL2 net_precision) ------------------------------------------
// On 2026-10-16 prod drew 20 of 30 launches at 00:00 UTC and 10 on 31 December:
// LL2's placeholders for "some time in Q4" or "2026". A precision coarser than
// Hour is a date class, never a countdown or a clock.

test("precision names rank finest first; absent or unknown keeps the old exact behaviour", () => {
  expect(["Second", "Minute", "Hour", "Day", "Month", "Quarter 4", "Year Half 2", "Year"].map(precisionRank)).toEqual([0, 0, 1, 2, 4, 5, 6, 7]);
  expect(precisionRank(undefined)).toBe(0);
  expect(precisionRank("Something new")).toBe(0);
  expect(isVagueSchedule("Hour")).toBe(false);
  expect(isVagueSchedule("Day")).toBe(true);
  expect(isVagueSchedule(undefined)).toBe(false);
});

test("netLabel names the date class, not LL2's placeholder stamp", () => {
  expect(netLabel("2026-10-29T00:00:00Z", "Day")).toBe("NET Oct 29");
  expect(netLabel("2026-10-31T00:00:00Z", "Month")).toBe("NET Oct 2026");
  expect(netLabel("2026-12-31T00:00:00Z", "Quarter 4")).toBe("NET Q4 2026");
  expect(netLabel("2026-12-31T00:00:00Z", "Year Half 2")).toBe("NET H2 2026");
  expect(netLabel("2026-12-31T00:00:00Z", "Year")).toBe("NET 2026");
  expect(netLabel("2026-10-21T05:00:00Z", "Hour")).toBe("");
});

test("a vague row has no countdown, no clock, and a class heading (Day keeps its date)", () => {
  const year = countdown("2026-12-31T00:00:00Z", NOW, "Year");
  expect(year).toEqual({ label: "NET 2026", state: "unknown", ms: null });
  expect(scheduleClock("2026-12-31T00:00:00Z", "Year")).toBe("");
  expect(scheduleClock("2026-10-29T00:00:00Z", "Day")).toBe("");
  expect(scheduleHeading("2026-12-31T00:00:00Z", NOW, "Quarter 4")).toBe("NET Q4 2026");
  expect(scheduleHeading("2026-07-15T00:00:00Z", NOW, "Day")).toBe("Wed, Jul 15");
  // Exact rows are unchanged.
  expect(countdown("2026-07-10T16:30:00Z", NOW, "Minute").label).toBe("T- 4h 30m");
  expect(scheduleClock("2026-07-10T14:30:00Z", "Second")).toBe("14:30 UTC");
});
