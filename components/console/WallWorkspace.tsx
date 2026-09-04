// components/console/WallWorkspace.tsx
"use client";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { shellLayoutStore, useShellLayout } from "@/lib/console/store";
import type { GridRect, ShellLayout, WidgetInstance } from "@/lib/console/types";
import WidgetFrame from "@/components/console/WidgetFrame";
import { readingOrder, COLS, ROW_PX, GAP_PX } from "@/lib/terminal/layoutGrid";
import { useGridDrag, gridArea, type ResizeDir } from "@/lib/terminal/useGridDrag";
import { visibleShell } from "@/lib/terminal/rowBudget";
import { SKIP_TARGET_ID } from "@/components/shell/SkipLink";

// The camera wall: ONE free twelve-column grid of tiles, and no map in it.
//
// ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ────────────────────────────
// This is the grid #146 deleted, restored for `mode: "wall"` boards only — MINUS
// the stage. That subtraction is not a simplification, it is the answer to the
// reason the grid was removed in the first place:
//
//   "the map was just another tile — with its own drag grip and eight resize
//    handles, competing for cells with every widget. You could shove the map into
//    a corner and leave it there, and nothing stopped you."
//
// Every clause of that is about the map being a grid item. Here it is not one: it
// lives in the dock ConsoleWorkspace renders beside this element, all twelve
// columns belong to the tiles, and the thing a user is arranging is a wall of
// cameras rather than a workspace with a map wedged into it.
//
// ── WHAT CAME BACK WITH IT ───────────────────────────────────────────────────
//   • `.tn-grid-guides` and `.tn-grid-ghost` — both of which survived #146 in
//     globals.css as dead rules and have simply had nothing to attach to since.
//   • The eight `.tn-rz` handles per tile. Their CSS is the only thing #146
//     actually removed from globals.css, and it is restored beside those rules.
//   • The frozen-DOM-order machinery. See the note on `domOrder` below — this is
//     the one piece that is genuinely intricate, and it is intricate for a reason
//     that has not changed.
//
// ── WHAT IS LOAD-BEARING HERE ────────────────────────────────────────────────
//   • The container carries BOTH `.tn-seg` and `.tn-grid`. `.tn-seg` is what
//     every `.tn-seg-slot` rule expects as an ancestor; `.tn-grid` is what the
//     guides, the ghost and the ≤720px stacking fallback are scoped to.
//   • Each tile wrapper is `.tn-seg-slot` carrying `data-widget-id` AND
//     `data-grid-id`. useGridDrag does `closest("[data-grid-id]")` at pointer-down
//     to find the element it moves, and lib/terminal/flip.ts keys its animation
//     off the same attribute.

/** The eight resize handles, in the order they are painted. */
const HANDLES: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export default function WallWorkspace({
  style,
  skipTarget = false,
}: {
  style?: CSSProperties;
  /** Take the skip link's target. On a wall board the wall IS the main content —
   *  the map is stowed in a dock that may be closed — so the target moves here
   *  from `.tn-cw-stage`. `tabIndex={-1}` comes with it and is not optional:
   *  without it the browser scrolls to the anchor and leaves focus behind, which
   *  is how most skip links quietly fail and why no test would catch it. */
  skipTarget?: boolean;
}) {
  const layout = useShellLayout();
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useGridDrag(gridRef);

  /**
   * Repair on arrival: any tile with no rect gets one.
   *
   * A wall tile without a rect is MOUNTED BUT NEVER DRAWN — it keeps its config
   * and its fetches and shows nothing at all, which reads as a lost camera and is
   * impossible to diagnose from the screen. `sanitizeLayout` already seeds rects
   * on every path that goes through it, so this only catches what does not: a
   * layout `set` directly, or a widget added by a code path that predates the
   * mode flag.
   *
   * `seedWall` is a no-op when every tile is placed, so this effect settles after
   * one run rather than looping on its own store write.
   */
  useEffect(() => {
    if (layout.widgets.some((w) => !w.rect)) {
      // Rows, not pixels: `arrangeWall` fits its bands to a row budget, and the
      // shell's height in px over the row pitch is that budget.
      shellLayoutStore.seedWall(Math.floor(visibleShell().h / (ROW_PX + GAP_PX)));
    }
  }, [layout.widgets]);

  /**
   * DOM order is READING order — top to bottom, then left to right — not the
   * order tiles happen to sit in the array. Grid areas do the visual placement,
   * so DOM order is purely tab and screen-reader order, and after a free drag the
   * only honest answer to "what comes next?" is "whatever is next on screen".
   */
  const ordered = useMemo(() => {
    const placed = layout.widgets.filter(
      (w): w is WidgetInstance & { rect: GridRect } => Boolean(w.rect),
    );
    return readingOrder(placed.map((w) => ({ ...w.rect, widget: w }))).map((e) => e.widget);
  }, [layout.widgets]);

  /**
   * DOM order is FROZEN for the duration of a gesture.
   *
   * Reading order changes the moment a tile crosses a cell boundary, and letting
   * React act on that mid-drag means it reorders the grid's children under the
   * pointer — dozens of times in one drag. That churns the tab order while the
   * user is mid-gesture, and it used to break the drag outright: moving a node in
   * the DOM releases its pointer capture. (useGridDrag no longer takes a capture,
   * so that specific failure is gone, but the churn is still pointless work and
   * still moves focus around.) The order catches up on release, which is the only
   * moment it is meaningful anyway.
   *
   * Only the ORDER is frozen, never the tiles themselves — the ids are held and
   * re-resolved against the live layout every render, so tiles keep moving while
   * their positions in the DOM stay put.
   */
  const frozenIds = useRef<string[] | null>(null);
  if (!drag.activeId) frozenIds.current = null;
  else if (!frozenIds.current) frozenIds.current = ordered.map((w) => w.id);

  const domOrder = useMemo(() => {
    const ids = frozenIds.current;
    if (!ids) return ordered;
    const byId = new Map(ordered.map((w) => [w.id, w]));
    // Anything added mid-drag falls in at the end rather than being dropped.
    const held = ids.map((id) => byId.get(id)).filter((w): w is (typeof ordered)[number] => Boolean(w));
    const heldIds = new Set(held.map((w) => w.id));
    return [...held, ...ordered.filter((w) => !heldIds.has(w.id))];
  }, [ordered, drag.activeId]);

  const gridStyle = {
    gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
    gridAutoRows: `${ROW_PX}px`,
    gap: `${GAP_PX}px`,
    alignContent: "start",
    // NO min-height, and that is a fix rather than an omission. It used to carry
    // the board's own content height under the comment "tall boards scroll; they
    // never squeeze their rows" — and it was the reason tall boards did NOT
    // scroll. Growing the grid to its own content means the grid never overflows
    // ITSELF, so its `overflow: auto` never engages and the excess is clipped by
    // the band above it instead. Measured at 1440x900 before it was removed:
    // 1249px of board inside an 820px band, with 429px unreachable at any scroll
    // position. The rows cannot squeeze without it either: `gridAutoRows` is a
    // fixed 24px and `alignContent: start` pins the tracks to the top.
    //
    // The guide overlay's column pitch, derived rather than measured: percentages
    // in a `to right` gradient resolve against the element's own width, so this
    // stays correct at any container size, including while the dock animates.
    "--tn-col-step": `calc((100% - ${(COLS - 1) * GAP_PX}px) / ${COLS} + ${GAP_PX}px)`,
  } as CSSProperties;

  /** Where a tile is DRAWN: its own cell, unless it is the one being held. */
  const drawnRect = (id: string, rect: GridRect): GridRect =>
    drag.activeId === id && drag.pinnedRect ? drag.pinnedRect : rect;

  const handlesFor = (id: string, rect: GridRect) =>
    HANDLES.map((dir) => (
      <div
        key={dir}
        className={`tn-rz tn-rz-${dir}`}
        data-resize={dir}
        aria-hidden="true"
        onPointerDown={(e) => drag.start(e, id, rect, "resize", dir)}
      />
    ));

  const dockOpen = !layout.segments.right.collapsed;

  return (
    <div className="tn-wall" style={style}>
      {/* The wall's own controls, and they have to live OUT HERE rather than on
          the map: the dock control's whole job is opening a dock that is closed,
          so putting it inside the dock would make it unreachable in the only
          state it matters in. The same goes for adding a tile — the map's "PICK
          CAMERAS" flow is the other door, and it is behind the same closed dock. */}
      <div className="tn-wall-bar">
        <button
          type="button"
          className="tn-wall-btn"
          aria-pressed={dockOpen}
          title={dockOpen ? "Close the map" : "Open the map to pick cameras"}
          onClick={() => shellLayoutStore.collapseSegment("right", dockOpen)}
        >
          Map
        </button>
        <button
          type="button"
          className="tn-wall-btn"
          title="Add an empty camera wall to this board"
          onClick={() => shellLayoutStore.add("camslot", { segment: "left" })}
        >
          + Wall
        </button>
        <span className="tn-wall-sp" />
        <button
          type="button"
          className="tn-wall-btn"
          title="Re-tile every wall at an equal size"
          onClick={() => shellLayoutStore.arrange(Math.floor(visibleShell().h / (ROW_PX + GAP_PX)))}
        >
          Re-tile
        </button>
      </div>

      <div
        ref={gridRef}
        className={`tn-seg tn-grid${drag.activeId ? " is-dragging" : ""}`}
        style={gridStyle}
        id={skipTarget ? SKIP_TARGET_ID : undefined}
        tabIndex={skipTarget ? -1 : undefined}
        role="region"
        aria-label="Camera wall"
      >
      {/* The snap guides. A gradient overlay rather than 12 elements: it costs no
          DOM, cannot be hit-tested by accident, and fades in only while a gesture
          is live — a permanently visible grid would be noise on a wall whose
          whole job is showing pictures. */}
      <div className="tn-grid-guides" aria-hidden="true" />

      {/* Where the held tile will land. */}
      {drag.ghostRect && (
        <div className="tn-grid-ghost" aria-hidden="true" style={gridArea(drag.ghostRect)} />
      )}

      {domOrder.map((w) => (
        <div
          key={w.id}
          data-widget-id={w.id}
          data-grid-id={w.id}
          data-segment={w.segment}
          className={`tn-seg-slot${drag.activeId === w.id ? " is-held" : ""}`}
          style={gridArea(drawnRect(w.id, w.rect!))}
        >
          <WidgetFrame
            instance={w}
            onGrab={(e) => drag.start(e, w.id, w.rect!, "move", null)}
            onNudgeKey={(e) => onNudgeKey(e, w.id, w.rect!, drag.nudge)}
          />
          {handlesFor(w.id, w.rect!)}
        </div>
      ))}
      </div>
    </div>
  );
}

/**
 * Arrow keys move a tile by one cell; with Shift they resize it.
 *
 * The keyboard equivalent of the drag, and not optional — a pointer-only way to
 * lay out a wall would put the whole feature out of reach for anyone who cannot
 * use one. It is also the reason `WidgetFrame`'s grip stays a real `<button>`
 * rather than becoming a bare drag surface.
 */
function onNudgeKey(
  e: React.KeyboardEvent,
  id: string,
  rect: GridRect,
  nudge: (id: string, rect: GridRect, d: { dx?: number; dy?: number; dw?: number; dh?: number }) => void,
) {
  const step = e.shiftKey
    ? { ArrowLeft: { dw: -1 }, ArrowRight: { dw: 1 }, ArrowUp: { dh: -1 }, ArrowDown: { dh: 1 } }
    : { ArrowLeft: { dx: -1 }, ArrowRight: { dx: 1 }, ArrowUp: { dy: -1 }, ArrowDown: { dy: 1 } };
  const d = step[e.key as keyof typeof step];
  if (!d) return;
  e.preventDefault();
  e.stopPropagation();
  nudge(id, rect, d);
}
