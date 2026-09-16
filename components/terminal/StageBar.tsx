"use client";
// The Terminal's stage chrome — what still floats OVER the map inside the stage
// cell. It is two things now: the camera tray along the bottom of the stage, and
// the 24px clock strip.
//
// ─── THE STAGE RAIL IS GONE FROM HERE (2026-09-16) ────────────────────────────
// This file used to mount <MapRail/> — the two icon groups on the right edge of the
// map, Search and View settings, with one flyout open at a time. Sam asked for both
// to move onto the Inspector panel's new tool rail, together with "Draw an area",
// which came off the Sources tab. They are all
// components/shell/inspector/InspectorRail.tsx now, and components/console/maprail/
// is deleted rather than left unmounted — an exported component nothing renders
// still greps as live art and still has to be read by whoever comes next, which is
// the argument RailIcons.tsx made for the six glyphs it retired the same way.
//
// focusStageSearch() WENT WITH IT, and it is worth being precise about what that
// means, because the function's contract outlived it. The console's search shortcut
// still returns a boolean and ConsoleShell still preventDefaults only on a truthy
// return (tests/unit/search-shortcut-contract.test.ts holds that across both
// files); what changed is WHERE the box is, so the function is now
// focusInspectorSearch() in InspectorRail.tsx. StageBar no longer has an opinion
// about search at all.
//
// ─── CSS THIS COMPONENT NEEDS (integrator owns app/globals.css) ───────────────
// All scoped under .tn-terminal, using the --tnx-* token block.
//
// CLOCK BAR (restyle of components/console/WorldClock)
// .tnx-stage-foot       position:absolute; left:0; right:0; bottom:0; height:24px; z-index:6;
//                       display:flex; align-items:center; justify-content:center; padding:0 8px;
//                       background:rgba(8,11,15,.88); backdrop-filter:blur(6px);
//                       -webkit-backdrop-filter:blur(6px); pointer-events:none;
//   /* WorldClock's root is an absolutely-positioned rounded glass ribbon; flatten it. */
// .tnx-stage-foot .tn-worldclock   position:static; transform:none; display:flex; padding:0;
//                                  border:0; border-radius:0; background:none; box-shadow:none;
//                                  backdrop-filter:none; -webkit-backdrop-filter:none;
// .tnx-stage-foot .tn-wc-cell      flex-direction:row; align-items:baseline; gap:5px;
//                                  padding:0 9px; min-width:0;
// .tnx-stage-foot .tn-wc-cell + .tn-wc-cell::before { background:var(--tnx-line); }
// .tnx-stage-foot .tn-wc-glyph     display:none;
// .tnx-stage-foot .tn-wc-city      order:-1; font-size:9px; font-weight:400; letter-spacing:.1em;
//                                  color:var(--tnx-ink-faint);
// .tnx-stage-foot .tn-wc-time      font-size:11px; font-weight:700; letter-spacing:0;
//                                  color:var(--tnx-ink); font-variant-numeric:tabular-nums;
// .tnx-stage-foot .tn-wc-cell.is-night .tn-wc-time { color:var(--tnx-ink); }
//   /* London tinted accent. POSITIONAL, and knowingly so: WorldClock renders one cell per
//      entry of its CITIES array and puts no per-city hook in the DOM, so index 2 (LA, NYC,
//      →LDN) is the only handle CSS has. If CITIES ever changes, this tints the wrong city —
//      cosmetic, not a lie, but fix it here (components/console/WorldClock.tsx:14-22). */
// .tnx-stage-foot .tn-wc-cell:nth-child(3) .tn-wc-time { color:var(--tnx-accent); }
//
// THE CLOCKS ARE CENTRED, and the flex spacer that used to sit beside them is gone
// rather than kept at width zero. It existed to push the clock hard left and reserve
// the right-hand end for an attribution that was never typed there — attribution is
// a licensing requirement for OpenFreeMap, Esri, OpenTopoMap and CARTO and it
// changes with the basemap, so it stays MapLibre's own AttributionControl
// (WorldMap.tsx, raised by CSS to sit just above this bar). With nothing to reserve,
// a spacer is just an off-centre clock.
//
// ATTRIBUTION — a licensing requirement, not styling:
// .tn-terminal .maplibregl-ctrl-bottom-right { bottom:28px; right:8px; }
// .tn-terminal .maplibregl-ctrl-attrib       { background:rgba(8,11,15,.85); font-size:9px;
//                                              color:var(--tnx-ink-ghost); }
// .tn-terminal .maplibregl-ctrl-attrib a     { color:var(--tnx-ink-faint); }

import { useShellLayout } from "@/lib/console/store";
import CameraTray from "@/components/console/CameraTray";
import WorldClock from "@/components/console/WorldClock";

export default function StageBar() {
  const { stage, focusedWidgetId } = useShellLayout();

  // The same gate ConsoleWorkspace applies to MapControls/MapSearch/PinNavigator/
  // WorldClock (ConsoleWorkspace.tsx:101). Without it, this chrome floats on top of
  // a widget that has been expanded onto the stage — a tray and a clock strip
  // painted over a fullscreened chart. Keeping the gate inside the component means
  // the shell can mount <StageBar /> unconditionally.
  //
  // In a Terminal layout that never focuses a widget onto the stage this is inert,
  // which is the correct cost for a guard that cannot then be forgotten.
  if (focusedWidgetId != null || (stage !== "map3d" && stage !== "map2d")) return null;

  return (
    <>
      {/* The tray. Bottom of the STAGE, not of the viewport — it is about the map,
          and a bar pinned to the window would sit over whichever widget happened to
          be at the foot of the board. It renders nothing at all when the basket is
          empty and picking is off. */}
      <CameraTray />

      <div className="tnx-stage-foot">
        <WorldClock />
      </div>
    </>
  );
}
