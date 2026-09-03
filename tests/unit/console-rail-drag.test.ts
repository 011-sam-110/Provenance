import { expect, test } from "vitest";
import { resolveDrop, type RailRect } from "@/components/shell/sources/useRailDrag";

const rects: RailRect[] = [
  {
    segment: "left",
    box: { x: 0, y: 0, w: 200, h: 500 },
    tiles: [
      { y: 0, h: 100 },
      { y: 100, h: 100 },
    ],
  },
  { segment: "right", box: { x: 800, y: 0, w: 200, h: 500 }, tiles: [] },
  { segment: "bottom", box: { x: 0, y: 500, w: 1000, h: 120 }, tiles: [] },
];

test("a point outside every rail resolves to null", () => {
  expect(resolveDrop({ x: 500, y: 250 }, rects)).toBeNull();
});

test("a point in an empty rail lands at index 0", () => {
  expect(resolveDrop({ x: 850, y: 200 }, rects)).toEqual({ segment: "right", index: 0 });
});

test("above the midpoint of the first tile inserts before it", () => {
  expect(resolveDrop({ x: 100, y: 40 }, rects)).toEqual({ segment: "left", index: 0 });
});

test("below the midpoint of the last tile appends", () => {
  expect(resolveDrop({ x: 100, y: 190 }, rects)).toEqual({ segment: "left", index: 2 });
});

test("between two tiles inserts between them", () => {
  expect(resolveDrop({ x: 100, y: 120 }, rects)).toEqual({ segment: "left", index: 1 });
});

// The three destinations the dashboard actually has. A drop can mean one of
// these or nothing — there is no fourth answer and no free rectangle.
test("every rail is reachable, and only the three exist", () => {
  expect(resolveDrop({ x: 100, y: 40 }, rects)?.segment).toBe("left");
  expect(resolveDrop({ x: 850, y: 200 }, rects)?.segment).toBe("right");
  expect(resolveDrop({ x: 500, y: 560 }, rects)?.segment).toBe("bottom");
  expect(new Set(rects.map((r) => r.segment))).toEqual(new Set(["left", "right", "bottom"]));
});

// A rail whose size is 0 is not rendered at all (ConsoleWorkspace returns null
// for it), so it is simply absent from the list rather than present and empty.
test("a rail that is not on screen cannot be dropped into", () => {
  const noBottom = rects.filter((r) => r.segment !== "bottom");
  expect(resolveDrop({ x: 500, y: 560 }, noBottom)).toBeNull();
});

// SOLO MODE IS THE CASE THAT BREAKS NAIVE MEASUREMENT. The slots stay mounted
// and are `hidden`, so getBoundingClientRect gives every one of them zeros. Left
// in, they are all "above the point" and the drop lands at the wrong index — or
// at index 0 for a rail that visibly holds four widgets.
test("zero-height tiles are ignored rather than counted", () => {
  const solo: RailRect[] = [
    {
      segment: "left",
      box: { x: 0, y: 0, w: 200, h: 500 },
      tiles: [
        { y: 0, h: 0 },
        { y: 0, h: 0 },
        { y: 0, h: 100 },
      ],
    },
  ];
  // One real tile: above its midpoint means before it, and that is index 0.
  expect(resolveDrop({ x: 100, y: 10 }, solo)).toEqual({ segment: "left", index: 0 });
  // Below it appends after the one real tile, not after all three.
  expect(resolveDrop({ x: 100, y: 90 }, solo)).toEqual({ segment: "left", index: 1 });
});

test("the edges of a rail count as inside it", () => {
  expect(resolveDrop({ x: 0, y: 0 }, rects)).toEqual({ segment: "left", index: 0 });
  expect(resolveDrop({ x: 200, y: 499 }, rects)?.segment).toBe("left");
});
