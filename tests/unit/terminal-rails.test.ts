import { describe, expect, it, test } from "vitest";
import {
  RAIL_MIN, RAIL_MAX, STAGE_MIN_PX,
  clampRailSize, effectiveRailSize, railSizeFromPointer, railVars, splitSpan,
} from "@/lib/terminal/rails";
import { createDefaultLayout, type SegmentId, type ShellLayout, type WidgetInstance } from "@/lib/console/types";

// This replaces tests/unit/terminal-layout-grid.test.ts, deleted alongside the
// free grid it tested. The randomised idiom is the same — fixed seeds so a
// failure is reproducible — pointed at the thing that replaced dragging a card:
// dragging a rail's splitter.

const SEGMENTS: SegmentId[] = ["left", "right", "bottom"];

function widget(segment: SegmentId, id: string): WidgetInstance {
  return { id, type: "clock", segment, order: 0, height: 240, collapsed: false, config: {} };
}

/** A layout with widgets in exactly the given rails — the others are empty,
 *  which is the state `effectiveRailSize` must report as 0 regardless of what
 *  `segments[*].size` says. */
function layoutWithWidgetsIn(segs: readonly SegmentId[]): ShellLayout {
  const l = createDefaultLayout();
  return { ...l, widgets: segs.map((s, i) => widget(s, `w${i}`)) };
}

/** Deterministic PRNG — Math.random would make a failure unreproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function allSizes(l: ShellLayout, container: { w: number; h: number }, solo: boolean) {
  return {
    left: effectiveRailSize(l, "left", container, solo),
    right: effectiveRailSize(l, "right", container, solo),
    bottom: effectiveRailSize(l, "bottom", container, solo),
  };
}

/** The engine's real contract, asserted after every simulated drag. */
function expectValid(sizes: Record<SegmentId, number>, l: ShellLayout, containerW: number) {
  for (const seg of SEGMENTS) {
    const v = sizes[seg];
    const empty = !l.widgets.some((w) => w.segment === seg);
    if (empty) {
      expect(v, `${seg} is empty but reports ${v}`).toBe(0);
      continue;
    }
    const inRange = v >= RAIL_MIN[seg] && v <= RAIL_MAX[seg];
    expect(v === 0 || inRange, `${seg} size ${v} is neither 0 nor in [${RAIL_MIN[seg]},${RAIL_MAX[seg]}]`).toBe(true);
  }
  expect(sizes.left + sizes.right).toBeLessThanOrEqual(Math.max(0, containerW - STAGE_MIN_PX));
}

describe("rail sizes — randomised splitter drags", () => {
  for (const seed of [1, 7, 42, 1337, 90210]) {
    it(`holds every invariant over 200 drags (seed ${seed})`, () => {
      const rand = rng(seed);
      // Which rails carry widgets is randomised too — an empty rail must read 0
      // however hard its splitter is dragged.
      const present = SEGMENTS.filter(() => rand() > 0.35);
      let l = layoutWithWidgetsIn(present.length > 0 ? present : ["left"]);

      for (let n = 0; n < 200; n++) {
        const rail = SEGMENTS[Math.floor(rand() * SEGMENTS.length)];
        const containerW = 800 + Math.floor(rand() * 1600); // 800..2400
        const containerH = 500 + Math.floor(rand() * 800); // 500..1300
        const container = { w: containerW, h: containerH };
        const box = { left: 0, right: containerW, top: 0, bottom: containerH };
        // Pointer wanders outside the box too, so both an undershoot (drag past
        // the near edge) and an overshoot (drag past the far edge) get exercised.
        const pointer = {
          x: Math.floor(rand() * (containerW + 800)) - 400,
          y: Math.floor(rand() * (containerH + 800)) - 400,
        };

        const size = railSizeFromPointer(rail, pointer, box);
        l = { ...l, segments: { ...l.segments, [rail]: { ...l.segments[rail], size } } };

        expectValid(allSizes(l, container, false), l, containerW);
        // Solo zeroes all three, unconditionally — no widget count, no size, no
        // collapse state changes that.
        expect(allSizes(l, container, true)).toEqual({ left: 0, right: 0, bottom: 0 });
      }
    });
  }
});

describe("clampRailSize", () => {
  it("clamps into the rail's own [min,max]", () => {
    expect(clampRailSize("left", 10)).toBe(RAIL_MIN.left);
    expect(clampRailSize("left", 9999)).toBe(RAIL_MAX.left);
    expect(clampRailSize("bottom", 0)).toBe(RAIL_MIN.bottom);
  });
  it("rounds and survives junk numbers", () => {
    expect(clampRailSize("left", 300.6)).toBe(301);
    expect(clampRailSize("left", NaN)).toBe(RAIL_MIN.left);
    expect(clampRailSize("left", Infinity)).toBe(RAIL_MAX.left);
  });
  it("rails have independent ranges", () => {
    expect(RAIL_MIN.bottom).not.toBe(RAIL_MIN.left);
    expect(RAIL_MAX.bottom).not.toBe(RAIL_MAX.left);
  });
});

describe("effectiveRailSize", () => {
  const container = { w: 1440, h: 900 };

  it("is 0 for a rail with no widgets, however its size is set", () => {
    const l = layoutWithWidgetsIn(["left"]);
    expect(effectiveRailSize(l, "right", container, false)).toBe(0);
    expect(effectiveRailSize(l, "bottom", container, false)).toBe(0);
  });

  it("is 0 for a user-collapsed rail even with widgets in it", () => {
    let l = layoutWithWidgetsIn(["left"]);
    l = { ...l, segments: { ...l.segments, left: { ...l.segments.left, collapsed: true } } };
    expect(effectiveRailSize(l, "left", container, false)).toBe(0);
  });

  // Replaces the regex-over-source-text assertion this behaviour used to be
  // pinned by (stage-solo.test.ts's COLS-literal check, which died with the
  // grid it was reading). This is the behavioural claim that check stood in
  // for: solo hides every rail, full stop.
  it("solo zeroes all three rails regardless of contents", () => {
    const l = layoutWithWidgetsIn(["left", "right", "bottom"]);
    for (const seg of SEGMENTS) expect(effectiveRailSize(l, seg, container, true)).toBe(0);
  });

  function withSizes(left: number, right: number): ShellLayout {
    let l = layoutWithWidgetsIn(["left", "right"]);
    l = {
      ...l,
      segments: {
        ...l.segments,
        left: { ...l.segments.left, size: left },
        right: { ...l.segments.right, size: right },
      },
    };
    return l;
  }

  it("shrinks the wider of left/right first, leaving the narrower one untouched", () => {
    const l = withSizes(RAIL_MAX.left, 250);
    const container = { w: 1200, h: 900 }; // budget = 1200 - 360 = 840
    const left = effectiveRailSize(l, "left", container, false);
    const right = effectiveRailSize(l, "right", container, false);
    expect(left + right).toBe(840);
    expect(right).toBe(250); // the narrower ask is honoured in full
    expect(left).toBe(840 - 250);
    expect(left).toBeGreaterThanOrEqual(RAIL_MIN.left);
  });

  it("zeroes the wider rail outright when even its minimum will not fit", () => {
    const l = withSizes(RAIL_MAX.left, 250);
    const container = { w: 700, h: 900 }; // budget = 340 < RAIL_MIN.left + 250
    const left = effectiveRailSize(l, "left", container, false);
    const right = effectiveRailSize(l, "right", container, false);
    // Left cannot fit even at its floor (220) alongside 250 in a 340px budget,
    // so it goes to exactly 0 rather than sitting below its own minimum.
    expect(left).toBe(0);
    expect(right).toBe(250);
    expect(left + right).toBeLessThanOrEqual(container.w - STAGE_MIN_PX);
  });

  it("bottom does not compete with left/right for width", () => {
    const l = layoutWithWidgetsIn(["left", "right", "bottom"]);
    const before = effectiveRailSize(l, "bottom", { w: 1440, h: 900 }, false);
    const after = effectiveRailSize(l, "bottom", { w: 800, h: 900 }, false);
    expect(before).toBe(after);
  });
});

describe("railSizeFromPointer", () => {
  const box = { left: 0, right: 1200, top: 0, bottom: 800 };

  it("left rail grows from the box's left edge", () => {
    expect(railSizeFromPointer("left", { x: 300, y: 0 }, box)).toBe(300);
  });
  it("right rail grows from the box's right edge", () => {
    expect(railSizeFromPointer("right", { x: 900, y: 0 }, box)).toBe(300);
  });
  it("bottom rail grows from the box's bottom edge", () => {
    expect(railSizeFromPointer("bottom", { x: 0, y: 600 }, box)).toBe(200);
  });
  it("clamps a drag past either end of the range", () => {
    expect(railSizeFromPointer("left", { x: -500, y: 0 }, box)).toBe(RAIL_MIN.left);
    expect(railSizeFromPointer("left", { x: 5000, y: 0 }, box)).toBe(RAIL_MAX.left);
  });
});

describe("railVars", () => {
  it("emits the three CSS custom properties as px strings", () => {
    const l = layoutWithWidgetsIn(["left"]);
    const vars = railVars(l, { w: 1440, h: 900 }, false);
    expect(vars["--tn-lw"]).toMatch(/^\d+px$/);
    expect(vars["--tn-rw"]).toBe("0px");
    expect(vars["--tn-bh"]).toBe("0px");
  });
  it("solo collapses every rail var to 0px", () => {
    const l = layoutWithWidgetsIn(["left", "right", "bottom"]);
    const vars = railVars(l, { w: 1440, h: 900 }, true);
    expect(vars).toEqual({ "--tn-lw": "0px", "--tn-rw": "0px", "--tn-bh": "0px" });
  });
});

describe("splitSpan", () => {
  test("splits exactly, absorbing rounding drift on the largest item", () => {
    const out = splitSpan([1, 1, 1], 10, 1);
    expect(out.reduce((a, b) => a + b, 0)).toBe(10);
  });
  test("never drops below the minimum", () => {
    const out = splitSpan([1, 1, 1, 1, 1, 1, 1, 1], 4, 1);
    for (const v of out) expect(v).toBeGreaterThanOrEqual(1);
  });
  test("treats non-positive or non-finite weights as 1", () => {
    const out = splitSpan([0, -5, NaN, 1], 20, 1);
    expect(out).toHaveLength(4);
    expect(out.every((v) => Number.isFinite(v) && v >= 1)).toBe(true);
  });
  test("returns an empty split for an empty input", () => {
    expect(splitSpan([], 10, 1)).toEqual([]);
  });
});
