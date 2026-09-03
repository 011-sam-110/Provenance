// ── One-click sizes ─────────────────────────────────────────────────────────
// Dragging a widget's own bottom edge to a whole-row snap point is a fiddly way
// to say "make it taller". These are the same sizes as named destinations,
// offered in the ⋯ menu so resizing needs no aim at all. There is no width half
// of this file any more — a rail has one column, and a widget fills it.

export interface SizePreset<T> { label: string; hint: string; value: T }

export const HEIGHT_PRESETS: SizePreset<number>[] = [
  { label: "S", hint: "Short — a few rows", value: 180 },
  { label: "M", hint: "Medium", value: 280 },
  { label: "L", hint: "Tall", value: 420 },
  { label: "XL", hint: "Very tall", value: 620 },
];

/**
 * The preset a current value counts as, for marking the active button — or null
 * when the value is a hand-dragged size that matches none. Lighting up the
 * nearest button regardless would tell the user their widget is a size it is not,
 * so `tolerance` (in the value's own units) has to be opted into: pixel heights
 * want a few px of slack.
 */
export function activePreset<T extends number>(
  presets: SizePreset<T>[],
  value: number,
  tolerance = 0,
): T | null {
  if (presets.length === 0) return null;
  let best = presets[0];
  for (const p of presets) if (Math.abs(p.value - value) < Math.abs(best.value - value)) best = p;
  return Math.abs(best.value - value) <= tolerance ? best.value : null;
}

/** Slack for the pixel-height presets: a drag that lands within this reads as that size. */
export const HEIGHT_PRESET_TOLERANCE_PX = 8;
