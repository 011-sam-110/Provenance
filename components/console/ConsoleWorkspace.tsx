// components/console/ConsoleWorkspace.tsx
"use client";
import { useMemo, type CSSProperties } from "react";
import { useShellLayout, shellLayoutStore } from "@/lib/console/store";
import type { SegmentId, WidgetInstance } from "@/lib/console/types";
import { widgetsInSegment } from "@/lib/console/reducers";
import { dropIndex } from "@/lib/console/resize";
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
import { useTerminalMode } from "@/lib/terminal/mode";
import { terminalGrid } from "@/lib/terminal/grid";

// The OpenData Terminal workspace: ONE named-area CSS grid holding the map stage and
// every widget, in two templates (CONSOLE = map-dominant, WALL = everything equal).
//
// ── WHAT THIS REPLACED, AND WHY BOTH COULD NOT BE KEPT ───────────────────────
// The previous workspace was an absolute-positioning canvas: `.tn-cw-stage`,
// `.tn-cw-col-left/right` and `.tn-cw-bottom` all sized themselves off three runtime
// CSS vars (--tn-lw/--tn-rw/--tn-bh) written inline on the shell, with `.tn-grip`
// splitter handles pinned to the same numbers. That model and a named-area grid are
// mutually exclusive on the same element — a `position:absolute` child escapes its
// grid area entirely — and `terminalModeStore` has no "off" value, so there is no
// state in which the old path would ever render. Carrying a dead second layout in
// this file would have meant every future reader reverse-engineering which of two
// mutually exclusive systems was live. So the old path is GONE, deliberately, and
// the two things it uniquely provided are accounted for:
//
//   • Column resize (`.tn-grip`, role="separator", arrow-key operable) is REMOVED.
//     The Terminal's columns are fixed by lib/terminal/grid (300px rail / 250px
//     cards in CONSOLE, six equal tracks in WALL). Keeping a splitter that cannot
//     move anything would be a control that lies. tests/e2e/console.spec.ts is
//     updated in the same change rather than left to fail silently.
//   • The three visually-hidden column headings are replaced by ONE heading per
//     segment run — see the note above the slot loop.
//
// ── WHAT IS UNCHANGED, ON PURPOSE (each of these is load-bearing) ────────────
//   • `.tn-cw-shell` survives as the outer element. `.tn-alert ~ .tn-cw-shell`
//     reserves the breaking-banner band by sibling combinator, and the Source
//     Catalog rail is styled by `.tn-cw-shell > .tn-rail` / `:has(> .tn-rail)` —
//     both silently stop matching if this class or PanelHost's depth changes.
//   • `.tn-cw-stage` keeps id={SKIP_TARGET_ID} and tabIndex={-1}. Without the
//     tabindex the skip link scrolls and leaves focus behind, which is how most
//     skip links quietly fail and why no test would catch it.
//   • <StageHost> is mounted in ONE stable React position and is never keyed on the
//     mode. A remount costs a WebGL context, a full basemap style fetch, the
//     countries geojson, ~18 re-rasterised sprites and ~19k camera features. The
//     mode switch changes the CONTAINER's style object and nothing else — which is
//     also why lib/terminal/grid names areas by index rather than by widget id.
//   • Each widget wrapper is `.tn-seg-slot` carrying data-widget-id, inside a
//     container carrying `.tn-seg`. WidgetFrame.measureSeg() does
//     closest(".tn-seg") / closest(".tn-seg-slot") at pointer-down and returns null
//     — a dead handle, no error — if either ancestor is missing.
//   • PanelHost / CoveragePanel / MarketsPanel / WatchlistPanel stay mounted, and
//     PanelHost stays a DIRECT child of `.tn-cw-shell`. The three panels render null
//     while closed; without them the rail's three footer buttons are dead controls.

/**
 * Screen-reader names for a segment run. `Record<SegmentId, …>` rather than a lookup
 * with a fallback, so a fourth segment id would fail the typecheck instead of
 * rendering an unnamed heading.
 */
const SEGMENT_HEADING: Record<SegmentId, string> = {
  left: "Left widget column",
  right: "Right widget column",
  bottom: "Bottom widget dock",
};

/** Widget ids per segment, in board order — the input lib/terminal/grid wants. */
function segmentIds(layout: ReturnType<typeof shellLayoutStore.get>, seg: SegmentId): string[] {
  return widgetsInSegment(layout, seg).map((w) => w.id);
}

/**
 * Turn a drop position in the flattened board into a (segment, index) move.
 *
 * The old Segment.tsx had one drop zone per segment, so the segment was implied by
 * which element received the event. There is one grid now, so the segment has to be
 * READ BACK from the card the drop landed on — which is why every slot below carries
 * `data-segment` as well as `data-widget-id`. Dropping onto another segment's region
 * therefore moves the widget between segments, which the old three-zone version also
 * did; nothing is lost.
 *
 * `others` excludes the dragged card (the caller filters it out), so `flatIndex`
 * addresses a gap in that list: `flatIndex === others.length` means "after
 * everything", which appends to the last card's segment rather than guessing.
 */
function dropTarget(
  others: readonly HTMLElement[],
  flatIndex: number,
): { segment: SegmentId; index: number } {
  const before = others[flatIndex];
  const anchor = before ?? others[others.length - 1];
  const segment = (anchor?.dataset.segment as SegmentId | undefined) ?? "left";
  // Position WITHIN that segment = how many of its cards the drop is past. An empty
  // board (no other cards at all) falls through to index 0 of the left segment.
  const upTo = before ? flatIndex : others.length;
  let index = 0;
  for (let i = 0; i < upTo; i++) if (others[i].dataset.segment === segment) index += 1;
  return { segment, index };
}

export default function ConsoleWorkspace() {
  const layout = useShellLayout();
  const mode = useTerminalMode();

  const spec = useMemo(
    () =>
      terminalGrid({
        mode,
        left: segmentIds(layout, "left"),
        right: segmentIds(layout, "right"),
        bottom: segmentIds(layout, "bottom"),
      }),
    [mode, layout],
  );

  // Grid templates are the one thing here that genuinely has to be computed at
  // runtime — the areas string depends on how many widgets are on the board — so
  // they are inline while every colour, rule and size stays in the stylesheet.
  const gridStyle: CSSProperties = {
    gridTemplateAreas: spec.areas,
    gridTemplateColumns: spec.columns,
    gridTemplateRows: spec.rows,
  };

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

  const byId = useMemo(() => {
    const m = new Map<string, WidgetInstance>();
    for (const w of layout.widgets) m.set(w.id, w);
    return m;
  }, [layout.widgets]);

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

  const onDrop = (e: React.DragEvent) => {
    const wid = e.dataTransfer.getData("text/tn-widget");
    if (!wid) return;
    e.preventDefault();
    const others = ([...e.currentTarget.querySelectorAll("[data-widget-id]")] as HTMLElement[])
      .filter((c) => c.dataset.widgetId !== wid);
    const rects = others.map((c) => c.getBoundingClientRect());
    const target = dropTarget(others, dropIndex({ x: e.clientX, y: e.clientY }, rects));
    shellLayoutStore.move(wid, target.segment, target.index);
  };

  // Which slot opens a new segment run, so exactly one visually-hidden heading is
  // emitted per segment. The old shell had three fixed headings because it had three
  // fixed containers; the grid has one container, and a screen-reader user still
  // needs to know where "the left column" starts and ends when walking by heading.
  let lastSegment: SegmentId | null = null;

  return (
    <div className="tn-cw-shell tn-terminal" data-terminal-mode={mode} style={legacyVars}>
      {/* The grid itself is a separate element from `.tn-cw-shell`, and that is not
          incidental: grid areas only apply to DIRECT children of the grid container,
          while the rail (PanelHost) has to stay a direct child of `.tn-cw-shell` for
          `.tn-cw-shell > .tn-rail` to match. One element cannot be both without the
          rail becoming an auto-placed grid item.

          It carries `.tn-seg` so WidgetFrame's closest(".tn-seg") still resolves —
          to a real, distinct ancestor of `.tn-seg-slot`, not to the slot itself. The
          scoped block in globals.css re-tunes `.tn-seg`'s twelve-column console
          styling into the terminal template. */}
      <div
        className="tn-seg"
        style={gridStyle}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/tn-widget")) e.preventDefault();
        }}
        onDrop={onDrop}
      >
        <section
          className="tn-cw-stage"
          id={SKIP_TARGET_ID}
          tabIndex={-1}
          aria-labelledby="tn-cw-stage-h"
          style={{ gridArea: spec.stage ?? undefined }}
        >
          <h2 id="tn-cw-stage-h" className="tn-sr-only">{stageLabel}</h2>
          <StageHost stage={layout.stage} />
          {/* The Terminal's stage chrome — top bar (projection, basemaps, cursor),
              search, legend, clock bar. It REPLACES MapControls / MapSearch /
              WorldClock, which must not also be mounted or the app gets two
              geocoders, two clock timers and two projection switches. */}
          <StageBar />
          {showMapOverlays && <PinNavigator />}
        </section>

        {spec.slots.map((slot) => {
          const w = byId.get(slot.id);
          if (!w) return null;
          const opensRun = w.segment !== lastSegment;
          lastSegment = w.segment;
          return (
            <div
              // Keyed on the instance id, never the area name: area names are
              // positional, so keying on them would make React reuse one widget's
              // DOM for another after a reorder.
              key={slot.id}
              data-widget-id={w.id}
              data-segment={w.segment}
              className="tn-seg-slot"
              style={{ gridArea: slot.area }}
            >
              {opensRun && <h2 className="tn-sr-only">{SEGMENT_HEADING[w.segment]}</h2>}
              <WidgetFrame instance={w} />
            </div>
          );
        })}
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
