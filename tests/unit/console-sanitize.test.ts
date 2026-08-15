import { expect, test } from "vitest";
import { sanitizeLayout } from "@/lib/console/sanitize";
import { createDefaultLayout, MAX_WIDGETS } from "@/lib/console/types";

test("sanitizeLayout returns null for unrecoverable input", () => {
  expect(sanitizeLayout(null)).toBeNull();
  expect(sanitizeLayout("nope")).toBeNull();
  expect(sanitizeLayout(42)).toBeNull();
  expect(sanitizeLayout({ stage: "map2d", widgets: [] })).toBeNull(); // no segments
  expect(sanitizeLayout({ segments: {}, stage: "nope", widgets: [] })).toBeNull(); // bad stage
  expect(sanitizeLayout({ segments: {}, stage: "map2d" })).toBeNull(); // widgets not an array
});

test("sanitizeLayout backfills all three segments and clamps sizes", () => {
  const out = sanitizeLayout({ segments: { left: { size: 99999, collapsed: false } }, stage: "map2d", widgets: [] });
  expect(out).not.toBeNull();
  expect(out!.segments.left).toBeDefined();
  expect(out!.segments.right).toBeDefined();
  expect(out!.segments.bottom).toBeDefined();
  expect(out!.segments.left.size).toBe(900); // clamped into [0,900]
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

test("sanitizeLayout backfills width=12 for legacy widgets and clamps out-of-range", () => {
  const out = sanitizeLayout({
    segments: {}, stage: "map2d",
    widgets: [
      { id: "a", type: "clock" },              // legacy, no width
      { id: "b", type: "clock", width: 1 },    // below min
      { id: "c", type: "clock", width: 99 },   // above max
      { id: "d", type: "clock", width: 6 },    // valid
    ],
  });
  const byId = Object.fromEntries(out!.widgets.map((w) => [w.id, w.width]));
  expect(byId.a).toBe(12);
  expect(byId.b).toBe(3);
  expect(byId.c).toBe(12);
  expect(byId.d).toBe(6);
});
