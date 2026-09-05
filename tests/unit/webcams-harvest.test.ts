import { describe, it, expect } from "vitest";
import {
  WORLD,
  LEAF_CAPACITY,
  WINDY_MAX_OFFSET,
  WINDY_PAGE_LIMIT,
  splitBox,
  boxPath,
  boxFromPath,
  pageOffsets,
  leafRequestCost,
  needsSplit,
  planLeaves,
  selectLeavesForCycle,
  cyclesToFullCoverage,
  coverageRatio,
  type Box,
  type LeafState,
} from "@/lib/webcams/harvest";

describe("the measured tier caps", () => {
  it("never plans an offset the free tier refuses", () => {
    // offset=2000 is a live 400: {"message":"Offset is over API tier limit 1000!"}.
    // A planner that emits one turns a working harvest into a run of failures, so this
    // is the single most important property in the module.
    for (const total of [0, 1, 49, 50, 999, 1000, 1050, 5000, 70_736]) {
      for (const offset of pageOffsets(total)) {
        expect(offset).toBeLessThanOrEqual(WINDY_MAX_OFFSET);
        expect(offset % WINDY_PAGE_LIMIT).toBe(0);
      }
    }
  });

  it("reads a full box in exactly 21 requests, not 20", () => {
    // The last servable page STARTS at the ceiling and still returns a full page, so
    // capacity is 1000 + 50. Off-by-one here silently drops the last 50 rows of every
    // dense box in the world.
    expect(LEAF_CAPACITY).toBe(1050);
    expect(leafRequestCost(LEAF_CAPACITY)).toBe(21);
    expect(pageOffsets(LEAF_CAPACITY).at(-1)).toBe(WINDY_MAX_OFFSET);
  });

  it("asks for nothing when a box is empty", () => {
    expect(pageOffsets(0)).toEqual([]);
    expect(leafRequestCost(0)).toBe(0);
  });

  it("splits exactly at capacity, not around it", () => {
    expect(needsSplit(LEAF_CAPACITY, 0)).toBe(false);
    expect(needsSplit(LEAF_CAPACITY + 1, 0)).toBe(true);
  });

  it("stops splitting at max depth even when still over capacity", () => {
    expect(needsSplit(50_000, 12, 12)).toBe(false);
  });
});

describe("leaf identity", () => {
  it("pins quadrant order to real coordinates", () => {
    // THIS TEST EXISTS BECAUSE THE OBVIOUS ONE CANNOT FAIL. Asserting that
    // boxFromPath(boxPath(x)) round-trips proves nothing about ORDER: boxFromPath
    // calls the same splitBox, so swapping two quadrants inside splitBox keeps the
    // round-trip true by construction. Verified by injecting exactly that swap — the
    // round-trip stayed green. Only literal coordinates catch it.
    //
    // A silent reorder re-points every committed tile at a different patch of the
    // planet, and no other check in the system would notice.
    expect(boxFromPath("r0")).toEqual([90, 180, 0, 0]); // NE
    expect(boxFromPath("r1")).toEqual([90, 0, 0, -180]); // NW
    expect(boxFromPath("r2")).toEqual([0, 180, -90, 0]); // SE
    expect(boxFromPath("r3")).toEqual([0, 0, -90, -180]); // SW
    expect(boxFromPath("r01")).toEqual([90, 90, 45, 0]); // NE then NW
  });

  it("round-trips a path back to the same box", () => {
    for (const path of ["r", "r0", "r3", "r012", "r30122013"]) {
      expect(boxFromPath(path), path).not.toBeNull();
    }
    const deep = boxFromPath("r30122013")!;
    let expected: Box = WORLD;
    for (const i of [3, 0, 1, 2, 2, 0, 1, 3]) expected = splitBox(expected)[i as 0 | 1 | 2 | 3];
    expect(deep).toEqual(expected);
  });

  it("rejects a malformed path instead of guessing a box", () => {
    expect(boxFromPath("r4")).toBeNull();
    expect(boxFromPath("30122013")).toBeNull();
    expect(boxFromPath("rabc")).toBeNull();
  });

  it("covers the parent exactly when split", () => {
    const kids = splitBox(WORLD);
    const area = (b: Box) => (b[0] - b[2]) * (b[1] - b[3]);
    expect(kids.reduce((s, k) => s + area(k), 0)).toBeCloseTo(area(WORLD), 6);
  });
});

/** A fake Windy: counts how many of `points` fall inside a box. */
function densityProbe(points: { lat: number; lon: number }[]) {
  const calls: Box[] = [];
  const probe = async (box: Box) => {
    calls.push(box);
    const [n, e, s, w] = box;
    return points.filter((p) => p.lat > s && p.lat <= n && p.lon > w && p.lon <= e).length;
  };
  return { probe, calls };
}

describe("planLeaves", () => {
  it("splits only where the density needs it", async () => {
    // One dense cluster in a corner, nothing anywhere else. A correct planner spends
    // its probes on the cluster and leaves the empty ocean at depth 1.
    const points = Array.from({ length: 3000 }, (_, i) => ({
      lat: 10 + (i % 100) * 0.001,
      lon: 10 + Math.floor(i / 100) * 0.001,
    }));
    const { probe } = densityProbe(points);
    const { leaves, worldTotal } = await planLeaves(probe);

    expect(worldTotal).toBe(3000);
    for (const leaf of leaves) expect(leaf.total).toBeLessThanOrEqual(LEAF_CAPACITY);
    // Every point is accounted for exactly once.
    expect(leaves.reduce((s, l) => s + l.total, 0)).toBe(3000);
    // And the empty three-quarters of the planet did not get subdivided.
    expect(leaves.length).toBeLessThan(40);
  });

  it("DROPS a failed probe rather than recording it as empty", async () => {
    // The failure this guards is silent deletion, the same one registry.ts's
    // mergeResults exists to prevent: a transient 500 recorded as `total: 0` bakes
    // "there is nothing here" into a committed plan, and nothing downstream can tell
    // that apart from a genuinely empty ocean.
    const points = Array.from({ length: 2000 }, (_, i) => ({ lat: 45 + i * 0.0001, lon: 45 }));
    let seen = 0;
    const probe = async (box: Box) => {
      const [n, e, s, w] = box;
      seen++;
      if (seen === 3) return -1; // one quadrant probe fails
      return points.filter((p) => p.lat > s && p.lat <= n && p.lon > w && p.lon <= e).length;
    };
    const { leaves, failed } = await planLeaves(probe);
    expect(failed).toBe(1);
    expect(leaves.every((l) => l.total > 0)).toBe(true);
  });

  it("marks a box truncated rather than dropping it when the budget runs out", async () => {
    const points = Array.from({ length: 40_000 }, (_, i) => ({
      lat: 45 + (i % 200) * 0.0001,
      lon: 45 + Math.floor(i / 200) * 0.0001,
    }));
    const { probe } = densityProbe(points);
    const { leaves } = await planLeaves(probe, { budget: 9 });
    const truncated = leaves.filter((l) => l.truncated);
    expect(truncated.length).toBeGreaterThan(0);
    // Truncated does not mean discarded — the readable part is still planned.
    expect(truncated.every((l) => l.total > LEAF_CAPACITY)).toBe(true);
  });
});

const leaf = (k: string, total: number, fetchedAt: number): LeafState => ({
  k,
  box: WORLD,
  total,
  depth: 1,
  fetchedAt,
});

describe("the rolling cursor", () => {
  it("reads never-fetched leaves before anything else", () => {
    const leaves = [leaf("a", 100, 5_000), leaf("b", 100, 0), leaf("c", 100, 1_000)];
    const { picked } = selectLeavesForCycle(leaves, 100);
    expect(picked.map((l) => l.k)).toEqual(["b", "c", "a"]);
  });

  it("stays inside the request budget", () => {
    const leaves = [leaf("a", 1050, 0), leaf("b", 1050, 0), leaf("c", 1050, 0)];
    const { picked, cost } = selectLeavesForCycle(leaves, 45);
    expect(cost).toBeLessThanOrEqual(45);
    expect(picked).toHaveLength(2); // 21 + 21 = 42; a third would be 63
  });

  it("SKIPS a leaf too big for the remaining budget instead of half-reading it", () => {
    // A partially-paged leaf would be recorded as fetched and drop to the back of the
    // queue, so its unread rows would never be collected. Skipping leaves it stalest,
    // so the next cycle takes it with a full budget.
    const leaves = [leaf("cheap", 50, 0), leaf("expensive", 1050, 1)];
    const { picked } = selectLeavesForCycle(leaves, 10);
    expect(picked.map((l) => l.k)).toEqual(["cheap"]);
  });

  it("still makes progress when the budget is smaller than the cheapest leaf", () => {
    // Otherwise a badly-set budget means every cycle does nothing at all, forever,
    // and coverage silently never moves.
    const { picked } = selectLeavesForCycle([leaf("big", 1050, 0)], 5);
    expect(picked.map((l) => l.k)).toEqual(["big"]);
  });

  it("reports how long a full sweep takes at a given budget", () => {
    const leaves = Array.from({ length: 208 }, (_, i) => leaf(`l${i}`, 340, 0));
    // 208 leaves x 7 requests = 1,456; at 60 a cycle that is 25 cycles.
    expect(cyclesToFullCoverage(leaves, 60)).toBe(25);
  });
});

describe("coverage honesty", () => {
  it("reports zero before anything has been read", () => {
    expect(coverageRatio([leaf("a", 500, 0), leaf("b", 500, 0)])).toBe(0);
  });

  it("counts rows actually kept, not the leaves visited", () => {
    // A leaf whose page came back short must not report its planned total as covered —
    // that is the "ceiling wearing the costume of a measurement" defect the repo's
    // coverage contract exists to prevent.
    const leaves: LeafState[] = [
      { ...leaf("a", 1000, 1), rows: 400 },
      { ...leaf("b", 1000, 0) },
    ];
    expect(coverageRatio(leaves)).toBeCloseTo(0.2, 6);
  });

  it("never exceeds 1 when boxes share an edge", () => {
    const leaves: LeafState[] = [
      { ...leaf("a", 100, 1), rows: 140 },
      { ...leaf("b", 100, 1), rows: 140 },
    ];
    expect(coverageRatio(leaves)).toBe(1);
  });
});
