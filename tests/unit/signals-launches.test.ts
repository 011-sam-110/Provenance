import { afterEach, expect, test, vi } from "vitest";
import fixture from "@/tests/fixtures/launches.json";
import ll23 from "@/tests/fixtures/launches-ll2-2.3.0.json";
import { normalizeLaunches, launchStatusColor, LAUNCHES_SOURCE, resetLaunchesCacheForTest } from "@/lib/signals/launches";
import { readOutcome } from "@/lib/signals/outcome";
import { readCoverage } from "@/lib/signals/coverage";
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

// --- fetch path: no dev-mirror fallback ------------------------------------------
// lldev.thespacedevs.com was a six-day-old snapshot on 2026-10-16 (178 launches
// against production's 476), and the adapter stamped its rows as a live read.
// A refusal from production must now serve the last good rows, marked degraded,
// and must never ask the dev host.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetLaunchesCacheForTest();
});

test("a production 429 with nothing cached is degraded and never calls the dev host", async () => {
  resetLaunchesCacheForTest();
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(String(url)); return { ok: false, status: 429, json: async () => ({}) }; }));
  const out = await LAUNCHES_SOURCE.fetch();
  expect(out).toEqual([]);
  expect(readOutcome(out)?.ok).toBe(false);
  expect(calls).toHaveLength(1);
  expect(calls.every((u) => u.startsWith("https://ll.thespacedevs.com/"))).toBe(true);
  expect(calls.some((u) => u.includes("lldev"))).toBe(false);
});

test("a production 429 after a good read keeps the last good rows, stamped when they were read", async () => {
  resetLaunchesCacheForTest();
  vi.useFakeTimers();
  const readAt = Date.parse("2026-10-16T12:00:00Z");
  vi.setSystemTime(readAt);
  const calls: string[] = [];
  let refuse = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(String(url));
    return refuse ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => fixture };
  }));
  const first = await LAUNCHES_SOURCE.fetch();
  expect(first).toHaveLength(3);
  expect(readOutcome(first)?.ok).toBe(true);
  refuse = true;
  vi.setSystemTime(readAt + 2 * 60 * 60 * 1000); // past the 1 h cache
  const second = await LAUNCHES_SOURCE.fetch();
  expect(second).toHaveLength(3);
  expect(readOutcome(second)?.ok).toBe(false);
  expect(readOutcome(second)?.at).toBe(readAt);
  expect(calls.some((u) => u.includes("lldev"))).toBe(false);
});

// --- LL2 2.3.0 (captured 2026-10-16) --------------------------------------------

test("reads the 2.3.0 shape: numeric pad coordinates, LL2 total as an exact N of M", () => {
  const out = normalizeLaunches(ll23 as never);
  expect(out).toHaveLength(ll23.results.length);
  const mmx = out.find((f) => f.title.includes("MMX"));
  expect(mmx?.props?.provider).toBeTruthy();
  expect(mmx?.ts).toBe("2026-10-19T19:41:03Z");
  expect(out.every((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))).toBe(true);
  expect(readCoverage(out)).toMatchObject({ available: 476, availableExact: true, capped: true, cap: 100 });
});
