import { expect, test, describe } from "vitest";
import {
  applyCap,
  markCoverage,
  carryCoverage,
  withCoverage,
  readCoverage,
  describeCoverage,
  coverageCountLabel,
  coverageNote,
  groupDigits,
} from "@/lib/signals/coverage";

// The truncation-honesty contract. A render cap that leaves no trace in the
// payload is a lie by omission — "1,500 fires" reads as the number of fires.
// These tests pin the three things a consumer needs: how many were available,
// how many came back, and whether a ceiling was hit.

const items = Array.from({ length: 50 }, (_, i) => ({ i }));

describe("applyCap", () => {
  test("records the pre-cap total when the cap bites", () => {
    const out = applyCap(items, 10, { noun: "widgets", rule: "the biggest" });
    expect(out).toHaveLength(10);
    expect(readCoverage(out)).toEqual({
      returned: 10,
      available: 50,
      availableExact: true,
      capped: true,
      cap: 10,
      noun: "widgets",
      rule: "the biggest",
    });
  });

  test("keeps the prefix, so the caller's sort decides who survives", () => {
    const out = applyCap(items, 3);
    expect(out.map((x) => x.i)).toEqual([0, 1, 2]);
  });

  test("an untruncated feed is recorded as complete, not as unknown", () => {
    const out = applyCap(items, 500);
    expect(out).toHaveLength(50);
    expect(readCoverage(out)).toMatchObject({ returned: 50, available: 50, capped: false });
    expect(readCoverage(out)?.cap).toBeUndefined();
  });

  test("never mutates or aliases the caller's array", () => {
    const src = [...items];
    const out = applyCap(src, 5);
    expect(src).toHaveLength(50);
    expect(out).not.toBe(src);
    expect(readCoverage(src)).toBeUndefined();
  });

  test("an exactly-full array is not capped (50 of 50 is all of them)", () => {
    expect(readCoverage(applyCap(items, 50))?.capped).toBe(false);
  });

  test("a saturated upstream page makes `available` a LOWER BOUND", () => {
    const out = applyCap(items, 1000, { noun: "stations", upstream: { limit: 50, count: 50 } });
    const c = readCoverage(out)!;
    expect(c.capped).toBe(true); // no local cap bit, but upstream truncated us
    expect(c.availableExact).toBe(false);
    expect(c.upstreamLimit).toBe(50);
  });

  test("an unsaturated upstream page is exact", () => {
    const out = applyCap(items, 1000, { upstream: { limit: 200, count: 50 } });
    expect(readCoverage(out)).toMatchObject({ capped: false, availableExact: true });
  });

  test("both truncations at once: local cap plus a saturated page", () => {
    const out = applyCap(items, 10, { upstream: { limit: 50, count: 50 } });
    expect(readCoverage(out)).toMatchObject({
      returned: 10,
      available: 50,
      availableExact: false,
      capped: true,
      cap: 10,
      upstreamLimit: 50,
    });
  });
});

describe("withCoverage", () => {
  test("`returned` is MEASURED from the array — a caller cannot overstate it", () => {
    const out = withCoverage([1, 2, 3], { available: 900, availableExact: true, capped: true, cap: 3 });
    expect(readCoverage(out)?.returned).toBe(3);
  });

  test("`capped` is forced false when the payload demonstrably holds everything", () => {
    const out = withCoverage([1, 2, 3], { available: 3, availableExact: true, capped: true, cap: 3 });
    expect(readCoverage(out)?.capped).toBe(false);
  });

  test("`available` can never come out below `returned`", () => {
    const out = withCoverage([1, 2, 3, 4], { available: 2, availableExact: true, capped: false });
    expect(readCoverage(out)?.available).toBe(4);
  });
});

describe("carryCoverage", () => {
  test("moves the record onto a derived array and re-measures `returned`", () => {
    const capped = applyCap(items, 10, { noun: "cells" });
    const mapped = carryCoverage(capped, capped.slice(0, 8).map((x) => `cell-${x.i}`));
    expect(readCoverage(mapped)).toMatchObject({
      returned: 8, // two rows lost in the mapping
      available: 50, // the 40 hidden by the cap are still declared
      capped: true,
      cap: 10,
      noun: "cells",
    });
  });

  test("is a no-op when the source declared nothing", () => {
    const mapped = carryCoverage([1, 2, 3], ["a"]);
    expect(readCoverage(mapped)).toBeUndefined();
  });
});

describe("readCoverage", () => {
  test("absence is 'not declared', not 'complete' — plain arrays read undefined", () => {
    expect(readCoverage([1, 2, 3])).toBeUndefined();
    expect(readCoverage(undefined)).toBeUndefined();
    expect(readCoverage(null)).toBeUndefined();
    expect(readCoverage("nope")).toBeUndefined();
  });

  test("a JSON round-trip drops the side channel (why the API publishes it explicitly)", () => {
    const out = applyCap(items, 10);
    expect(readCoverage(JSON.parse(JSON.stringify(out)))).toBeUndefined();
  });

  // REGRESSION GUARD. The first cut kept records in a module-level WeakMap. The
  // Next server build duplicates lib/signals/coverage.ts across chunks, so the
  // adapter wrote to one WeakMap and the route read another: every capped layer
  // shipped with NO coverage in production while these tests passed. The record
  // must therefore live under a GLOBAL-registry symbol, reachable by any copy of
  // the module. A `Symbol()` or a WeakMap fails this test.
  test("the record is reachable without sharing a module instance", () => {
    const out = applyCap(items, 10, { noun: "widgets" });
    const key = Symbol.for("opendata.signals.coverage");
    expect(Object.getOwnPropertySymbols(out)).toContain(key);
    const viaGlobalSymbol = (out as unknown as Record<symbol, unknown>)[key];
    expect(viaGlobalSymbol).toMatchObject({ returned: 10, available: 50, capped: true });
  });

  test("the record stays invisible to normal array use", () => {
    const out = applyCap(items, 3);
    expect(Object.keys(out)).toEqual(["0", "1", "2"]);
    expect(JSON.stringify(out)).toBe(JSON.stringify([{ i: 0 }, { i: 1 }, { i: 2 }]));
    expect([...out]).toHaveLength(3);
  });
});

describe("count labels and notes", () => {
  test("a capped count always carries its denominator", () => {
    const c = readCoverage(applyCap(Array.from({ length: 41203 }, (_, i) => i), 1500))!;
    expect(coverageCountLabel(c)).toBe("1,500 of 41,203");
  });

  test("an uncapped count is printed bare", () => {
    expect(coverageCountLabel(readCoverage(applyCap(items, 500)))).toBe("50");
    expect(coverageCountLabel(undefined, 412)).toBe("412");
  });

  test("a lower-bound denominator is marked with '+'", () => {
    const c = readCoverage(markCoverage(items, { upstream: { limit: 50, count: 50 } }))!;
    expect(coverageCountLabel(c)).toBe("50 of 50+");
  });

  test("the note names the hidden count and the selection rule", () => {
    const c = readCoverage(
      applyCap(Array.from({ length: 41203 }, (_, i) => i), 1500, {
        noun: "fire detections",
        rule: "the most intense by fire radiative power",
      }),
    )!;
    expect(coverageNote(c)).toBe(
      "Showing 1,500 of 41,203 fire detections — a cap of 1,500 hides 39,703. " +
        "Kept: the most intense by fire radiative power.",
    );
  });

  test("the note admits when the true total is unknown", () => {
    const c = readCoverage(markCoverage(items, { noun: "events", upstream: { limit: 50, count: 50 } }))!;
    expect(coverageNote(c)).toContain("not all of them");
    expect(coverageNote(c)).toContain("the real total is higher and unknown");
  });

  test("no note when nothing was truncated", () => {
    expect(coverageNote(readCoverage(applyCap(items, 500)))).toBeUndefined();
    expect(coverageNote(undefined)).toBeUndefined();
  });

  test("describeCoverage attaches the note the API publishes", () => {
    const c = readCoverage(applyCap(items, 10, { noun: "widgets" }))!;
    expect(describeCoverage(c).note).toBe(
      "Showing 10 of 50 widgets — a cap of 10 hides 40.",
    );
    const complete = readCoverage(applyCap(items, 500))!;
    expect(describeCoverage(complete).note).toBeUndefined();
  });

  test("digit grouping is locale-independent", () => {
    expect(groupDigits(0)).toBe("0");
    expect(groupDigits(999)).toBe("999");
    expect(groupDigits(1500)).toBe("1,500");
    expect(groupDigits(41203)).toBe("41,203");
    expect(groupDigits(1234567)).toBe("1,234,567");
  });
});
