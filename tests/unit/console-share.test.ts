import { expect, test } from "vitest";
import { encodeLayout, decodeLayout } from "@/lib/console/share";
import { BUILTIN_PRESETS } from "@/lib/console/presets";
import { createDefaultLayout, MAX_WIDGETS, type ShellLayout } from "@/lib/console/types";

test("encode→decode round-trips a layout", () => {
  const l = BUILTIN_PRESETS.find((p) => p.id === "earth")!.build();
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

test("encode→decode round-trips widget width", () => {
  const l = decodeLayout(encodeLayout({
    segments: createDefaultLayout().segments, stage: "map2d",
    widgets: [{ id: "a", type: "clock", segment: "left", order: 0, width: 6, height: 240, collapsed: false, config: {} }],
  } as unknown as ShellLayout));
  expect(l!.widgets[0].width).toBe(6);
});
