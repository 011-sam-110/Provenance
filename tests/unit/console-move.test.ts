import { describe, expect, it } from "vitest";
import { addWidget, widgetsInSegment } from "@/lib/console/reducers";
import { moveWidget } from "@/lib/console/reducers";
import { createDefaultLayout, type ShellLayout } from "@/lib/console/types";
import { nudgeTarget, otherSegments, sendToTarget, SEGMENT_LABEL, SEGMENT_ORDER } from "@/lib/console/move";
import {
  activePreset,
  HEIGHT_PRESETS,
  HEIGHT_PRESET_TOLERANCE_PX,
  WIDTH_PRESETS,
} from "@/lib/console/resize";

// Moving a widget used to require an HTML5 drag from an unmarked header to an
// invisible drop index. These cover the destinations behind the ⋯ → Move buttons
// that replaced it — specifically the ends, where "do nothing" and "wrap around"
// are both wrong and only one of them is obvious.

function board(): ShellLayout {
  let l = createDefaultLayout();
  l = addWidget(l, "a", "w1", { segment: "left" });
  l = addWidget(l, "b", "w2", { segment: "left" });
  l = addWidget(l, "c", "w3", { segment: "left" });
  l = addWidget(l, "d", "w4", { segment: "right" });
  return l;
}

describe("nudging a widget within its column", () => {
  it("moves one place up", () => {
    expect(nudgeTarget(board(), "w2", -1)).toEqual({ segment: "left", index: 0 });
  });

  it("moves one place down", () => {
    expect(nudgeTarget(board(), "w2", 1)).toEqual({ segment: "left", index: 2 });
  });

  it("refuses to move the first card up, rather than wrapping to the bottom", () => {
    expect(nudgeTarget(board(), "w1", -1)).toBeNull();
  });

  it("refuses to move the last card down", () => {
    expect(nudgeTarget(board(), "w3", 1)).toBeNull();
  });

  it("returns null for a widget that is not on the board", () => {
    expect(nudgeTarget(board(), "nope", 1)).toBeNull();
  });

  it("actually reorders when the target is applied", () => {
    const l = board();
    const t = nudgeTarget(l, "w3", -1)!;
    const after = moveWidget(l, "w3", t.segment, t.index);
    expect(widgetsInSegment(after, "left").map((w) => w.id)).toEqual(["w1", "w3", "w2"]);
  });
});

describe("sending a widget to another column", () => {
  it("lands at the end of the destination — where a new widget lands", () => {
    expect(sendToTarget(board(), "w1", "right")).toEqual({ segment: "right", index: 1 });
  });

  it("lands at index 0 in an empty column", () => {
    expect(sendToTarget(board(), "w1", "bottom")).toEqual({ segment: "bottom", index: 0 });
  });

  it("does nothing when the widget is already in that column", () => {
    expect(sendToTarget(board(), "w1", "left")).toBeNull();
  });

  it("offers exactly the columns the widget is not already in", () => {
    expect(otherSegments(board(), "w1")).toEqual(["right", "bottom"]);
    expect(otherSegments(board(), "w4")).toEqual(["left", "bottom"]);
  });

  it("really lands there when applied, and leaves the old column reindexed", () => {
    const l = board();
    const t = sendToTarget(l, "w1", "right")!;
    const after = moveWidget(l, "w1", t.segment, t.index);
    expect(widgetsInSegment(after, "right").map((w) => w.id)).toEqual(["w4", "w1"]);
    expect(widgetsInSegment(after, "left").map((w) => w.order)).toEqual([0, 1]);
  });

  it("names every segment it can offer", () => {
    for (const s of SEGMENT_ORDER) expect(SEGMENT_LABEL[s]).toBeTruthy();
  });
});

describe("one-click sizes", () => {
  it("marks the preset a value currently matches", () => {
    expect(activePreset(WIDTH_PRESETS, 6)).toBe(6);
    expect(activePreset(HEIGHT_PRESETS, 280, HEIGHT_PRESET_TOLERANCE_PX)).toBe(280);
  });

  it("claims no preset for a hand-dragged size that matches none", () => {
    // 9 columns is between ⅔ (8) and Full (12) — lighting up either would tell
    // the user their widget is a size it is not.
    expect(activePreset(WIDTH_PRESETS, 9)).toBeNull();
    expect(activePreset(HEIGHT_PRESETS, 350, HEIGHT_PRESET_TOLERANCE_PX)).toBeNull();
  });

  it("tolerates a near-miss from a drag, in pixels only", () => {
    expect(activePreset(HEIGHT_PRESETS, 285, HEIGHT_PRESET_TOLERANCE_PX)).toBe(280);
    // Column spans are discrete: 7 is not "half", however close it looks.
    expect(activePreset(WIDTH_PRESETS, 7)).toBeNull();
  });

  it("offers only spans the grid can actually render", () => {
    for (const p of WIDTH_PRESETS) {
      expect(p.value).toBeGreaterThanOrEqual(3);
      expect(p.value).toBeLessThanOrEqual(12);
    }
  });

  it("offers only heights the store will not clamp away", () => {
    for (const p of HEIGHT_PRESETS) {
      expect(p.value).toBeGreaterThanOrEqual(120);
      expect(p.value).toBeLessThanOrEqual(1200);
    }
  });
});
