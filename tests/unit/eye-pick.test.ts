import { describe, expect, it } from "vitest";
import { ALSO_MAX, PICK_RADIUS, marksAround, pickMarks, type PickCandidate } from "@/lib/eye/pick";

const ship = (id: string, x: number, y: number, r?: number): PickCandidate => ({ id, kind: "ship", x, y, ...(r != null ? { r } : {}) });
const plane = (id: string, x: number, y: number, r?: number): PickCandidate => ({ id, kind: "plane", x, y, ...(r != null ? { r } : {}) });

describe("pickMarks", () => {
  it("has a wider reach for a phone's thumb than for a pointer", () => {
    expect(PICK_RADIUS.wide).toBe(18);
    expect(PICK_RADIUS.phone).toBe(24);
    expect(PICK_RADIUS.phone).toBeGreaterThan(PICK_RADIUS.wide);
  });

  it("hits the nearest mark within reach", () => {
    const cands = [ship("a", 100, 100), ship("b", 110, 100), ship("c", 300, 300)];
    const { hit } = pickMarks(cands, { x: 108, y: 100 }, 18);
    expect(hit?.id).toBe("b");
  });

  it("hits nothing past the reach, and the reach includes its edge", () => {
    const cands = [ship("a", 100, 100)];
    expect(pickMarks(cands, { x: 119, y: 100 }, 18).hit).toBeNull();
    expect(pickMarks(cands, { x: 118, y: 100 }, 18).hit?.id).toBe("a");
    expect(pickMarks(cands, { x: 119, y: 100 }, 24).hit?.id).toBe("a");
    expect(pickMarks([], { x: 0, y: 0 }, 18)).toEqual({ hit: null, also: [] });
  });

  it("uses a mark's own larger reach (a long hull), never a smaller one", () => {
    const cands = [ship("long", 100, 100, 40), ship("short", 300, 300, 4)];
    expect(pickMarks(cands, { x: 135, y: 100 }, 18).hit?.id).toBe("long");
    // r 4 does not shrink the 18 px minimum: 10 px away still hits, 19 px away does not.
    expect(pickMarks(cands, { x: 310, y: 300 }, 18).hit?.id).toBe("short");
    expect(pickMarks(cands, { x: 319, y: 300 }, 18).hit).toBeNull();
  });

  it("skips a mark whose point is not finite", () => {
    const cands = [ship("nan", Number.NaN, 100), ship("inf", Number.POSITIVE_INFINITY, 0), ship("ok", 50, 50)];
    expect(pickMarks(cands, { x: 50, y: 50 }, 18).hit?.id).toBe("ok");
    expect(pickMarks([cands[0], cands[1]], { x: 0, y: 0 }, 18).hit).toBeNull();
  });

  it("gives nothing for a click that is not a point", () => {
    expect(pickMarks([ship("a", 1, 1)], { x: Number.NaN, y: 0 }, 18)).toEqual({ hit: null, also: [] });
  });

  it("keeps input order when two marks are the same distance away", () => {
    const cands = [ship("first", 90, 100), ship("second", 110, 100)];
    expect(pickMarks(cands, { x: 100, y: 100 }, 18).hit?.id).toBe("first");
    expect(pickMarks([...cands].reverse(), { x: 100, y: 100 }, 18).hit?.id).toBe("second");
  });

  it("lists the neighbours of the HIT's point, not of the click, nearest first", () => {
    const cands = [ship("hit", 100, 100), ship("far", 100, 115), ship("near", 100, 105), ship("away", 100, 200)];
    // The click is 14 px up from the hit, so "far" (115) is 29 px from the click but 15 px from the hit.
    const out = pickMarks(cands, { x: 100, y: 86 }, 18);
    expect(out.hit?.id).toBe("hit");
    expect(out.also.map((c) => c.id)).toEqual(["near", "far"]);
  });

  it("never lists the hit among its own neighbours", () => {
    const cands = [ship("a", 10, 10), ship("b", 10, 10)];
    const out = pickMarks(cands, { x: 10, y: 10 }, 18);
    expect(out.hit?.id).toBe("a");
    expect(out.also.map((c) => c.id)).toEqual(["b"]);
  });

  it("mixes ships and aircraft in one cluster", () => {
    const cands = [ship("s1", 200, 200), plane("p1", 208, 200), ship("s2", 200, 212), plane("p2", 400, 400)];
    const out = pickMarks(cands, { x: 201, y: 200 }, 18);
    expect(out.hit).toEqual(cands[0]);
    expect(out.also.map((c) => `${c.kind}:${c.id}`)).toEqual(["plane:p1", "ship:s2"]);
  });
});

describe("marksAround", () => {
  it("is at most ALSO_MAX long, nearest first", () => {
    const centre = ship("centre", 0, 0);
    const crowd = Array.from({ length: 20 }, (_, i) => ship(`n${i}`, i + 1, 0));
    const out = marksAround([centre, ...crowd], centre, 24);
    expect(ALSO_MAX).toBe(12);
    expect(out).toHaveLength(ALSO_MAX);
    expect(out.map((c) => c.id)).toEqual(crowd.slice(0, ALSO_MAX).map((c) => c.id));
  });

  it("applies each neighbour's own reach", () => {
    const centre = ship("centre", 0, 0);
    const big = ship("big", 30, 0, 40);
    const small = ship("small", 30, 0);
    expect(marksAround([centre, big, small], centre, 18).map((c) => c.id)).toEqual(["big"]);
  });

  it("is empty when the centre is not a point", () => {
    expect(marksAround([ship("a", 1, 1)], ship("c", Number.NaN, 0), 18)).toEqual([]);
  });
});
