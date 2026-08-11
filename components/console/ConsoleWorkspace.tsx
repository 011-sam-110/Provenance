// components/console/ConsoleWorkspace.tsx
"use client";
import type { CSSProperties } from "react";
import { useShellLayout, shellLayoutStore } from "@/lib/console/store";
import type { SegmentId } from "@/lib/console/types";
import Segment from "@/components/console/Segment";
import StageHost from "@/components/console/StageHost";
import MapControls from "@/components/console/MapControls";
import WorldClock from "@/components/console/WorldClock";
import MapSearch from "@/components/console/MapSearch";
import PinNavigator from "@/components/console/PinNavigator";
import PanelHost from "@/components/shell/PanelHost";
import CoveragePanel from "@/components/shell/CoveragePanel";
import MarketsPanel from "@/components/shell/MarketsPanel";
import WatchlistPanel from "@/components/shell/WatchlistPanel";
import { getWidgetType } from "@/lib/console/registry";
import { stageRegionLabel } from "@/components/shell/a11y";
import { SKIP_TARGET_ID } from "@/components/shell/SkipLink";

// Full-bleed console: the map is a 100%×100% base layer and the three widget
// segments FLOAT over it as translucent glass columns (the calm-glass identity the
// old rail/dossier used, restored). The segment widths + bottom height ride out as
// CSS vars (--tn-lw/--tn-rw/--tn-bh) so the absolute grips and the MapLibre controls
// can position themselves off the same numbers the columns use.
//
// Those vars are also the ONLY place the sizes live: the columns take their width
// from `--tn-lw`/`--tn-rw` in CSS rather than an inline `style.width`. That matters
// on a phone — an inline width beats a stylesheet rule, so a fixed 300px column
// could not be dropped by a media query and the two columns rendered ON TOP of each
// other with a 0px-wide map between them. With the width in CSS, the ≤900px block in
// app/globals.css restacks the whole console vertically (map → left → right → bottom,
// which is already the DOM order below) with no !important and no JS breakpoint.

// Default column width — the reset target for a double-click / Home key. Matches
// createDefaultLayout() in lib/console/types.
const DEFAULT_SEG_SIZE = 300;
/** How far one arrow-key press moves a column edge. */
const GRIP_KEY_STEP = 24;

// The column resize grip.
//
// It used to be a 7px transparent strip: no resting appearance, no keyboard path,
// and nothing to aim at — you had to already know the edge was draggable and then
// hit a target a third of WCAG's 24px minimum. It is now 14px wide with a visible
// resting bar, a real focusable separator with arrow-key resizing, and a
// double-click (or Home) reset, so a mis-drag costs one click to undo.
function VGrip({ seg, dir, cls }: { seg: SegmentId; dir: 1 | -1; cls: string }) {
  const layout = useShellLayout();
  const size = layout.segments[seg].size;
  const label = `Resize the ${seg} column`;
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startSize = size;
    const move = (ev: PointerEvent) => shellLayoutStore.setSegment(seg, startSize + dir * (ev.clientX - startX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  // Arrow keys nudge, Home resets. `dir` flips the mapping for the right-hand
  // grip so ← always makes the map bigger on the left and smaller on the right —
  // i.e. the key moves the EDGE you are holding, not an abstract number.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = (e.key === "ArrowRight" ? 1 : -1) * dir * GRIP_KEY_STEP;
      shellLayoutStore.setSegment(seg, size + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      shellLayoutStore.setSegment(seg, DEFAULT_SEG_SIZE);
    }
  };
  return (
    <div
      className={`tn-grip ${cls}`}
      onPointerDown={onDown}
      onDoubleClick={() => shellLayoutStore.setSegment(seg, DEFAULT_SEG_SIZE)}
      onKeyDown={onKey}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={0}
      aria-valuemax={900}
      tabIndex={0}
      title={`${label}. Drag it, or focus it and press the left/right arrow keys. Double-click to reset.`}
    />
  );
}

export default function ConsoleWorkspace() {
  const layout = useShellLayout();
  const w = (s: SegmentId) => (layout.segments[s].collapsed ? 0 : layout.segments[s].size);
  const lw = w("left"), rw = w("right");
  // The bottom dock reserves screen only when it holds widgets — otherwise the map
  // runs to the viewport bottom. When shown, its size is a max-height cap (hug-content).
  const bottomShown = !layout.segments.bottom.collapsed && layout.widgets.some((x) => x.segment === "bottom");
  const bh = bottomShown ? layout.segments.bottom.size : 0;
  const vars = { "--tn-lw": `${lw}px`, "--tn-rw": `${rw}px`, "--tn-bh": `${bh}px` } as CSSProperties;

  // Ambient map overlays (map-view controls, world clock) show only over a live map —
  // never when a widget is fullscreened onto the stage (focused) or on a non-map stage.
  const showMapOverlays = layout.focusedWidgetId == null && (layout.stage === "map3d" || layout.stage === "map2d");

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

  return (
    <div className="tn-cw-shell" style={vars}>
      {/* The centre stage is the skip link's landing site, so it is a NAMED region
          with a real (visually-hidden) heading and tabIndex={-1}. Without the
          tabindex the browser scrolls here and leaves focus behind on the link,
          which is how most skip links quietly fail. */}
      <section
        className="tn-cw-stage"
        id={SKIP_TARGET_ID}
        tabIndex={-1}
        aria-labelledby="tn-cw-stage-h"
      >
        <h2 id="tn-cw-stage-h" className="tn-sr-only">{stageLabel}</h2>
        <StageHost stage={layout.stage} />
        {showMapOverlays && <MapControls />}
        {showMapOverlays && <MapSearch />}
        {showMapOverlays && <PinNavigator />}
        {showMapOverlays && <WorldClock />}
      </section>

      {/* Widths come from --tn-lw / --tn-rw (set on the shell above), NOT an inline
          style — see the note at the top of this file.

          Each column carries a visually-hidden <h2>. They are headings rather than
          landmarks on purpose: three more region landmarks would crowd the landmark
          menu, whereas headings give the page the outline it was missing entirely
          (h1 product → h2 region → h3 widget) and let a screen-reader user walk it
          with the H key. `.tn-sr-only` is position:absolute, so none of these
          headings is a flex/grid item and none of them moves a pixel. */}
      <div className="tn-cw-col tn-cw-col-left">
        <h2 className="tn-sr-only">Left widget column</h2>
        <Segment id="left" />
      </div>
      <VGrip seg="left" dir={1} cls="tn-grip-l" />

      <div className="tn-cw-col tn-cw-col-right">
        <h2 className="tn-sr-only">Right widget column</h2>
        <Segment id="right" />
      </div>
      <VGrip seg="right" dir={-1} cls="tn-grip-r" />

      {bottomShown && (
        <>
          {/* max-height also rides --tn-bh in CSS (same value as bottom.size whenever
              this branch renders), so the mobile block can lift the cap. */}
          <div className="tn-cw-bottom">
            <h2 className="tn-sr-only">Bottom widget dock</h2>
            <Segment id="bottom" />
          </div>
          <div className="tn-grip tn-grip-b"
               onPointerDown={(e) => {
                 e.preventDefault();
                 const startY = e.clientY, start = layout.segments.bottom.size;
                 const move = (ev: PointerEvent) => shellLayoutStore.setSegment("bottom", start - (ev.clientY - startY));
                 const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                 window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
               }}
               onDoubleClick={() => shellLayoutStore.setSegment("bottom", 220)}
               onKeyDown={(e) => {
                 if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                   e.preventDefault();
                   shellLayoutStore.setSegment("bottom", layout.segments.bottom.size + (e.key === "ArrowUp" ? 1 : -1) * GRIP_KEY_STEP);
                 } else if (e.key === "Home") {
                   e.preventDefault();
                   shellLayoutStore.setSegment("bottom", 220);
                 }
               }}
               role="separator" aria-orientation="horizontal"
               aria-label="Resize the bottom dock"
               aria-valuenow={Math.round(layout.segments.bottom.size)} aria-valuemin={0} aria-valuemax={900}
               tabIndex={0}
               title="Resize the bottom dock. Drag it, or focus it and press the up/down arrow keys. Double-click to reset." />
        </>
      )}

      {/* The variant's persistent chrome — the Source Catalog rail. It lives INSIDE
          the shell so it inherits --tn-lw (the left column's width): closed, its
          launcher parks at the map's top-left; open, `.tn-cw-shell:has(> .tn-rail)`
          insets the console so the drawer pushes the widget columns rather than
          covering them. See the block at the end of app/globals.css.

          Nothing had mounted this since the console rebuild, which took the full
          36-layer list, the per-layer map toggles, the per-layer freshness dot and
          the "needs a key" badge out of the product entirely. */}
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
