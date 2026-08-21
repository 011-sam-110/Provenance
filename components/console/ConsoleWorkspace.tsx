// components/console/ConsoleWorkspace.tsx
"use client";
import { useMemo, useRef, type CSSProperties } from "react";
import { useShellLayout, shellLayoutStore } from "@/lib/console/store";
import { STAGE_ID, type GridRect, type WidgetInstance } from "@/lib/console/types";
import WidgetFrame from "@/components/console/WidgetFrame";
import StageHost from "@/components/console/StageHost";
import StageBar from "@/components/terminal/StageBar";
import PinNavigator from "@/components/console/PinNavigator";
import PanelHost from "@/components/shell/PanelHost";
import CoveragePanel from "@/components/shell/CoveragePanel";
import MarketsPanel from "@/components/shell/MarketsPanel";
import WatchlistPanel from "@/components/shell/WatchlistPanel";
import { getWidgetType } from "@/lib/console/registry";
import { stageRegionLabel } from "@/components/shell/a11y";
import { SKIP_TARGET_ID } from "@/components/shell/SkipLink";
import { readingOrder, rowsUsed, COLS, ROW_PX, GAP_PX } from "@/lib/terminal/layoutGrid";
import { useStageSolo } from "@/lib/terminal/solo";
import { useGridDrag, gridArea, type ResizeDir } from "@/lib/terminal/useGridDrag";
import { useTerminalSkin } from "@/lib/terminal/skin";

// The OpenData Terminal workspace: ONE twelve-column grid holding the map stage and
// every widget, each at its own rectangle.
//
// ── WHAT THIS REPLACED ───────────────────────────────────────────────────────
// Until now the template came from lib/terminal/grid.ts, which generated a
// `grid-template-areas` string from segment membership and IGNORED every widget's
// stored width and height. That is why resizing was impossible: the drag handles,
// the ⋯ menu's Width/Height chips and their aria-pressed state were all writing
// values nothing on screen read. Position now comes from `widget.rect`, so those
// controls mean something again and the handles can come back.
//
// ── WHAT IS UNCHANGED, ON PURPOSE (each of these is load-bearing) ────────────
//   • `.tn-cw-shell` survives as the outer element. `.tn-alert ~ .tn-cw-shell`
//     reserves the breaking-banner band by sibling combinator, and the Source
//     Catalog rail is styled by `.tn-cw-shell > .tn-rail` / `:has(> .tn-rail)` —
//     both silently stop matching if this class or PanelHost's depth changes.
//   • `.tn-cw-stage` keeps id={SKIP_TARGET_ID} and tabIndex={-1}. Without the
//     tabindex the skip link scrolls and leaves focus behind, which is how most
//     skip links quietly fail and why no test would catch it.
//   • <StageHost> is mounted in ONE stable React position and is never keyed on
//     anything that changes. A remount costs a WebGL context, a full basemap style
//     fetch, the countries geojson, ~18 re-rasterised sprites and ~19k camera
//     features. Dragging the stage changes its grid-area and nothing else —
//     that is why the stage is a normal grid item rather than a special case.
//   • Each widget wrapper is `.tn-seg-slot` carrying data-widget-id, inside a
//     container carrying `.tn-seg`. WidgetFrame.measureSeg() does
//     closest(".tn-seg") / closest(".tn-seg-slot") at pointer-down.
//   • PanelHost / CoveragePanel / MarketsPanel / WatchlistPanel stay mounted, and
//     PanelHost stays a DIRECT child of `.tn-cw-shell`. The three panels render
//     null while closed; without them the rail's three footer buttons are dead.

/** The eight resize handles, in the order they are painted. */
const HANDLES: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export default function ConsoleWorkspace() {
  const layout = useShellLayout();
  const skin = useTerminalSkin();
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useGridDrag(gridRef);

  const boardRect: GridRect = layout.stageRect ?? { x: 3, y: 0, w: 6, h: 14 };

  /**
   * SOLO gives the whole board to the map and stands the widgets down.
   *
   * The height is the stage's OWN height, not a taller full-board guess: the grid
   * is `alignContent: start` over fixed 24px rows, so a rect taller than the
   * fitted row budget introduces a scrollbar on a view whose entire purpose is
   * that there is nothing else to look at.
   *
   * The widgets are not unmounted, only skipped — see the note on domOrder below.
   */
  const solo = useStageSolo();
  const stageRect: GridRect = solo
    ? { x: 0, y: 0, w: COLS, h: boardRect.h }
    : boardRect;

  /**
   * DOM order is READING order — top to bottom, then left to right — not the order
   * widgets happen to sit in the array. Grid areas do the visual placement, so DOM
   * order is purely tab and screen-reader order, and after a free-form drag the
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
   * Reading order changes the moment a card crosses a cell boundary, and letting
   * React act on that mid-drag means it reorders the grid's children under the
   * pointer — dozens of times in one drag. That churns the tab order while the
   * user is mid-gesture, and it used to break the drag outright: moving a node in
   * the DOM releases its pointer capture. (The capture is gone now, but the
   * churn is still pointless work and still moves focus around.) The order
   * catches up on release, which is the only moment it is meaningful anyway.
   */
  // Only the ORDER is frozen, never the widgets themselves — the ids are held and
  // re-resolved against the live layout every render, so cards keep moving while
  // their positions in the DOM stay put.
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

  /**
   * How many rows the board actually occupies — its lowest bottom edge.
   *
   * Solo counts the stage alone: the widgets are `hidden`, which is `display:none`,
   * so they hold no tracks and a board sized to include them would leave the exact
   * dead strip this is here to remove.
   */
  const boardRows = useMemo(() => {
    const rects: GridRect[] = [stageRect];
    if (!solo) for (const w of ordered) if (w.rect) rects.push(w.rect);
    return Math.max(1, rowsUsed(rects));
  }, [solo, stageRect, ordered]);

  const gridStyle = {
    gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
    // THE LAST ROW ABSORBS THE REMAINDER, and that is the whole reason this is a
    // template rather than `gridAutoRows` alone.
    //
    // Rows are a fixed 24px on a 1px gap — a 25px pitch — and `alignContent:start`
    // pins them to the top. A band whose height is not an exact multiple of 25 is
    // therefore left with 0-24px of unused track at the bottom, and `.tn-seg`'s
    // background is `var(--tnx-line)`: the hairline colour, chosen so the 1px
    // gutters between panels ARE the rules. Leftover track paints in that colour,
    // full width, so it reads as a grey bar sitting under the board rather than as
    // slack. Measured in the running app at 1600x900: band 844px, 33 rows x 25px =
    // 824px, 20px of bar. Sampo circled it and asked what it was for. Nothing.
    //
    // So the last row is `minmax(ROW_PX, 1fr)` and eats the remainder: the map and
    // the bottom-most cards get those pixels instead. It is not a repaint — there
    // is no leftover track left to colour.
    //
    // WHY THE FLOOR MATTERS. When the board is TALLER than the band there is no
    // free space, `1fr` collapses to its minimum, the tracks overflow and the
    // grid's own `overflow:auto` scrolls — which is the behaviour the removed
    // `min-height` note below exists to protect. Without the `minmax` floor the
    // final row would flatten to nothing on exactly those tall boards.
    //
    // `gridAutoRows` STAYS, and is not redundant: a drag can put a card past the
    // template's last row mid-gesture, and those implicit rows still need a height.
    gridTemplateRows:
      boardRows > 1
        ? `repeat(${boardRows - 1}, ${ROW_PX}px) minmax(${ROW_PX}px, 1fr)`
        : `minmax(${ROW_PX}px, 1fr)`,
    gridAutoRows: `${ROW_PX}px`,
    gap: `${GAP_PX}px`,
    alignContent: "start",
    // NO min-height. It used to carry `boardHeightPx(gridItems(layout))` under the
    // comment "tall boards scroll; they never squeeze their rows" — and it was the
    // reason tall boards did NOT scroll. Measured in the running app at 1440x900:
    //
    //   .tn-cw-shell (the band)   clientHeight   820px   overflow: hidden
    //   .tn-seg      (this grid)  scrollHeight  1249px   overflow: auto
    //
    // Growing the grid to its own content means the grid never overflows ITSELF,
    // so its `overflow: auto` never engages, and the excess is clipped by the
    // band above it instead. `seg.scrollTop = 400` did nothing. 429px of the
    // landing board — including a whole Headlines card at rows 40-50 — was not
    // merely below the fold, it was unreachable at any scroll position.
    //
    // The rows cannot squeeze without it: `gridAutoRows` is a fixed 24px and
    // `alignContent: start` pins the tracks to the top, so a short board still
    // sits up against the header and a tall one now genuinely scrolls. Verified
    // in the browser — dropping the declaration made scrollHeight exceed
    // clientHeight, `scrollTop` take effect, and a card stay exactly 249px.
    //
    // Defaults are fitted to the window (lib/terminal/rowBudget) so this should
    // stay a safety net rather than a scrollbar anyone meets — but a user can
    // always drag a card past the fold, and content you cannot reach is worse
    // than a scrollbar.
    // The guide overlay's column pitch, derived rather than measured: percentages
    // in a `to right` gradient resolve against the element's own width, so this
    // stays correct at any container size, including while the rail animates open.
    "--tn-col-step": `calc((100% - ${(COLS - 1) * GAP_PX}px) / ${COLS} + ${GAP_PX}px)`,
  } as CSSProperties;

  // --tn-lw / --tn-rw / --tn-bh are legacy: nothing in the Terminal layout positions
  // itself off them any more. They are still published because several rules OUTSIDE
  // the `.tn-terminal` scope compute `calc(… + var(--tn-lw))`, and a var with no value
  // makes the whole declaration invalid rather than falling back — a silent way to
  // lose a rule we have not thought to override yet.
  const legacyVars = {
    "--tn-lw": `${layout.segments.left.collapsed ? 0 : layout.segments.left.size}px`,
    "--tn-rw": `${layout.segments.right.collapsed ? 0 : layout.segments.right.size}px`,
    "--tn-bh": "0px",
  } as CSSProperties;

  // Ambient stage chrome shows only over a live map — never when a widget is
  // fullscreened onto the stage. StageBar applies the same gate internally, so it is
  // mounted unconditionally; PinNavigator does not, so it is gated here.
  const showMapOverlays =
    layout.focusedWidgetId == null && (layout.stage === "map3d" || layout.stage === "map2d");

  // The stage heading is derived, not fixed: the stage is the 2D map, the 3D globe,
  // or a widget expanded onto it, and a hard-coded "Map" would be a false claim in
  // two of those three states. Pure — see components/shell/a11y.ts.
  const focusedType = layout.focusedWidgetId
    ? getWidgetType(layout.widgets.find((x) => x.id === layout.focusedWidgetId)?.type ?? "")
    : undefined;
  const stageLabel = stageRegionLabel({
    focusedWidgetId: layout.focusedWidgetId ?? null,
    focusedTitle: focusedType?.title ?? null,
    stage: layout.stage,
  });

  /** Where an item is DRAWN: its own cell, unless it is the one being held. */
  const drawnRect = (id: string, rect: GridRect): GridRect =>
    drag.activeId === id && drag.pinnedRect ? drag.pinnedRect : rect;

  const isHeld = (id: string) => drag.activeId === id;

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

  return (
    // data-tnx-skin is repeated here, not inherited. This element carries
    // `.tn-terminal` too, and that block re-declares the whole dark --tnx-*
    // palette — so without the attribute the inner scope would override the
    // light values cascading down from the shell and only the chrome would
    // change skin.
    <div className="tn-cw-shell tn-terminal" data-tnx-skin={skin} style={legacyVars}>
      {/* The grid is a separate element from `.tn-cw-shell`, and that is not
          incidental: grid areas only apply to DIRECT children of the grid container,
          while the rail (PanelHost) has to stay a direct child of `.tn-cw-shell` for
          `.tn-cw-shell > .tn-rail` to match. One element cannot be both without the
          rail becoming an auto-placed grid item.

          It carries `.tn-seg` so WidgetFrame's closest(".tn-seg") still resolves —
          to a real, distinct ancestor of `.tn-seg-slot`, not to the slot itself. */}
      <div
        ref={gridRef}
        className={`tn-seg tn-grid${drag.activeId ? " is-dragging" : ""}`}
        style={gridStyle}
      >
        {/* The snap guides. A gradient overlay rather than 12 elements: it costs no
            DOM, cannot be hit-tested by accident, and fades in only while a gesture
            is live — a permanently visible grid would be noise on a surface whose
            whole job is reading data. */}
        <div className="tn-grid-guides" aria-hidden="true" />

        {/* Where the held item will land. */}
        {drag.ghostRect && (
          <div className="tn-grid-ghost" aria-hidden="true" style={gridArea(drag.ghostRect)} />
        )}

        <section
          className={`tn-cw-stage${isHeld(STAGE_ID) ? " is-held" : ""}`}
          id={SKIP_TARGET_ID}
          tabIndex={-1}
          aria-labelledby="tn-cw-stage-h"
          data-grid-id={STAGE_ID}
          style={gridArea(drawnRect(STAGE_ID, stageRect))}
        >
          <h2 id="tn-cw-stage-h" className="tn-sr-only">{stageLabel}</h2>
          <StageHost stage={layout.stage} />
          {/* The Terminal's stage chrome — top bar (projection, basemaps, cursor),
              search, legend, clock bar. It REPLACES MapControls / MapSearch /
              WorldClock, which must not also be mounted or the app gets two
              geocoders, two clock timers and two projection switches. */}
          <StageBar />
          {showMapOverlays && <PinNavigator />}
          {/* The stage is dragged by a dedicated grip, not by its whole surface:
              the map owns click, drag and wheel for panning and zooming, so a
              drag-anywhere stage would make the map unusable. */}
          <div
            className="tn-stage-grip"
            role="button"
            tabIndex={0}
            aria-label="Move or resize the map"
            title="Drag to move the map panel"
            onPointerDown={(e) => drag.start(e, STAGE_ID, stageRect, "move", null)}
            onKeyDown={(e) => onNudgeKey(e, STAGE_ID, stageRect, drag.nudge)}
          >
            ⠿
          </div>
          {handlesFor(STAGE_ID, stageRect)}
        </section>

        {/* HIDDEN while solo, not removed — `hidden` is display:none, so the slots
            take no grid space, leave the accessibility tree and drop out of the
            tab order, while the widgets stay MOUNTED. That distinction is the
            point: dropping them from the tree would throw away every widget's
            fetched rows and scroll position, and coming back from solo would
            repopulate an empty board feed by feed. Returning is meant to give you
            the board you left. */}
        {domOrder.map((w) => (
          <div
            key={w.id}
            data-widget-id={w.id}
            data-grid-id={w.id}
            data-segment={w.segment}
            className={`tn-seg-slot${isHeld(w.id) ? " is-held" : ""}`}
            style={gridArea(drawnRect(w.id, w.rect))}
            hidden={solo}
          >
            <WidgetFrame
              instance={w}
              onGrab={(e) => drag.start(e, w.id, w.rect, "move", null)}
              onNudgeKey={(e) => onNudgeKey(e, w.id, w.rect, drag.nudge)}
              onNudge={(d) => drag.nudge(w.id, w.rect, d)}
            />
            {handlesFor(w.id, w.rect)}
          </div>
        ))}
      </div>

      {/* The variant's persistent chrome — the Source Catalog rail, and the ONLY
          surface in the product with per-layer map toggles for all 37 signal
          layers, the per-layer freshness dot and the "needs a key" badge. It must
          stay a DIRECT child of this element: `.tn-cw-shell > .tn-rail` re-homes it
          and `.tn-cw-shell:has(> .tn-rail)` makes it PUSH the grid instead of
          covering it. Nest it one level deeper and it silently reverts to the fixed
          base rule — the exact regression that removed it from the product once
          already. */}
      <PanelHost />

      {/* The three slide-ins the rail's footer buttons open. Each reads its own
          open-store and renders null while closed, so mounting them costs nothing —
          but without them those buttons are dead controls. */}
      <CoveragePanel />
      <MarketsPanel />
      <WatchlistPanel />
    </div>
  );
}

/**
 * Arrow keys move a card by one cell; with Shift they resize it. The keyboard
 * equivalent of the drag, and not optional — a pointer-only way to lay out the
 * board would put the whole feature out of reach for anyone who cannot use one,
 * and it would be a regression besides: the controls this replaces (the ⋯ menu's
 * segment buttons) were ordinary, operable buttons.
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
