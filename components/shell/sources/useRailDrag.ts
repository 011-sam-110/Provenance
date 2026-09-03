"use client";
// Dragging a source row into a rail.
//
// POINTER EVENTS, NOT HTML5 DRAG. components/console/WidgetFrame.tsx records why
// `draggable` + dataTransfer were deleted from this codebase: a `draggable`
// element begins a NATIVE drag on pointerdown, which cancels the pointer capture
// the drag depends on — the two cannot coexist on one element. Rows use
// setPointerCapture instead. Do not reintroduce `draggable` here.
//
// THIS DOES NOT REINSTATE FREE DRAGGING. The reskin removed dragging to a
// rectangle because "where will this land?" could only be answered with
// "somewhere". A drop here resolves to a rail and an index in that rail's stack —
// the same two values the ＋ picker produces, and the same two the keyboard path
// produces. Drag is a faster way to say it, not a different kind of answer, so
// nothing regresses for someone who cannot drag.

import { useRef } from "react";
import type { SegmentId } from "@/lib/console/types";

export interface RailRect {
  segment: SegmentId;
  box: { x: number; y: number; w: number; h: number };
  tiles: { y: number; h: number }[];
}

const SEGMENTS = ["left", "right", "bottom"] as const;

/**
 * Pure: which rail, and which index in its stack, does this point mean?
 *
 * Kept free of the DOM so the arithmetic is node-testable — the repo has no
 * jsdom, so anything that reads an element cannot be covered by a unit test.
 */
export function resolveDrop(
  point: { x: number; y: number },
  rects: readonly RailRect[],
): { segment: SegmentId; index: number } | null {
  const hit = rects.find(
    (r) =>
      point.x >= r.box.x &&
      point.x <= r.box.x + r.box.w &&
      point.y >= r.box.y &&
      point.y <= r.box.y + r.box.h,
  );
  if (!hit) return null;

  // Zero-height tiles are dropped BEFORE indexing, not skipped during it.
  // In solo mode every slot stays mounted and `hidden`, so each one measures
  // zero: counted, they all sit "above" the pointer and the drop lands past the
  // end of a rail that visibly holds one widget.
  const tiles = hit.tiles.filter((t) => t.h > 0);

  let index = tiles.length;
  for (let i = 0; i < tiles.length; i++) {
    if (point.y < tiles[i].y + tiles[i].h / 2) {
      index = i;
      break;
    }
  }
  return { segment: hit.segment, index };
}

/**
 * Measures the rails from the DOM.
 *
 * Separate from resolveDrop so the maths stays testable without a DOM.
 *
 * The container is addressed by its ID, not by [data-segment]. That attribute is
 * on the rail AND on every widget slot inside it, so the obvious selector would
 * match the tiles as well as the rail that holds them. A rail sized to 0 is not
 * rendered at all, so it is simply absent here — which is right: you cannot drop
 * into a rail that is not on screen.
 */
export function readRailRects(): RailRect[] {
  const out: RailRect[] = [];
  for (const seg of SEGMENTS) {
    const node = document.getElementById(`tn-rail-${seg}`);
    if (!node) continue;
    const b = node.getBoundingClientRect();
    const tiles = [...node.querySelectorAll<HTMLElement>("[data-widget-id]")].map((t) => {
      const r = t.getBoundingClientRect();
      return { y: r.top, h: r.height };
    });
    out.push({
      segment: seg,
      box: { x: b.left, y: b.top, w: b.width, h: b.height },
      tiles,
    });
  }
  return out;
}

/**
 * Below this, a press is a click.
 *
 * Without a threshold every click that happens to move one pixel becomes a drag,
 * and the ＋ and the toggle stop being reliably clickable.
 */
const DRAG_THRESHOLD_PX = 5;

/**
 * Start a rail drag from a row's pointerdown.
 *
 * The move and up listeners go on `window` rather than coming back as React
 * props. The plan returned all three for the row to spread, but the row is a
 * committed component whose only drag prop is the pointerdown, and binding the
 * rest to the window keeps the gesture entirely inside this hook — the row does
 * not have to hold any drag state to stay correct. Pointer capture is still
 * taken, so the cursor and the event stream stay with the row while the pointer
 * travels across the map.
 *
 * A touch that pans vertically is left alone: the rows are `touch-action: pan-y`
 * so the rail can still be scrolled, and the browser sends pointercancel when it
 * takes the gesture over. That is treated as an abandoned drag, not a drop.
 */
export function useRailDrag(onDrop: (segment: SegmentId, index: number) => void) {
  const cleanup = useRef<(() => void) | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    // A press that lands on either control belongs to that control.
    if ((e.target as HTMLElement).closest(".tn-src-add, .tn-src-toggle")) return;

    const row = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let dragging = false;

    row.setPointerCapture(pointerId);

    const end = (commit: { x: number; y: number } | null) => {
      cleanup.current?.();
      if (!dragging || !commit) return;
      const drop = resolveDrop(commit, readRailRects());
      if (drop) onDrop(drop.segment, drop.index);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      dragging = true;
      document.body.dataset.tnRailDragging = "true";
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      end({ x: ev.clientX, y: ev.clientY });
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      end(null);
    };

    cleanup.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      delete document.body.dataset.tnRailDragging;
      if (row.hasPointerCapture(pointerId)) row.releasePointerCapture(pointerId);
      cleanup.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  return { onPointerDown };
}
