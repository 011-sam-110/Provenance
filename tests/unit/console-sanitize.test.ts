import { expect, test } from "vitest";
import { sanitizeLayout } from "@/lib/console/sanitize";
import { createDefaultLayout, MAX_WIDGETS } from "@/lib/console/types";
import { RAIL_MAX } from "@/lib/terminal/rails";

test("sanitizeLayout returns null for unrecoverable input", () => {
  expect(sanitizeLayout(null)).toBeNull();
  expect(sanitizeLayout("nope")).toBeNull();
  expect(sanitizeLayout(42)).toBeNull();
  expect(sanitizeLayout({ stage: "map2d", widgets: [] })).toBeNull(); // no segments
  expect(sanitizeLayout({ segments: {}, stage: "nope", widgets: [] })).toBeNull(); // bad stage
  expect(sanitizeLayout({ segments: {}, stage: "map2d" })).toBeNull(); // widgets not an array
});

test("sanitizeLayout backfills all three segments and clamps sizes per rail (not the old flat [0,900])", () => {
  const out = sanitizeLayout({ segments: { left: { size: 99999, collapsed: false } }, stage: "map2d", widgets: [] });
  expect(out).not.toBeNull();
  expect(out!.segments.left).toBeDefined();
  expect(out!.segments.right).toBeDefined();
  expect(out!.segments.bottom).toBeDefined();
  expect(out!.segments.left.size).toBe(RAIL_MAX.left); // clamped via clampRailSize
});

test("sanitizeLayout drops widgets missing id/type and defaults config to {}", () => {
  const out = sanitizeLayout({
    segments: createDefaultLayout().segments,
    stage: "map2d",
    widgets: [
      { id: "ok", type: "clock" },                 // valid; missing config → {}
      { type: "clock" },                           // missing id → dropped
      { id: "noType" },                            // missing type → dropped
      { id: "badcfg", type: "clock", config: 5 },  // non-object config → {}
      "garbage",                                   // not an object → dropped
    ],
  });
  expect(out!.widgets.length).toBe(2);
  expect(out!.widgets[0].id).toBe("ok");
  expect(out!.widgets[0].config).toEqual({});
  expect(out!.widgets[1].config).toEqual({});
});

test("sanitizeLayout clamps widget height into [120,1200] and caps count", () => {
  const tall = sanitizeLayout({
    segments: createDefaultLayout().segments, stage: "map2d",
    widgets: [{ id: "a", type: "clock", height: 99999 }, { id: "b", type: "clock", height: 1 }],
  });
  expect(tall!.widgets[0].height).toBe(1200);
  expect(tall!.widgets[1].height).toBe(120);

  const many = sanitizeLayout({
    segments: createDefaultLayout().segments, stage: "map2d",
    widgets: Array.from({ length: MAX_WIDGETS + 10 }, (_, i) => ({ id: `w${i}`, type: "clock" })),
  });
  expect(many!.widgets.length).toBe(MAX_WIDGETS);
});

test("sanitizeLayout falls back an unknown/missing segment to left, and densely reindexes order per rail", () => {
  const out = sanitizeLayout({
    segments: {}, stage: "map2d",
    widgets: [
      { id: "a", type: "clock" },                                   // no segment -> left
      { id: "b", type: "clock", segment: "not-a-rail" },             // bogus -> left
      { id: "c", type: "clock", segment: "left", order: 5 },
      { id: "d", type: "clock", segment: "left", order: 5 },         // duplicate order
      { id: "e", type: "clock", segment: "right", order: 0 },
    ],
  });
  const bySegment = (seg: string) =>
    out!.widgets.filter((w) => w.segment === seg).sort((x, y) => x.order - y.order);

  expect(bySegment("left").map((w) => w.id).sort()).toEqual(["a", "b", "c", "d"]);
  expect(bySegment("left").map((w) => w.order)).toEqual([0, 1, 2, 3]); // dense, no duplicates
  expect(bySegment("right").map((w) => w.order)).toEqual([0]);
  expect(out!.widgets.every((w) => (["left", "right", "bottom"] as const).includes(w.segment))).toBe(true);
});
