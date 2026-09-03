import { expect, test } from "vitest";
import { activePreset, HEIGHT_PRESETS, HEIGHT_PRESET_TOLERANCE_PX } from "@/lib/console/resize";

// resize.ts used to also hold the WIDTH half of this — WIDGET_COLS, clampSpan,
// spanFromPointer, WIDTH_PRESETS, dropIndex — deleted along with the free grid:
// a rail has one column, and a widget fills it, so there is no width to offer a
// preset for any more. Only the one-click HEIGHT sizes survive.

test("marks the preset a value currently matches", () => {
  expect(activePreset(HEIGHT_PRESETS, 280, HEIGHT_PRESET_TOLERANCE_PX)).toBe(280);
});

test("claims no preset for a hand-dragged size that matches none", () => {
  expect(activePreset(HEIGHT_PRESETS, 350, HEIGHT_PRESET_TOLERANCE_PX)).toBeNull();
});

test("tolerates a near-miss from a drag, within the pixel tolerance", () => {
  expect(activePreset(HEIGHT_PRESETS, 285, HEIGHT_PRESET_TOLERANCE_PX)).toBe(280);
  expect(activePreset(HEIGHT_PRESETS, 280 + HEIGHT_PRESET_TOLERANCE_PX + 1, HEIGHT_PRESET_TOLERANCE_PX)).not.toBe(280);
});

test("offers only heights the reducer will not clamp away", () => {
  for (const p of HEIGHT_PRESETS) {
    expect(p.value).toBeGreaterThanOrEqual(120);
    expect(p.value).toBeLessThanOrEqual(1200);
  }
});

test("with no tolerance given, only an exact match counts", () => {
  expect(activePreset(HEIGHT_PRESETS, 280)).toBe(280);
  expect(activePreset(HEIGHT_PRESETS, 281)).toBeNull();
});

test("returns null for an empty preset list rather than throwing", () => {
  expect(activePreset([], 280)).toBeNull();
});
