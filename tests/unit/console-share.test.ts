import { expect, test } from "vitest";
import { encodeLayout, decodeLayout } from "@/lib/console/share";
import { BUILTIN_PRESETS } from "@/lib/console/presets";
import { createDefaultLayout, MAX_WIDGETS, type ShellLayout } from "@/lib/console/types";

test("encode→decode round-trips a layout", () => {
  // Was the Hazards board, which no longer exists. Streets is now the only built-in
  // with widgets on it, and a round-trip needs widgets to be worth anything.
  const l = BUILTIN_PRESETS.find((p) => p.id === "streets")!.build();
  const round = decodeLayout(encodeLayout(l));
  expect(round?.stage).toBe(l.stage);
  expect(round?.widgets.map((w) => w.type)).toEqual(l.widgets.map((w) => w.type));
});

test("decode returns null on garbage", () => {
  expect(decodeLayout("@@@notjson@@@")).toBeNull();
});

test("decode backfills missing segments through sanitize", () => {
  const partial = { segments: { left: { size: 320, collapsed: false } }, stage: "map2d", widgets: [] };
  const round = decodeLayout(encodeLayout(partial as unknown as ShellLayout));
  expect(round).not.toBeNull();
  expect(round!.segments.right).toBeDefined();
  expect(round!.segments.bottom).toBeDefined();
  expect(typeof round!.segments.right.size).toBe("number");
});

test("decode caps an oversized layout at MAX_WIDGETS", () => {
  const widgets = Array.from({ length: MAX_WIDGETS + 10 }, (_, i) => ({
    id: `w${i}`, type: "clock", segment: "left", order: i, height: 240, collapsed: false, config: {},
  }));
  const layout = { segments: createDefaultLayout().segments, stage: "map2d", widgets };
  const round = decodeLayout(encodeLayout(layout as unknown as ShellLayout));
  expect(round!.widgets.length).toBe(MAX_WIDGETS);
});

test("encode→decode round-trips a widget's segment, order and height", () => {
  const l = decodeLayout(encodeLayout({
    segments: createDefaultLayout().segments, stage: "map2d",
    widgets: [{ id: "a", type: "clock", segment: "right", order: 0, height: 420, collapsed: false, config: {} }],
  } as unknown as ShellLayout));
  expect(l!.widgets[0].segment).toBe("right");
  expect(l!.widgets[0].height).toBe(420);
});

// Guards the migration in lib/terminal/rails.ts (railsFromRects), which every
// `?c=` link minted before rails shipped funnels through. A payload like this —
// a stageRect plus widgets carrying their old grid `rect`, all claiming the
// stale segment "bottom" from before free-dragging made that field untrustworthy
// — is exactly what such a link looks like.
test("decode migrates a real rect-bearing ?c= payload without losing a widget, and the rails it derives are valid", () => {
  const stageRect = { x: 4, y: 0, w: 4, h: 14 };
  const legacy = {
    segments: createDefaultLayout().segments,
    stage: "map2d",
    stageRect,
    widgets: [
      { id: "a", type: "clock", segment: "bottom", order: 0, width: 12, height: 260, rect: { x: 0, y: 0, w: 4, h: 6 }, collapsed: false, config: {} },
      { id: "b", type: "aviation", segment: "bottom", order: 1, width: 12, height: 260, rect: { x: 8, y: 0, w: 4, h: 6 }, collapsed: false, config: {} },
      { id: "c", type: "events", segment: "bottom", order: 2, width: 12, height: 520, rect: { x: 0, y: 14, w: 12, h: 8 }, collapsed: false, config: {} },
    ],
  };
  const round = decodeLayout(encodeLayout(legacy as unknown as ShellLayout));
  expect(round).not.toBeNull();
  expect(round!.widgets.length).toBe(3); // no widget lost

  // Derived from GEOMETRY, not the stale "bottom" every widget above claims.
  const byId = Object.fromEntries(round!.widgets.map((w) => [w.id, w]));
  expect(byId.a.segment).toBe("left");   // entirely left of the stage
  expect(byId.b.segment).toBe("right");  // entirely right of the stage
  expect(byId.c.segment).toBe("bottom"); // spans underneath it

  for (const seg of ["left", "right", "bottom"] as const) {
    const inRail = round!.widgets.filter((w) => w.segment === seg).sort((x, y) => x.order - y.order);
    expect(inRail.map((w) => w.order)).toEqual(inRail.map((_, i) => i)); // dense 0..n-1
  }
});
