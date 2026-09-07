// Reading and shaping the rollups for /admin/analytics.
//
// THE CENTRAL ASSERTION IN THIS FILE IS A NEGATIVE ONE: buildWindow must never sum the
// per-day visitor figures. Each day's number is the size of that day's set of salted
// hashes, and those sets are deleted when a day is finalised, so the union across days
// is not merely unknown — it is unrecoverable. A sum would answer a different question
// while looking like an answer to this one, and it would do it in the direction that
// flatters: someone who visits every day is counted seven times in a week.
//
// It is the easiest change in the codebase to make by accident, because summing is what
// every other field in mergeDay does, and it would never look wrong on screen.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyDay, type DayRollup } from "@/lib/analytics/rollup";
import { readRollups, stalenessSeconds } from "@/lib/analytics/rollupRead";
import {
  apiByteShare,
  buildWindow,
  bytes,
  directShare,
  durationBuckets,
  lastDays,
  rows,
} from "@/lib/analytics/rollupView";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rollup-read-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function day(date: string, over: Partial<DayRollup> = {}): DayRollup {
  return { ...emptyDay(date), ...over };
}

function writeDayFile(d: DayRollup) {
  mkdirSync(join(dir, "days"), { recursive: true });
  writeFileSync(join(dir, "days", `${d.date}.json`), JSON.stringify(d));
}

function writeStateFile(days: DayRollup[], lastRun = 1_788_800_000) {
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({ version: 1, salt: "x", cursors: {}, visitorKeys: {}, lastRun, days: Object.fromEntries(days.map((d) => [d.date, d])) }),
  );
}

describe("readRollups", () => {
  it("says why it is empty rather than throwing, when the directory does not exist", () => {
    // The normal state in local development and the state on any box where the timer
    // was never installed. A 500 on an internal page helps nobody.
    const r = readRollups({ ANALYTICS_ROLLUP_DIR: join(dir, "nope") });
    expect(r.days).toEqual([]);
    expect(r.reason).toContain("does not exist");
    expect(r.dir).toContain("nope");
  });

  it("says why it is empty when the directory is there but holds nothing", () => {
    const r = readRollups({ ANALYTICS_ROLLUP_DIR: dir });
    expect(r.days).toEqual([]);
    expect(r.reason).toContain("no days yet");
  });

  it("reads finished days and open days as one list, oldest first", () => {
    writeDayFile(day("2026-09-05", { requests: 5 }));
    writeDayFile(day("2026-09-06", { requests: 6 }));
    writeStateFile([day("2026-09-07", { requests: 7 })]);
    const r = readRollups({ ANALYTICS_ROLLUP_DIR: dir });
    expect(r.days.map((d) => d.date)).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(r.reason).toBeNull();
  });

  it("prefers the open copy of a day over the finished one", () => {
    // Only happens mid-write, and the state file is the newer of the two by definition.
    writeDayFile(day("2026-09-07", { requests: 1 }));
    writeStateFile([day("2026-09-07", { requests: 99 })]);
    expect(readRollups({ ANALYTICS_ROLLUP_DIR: dir }).days[0]?.requests).toBe(99);
  });

  it("skips a corrupt file instead of losing every other day with it", () => {
    writeDayFile(day("2026-09-05", { requests: 5 }));
    mkdirSync(join(dir, "days"), { recursive: true });
    writeFileSync(join(dir, "days", "2026-09-06.json"), "{ truncated");
    writeFileSync(join(dir, "days", "not-a-day.json"), "{}");
    const r = readRollups({ ANALYTICS_ROLLUP_DIR: dir });
    expect(r.days.map((d) => d.date)).toEqual(["2026-09-05"]);
  });

  it("keeps only the newest N days", () => {
    for (let i = 1; i <= 9; i++) writeDayFile(day(`2026-09-0${i}`));
    expect(readRollups({ ANALYTICS_ROLLUP_DIR: dir }, 3).days.map((d) => d.date)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ]);
  });
});

describe("stalenessSeconds", () => {
  it("reports null when the job has never run, and seconds when it has", () => {
    // A timer that has silently stopped leaves a dashboard that looks fine and is
    // frozen, and the only symptom is the last day not growing — which is exactly what
    // a quiet night looks like.
    expect(stalenessSeconds({ dir, days: [], lastRun: null, reason: null })).toBeNull();
    expect(stalenessSeconds({ dir, days: [], lastRun: 1000, reason: null }, 1_300_000)).toBe(300);
  });
});

describe("buildWindow", () => {
  const days = [
    day("2026-09-05", { pageviews: 10, requests: 100, visitors: 7, bytes: 1000 }),
    day("2026-09-06", { pageviews: 20, requests: 200, visitors: 4, bytes: 2000 }),
    day("2026-09-07", { pageviews: 30, requests: 300, visitors: 10, bytes: 3000 }),
  ];

  it("NEVER sums visitors across days — it reports the mean and the peak", () => {
    const w = buildWindow(days)!;
    expect(w.visitorsPeak).toBe(10);
    expect(w.visitorsMean).toBe(7); // (7 + 4 + 10) / 3
    // 21 is the sum, and it is the wrong answer. If this ever equals 21 someone has
    // "fixed" mergeDay to add visitors and the dashboard is now inflating by up to the
    // number of days in the window.
    expect(w.totals.visitors).not.toBe(21);
    expect(w.totals.visitors).toBe(10);
  });

  it("sums everything that IS additive", () => {
    const w = buildWindow(days)!;
    expect(w.totals.pageviews).toBe(60);
    expect(w.totals.requests).toBe(600);
    expect(w.totals.bytes).toBe(6000);
  });

  it("orders by date regardless of the order it was handed", () => {
    const w = buildWindow([days[2]!, days[0]!, days[1]!])!;
    expect(w.from).toBe("2026-09-05");
    expect(w.to).toBe("2026-09-07");
    expect(w.points.map((p) => p.date)).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
  });

  it("returns null rather than an empty shell when there are no days", () => {
    expect(buildWindow([])).toBeNull();
  });

  it("reports no mean response time rather than dividing by zero", () => {
    expect(buildWindow([day("2026-09-05")])!.meanDurationMs).toBeNull();
    expect(buildWindow([day("2026-09-05", { durationMsSum: 500, durationCount: 4 })])!.meanDurationMs).toBe(125);
  });
});

describe("rows", () => {
  it("computes each share against the WHOLE map, including rows it does not return", () => {
    // A share taken against the visible rows adds to 100% however much was cut off,
    // which is precisely how a truncated table implies it is complete.
    const map = { a: 50, b: 30, c: 20 };
    const r = rows(map, 1);
    expect(r).toHaveLength(1);
    expect(r[0]!.share).toBeCloseTo(0.5);
  });

  it("counts the (other) bucket in the denominator", () => {
    const r = rows({ a: 10, "(other)": 90 }, 1);
    expect(r[0]!.key).toBe("(other)");
    expect(r[0]!.share).toBeCloseTo(0.9);
  });

  it("does not divide by zero on an empty map", () => {
    expect(rows({}, 5)).toEqual([]);
  });
});

describe("bytes", () => {
  it("uses decimal units, because that is what bandwidth is billed in", () => {
    expect(bytes(999)).toBe("999 B");
    expect(bytes(1500)).toBe("1.5 kB");
    expect(bytes(1_455_900_000)).toBe("1.5 GB");
    expect(bytes(250_000_000)).toBe("250 MB");
  });
});

describe("durationBuckets", () => {
  it("labels every bucket from the edges, and the last one as an overflow", () => {
    const d = day("2026-09-07", { durationBuckets: [4, 3, 2, 1, 5] });
    const b = durationBuckets(d);
    expect(b.map((x) => x.label)).toEqual([
      "under 100 ms",
      "100–300 ms",
      "300–1000 ms",
      "1000–3000 ms",
      "over 3000 ms",
    ]);
    expect(b[4]!.count).toBe(5);
    expect(b.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
  });

  it("returns zero shares rather than NaN when nothing was timed", () => {
    expect(durationBuckets(day("2026-09-07")).every((b) => b.share === 0)).toBe(true);
  });
});

describe("directShare and apiByteShare", () => {
  it("measures the proportion that bypassed Cloudflare", () => {
    // Above roughly zero means some resolver still hands out the origin address, which
    // is the condition that makes closing the origin firewall an outage.
    expect(directShare(day("d", { viaCloudflare: 5821, direct: 5693 }))).toBeCloseTo(0.4944, 3);
    expect(directShare(day("d"))).toBe(0);
  });

  it("measures how much of the egress is API rather than pages", () => {
    expect(apiByteShare(day("d", { bytes: 1000, apiBytes: 930 }))).toBeCloseTo(0.93);
    expect(apiByteShare(day("d"))).toBe(0);
  });
});

describe("lastDays", () => {
  it("takes from the end and never returns an empty slice for a positive request", () => {
    const ds = ["a", "b", "c"].map((x) => day(x));
    expect(lastDays(ds, 2).map((d) => d.date)).toEqual(["b", "c"]);
    expect(lastDays(ds, 0)).toHaveLength(1);
    expect(lastDays(ds, 99)).toHaveLength(3);
  });
});
