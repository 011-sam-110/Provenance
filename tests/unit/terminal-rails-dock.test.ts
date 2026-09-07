import { describe, expect, it } from "vitest";
import { dockSize, RAIL_MAX, WALL_MIN_PX } from "@/lib/terminal/rails";
import type { ShellLayout, WidgetInstance } from "@/lib/console/types";

const box = { w: 1440, h: 900 };

const layout = (widgets: WidgetInstance[], collapsed = false, size = 400): ShellLayout => ({
  mode: "wall",
  stage: "map2d",
  widgets,
  focusedWidgetId: null,
  segments: {
    left: { size: 320, collapsed: false },
    right: { size, collapsed },
    bottom: { size: 0, collapsed: false },
  },
});

const tile = (id: string): WidgetInstance => ({
  id, type: "camslot", segment: "left", order: 0, height: 280,
  collapsed: false, config: {}, rect: { x: 0, y: 0, w: 4, h: 6 },
});

describe("dockSize", () => {
  it("takes the whole board when the wall holds no tiles", () => {
    expect(dockSize(layout([]), box)).toBe(box.w);
  });

  it("returns to the normal clamp as soon as one tile exists", () => {
    expect(dockSize(layout([tile("a")]), box)).toBe(400);
  });

  it("still honours RAIL_MAX once tiles exist", () => {
    expect(dockSize(layout([tile("a")], false, 9999), box)).toBe(RAIL_MAX.right);
  });

  it("still leaves the wall its floor once tiles exist", () => {
    const narrow = { w: WALL_MIN_PX + 100, h: 900 };
    expect(dockSize(layout([tile("a")], false, 9999), narrow)).toBe(100);
  });

  it("respects a collapsed dock even on an empty wall — closed is closed", () => {
    expect(dockSize(layout([], true), box)).toBe(0);
  });

  it("does not apply the exception to a rails board", () => {
    const rails = { ...layout([]), mode: "rails" as const };
    expect(dockSize(rails, box)).not.toBe(box.w);
  });
});

// ConsoleWorkspace and WallWorkspace are React components, and this repo has
// no React testing library and runs vitest in the node environment — neither
// "an empty wall renders nothing" (WallWorkspace) nor "the dock splitter does
// not render in the full-bleed state" (ConsoleWorkspace's renderSplit) can be
// exercised from a unit test. What IS pure and testable is the numeric
// precondition that makes the splitter suppression necessary: the full-bleed
// dock width has to be capable of exceeding RAIL_MAX.right, because that is
// exactly what would make a rendered splitter report an aria-valuenow outside
// its own aria-valuemax on a control that dockSize has already stopped
// listening to.
// The numeric precondition behind that suppression IS covered above: "takes the
// whole board when the wall holds no tiles" pins the full-bleed width at 1440,
// which is already past RAIL_MAX.right (720) — the out-of-range aria-valuenow a
// rendered splitter would report. A separate assertion for it could only go red
// when that one does.
