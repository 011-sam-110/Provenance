// components/console/ConsoleWorkspace.tsx
"use client";
import { useMemo, useRef, type CSSProperties } from "react";
import { useShellLayout, shellLayoutStore } from "@/lib/console/store";
import { STAGE_ID, type SegmentId } from "@/lib/console/types";
import { widgetsInSegment } from "@/lib/console/reducers";
import { nudgeTarget, sendToTarget, SEGMENT_ORDER, SEGMENT_LABEL } from "@/lib/console/move";
import WidgetFrame from "@/components/console/WidgetFrame";
import StageHost from "@/components/console/StageHost";
import StageBar from "@/components/terminal/StageBar";
import PinNavigator from "@/components/console/PinNavigator";
import PanelHost from "@/components/shell/PanelHost";
import PlacementPicker from "@/components/console/PlacementPicker";
import CoveragePanel from "@/components/shell/CoveragePanel";
import MarketsPanel from "@/components/shell/MarketsPanel";
import WatchlistPanel from "@/components/shell/WatchlistPanel";
import RailSplitter from "@/components/console/RailSplitter";
import WallWorkspace from "@/components/console/WallWorkspace";
import { getWidgetType } from "@/lib/console/registry";
import { stageRegionLabel } from "@/components/shell/a11y";
import { SKIP_TARGET_ID } from "@/components/shell/SkipLink";
import { railSizes, dockSize } from "@/lib/terminal/rails";
import { useRailSplitter } from "@/lib/terminal/useRailSplitter";
import { useShellBox } from "@/lib/terminal/rowBudget";

// The Provenance console: a FIXED HERO MAP with three resizable rails around it.
//
// ── WHAT THIS REPLACED, AND WHY ──────────────────────────────────────────────
// Until now this rendered ONE free twelve-column grid in which the map was just
// another tile — with its own drag grip and eight resize handles, competing for
// cells with every widget. You could shove the map into a corner and leave it
// there, and nothing stopped you. Adding a widget dropped it wherever a
// free-space scan happened to reach, so the honest answer to "where will this
// land?" was "somewhere". That is what "crowded and hard to use" was describing.
//
// The map is now the hero and takes whatever the rails do not. A widget's only
// position is WHICH RAIL it is in and WHERE IN THAT RAIL'S STACK it sits, which
// is a position a person can predict, name and undo. The map is resized by
// dragging a rail seam and in no other way — it has no grip and no handles,
// because it is not a tile any more.
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
//     anything that changes. A remount costs a WebGL context, a full basemap
//     style fetch, the countries geojson, ~18 re-rasterised sprites and ~19k
//     camera features. THIS IS THE CONSTRAINT THE WHOLE FILE BENDS AROUND: the
//     stage sits in one fixed grid cell and only the cell's TRACK SIZE changes
//     when a rail moves, so a resize never touches the element.
//   • Each widget wrapper is `.tn-seg-slot` carrying data-widget-id, inside a
//     container carrying `.tn-seg`.
//   • `data-grid-id` survives on the stage and every slot: lib/terminal/flip.ts
//     keys its reorder animation off it, and without it reordering a card within
//     a rail is a teleport rather than a movement.
//   • PanelHost / CoveragePanel / MarketsPanel / WatchlistPanel stay mounted, and
//     PanelHost stays a DIRECT child of `.tn-cw-shell`. The three panels render
//     null while closed; without them the rail's three footer buttons are dead.
//
// ── WHAT WENT, AND WHAT REPLACED IT ──────────────────────────────────────────
// Gone: `.tn-stage-grip`, all eight `.tn-rz` handles per card AND per stage,
// `.tn-grid-guides`, `.tn-grid-ghost`, `gridArea`, `drawnRect`, the frozen
// DOM-order machinery, and the free-spot scan behind the "add a camera wall"
// ghost tile.
//
// DOM order is now LITERAL — left rail, stage, right rail, bottom rail, each
// rail top to bottom — which IS reading order. The old file needed a whole
// mechanism to compute reading order from rectangles and then freeze it for the
// duration of a drag, because after a free drag the only honest answer to "what
// comes next?" was "whatever is next on screen", and that changed mid-gesture.
// Rails have no such problem: the structure is the order.
//
// THE EMPTY-BOARD RESCUE IS GONE TOO, and that is a deletion worth justifying.
// It existed because removing the last camera wall left you looking at an empty
// grid with no way back. Under rails an empty board is not a dead end, it is the
// intended resting state: a full-bleed hero map with the Source Catalog rail
// still sitting beside it, one click from adding anything. Keeping a panel that
// says "this board has no camera walls" would be scolding the user for being in
// the default state.
//   NOTE: that panel was also a real add-path for the camslot widget. Its
//   replacement is the widget catalogue in the Source Catalog rail, which is the
//   only other door camslot has. Do not delete the command palette until that
//   catalogue is live, or camslot becomes uncreatable.

/** The rails, in the order they are laid out and read. */
const RAILS: SegmentId[] = ["left", "right", "bottom"];

export default function ConsoleWorkspace() {
  const layout = useShellLayout();
  const gridRef = useRef<HTMLDivElement>(null);
  const split = useRailSplitter(gridRef);

  // The workspace's own box, measured. Rail sizes are clamped against it so two
  // wide rails can never squeeze the map below STAGE_MIN_PX — the clamp needs a
  // container width, and this is the element the rails actually hang off.
  const box = useShellBox(gridRef);

  // `false` is the only value the solo flag can take now: the Solo button was the
  // one control that set it and it has been removed, along with its store. The
  // parameter stays on the pure rails function, where it is still unit-tested.
  const sizes = useMemo(() => railSizes(layout, box, false), [layout, box]);

  // ── WALL MODE ──────────────────────────────────────────────────────────────
  //
  // The frame does not change. Five columns, three rows, same element, same
  // children in the same order. What changes is which cell each occupant sits
  // in: the WALL takes the hero cell (column 3) and the STAGE moves to the
  // right-hand track (column 5), where it is the map dock.
  //
  // THE STAGE SECTION KEEPS ITS REACT POSITION IN BOTH MODES, and that is the
  // constraint this whole file already bends around. A `StageHost` remount costs
  // a WebGL context, a full basemap style fetch, the countries geojson, ~18
  // re-rasterised sprites and ~19k camera features. Rendering the map "somewhere
  // else" for a wall board would remount it on every board switch. So the section
  // below is emitted unconditionally, at a fixed index among its siblings, and
  // only its inline `gridColumn` differs — exactly the trick that lets a rail
  // splitter resize the map without touching the element.
  //
  // The other slots become `null` rather than disappearing, which keeps every
  // sibling index stable for React's positional reconciliation.
  const wall = layout.mode === "wall";
  const dock = wall ? dockSize(layout, box) : 0;

  /** Every rail's widgets, already ordered — `order` is dense and 0-based. */
  const byRail = useMemo(() => {
    const out = {} as Record<SegmentId, ReturnType<typeof widgetsInSegment>>;
    for (const rail of RAILS) out[rail] = widgetsInSegment(layout, rail);
    return out;
  }, [layout]);

  const railVars = {
    "--tn-lw": `${wall ? 0 : sizes.left}px`,
    "--tn-rw": `${wall ? dock : sizes.right}px`,
    "--tn-bh": `${wall ? 0 : sizes.bottom}px`,
  } as CSSProperties;

  /**
   * The frame. Five columns and three rows, and every splitter track is `auto`
   * so an unrendered splitter collapses the track to zero rather than leaving a
   * seam floating beside a rail that is not there.
   *
   *   cols:  [left rail] [split] [ MAP 1fr ] [split] [right rail]
   *   rows:  [ the above, 1fr ] [split] [bottom rail]
   *
   * The bottom rail spans all five columns, so it sits under the side rails as
   * well as the map. That is deliberate: a bottom rail inset between two side
   * rails reads as a third column that happens to be short, not as a dock.
   */
  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "var(--tn-lw) auto minmax(0, 1fr) auto var(--tn-rw)",
    gridTemplateRows: "minmax(0, 1fr) auto var(--tn-bh)",
    minHeight: 0,
  } as CSSProperties;

  // Ambient stage chrome shows only over a live map — never when a widget is
  // fullscreened onto the stage. StageBar applies the same gate internally, so it
  // is mounted unconditionally; PinNavigator does not, so it is gated here.
  const showMapOverlays =
    layout.focusedWidgetId == null && (layout.stage === "map3d" || layout.stage === "map2d");

  // The stage heading is derived, not fixed: the stage is the 2D map, the 3D
  // globe, or a widget expanded onto it, and a hard-coded "Map" would be a false
  // claim in two of those three states. Pure — see components/shell/a11y.ts.
  const focusedType = layout.focusedWidgetId
    ? getWidgetType(layout.widgets.find((x) => x.id === layout.focusedWidgetId)?.type ?? "")
    : undefined;
  const stageLabel = stageRegionLabel({
    focusedWidgetId: layout.focusedWidgetId ?? null,
    focusedTitle: focusedType?.title ?? null,
    stage: layout.stage,
  });

  /**
   * Arrow keys on a card's grip, with RAIL meanings.
   *
   * Up/down reorder within the rail; left/right send the card to the previous or
   * next rail. Both are `lib/console/move.ts`'s pure, already-tested destination
   * functions — that module has had unit tests and no product caller since free
   * dragging shipped, and this is its first one.
   *
   * Left/right are a CYCLE rather than a direction, because from the bottom rail
   * "left" is a destination, not a direction, and there is no fourth rail to
   * travel to. Cycling means every rail is reachable from every other rail with
   * at most two presses and no dead key.
   */
  const onRailKey = (e: React.KeyboardEvent, id: string) => {
    const l = shellLayoutStore.get();

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const t = nudgeTarget(l, id, e.key === "ArrowUp" ? -1 : 1);
      if (!t) return; // at the end of the rail — do nothing rather than wrap
      e.preventDefault();
      e.stopPropagation();
      shellLayoutStore.move(id, t.segment, t.index);
      return;
    }

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const w = l.widgets.find((x) => x.id === id);
      if (!w) return;
      const at = SEGMENT_ORDER.indexOf(w.segment);
      const step = e.key === "ArrowLeft" ? -1 : 1;
      const next = SEGMENT_ORDER[(at + step + SEGMENT_ORDER.length) % SEGMENT_ORDER.length];
      const t = sendToTarget(l, id, next);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      shellLayoutStore.move(id, t.segment, t.index);
    }
  };

  /** One rail column, or nothing at all when it has no size. */
  const renderRail = (rail: SegmentId) => {
    const widgets = byRail[rail];
    // A rail with no size is not rendered rather than rendered empty: an empty
    // scroll container still takes a border, still takes a focus stop, and would
    // put a seam on screen for a rail nobody can see.
    if (sizes[rail] === 0) return null;
    return (
      <div
        id={`tn-rail-${rail}`}
        className={`tn-rail-col tn-rail-col-${rail}`}
        data-segment={rail}
        role="region"
        aria-label={SEGMENT_LABEL[rail]}
        style={{
          gridColumn: rail === "left" ? 1 : rail === "right" ? 5 : "1 / -1",
          gridRow: rail === "bottom" ? 3 : 1,
        }}
      >
        {widgets.map((w) => (
          <div
            key={w.id}
            data-widget-id={w.id}
            data-grid-id={w.id}
            data-segment={w.segment}
            className="tn-seg-slot"
            style={{ height: `${w.height}px` }}
          >
            <WidgetFrame instance={w} onNudgeKey={(e) => onRailKey(e, w.id)} />
          </div>
        ))}
      </div>
    );
  };

  /** A rail's seam, on the side that faces the map — or, in wall mode, the map
   *  dock's own seam. Same component and the same store write, because the dock
   *  IS the right rail: it simply holds the stage instead of widgets, so its
   *  width persists in `segments.right.size` like every other rail's. */
  const renderSplit = (rail: SegmentId) => {
    const size = wall ? (rail === "right" ? dock : 0) : sizes[rail];
    if (size === 0) return null;
    return (
      <div
        style={{
          gridColumn: rail === "left" ? 2 : rail === "right" ? 4 : "1 / -1",
          gridRow: rail === "bottom" ? 2 : 1,
          display: "grid",
        }}
      >
        <RailSplitter
          rail={rail}
          size={size}
          active={split.activeRail === rail}
          onPointerDown={(e) => split.start(e, rail)}
        />
      </div>
    );
  };

  return (
    // `.tn-terminal` is repeated here, not inherited, and that is still deliberate
    // even though there is only one palette now: this element re-declares the whole
    // --tnx-* block, and it has to, because the widget bodies below it read those
    // tokens. It used to carry a `data-tnx-skin` attribute alongside — without it,
    // the inner scope re-declared the DARK palette and only the outer chrome went
    // light. That failure mode died with the dark skin.
    <div className="tn-cw-shell tn-terminal" style={railVars}>
      {/* The grid is a separate element from `.tn-cw-shell`, and that is not
          incidental: grid placement only applies to DIRECT children of the grid
          container, while the rail (PanelHost) has to stay a direct child of
          `.tn-cw-shell` for `.tn-cw-shell > .tn-rail` to match. One element
          cannot be both without the Source Catalog rail becoming an auto-placed
          grid item in the middle of the console.

          It carries `.tn-seg` so it stays a real, distinct ancestor of every
          `.tn-seg-slot`. */}
      <div
        ref={gridRef}
        className={`tn-seg tn-rails${split.activeRail ? " is-splitting" : ""}`}
        style={gridStyle}
      >
        {/* SLOT 0 — the hero cell's occupant. On rails that is the left rail; on
            a wall it is the wall itself. Every slot below keeps its index in
            both modes (a `null` still counts), because React reconciles these
            children POSITIONALLY and a shifting index would remount the stage. */}
        {wall
          ? <WallWorkspace style={{ gridColumn: 3, gridRow: 1 }} skipTarget />
          : renderRail("left")}
        {wall ? null : renderSplit("left")}

        {/* SLOT 2 — the stage. Emitted unconditionally and never keyed, in both
            modes. Only `gridColumn` differs: the hero cell on rails, the dock's
            track on a wall. See the WALL MODE note at the top of the component
            for what a remount here would cost. */}
        <section
          // A CLOSED DOCK IS NOT `hidden` AND NOT `aria-hidden`, and both of
          // those were tried and are wrong. `hidden` is display:none, which does
          // not unmount but would tear down the map's layout box entirely.
          // `aria-hidden` on its own is worse than useless here: the stage holds
          // StageBar's real buttons, and aria-hidden over focusable controls
          // leaves them tabbable but unannounced, which is the one combination
          // WCAG calls out by name.
          //
          // `.is-stowed` sets `visibility: hidden`, which removes the subtree
          // from BOTH the accessibility tree and the tab order in one move,
          // while leaving the element laid out — so the map keeps its WebGL
          // context, its style and its sources, and WorldMap's own
          // ResizeObserver fires `map.resize()` when the track widens again.
          // Reopening the dock is a resize, never a rebuild.
          className={`tn-cw-stage${wall && dock === 0 ? " is-stowed" : ""}`}
          // The skip link points at the MAIN thing on the board, and on a wall
          // that is the wall — see WallWorkspace's `skipTarget`. Leaving the
          // target on a stowed dock is how a skip link silently sends a keyboard
          // user to an invisible region.
          id={wall ? undefined : SKIP_TARGET_ID}
          tabIndex={wall ? undefined : -1}
          aria-labelledby="tn-cw-stage-h"
          data-grid-id={STAGE_ID}
          style={{ gridColumn: wall ? 5 : 3, gridRow: 1 }}
        >
          <h2 id="tn-cw-stage-h" className="tn-sr-only">{stageLabel}</h2>
          <StageHost stage={layout.stage} />
          {/* The Terminal's stage chrome — top bar (projection, basemaps,
              cursor), search, legend, clock bar. It REPLACED MapControls /
              MapSearch / WorldClock, which must not also be mounted or the app
              gets two geocoders, two clock timers and two projection switches. */}
          <StageBar />
          {showMapOverlays && <PinNavigator />}
        </section>

        {renderSplit("right")}
        {wall ? null : renderRail("right")}

        {wall ? null : renderSplit("bottom")}
        {wall ? null : renderRail("bottom")}
      </div>

      {/* The variant's persistent chrome — the Source Catalog rail, and the ONLY
          surface in the product with per-layer map toggles for all 37 signal
          layers, the per-layer freshness dot and the "needs a key" badge. It must
          stay a DIRECT child of this element: `.tn-cw-shell > .tn-rail` re-homes
          it and `.tn-cw-shell:has(> .tn-rail)` makes it PUSH the grid instead of
          covering it. Nest it one level deeper and it silently reverts to the
          fixed base rule — the exact regression that removed it from the product
          once already. */}
      <PanelHost />

      {/* Where a new widget goes. Mounted HERE, once, rather than inside the
          Source Catalog rail next to the ＋ that opens it: the rail is
          position:fixed with its own scroller, so a popover rendered inside it
          would clip at the rail's edge and scroll away from its own button. */}
      <PlacementPicker />

      {/* The three slide-ins the rail's footer buttons open. Each reads its own
          open-store and renders null while closed, so mounting them costs
          nothing — but without them those buttons are dead controls. */}
      <CoveragePanel />
      <MarketsPanel />
      <WatchlistPanel />
    </div>
  );
}
