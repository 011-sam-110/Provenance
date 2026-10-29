// The pins on the God's eye view's bar, the pure half: where a dragged source would land,
// and how a pin moves. components/eye/EyeSources.tsx does the pointer and the DOM; the
// order lives in lib/eye/sources.ts (the reducer). Pinned by tests/unit/eye-pins.test.ts.

/** The horizontal extent of one pin on the bar, in the same pixels as the pointer. */
export interface PinRect {
  left: number;
  right: number;
}

/**
 * The slot a dragged source would take among the pins, by the midpoint rule: it goes
 * after every pin whose middle the pointer has passed. `draggedIndex` is the dragged
 * pin's own place when a pin is being reordered; it is ignored, so the answer is a place
 * in the list WITHOUT it (what `movePin` takes). With no pins the slot is 0.
 */
export function dropIndex(x: number, rects: readonly PinRect[], draggedIndex?: number): number {
  let slot = 0;
  rects.forEach((r, i) => {
    if (i === draggedIndex) return;
    if (x > (r.left + r.right) / 2) slot += 1;
  });
  return slot;
}

/**
 * The pins with `id` taken out and put back at `to`, a place in the list without it.
 * Out of range clamps to the ends; an id that is not pinned, or a move to where it
 * already is, gives the same array back.
 */
export function movePin(pins: readonly string[], id: string, to: number): readonly string[] {
  const from = pins.indexOf(id);
  if (from < 0) return pins;
  const rest = pins.filter((p) => p !== id);
  const at = Math.max(0, Math.min(rest.length, Math.trunc(to)));
  if (at === from) return pins;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
