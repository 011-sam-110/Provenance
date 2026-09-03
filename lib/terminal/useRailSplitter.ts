// lib/terminal/useRailSplitter.ts
"use client";
import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { shellLayoutStore } from "@/lib/console/store";
import { railSizeFromPointer } from "@/lib/terminal/rails";
import type { SegmentId } from "@/lib/console/types";

// Dragging a rail splitter — all that is left of layout gestures now that the
// map is a fixed hero and a widget's position is which rail it is in.
//
// ── WHY THIS IS SO MUCH SMALLER THAN `useGridDrag` ───────────────────────────
// The machine this replaces had to hold a pinned rect, paint a ghost of the
// destination, freeze DOM order for the duration of the gesture and write refs
// every frame, because dragging a card moved a grid item among other grid items
// and every one of them could reflow under the pointer.
//
// A splitter moves nothing. It changes ONE CSS custom property on the workspace,
// and the grid's own track sizing does the rest: no element changes parent, no
// element changes order, and no card's grid area is recomputed. So there is no
// ghost to draw (the thing you are dragging IS the thing that moves), nothing to
// pin, and nothing to freeze.
//
// ── POINTER CAPTURE, AND WHY THE OLD REFUSAL DOES NOT APPLY ──────────────────
// `useGridDrag` deliberately did NOT use setPointerCapture, and its comment
// explained why: React reordered the grid's children mid-drag, and moving a node
// in the DOM releases its pointer capture, so the gesture died halfway through.
//
// That constraint is gone, and it is worth saying so here rather than leaving
// the next person to rediscover it. A splitter is a fixed child of the grid in a
// fixed position — it is never reordered, never re-parented and never keyed on
// anything that changes. So capture is safe, and it is strictly better than the
// window-listener approach: the pointer keeps talking to the splitter when it
// leaves the element (which it does immediately, since you are dragging it), and
// the browser cleans up for us if the gesture is interrupted.

export interface RailSplitterDrag {
  /** The rail currently being dragged, or null. Drives the resize cursor. */
  activeRail: SegmentId | null;
  /** Begin a drag from a splitter's pointerdown. */
  start: (e: React.PointerEvent, rail: SegmentId) => void;
}

/**
 * @param boxRef the workspace grid element — the box a rail's size is measured
 *   against. Rails hang off its edges, so this must be the element the rails and
 *   the stage actually live in, not the outer shell.
 */
export function useRailSplitter(boxRef: RefObject<HTMLElement | null>): RailSplitterDrag {
  const [activeRail, setActiveRail] = useState<SegmentId | null>(null);
  // The rail is held in a ref as well as state because the move handler is bound
  // once per gesture and must not go stale between renders.
  const railRef = useRef<SegmentId | null>(null);

  const apply = useCallback(
    (rail: SegmentId, clientX: number, clientY: number) => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      const size = railSizeFromPointer(
        rail,
        { x: clientX, y: clientY },
        { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      );
      shellLayoutStore.setSegment(rail, size);
    },
    [boxRef],
  );

  const start = useCallback(
    (e: React.PointerEvent, rail: SegmentId) => {
      // Only the primary button drags. A right-click on a separator should open
      // the context menu, not silently start resizing.
      if (e.button !== 0) return;
      e.preventDefault();

      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      railRef.current = rail;
      setActiveRail(rail);

      const onMove = (ev: PointerEvent) => {
        const r = railRef.current;
        if (r) apply(r, ev.clientX, ev.clientY);
      };
      const onEnd = () => {
        railRef.current = null;
        setActiveRail(null);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onEnd);
        el.removeEventListener("pointercancel", onEnd);
        // Releasing an already-released capture throws in some browsers, and the
        // browser releases it for us on pointercancel.
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
      };

      // Listeners go on the SPLITTER, not the window, because the capture routes
      // every subsequent pointer event for this pointer id back to it — including
      // the ones fired while the pointer is over the map, which is where it spends
      // most of a drag.
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onEnd);
      el.addEventListener("pointercancel", onEnd);
    },
    [apply],
  );

  return { activeRail, start };
}
