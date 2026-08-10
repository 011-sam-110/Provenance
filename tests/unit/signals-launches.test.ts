import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/launches.json";
import { normalizeLaunches, launchStatusColor, LAUNCHES_SOURCE } from "@/lib/signals/launches";
import { countdown } from "@/lib/console/signals/schedule";

test("normalizes LL2 launches to pad points, skipping pad-less ones", () => {
  const out = normalizeLaunches(fixture as never);
  // 4 results in; the synthetic null-pad launch is skipped → 3 features.
  expect(out).toHaveLength(3);
  expect(out.every((f) => f.signalId === "launches")).toBe(true);
  expect(out.every((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))).toBe(true);
  expect(out.some((f) => f.id === "launch:no-pad-x")).toBe(false);
});

test("maps pad coords (string→number), provider, rocket, status and net", () => {
  const [a] = normalizeLaunches(fixture as never);
  expect(a.lat).toBeCloseTo(8.716667, 5);
  expect(a.lon).toBeCloseTo(167.733333, 5);
  expect(a.props?.provider).toBe("Northrop Grumman Space Systems");
  expect(a.props?.rocket).toBe("Pegasus XL");
  expect(a.props?.status).toBe("Go for Launch");
  expect(a.ts).toBe("2026-06-27T09:00:00Z");
  expect(a.color).toBe(launchStatusColor("Go for Launch"));
});

test("status colour ramp: go=green, tbd=violet", () => {
  expect(launchStatusColor("Go for Launch")).toBe("#22c55e");
  expect(launchStatusColor("To Be Determined")).toBe("#a855f7");
  expect(launchStatusColor("Launch Failure")).toBe("#ef4444");
});

test("registers as a schedule so it renders the countdown agenda, not the event view", () => {
  expect(LAUNCHES_SOURCE.kind).toBe("schedule");
});

// --- countdown -----------------------------------------------------------------
// A schedule layer's `ts` is the SCHEDULED time, i.e. in the FUTURE. Every row's
// countdown must therefore be derived with countdown(ts, now) — an "age since ts"
// formatter clamps a future stamp to zero, which is what produced the "· 0s" seen
// on every launch row in production. These lock the adapter half of that contract:
// if `ts` ever stops carrying LL2's `net`, the countdown silently dies again.

const NOW = Date.parse("2026-06-27T06:00:00Z"); // 3h before the fixture's first launch

test("REGRESSION: every launch yields a real remaining-time string, never 0", () => {
  const out = normalizeLaunches(fixture as never);
  const labels = out.map((f) => countdown(f.ts, NOW).label);
  expect(labels).toEqual(["T- 3h 0m", "T- 1d 8h", "T- 2d 18h"]);
  expect(labels.some((l) => /\b0s\b/.test(l))).toBe(false);
  expect(labels).not.toContain("Unscheduled");
});

test("REGRESSION: launch timestamps are in the future and carry a positive delta", () => {
  const out = normalizeLaunches(fixture as never);
  expect(out.every((f) => typeof f.ts === "string")).toBe(true);
  expect(out.every((f) => Date.parse(f.ts as string) > NOW)).toBe(true);
  const deltas = out.map((f) => countdown(f.ts, NOW).ms);
  expect(deltas.every((ms) => ms != null && ms > 0)).toBe(true);
  expect(deltas[0]).toBe(3 * 3_600_000);
});

test("countdown states escalate as a launch approaches, and survive the window", () => {
  const [pegasus] = normalizeLaunches(fixture as never); // 2026-06-27T09:00:00Z
  expect(countdown(pegasus.ts, Date.parse("2026-06-27T06:00:00Z")).state).toBe("soon");
  expect(countdown(pegasus.ts, Date.parse("2026-06-27T08:50:00Z")).label).toBe("T- 10m");
  expect(countdown(pegasus.ts, Date.parse("2026-06-27T09:30:00Z")).label).toBe("in progress");
  expect(countdown(pegasus.ts, Date.parse("2026-06-27T13:00:00Z")).label).toBe("launched");
});
