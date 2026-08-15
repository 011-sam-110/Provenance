import { expect, test } from "vitest";
import { createDefaultLayout, MAX_WIDGETS } from "@/lib/console/types";
import {
  addWidget, removeWidget, moveWidget, setWidgetHeight, setWidgetWidth, setSegmentSize,
  setStage, widgetsInSegment, isAtCapacity,
} from "@/lib/console/reducers";
import { newInstanceId } from "@/lib/console/types";

test("default layout has three segments, a 2D stage, and no widgets", () => {
  const l = createDefaultLayout();
  expect(Object.keys(l.segments).sort()).toEqual(["bottom", "left", "right"]);
  expect(l.segments.left).toEqual({ size: 300, collapsed: false });
  expect(l.segments.bottom).toEqual({ size: 220, collapsed: false });
  expect(l.stage).toBe("map2d");
  expect(l.widgets).toEqual([]);
  // Deliberately asserts a FLOOR, not the exact number. This is a runaway-writer
  // backstop that has already been raised once (50 -> 200 for the Streets board);
  // pinning the literal made five tests fail for a change that broke nothing.
  expect(MAX_WIDGETS).toBeGreaterThanOrEqual(50);
});

test("addWidget appends to the emptiest segment and assigns dense order", () => {
  let l = createDefaultLayout();
  l = addWidget(l, "aviation", "a");
  l = addWidget(l, "events", "b", { segment: "left" });
  expect(widgetsInSegment(l, "left").map((w) => w.id)).toEqual(["a", "b"]);
  expect(widgetsInSegment(l, "left").map((w) => w.order)).toEqual([0, 1]);
});

test("addWidget is a no-op at capacity", () => {
  let l = createDefaultLayout();
  for (let i = 0; i < MAX_WIDGETS; i++) l = addWidget(l, "aviation", newInstanceId(i));
  expect(l.widgets.length).toBe(MAX_WIDGETS);
  expect(isAtCapacity(l)).toBe(true);
  const same = addWidget(l, "aviation", "overflow");
  expect(same).toBe(l); // identity — caller can detect rejection
});

test("moveWidget re-segments and densely reindexes order", () => {
  let l = createDefaultLayout();
  l = addWidget(l, "aviation", "a", { segment: "left" });
  l = addWidget(l, "events", "b", { segment: "left" });
  l = moveWidget(l, "a", "right", 0);
  expect(widgetsInSegment(l, "left").map((w) => w.id)).toEqual(["b"]);
  expect(widgetsInSegment(l, "right").map((w) => w.id)).toEqual(["a"]);
  expect(widgetsInSegment(l, "left")[0].order).toBe(0);
});

test("setWidgetHeight clamps; setSegmentSize clamps; setStage swaps", () => {
  let l = addWidget(createDefaultLayout(), "aviation", "a");
  l = setWidgetHeight(l, "a", 5);
  expect(l.widgets[0].height).toBe(120);
  l = setSegmentSize(l, "left", -10);
  expect(l.segments.left.size).toBe(0);
  l = setStage(l, "clock");
  expect(l.stage).toBe("clock");
});

test("removeWidget drops the instance and leaves others intact", () => {
  let l = addWidget(addWidget(createDefaultLayout(), "aviation", "a"), "events", "b");
  l = removeWidget(l, "a");
  expect(l.widgets.map((w) => w.id)).toEqual(["b"]);
});

test("add→remove→add keeps dense, unique order in the segment (regression)", () => {
  let l = createDefaultLayout();
  l = addWidget(l, "aviation", "a", { segment: "left" });
  l = addWidget(l, "events", "b", { segment: "left" });
  l = removeWidget(l, "a");
  l = addWidget(l, "cameras", "c", { segment: "left" });
  const seg = widgetsInSegment(l, "left");
  expect(seg.map((w) => w.id)).toEqual(["b", "c"]);
  expect(seg.map((w) => w.order)).toEqual([0, 1]); // dense + unique, no duplicate order
});

test("setWidgetHeight clamps the UPPER bound to 1200", () => {
  let l = addWidget(createDefaultLayout(), "aviation", "a");
  l = setWidgetHeight(l, "a", 9999);
  expect(l.widgets[0].height).toBe(1200);
});

test("setSegmentSize clamps the UPPER bound to 900", () => {
  let l = setSegmentSize(createDefaultLayout(), "left", 9999);
  expect(l.segments.left.size).toBe(900);
});

test("addWidget sets a default full width of 12", () => {
  const l = addWidget(createDefaultLayout(), "aviation", "a");
  expect(l.widgets[0].width).toBe(12);
});

test("setWidgetWidth clamps the span into [3,12]", () => {
  let l = addWidget(createDefaultLayout(), "aviation", "a");
  l = setWidgetWidth(l, "a", 6);
  expect(l.widgets[0].width).toBe(6);
  l = setWidgetWidth(l, "a", 1);
  expect(l.widgets[0].width).toBe(3);   // below min → 3
  l = setWidgetWidth(l, "a", 99);
  expect(l.widgets[0].width).toBe(12);  // above max → 12
});
