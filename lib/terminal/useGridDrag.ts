"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { shellLayoutStore } from "@/lib/console/store";
import { gridItems } from "@/lib/console/reducers";
import type { GridRect } from "@/lib/console/types";
import {
  clampRect, columnWidth, settle, COLS, GAP_PX, MIN_H, MIN_W, ROW_PX,
} from "@/lib/terminal/layoutGrid";
import { captureFlip, clearFlip, flipOne, SNAP_EASE, SNAP_MS } from "@/lib/terminal/flip";

// ── The drag/resize state machine ────────────────────────────────────────────
//
// One machine drives moving a card and all eight resize handles, because they are
// the same gesture with a different arithmetic step: press, track the pointer,
// preview where it would land, release into that cell.
//
// THE PIN, and why it exists. While a card is held, the store runs AHEAD of it —
// the model has already moved it to the target cell so the other cards can be
// pushed out of the way and previewed. If the held card were also drawn at that
// new cell it would move twice: once by the pointer transform and once by its own
// grid position catching up. It would feel like the card was fighting the
// pointer. So the held card stays pinned to the cell it started in for the
// duration, tracks the pointer with a transform, and the dashed placeholder is
// what shows the target. On release the pin drops and the card glides from
// wherever the pointer left it into the real cell.
//
// PER-FRAME WORK. Pointer moves happen at screen refresh rate, so nothing in the
// hot path is allowed to cause a React render on every event. The held card's
// transform and live box are written straight to the DOM through a ref; React
// state is touched only when the SETTLED board changes, which happens at cell
// boundaries — tens of times in a drag, not thousands.

export type DragMode = "move" | "resize";

/** Which edges a handle drags. "se" is south-east, and so on. */
export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface GridDragState {
  /** The item being dragged, or null. Drives the `.is-dragging` styling. */
  activeId: string | null;
  mode: DragMode | null;
  /** Where the held card is DRAWN while held — see "the pin" above. */
  pinnedRect: GridRect | null;
  /** Where it will land. Rendered as the dashed placeholder. */
  ghostRect: GridRect | null;
}

interface Session {
  id: string;
  mode: DragMode;
  dir: ResizeDir | null;
  origin: GridRect;
  startX: number;
  startY: number;
  /** The card's px box at press, relative to the grid container. */
  box: { left: number; top: number; width: number; height: number };
  containerWidth: number;
  el: HTMLElement;
  pointerId: number;
  /** The last rect committed to the store, so an unchanged frame does no work. */
  committed: GridRect;
  /** Where the board actually SETTLED the card — read back after settle(), not the
   *  raw pointer target. This is what the held card is drawn at. */
  landed: GridRect;
  moved: boolean;
}

const rowStep = () => ROW_PX + GAP_PX;

/** Resolve a resize drag into a rectangle. Dragging a west or north edge moves the
 *  origin as well as the size, and hitting the minimum has to stop the far edge
 *  moving rather than letting the card walk across the board. */
function resizeRect(o: GridRect, dir: ResizeDir, dx: number, dy: number): GridRect {
  let { x, y, w, h } = o;
  if (dir.includes("e")) w = o.w + dx;
  if (dir.includes("s")) h = o.h + dy;
  if (dir.includes("w")) { x = o.x + dx; w = o.w - dx; }
  if (dir.includes("n")) { y = o.y + dy; h = o.h - dy; }
  if (w < MIN_W) { if (dir.includes("w")) x = o.x + o.w - MIN_W; w = MIN_W; }
  if (h < MIN_H) { if (dir.includes("n")) y = o.y + o.h - MIN_H; h = MIN_H; }
  if (x < 0) { w += x; x = 0; }
  if (x + w > COLS) w = COLS - x;
  return { x, y, w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) };
}

export function useGridDrag(containerRef: React.RefObject<HTMLElement | null>) {
  const [state, setState] = useState<GridDragState>({
    activeId: null, mode: null, pinnedRect: null, ghostRect: null,
  });
  const session = useRef<Session | null>(null);
  const playFlip = useRef<((o: { duration: number; easing: string; skip?: ReadonlySet<string> }) => void) | null>(null);
  const reduced = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = mq.matches;
    const on = () => { reduced.current = mq.matches; };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const motion = useCallback(
    () => ({ duration: reduced.current ? 0 : SNAP_MS, easing: SNAP_EASE }),
    [],
  );

  // Play whatever was captured before the last store write. useLayoutEffect, not
  // useEffect: this has to run after React has mutated the DOM but BEFORE the
  // browser paints, or the cards are drawn once in their new places and the
  // inverted transform arrives a frame too late as a visible jump.
  useLayoutEffect(() => {
    const play = playFlip.current;
    if (!play) return;
    playFlip.current = null;
    play({ ...motion(), skip: session.current ? new Set([session.current.id]) : undefined });
  });

  /** Commit a target rect, previewing the displacement of everything else. */
  const commit = useCallback((s: Session, target: GridRect) => {
    const same =
      target.x === s.committed.x && target.y === s.committed.y &&
      target.w === s.committed.w && target.h === s.committed.h;
    if (same) return;
    s.committed = target;

    playFlip.current = captureFlip(containerRef.current);
    shellLayoutStore.placeItem(s.id, target);

    // Where it ACTUALLY landed: settle may float the card up into a gap, so the
    // placeholder has to show the settled cell, not the raw pointer target.
    const landed = gridItems(shellLayoutStore.get()).find((i) => i.id === s.id);
    const rect = landed ? { x: landed.x, y: landed.y, w: landed.w, h: landed.h } : target;
    s.landed = rect;
    setState((prev) => ({ ...prev, ghostRect: rect }));
  }, [containerRef]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;

    const dxPx = e.clientX - s.startX;
    const dyPx = e.clientY - s.startY;
    if (!s.moved && Math.abs(dxPx) < 3 && Math.abs(dyPx) < 3) return; // ignore a click's jitter
    s.moved = true;

    const colW = columnWidth(s.containerWidth);
    const dx = colW > 0 ? Math.round(dxPx / colW) : 0;
    const dy = Math.round(dyPx / rowStep());

    if (s.mode === "move") {
      // Commit FIRST, then draw — the transform below reads what settle() decided.
      commit(s, clampRect({ ...s.origin, x: s.origin.x + dx, y: Math.max(0, s.origin.y + dy) }));

      // THE CARD IS DRAWN WHERE IT WILL LAND, NOT UNDER THE POINTER.
      //
      // Free-tracking the pointer made the card promise a position the engine had
      // already decided not to honour: it followed the cursor the whole way down,
      // the dashed ghost stayed on the cell it started in, and flipOne paid the
      // debt at release with a flight back — measured at 360px. That flight IS the
      // jump people report. Drawing the card at the settled cell means there is
      // nothing left to animate on release, because it is already there.
      //
      // The cost, and it is deliberate: the card no longer tracks the pointer 1:1.
      // It moves in whole cells and stops where it will actually go. A card that
      // stops where it will land is honest; one that follows your finger and then
      // teleports is not.
      const colW = columnWidth(s.containerWidth);
      const tx = (s.landed.x - s.origin.x) * (colW + GAP_PX);
      const ty = (s.landed.y - s.origin.y) * rowStep();
      s.el.style.transform = `translate(${tx}px, ${ty}px)`;
      return;
    }

    const dir = s.dir!;
    // The live px box, so the edge under the pointer tracks it exactly rather
    // than jumping between whole cells.
    const west = dir.includes("w") ? dxPx : 0;
    const north = dir.includes("n") ? dyPx : 0;
    const dw = dir.includes("e") ? dxPx : dir.includes("w") ? -dxPx : 0;
    const dh = dir.includes("s") ? dyPx : dir.includes("n") ? -dyPx : 0;
    s.el.style.left = `${s.box.left + west}px`;
    s.el.style.top = `${s.box.top + north}px`;
    s.el.style.width = `${Math.max(colW * MIN_W, s.box.width + dw)}px`;
    s.el.style.height = `${Math.max(rowStep() * MIN_H, s.box.height + dh)}px`;

    commit(s, clampRect(resizeRect(s.origin, dir, dx, dy)));
  }, [commit]);

  const onPointerUp = useCallback((e: PointerEvent) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    session.current = null;

    // Measured while the pin and the live box are still in force — this is where
    // the card visually IS, and where the settle animation has to start from.
    const from = s.el.getBoundingClientRect();

    s.el.style.transform = "";
    s.el.style.position = "";
    s.el.style.left = "";
    s.el.style.top = "";
    s.el.style.width = "";
    s.el.style.height = "";
    s.el.style.zIndex = "";

    // flushSync, and it is load-bearing. Dropping the pin is a state update, and
    // React is free to defer it past the next animation frame — so measuring
    // straight after would measure the card still pinned to the cell it STARTED
    // in. The settle then animates toward the wrong target and freezes there,
    // until the real commit lands and the card jumps into place. Forcing the
    // commit here is what makes `to` the cell the card actually ends up in.
    //
    // This also drops `.is-held`, whose `transition: none !important` would
    // otherwise suppress the very animation being set up two lines below.
    flushSync(() => {
      setState({ activeId: null, mode: null, pinnedRect: null, ghostRect: null });
    });

    flipOne(s.el, from, motion());
    window.setTimeout(() => clearFlip(s.el), (reduced.current ? 0 : SNAP_MS) + 60);
  }, [motion]);

  useEffect(() => {
    if (!state.activeId) return;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [state.activeId, onPointerMove, onPointerUp]);

  /**
   * Begin a gesture. `rect` is the item's current cell, read by the caller from
   * the layout it is already rendering — passing it in keeps this hook from
   * needing to know how a caller stores its board.
   */
  const start = useCallback(
    (e: React.PointerEvent, id: string, rect: GridRect, mode: DragMode, dir: ResizeDir | null) => {
      // Left button / touch / pen only. A right-click drag would start a gesture
      // that the context menu then swallows the pointerup for.
      if (e.button !== 0) return;
      const container = containerRef.current;
      const el = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-grid-id]");
      if (!container || !el) return;

      e.preventDefault();
      e.stopPropagation();

      const cbox = container.getBoundingClientRect();
      const ebox = el.getBoundingClientRect();

      // NO setPointerCapture here, deliberately. Capturing on the card looks like
      // the obvious thing to do and it silently breaks the drag: the board
      // reflows on the first cell boundary, React reorders the grid's children to
      // keep DOM order equal to reading order, and MOVING a node in the DOM
      // releases its pointer capture and fires `pointercancel` — which this hook
      // correctly treats as "the gesture was cancelled". The drag would die a few
      // pixels in, intermittently, depending on whether the pointer had crossed a
      // boundary yet. The window-level listeners below already track the pointer
      // everywhere, including outside the window, so the capture bought nothing.

      session.current = {
        id, mode, dir,
        origin: { ...rect },
        startX: e.clientX,
        startY: e.clientY,
        box: {
          left: ebox.left - cbox.left + container.scrollLeft,
          top: ebox.top - cbox.top + container.scrollTop,
          width: ebox.width,
          height: ebox.height,
        },
        containerWidth: container.clientWidth,
        el,
        pointerId: e.pointerId,
        committed: { ...rect },
        landed: { ...rect },
        moved: false,
      };

      if (mode === "resize") {
        // Out of grid flow so the box can follow the pointer freely. The
        // placeholder holds its cells in the meantime, so nothing collapses.
        el.style.position = "absolute";
        el.style.left = `${session.current.box.left}px`;
        el.style.top = `${session.current.box.top}px`;
        el.style.width = `${ebox.width}px`;
        el.style.height = `${ebox.height}px`;
      }
      el.style.zIndex = "40";

      setState({ activeId: id, mode, pinnedRect: { ...rect }, ghostRect: { ...rect } });
    },
    [containerRef],
  );

  /** Keyboard equivalent — the same move and resize, one cell at a time. This is
   *  not a nicety: a pointer-only way to size a widget would make the feature
   *  unreachable for anyone who cannot use one, and the controls it replaces
   *  (the ⋯ menu's segment buttons) were operable by keyboard. */
  const nudge = useCallback(
    (id: string, rect: GridRect, d: { dx?: number; dy?: number; dw?: number; dh?: number }) => {
      playFlip.current = captureFlip(containerRef.current);
      shellLayoutStore.placeItem(id, clampRect({
        x: rect.x + (d.dx ?? 0),
        y: Math.max(0, rect.y + (d.dy ?? 0)),
        w: rect.w + (d.dw ?? 0),
        h: rect.h + (d.dh ?? 0),
      }));
    },
    [containerRef],
  );

  /** Capture before a non-pointer layout change (add, remove, auto-arrange) so it
   *  animates like everything else instead of snapping. */
  const animateNext = useCallback(() => {
    playFlip.current = captureFlip(containerRef.current);
  }, [containerRef]);

  return { ...state, start, nudge, animateNext };
}

/** Grid item placement as inline style. Exported so the workspace and the
 *  placeholder cannot drift apart on the +1 that turns a 0-based cell into a
 *  1-based grid line. */
export function gridArea(r: GridRect): React.CSSProperties {
  return {
    gridColumn: `${r.x + 1} / span ${r.w}`,
    gridRow: `${r.y + 1} / span ${r.h}`,
  };
}

/** Board height in px, for the container's min-height — so a tall board scrolls
 *  rather than compressing its rows. */
export function boardHeightPx(items: readonly GridRect[]): number {
  const rows = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  return rows * ROW_PX + Math.max(0, rows - 1) * GAP_PX;
}

export { settle };
