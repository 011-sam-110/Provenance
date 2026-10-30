import { describe, expect, it } from "vitest";
import { ALSO_MAX, PICK_RADIUS, marksAround, pickMarks, runsInside, type PickCandidate } from "@/lib/eye/pick";

const ship = (id: string, x: number, y: number, r?: number): PickCandidate => ({ id, kind: "ship", x, y, ...(r != null ? { r } : {}) });
const plane = (id: string, x: number, y: number, r?: number): PickCandidate => ({ id, kind: "plane", x, y, ...(r != null ? { r } : {}) });
/** A road notice: TfL's point, and the street lines on screen as runs of points. */
const road = (id: string, x: number, y: number, ...path: [number, number][][]): PickCandidate => ({
  id,
  kind: "road",
  x,
  y,
  ...(path.length > 0 ? { path: path.map((run) => run.map(([px, py]) => ({ x: px, y: py }))) } : {}),
});

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

describe("a road notice is hit along its street, not only at its point", () => {
  // A street across the screen at y 100, from x 0 to 400; TfL's point is at its middle.
  const street = road("works", 200, 100, [[0, 100], [400, 100]]);

  it("measures to a stretch of the line between two vertices, not only to a vertex", () => {
    // 100 px from either vertex and from the point, but only 10 px from the line.
    expect(pickMarks([street], { x: 100, y: 110 }, 18).hit?.id).toBe("works");
    expect(pickMarks([street], { x: 100, y: 118 }, 18).hit?.id).toBe("works");
    expect(pickMarks([street], { x: 100, y: 119 }, 18).hit).toBeNull();
    // Past the end of the line it is the distance to the end vertex.
    expect(pickMarks([street], { x: 415, y: 100 }, 18).hit?.id).toBe("works");
    expect(pickMarks([street], { x: 419, y: 100 }, 18).hit).toBeNull();
  });

  it("still answers for its own point when it has no line", () => {
    const ring = road("ring", 50, 50);
    expect(pickMarks([ring], { x: 60, y: 50 }, 18).hit?.id).toBe("ring");
    expect(pickMarks([ring], { x: 70, y: 50 }, 18).hit).toBeNull();
  });

  it("uses the thumb's wider reach along a line too", () => {
    expect(pickMarks([street], { x: 100, y: 124 }, 24).hit?.id).toBe("works");
    expect(pickMarks([street], { x: 100, y: 125 }, 24).hit).toBeNull();
  });

  it("measures a run that bends, and a lone vertex, and skips a point that is not finite", () => {
    const bent = road("bent", 0, 0, [[0, 0], [100, 0], [100, 100]], [[300, 300]]);
    expect(pickMarks([bent], { x: 110, y: 60 }, 18).hit?.id).toBe("bent");
    expect(pickMarks([bent], { x: 308, y: 300 }, 18).hit?.id).toBe("bent");
    const holes: PickCandidate = { id: "holes", kind: "road", x: Number.NaN, y: Number.NaN, path: [[{ x: Number.NaN, y: 5 }, { x: 10, y: 10 }, { x: 20, y: 10 }]] };
    expect(pickMarks([holes], { x: 15, y: 12 }, 18).hit?.id).toBe("holes");
    const empty: PickCandidate = { id: "none", kind: "road", x: Number.NaN, y: Number.NaN, path: [] };
    expect(pickMarks([empty], { x: 0, y: 0 }, 18).hit).toBeNull();
  });

  it("picks the nearest of two roads when only roads are in reach", () => {
    const a = road("a", 0, 0, [[0, 100], [400, 100]]);
    const b = road("b", 0, 0, [[0, 108], [400, 108]]);
    expect(pickMarks([a, b], { x: 200, y: 105 }, 18).hit?.id).toBe("b");
    expect(pickMarks([b, a], { x: 200, y: 101 }, 18).hit?.id).toBe("a");
  });

  it("lets a vessel or an aircraft win a click they share, even when the road is nearer", () => {
    const boat = ship("boat", 200, 112);
    const jet = plane("jet", 200, 112);
    // The click is on the street (distance 0), the boat is 12 px away.
    const byBoat = pickMarks([street, boat], { x: 200, y: 100 }, 18);
    expect(byBoat.hit?.id).toBe("boat");
    expect(pickMarks([street, jet], { x: 200, y: 100 }, 18).hit?.id).toBe("jet");
    // The street is still listed beside it.
    expect(byBoat.also.map((c) => c.id)).toEqual(["works"]);
    // Without the boat the street is the hit.
    expect(pickMarks([street, ship("far", 200, 300)], { x: 200, y: 100 }, 18).hit?.id).toBe("works");
  });

  it("lists a road under the click but out of reach of the hit's own point", () => {
    // The boat's point is 30 px from the street, out of its own reach, but the click is
    // 14 px from the boat and 16 px from the street, and 18 px reaches both.
    const boat = ship("boat", 200, 150);
    const street = road("street", 0, 0, [[0, 120], [400, 120]]);
    const out = pickMarks([boat, street], { x: 205, y: 136 }, 18);
    expect(out.hit?.id).toBe("boat");
    expect(marksAround([boat, street], boat, 18)).toEqual([]);
    expect(out.also.map((c) => c.id)).toEqual(["street"]);
  });

  it("puts the hit's neighbours first, then the others under the click, nearest the click first", () => {
    const hit = ship("hit", 100, 100);
    const near = ship("near", 100, 108);
    const lineA = road("lineA", 0, 0, [[0, 130], [400, 130]]);
    const lineB = road("lineB", 0, 0, [[0, 92], [400, 92]]);
    // The click is at (100, 112), so "near" (4 px) is the hit. Around ITS point (100, 108):
    // "hit" is 8 px off and lineB 16 px, but lineA 22 px (out of reach). lineA is 18 px
    // from the CLICK, in reach, so it follows the hit's own neighbours.
    const out = pickMarks([lineA, lineB, hit, near], { x: 100, y: 112 }, 18);
    expect(out.hit?.id).toBe("near");
    expect(out.also.map((c) => c.id)).toEqual(["hit", "lineB", "lineA"]);
  });

  it("caps the list at ALSO_MAX", () => {
    const hit = ship("hit", 200, 100);
    const lines = Array.from({ length: 20 }, (_, i) => road(`r${i}`, 0, 0, [[0, 100 + (i % 5)], [400, 100 + (i % 5)]]));
    const out = pickMarks([hit, ...lines], { x: 200, y: 100 }, 18);
    expect(out.hit?.id).toBe("hit");
    expect(out.also).toHaveLength(ALSO_MAX);
  });

  it("marksAround measures from a road's own point, and to other roads' lines", () => {
    const centre = road("centre", 100, 100);
    const line = road("line", 0, 0, [[0, 110], [400, 110]]);
    const boat = ship("boat", 100, 112);
    const away = ship("away", 100, 200);
    expect(marksAround([centre, line, boat, away], centre, 18).map((c) => c.id)).toEqual(["line", "boat"]);
  });
});

describe("runsInside", () => {
  const box = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const pts = (...p: [number, number][]) => p.map(([x, y]) => ({ x, y }));

  it("keeps a line that is wholly inside as one run", () => {
    expect(runsInside(pts([10, 10], [50, 50], [90, 90]), box)).toEqual([pts([10, 10], [50, 50], [90, 90])]);
  });

  it("splits at the box edge into the runs that are inside, and drops the part outside", () => {
    const line = pts([10, 10], [20, 20], [150, 20], [160, 30], [30, 40], [40, 50]);
    expect(runsInside(line, box)).toEqual([pts([10, 10], [20, 20]), pts([30, 40], [40, 50])]);
  });

  it("counts the edge as inside", () => {
    expect(runsInside(pts([0, 0], [100, 100]), box)).toEqual([pts([0, 0], [100, 100])]);
  });

  it("drops a run of one point", () => {
    expect(runsInside(pts([10, 10], [200, 200], [300, 10], [50, 50], [60, 60], [400, 400], [70, 70]), box)).toEqual([pts([50, 50], [60, 60])]);
    expect(runsInside(pts([10, 10]), box)).toEqual([]);
  });

  it("drops a point that is not finite, and splits the line there", () => {
    const line = [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: Number.NaN, y: 30 }, { x: 40, y: 40 }, { x: 50, y: Number.POSITIVE_INFINITY }, { x: 60, y: 60 }, { x: 70, y: 70 }];
    expect(runsInside(line, box)).toEqual([pts([10, 10], [20, 20]), pts([60, 60], [70, 70])]);
  });

  it("gives nothing for an empty line or one wholly outside", () => {
    expect(runsInside([], box)).toEqual([]);
    expect(runsInside(pts([-5, -5], [200, 200]), box)).toEqual([]);
  });

  it("keeps a street from crossing the screen to a point mirrored from behind the camera", () => {
    // map.project() puts a point behind the camera above the horizon: here far outside
    // the padded box, so the segment to it is never offered to a click.
    const street = pts([20, 20], [30, 30], [40, -4000], [50, 50]);
    const runs = runsInside(street, box);
    expect(runs).toEqual([pts([20, 20], [30, 30])]);
    const cand: PickCandidate = { id: "r", kind: "road", x: 25, y: 25, path: runs };
    expect(pickMarks([cand], { x: 40, y: 50 }, 18).hit).toBeNull();
  });
});
