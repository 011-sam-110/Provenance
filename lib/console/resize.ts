export const WIDGET_COLS = 12;
export const MIN_WIDGET_SPAN = 3;

/** Round a raw column count to a valid whole span, clamped to [MIN_WIDGET_SPAN, 12]. */
export function clampSpan(n: number): number {
  const r = Math.round(n);
  if (!Number.isFinite(r)) return WIDGET_COLS;
  return Math.max(MIN_WIDGET_SPAN, Math.min(WIDGET_COLS, r));
}

/** Snap a right-edge drag to a whole column span.
 *  slotLeft = the widget slot's left px; segWidth = the segment's content-box width px. */
export function spanFromPointer(args: { pointerX: number; slotLeft: number; segWidth: number }): number {
  if (!(args.segWidth > 0)) return WIDGET_COLS;
  const dragged = args.pointerX - args.slotLeft;
  return clampSpan((dragged / args.segWidth) * WIDGET_COLS);
}

// ── One-click sizes ─────────────────────────────────────────────────────────
// Dragging a 6px edge to a whole-column snap point is a fiddly way to say "half
// width". These are the same sizes as named destinations, offered in the widget
// menu so resizing needs no aim at all. The drag handles still work — they are
// just no longer the only way.

export interface SizePreset<T> { label: string; hint: string; value: T }

export const WIDTH_PRESETS: SizePreset<number>[] = [
  { label: "⅓", hint: "A third of the column", value: 4 },
  { label: "½", hint: "Half the column", value: 6 },
  { label: "⅔", hint: "Two thirds of the column", value: 8 },
  { label: "Full", hint: "Full column width", value: 12 },
];

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
 * so `tolerance` (in the value's own units) has to be opted into: column spans
 * are discrete and want an exact match, pixel heights want a few px of slack.
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

export interface Box { top: number; bottom: number; left: number; right: number }

/** Reading-order insert index for a drop over a wrapping grid of cards. */
export function dropIndex(p: { x: number; y: number }, rects: Box[]): number {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const beforeRow = p.y < r.top;
    const inRow = p.y >= r.top && p.y <= r.bottom;
    const cx = (r.left + r.right) / 2;
    if (beforeRow || (inRow && p.x < cx)) return i;
  }
  return rects.length;
}
