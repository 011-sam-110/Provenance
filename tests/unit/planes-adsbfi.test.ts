/**
 * adsb.fi on the planes layer (lib/sources/adsbfi.ts): gap fill every cycle over
 * thinly covered cities, and a labelled regional failover when adsb.lol has been
 * silent for ten minutes.
 *
 * The fixture holds verbatim adsb.fi /api/v3 rows (fields trimmed) captured on
 * 2026-10-16. Rows changed for a test are copies, and the test says so.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cell from "@/tests/fixtures/adsbfi-v3-cell.json";
import {
  FAILOVER_AFTER_MS,
  FAILOVER_CELLS,
  GAP_CELLS,
  adsbFiRowsToObjects,
  cellUrl,
  fetchAdsbFiCells,
  mergeGapFill,
  shouldFailOver,
  sweepToObjects,
  type FiCell,
} from "@/lib/sources/adsbfi";
import { pullToObjects, type AdsbRow, type PullResult } from "@/lib/sources/adsb";
import { readCoverage } from "@/lib/signals/coverage";

const rows = cell.ac as AdsbRow[];

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("adsbFiRowsToObjects", () => {
  it("keeps civil aircraft, typed or not, and marks each as adsb.fi's", () => {
    const out = adsbFiRowsToObjects(rows);
    expect(out.map((o) => o.id).sort()).toEqual(
      ["plane:458664", "plane:49d630", "plane:4bce0a", "plane:~2789ae"],
    );
    expect(out.every((o) => o.meta?.network === "adsb.fi")).toBe(true);
  });

  it("drops a military-flagged aircraft, which the military-air layer already draws", () => {
    expect(rows.find((r) => r.hex === "adfec1")?.dbFlags).toBe(1);
    expect(adsbFiRowsToObjects(rows).some((o) => o.id === "plane:adfec1")).toBe(false);
  });

  it("drops a position older than 60 s (a copy of a real row, seen_pos changed)", () => {
    const old = { ...rows[0], seen_pos: 75 };
    expect(adsbFiRowsToObjects([old])).toEqual([]);
  });
});

describe("mergeGapFill", () => {
  it("adds only what the primary lacks, and the primary's row wins", () => {
    const fi = adsbFiRowsToObjects(rows);
    const primary = [{ ...fi[0], meta: { ...fi[0].meta, network: undefined } }];
    const { objects, added } = mergeGapFill(primary, fi);
    expect(added).toBe(fi.length - 1);
    expect(objects).toHaveLength(fi.length);
    expect(objects[0]).toBe(primary[0]);
  });
});

describe("fetchAdsbFiCells", () => {
  const A: FiCell = { name: "A", lat: 1, lon: 2 };
  const B: FiCell = { name: "B", lat: 3, lon: 4 };
  const C: FiCell = { name: "C", lat: 5, lon: 6 };

  function harness(script: Record<string, () => Response>, msPerRequest = 1_000) {
    const calls: string[] = [];
    let clock = 0;
    return {
      calls,
      deps: (deadline: number) => ({
        deadline,
        now: () => clock,
        fetchImpl: async (url: string) => {
          calls.push(url);
          clock += msPerRequest;
          return (script[url] ?? (() => new Response(JSON.stringify({ ac: [] }), { status: 200 })))();
        },
      }),
    };
  }
  const ok = (r: AdsbRow[]) => () => new Response(JSON.stringify({ ac: r }), { status: 200 });

  it("asks each cell in order and collapses an aircraft two overlapping cells both heard", async () => {
    const h = harness({ [cellUrl(A)]: ok(rows.slice(0, 2)), [cellUrl(B)]: ok(rows.slice(1, 3)) });
    const r = await fetchAdsbFiCells([A, B], h.deps(60_000));
    expect(h.calls).toEqual([cellUrl(A), cellUrl(B)]);
    expect(r.objects).toHaveLength(3);
    expect(r).toMatchObject({ cellsPlanned: 2, cellsAttempted: 2, cellsSucceeded: 2, answered: ["A", "B"] });
  });

  it("counts and logs a refused cell without losing the others", async () => {
    const h = harness({ [cellUrl(A)]: () => new Response("slow down", { status: 429 }), [cellUrl(B)]: ok(rows.slice(0, 1)) });
    const r = await fetchAdsbFiCells([A, B], h.deps(60_000));
    expect(r).toMatchObject({ cellsAttempted: 2, cellsSucceeded: 1, answered: ["B"] });
    expect(r.objects).toHaveLength(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/429/);
  });

  it("starts no cell once the deadline is near", async () => {
    const h = harness({}, 1_000);
    const r = await fetchAdsbFiCells([A, B, C], h.deps(2_400));
    expect(h.calls).toEqual([cellUrl(A)]);
    expect(r).toMatchObject({ cellsPlanned: 3, cellsAttempted: 1 });
  });

  it("asks a 250 nm point query, the largest radius adsb.fi serves", () => {
    expect(cellUrl({ name: "Delhi", lat: 28.6, lon: 77.2 })).toBe("https://opendata.adsb.fi/api/v3/lat/28.6/lon/77.2/dist/250");
  });

  it("keeps the gap sweep inside the pull budget at adsb.fi's one request per second", () => {
    // 1.1 s per cell (lib/http/hostLane.ts) must fit the 20 s PULL_BUDGET_MS it shares.
    expect(GAP_CELLS.length * 1.1).toBeLessThan(18);
    // The failover sweep adds the hubs inside its 45 s budget.
    expect((GAP_CELLS.length + FAILOVER_CELLS.length) * 1.1).toBeLessThan(43);
  });
});

describe("failover", () => {
  it("waits ten minutes of adsb.lol silence before replacing its last good snapshot", () => {
    const now = 1_792_180_000_000;
    expect(FAILOVER_AFTER_MS).toBe(600_000);
    expect(shouldFailOver(now - 60_000, now)).toBe(false);
    expect(shouldFailOver(now - FAILOVER_AFTER_MS - 1, now)).toBe(true);
    expect(shouldFailOver(null, now)).toBe(true);
  });

  it("labels a failover snapshot regional, never worldwide, and never exact", () => {
    const objects = adsbFiRowsToObjects(rows);
    const out = sweepToObjects({ objects, cellsPlanned: 35, cellsAttempted: 35, cellsSucceeded: 33, answered: [] }, 3000);
    const cov = readCoverage(out)!;
    expect(cov.availableExact).toBe(false);
    expect(cov.rule).toMatch(/adsb\.lol did not answer/);
    expect(cov.rule).toMatch(/33 of 35 cities/);
    expect(cov.rule).toMatch(/regional, not worldwide/);
  });
});

describe("the planes coverage rule names adsb.fi's additions", () => {
  const pull = (objects = adsbFiRowsToObjects(rows)): PullResult => ({
    objects,
    batchesPlanned: 1,
    batchesAttempted: 1,
    batchesSucceeded: 1,
    mainlineSucceeded: true,
    typesPlanned: 243,
  });

  it("says how many aircraft only adsb.fi heard, and over how many cities", () => {
    const rule = readCoverage(pullToObjects(pull(), 3000, { added: 4, cellsSucceeded: 12, cellsPlanned: 13 }))?.rule ?? "";
    expect(rule).toContain("plus 4 aircraft of any type that only adsb.fi's receivers heard");
    expect(rule).toContain("12 of 13");
  });

  it("says nothing about adsb.fi when it added nothing", () => {
    const rule = readCoverage(pullToObjects(pull(), 3000, { added: 0, cellsSucceeded: 0, cellsPlanned: 13 }))?.rule ?? "";
    expect(rule).not.toContain("adsb.fi");
  });
});
