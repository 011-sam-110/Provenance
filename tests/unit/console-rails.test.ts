import { describe, expect, it } from "vitest";
import { railsFromRects, type LegacyWidgetLike } from "@/lib/terminal/rails";
import type { GridRect, SegmentId } from "@/lib/console/types";

// Every persisted `tn.console.v1` layout, every `?c=` share link written by an
// older build, and all seven built-in presets speak either segment/order/height
// (never had a rect) or rect/stageRect (free-dragged). `railsFromRects` is the
// one place both migrate into rail placements — this is its migration contract,
// replacing the `fromLegacy` coverage in the deleted terminal-layout-grid.test.ts.

const w = (id: string, segment: SegmentId, order: number, height = 260, rect?: GridRect | null): LegacyWidgetLike =>
  ({ id, segment, order, height, rect });

const stage = (x: number, y: number, w2: number, h: number): GridRect => ({ x, y, w: w2, h });

describe("railsFromRects — rule 1: no rect, trust the stored segment", () => {
  it("keeps every widget in the segment it was authored in", () => {
    const out = railsFromRects([w("a", "left", 0), w("b", "right", 0), w("c", "bottom", 0)], stage(3, 0, 6, 14));
    expect(out.get("a")!.segment).toBe("left");
    expect(out.get("b")!.segment).toBe("right");
    expect(out.get("c")!.segment).toBe("bottom");
  });

  it("falls back to left for a corrupt/unknown segment", () => {
    const junk = { id: "x", segment: "diagonal" as unknown as SegmentId, order: 0, height: 240 };
    const out = railsFromRects([junk], null);
    expect(out.get("x")!.segment).toBe("left");
  });
});

describe("railsFromRects — rule 2: a rect plus a known stageRect derives from geometry", () => {
  const st = stage(4, 0, 4, 14); // stage occupies x in [4,8)

  it("a widget entirely left of the stage lands in the left rail", () => {
    const out = railsFromRects([w("a", "right", 0, 260, { x: 0, y: 0, w: 4, h: 6 })], st);
    expect(out.get("a")!.segment).toBe("left");
  });

  it("a widget entirely right of the stage lands in the right rail", () => {
    const out = railsFromRects([w("a", "left", 0, 260, { x: 8, y: 0, w: 4, h: 6 })], st);
    expect(out.get("a")!.segment).toBe("right");
  });

  it("a widget under or straddling the stage lands in the bottom rail", () => {
    const under = railsFromRects([w("a", "left", 0, 260, { x: 4, y: 14, w: 4, h: 6 })], st);
    expect(under.get("a")!.segment).toBe("bottom");
    const straddling = railsFromRects([w("b", "left", 0, 260, { x: 2, y: 0, w: 4, h: 6 })], st);
    expect(straddling.get("b")!.segment).toBe("bottom");
  });

  it("ignores the STORED segment entirely once geometry is available — the whole point of the rule", () => {
    // Claims "left" but sits to the right of the stage: geometry wins.
    const out = railsFromRects([w("a", "left", 0, 260, { x: 8, y: 0, w: 4, h: 6 })], st);
    expect(out.get("a")!.segment).toBe("right");
  });

  it("without a known stageRect, falls back to rule 1 even if a rect is present", () => {
    const out = railsFromRects([w("a", "right", 0, 260, { x: 0, y: 0, w: 4, h: 6 })], null);
    expect(out.get("a")!.segment).toBe("right");
  });
});

describe("railsFromRects — totality and determinism", () => {
  it("never drops a widget", () => {
    const input = Array.from({ length: 40 }, (_, i) =>
      w(`w${i}`, (["left", "right", "bottom"] as const)[i % 3], i, 240, i % 2 === 0 ? { x: i % 12, y: i, w: 2, h: 4 } : undefined));
    const out = railsFromRects(input, stage(4, 0, 4, 14));
    expect(out.size).toBe(40);
    for (const item of input) expect(out.has(item.id)).toBe(true);
  });

  it("is deterministic — the same input migrates identically every time", () => {
    const input = [
      w("a", "left", 0, 260, { x: 0, y: 0, w: 4, h: 6 }),
      w("b", "left", 1, 260, { x: 0, y: 6, w: 4, h: 6 }),
      w("c", "right", 0, 260, { x: 8, y: 0, w: 4, h: 6 }),
    ];
    const st = stage(4, 0, 4, 14);
    const first = railsFromRects(input, st);
    const second = railsFromRects(input, st);
    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it("gives every rail a densely reindexed order, 0..n-1, with no duplicates", () => {
    const input = [
      w("a", "left", 5), w("b", "left", 5), w("c", "left", 99),
      w("d", "right", 0),
    ];
    const out = railsFromRects(input, null);
    const leftOrders = ["a", "b", "c"].map((id) => out.get(id)!.order).sort((x, y) => x - y);
    expect(leftOrders).toEqual([0, 1, 2]);
    expect(out.get("d")!.order).toBe(0);
  });

  it("survives junk and NaN numbers without dropping or crashing", () => {
    const junk: LegacyWidgetLike = {
      id: "x", segment: "left", order: NaN, height: NaN,
      rect: { x: NaN, y: NaN, w: NaN, h: NaN },
    };
    const st = { x: NaN, y: 0, w: 4, h: 14 } as GridRect;
    const out = railsFromRects([junk], st);
    expect(out.size).toBe(1);
    const placed = out.get("x")!;
    expect(["left", "right", "bottom"]).toContain(placed.segment);
    expect(Number.isFinite(placed.order)).toBe(true);
    expect(placed.height).toBeGreaterThanOrEqual(120);
    expect(placed.height).toBeLessThanOrEqual(1200);
  });

  it("handles an empty widget list", () => {
    expect(railsFromRects([], stage(4, 0, 4, 14)).size).toBe(0);
  });
});

describe("railsFromRects — left stays left of right", () => {
  it("reading order within a rail is preserved (top to bottom, then left to right)", () => {
    const st = stage(4, 0, 4, 14);
    const input = [
      w("bottom-one", "left", 0, 260, { x: 0, y: 4, w: 4, h: 4 }),
      w("top-one", "left", 0, 260, { x: 0, y: 0, w: 4, h: 4 }),
    ];
    const out = railsFromRects(input, st);
    expect(out.get("top-one")!.order).toBeLessThan(out.get("bottom-one")!.order);
  });

  it("a widget seeded with no rect at all still keeps left distinct from right", () => {
    const out = railsFromRects([w("l", "left", 0), w("r", "right", 0)], null);
    expect(out.get("l")!.segment).toBe("left");
    expect(out.get("r")!.segment).toBe("right");
  });
});

describe("railsFromRects — height, px ⇄ rows, round trip", () => {
  it("converts rect.h (rows) into px at 25 = ROW_PX(24) + GAP_PX(1)", () => {
    const out = railsFromRects([w("a", "left", 0, 260, { x: 0, y: 0, w: 4, h: 10 })], stage(4, 0, 4, 14));
    expect(out.get("a")!.height).toBe(250); // 10 rows * 25
  });

  it("round-trips losslessly against setWidgetHeight's px -> rows conversion", () => {
    // setWidgetHeight's inverse: Math.round(px / 25). For any whole-row height,
    // rows -> px -> rows must return the same row count.
    for (const rows of [5, 8, 10, 22, 48]) {
      const px = rows * 25;
      const out = railsFromRects([w("a", "left", 0, 260, { x: 0, y: 0, w: 4, h: rows })], stage(4, 0, 4, 14));
      expect(out.get("a")!.height).toBe(px);
      expect(Math.round(out.get("a")!.height / 25)).toBe(rows);
    }
  });

  it("clamps the converted height into [120,1200]", () => {
    const tiny = railsFromRects([w("a", "left", 0, 260, { x: 0, y: 0, w: 4, h: 1 })], stage(4, 0, 4, 14));
    expect(tiny.get("a")!.height).toBe(120);
    const huge = railsFromRects([w("b", "left", 0, 260, { x: 0, y: 0, w: 4, h: 200 })], stage(4, 0, 4, 14));
    expect(huge.get("b")!.height).toBe(1200);
  });

  it("without a rect, falls back to the widget's own (already-clamped) height", () => {
    const out = railsFromRects([w("a", "left", 0, 400)], null);
    expect(out.get("a")!.height).toBe(400);
  });
});
