// Where does a widget GO when you press a move button?
//
// Dragging a card by its header is the only way this console ever had to move a
// widget, and it is a poor only-way: the header carries no grab affordance, HTML5
// drag needs a deliberate press-and-travel that reads as a failed click if you
// stop short, and the drop target is computed from a pointer position you cannot
// see. People do not discover it, and the ones who do find it fiddly.
//
// These are the pure destination calculations behind the explicit ⋯ → Move
// controls, which do the same job with one click. Kept out of the component so
// the edge cases that are annoying to reproduce by hand — first card, last card,
// moving into an empty column — are unit-tested instead of eyeballed.

import type { SegmentId, ShellLayout } from "@/lib/console/types";
import { widgetsInSegment } from "@/lib/console/reducers";

export interface MoveTarget {
  segment: SegmentId;
  index: number;
}

export const SEGMENT_LABEL: Record<SegmentId, string> = {
  left: "Left column",
  right: "Right column",
  bottom: "Bottom dock",
};

/** Reading order for the "send to the next column" cycle. */
export const SEGMENT_ORDER: SegmentId[] = ["left", "right", "bottom"];

/**
 * One step up or down within the widget's own column.
 * Returns null at the ends — the caller disables the button rather than moving
 * nothing and leaving the user wondering whether the click registered.
 */
export function nudgeTarget(layout: ShellLayout, id: string, dir: -1 | 1): MoveTarget | null {
  const w = layout.widgets.find((x) => x.id === id);
  if (!w) return null;
  const siblings = widgetsInSegment(layout, w.segment);
  const at = siblings.findIndex((x) => x.id === id);
  if (at < 0) return null;
  const to = at + dir;
  if (to < 0 || to >= siblings.length) return null;
  return { segment: w.segment, index: to };
}

/**
 * Send a widget to another column, landing at the END of it — the same place a
 * newly added widget lands, so "where did it go?" has one answer everywhere.
 * Returns null when it is already there.
 */
export function sendToTarget(layout: ShellLayout, id: string, segment: SegmentId): MoveTarget | null {
  const w = layout.widgets.find((x) => x.id === id);
  if (!w || w.segment === segment) return null;
  return { segment, index: widgetsInSegment(layout, segment).length };
}

/** The columns a widget can be sent to right now (i.e. not the one it is in). */
export function otherSegments(layout: ShellLayout, id: string): SegmentId[] {
  const w = layout.widgets.find((x) => x.id === id);
  if (!w) return [];
  return SEGMENT_ORDER.filter((s) => s !== w.segment);
}
