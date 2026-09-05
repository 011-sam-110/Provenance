"use client";
// The Terminal's stage chrome — the three pieces of UI that float OVER the map
// inside the stage cell: the centred search box, the right-hand stack (layer
// legend + the area filter), and the 24px bottom clock bar.
//
// THE 22px TOP BAR WENT FIRST, AND THE FEED HEALTH ROW IT EMPTIED INTO HAS NOW GONE
// TOO. Between them they took every view control off the screen:
//
//   * the projection switch, the basemap picker, Export (Report + Image) and Solo
//     moved from this bar to the FEED HEALTH row (StageControls.tsx), and were
//     deleted when that row was deleted. StageControls.tsx and ExportView.tsx are
//     gone from the tree, and so is StageSwitch.tsx, which nothing else rendered.
//   * SOLO IS A REAL REMOVAL, not a relocation. It was the only control that could
//     set the solo flag, so lib/terminal/solo.ts went with it — leaving the store
//     behind would have stranded anyone whose `solo: true` was already persisted
//     with no button left to switch it off, and a hidden board with no way back is
//     worse than a missing feature.
//   * the projection and the basemaps ARE still reachable, from the command palette only
//     ("Stage → 3D map", "Basemap → …"), because CommandPalette iterates the same
//     registries the buttons used to.
//   * STAGE·FLAT and the cursor coordinate readout were DELETED earlier, with the
//     22px bar. The label duplicated the 3D/2D switch; the coordinate readout had
//     no second home. WorldMap's `tn-map-cursor` dispatch went with it, because a
//     window event with no listener is work done every mousemove for nobody.
//
// TWO EXISTING COMPONENTS ARE RE-SKINNED, NOT REBUILT: MapSearch (geocode → drop a
// pin → fly) and WorldClock. They are rendered inside this file's frames and
// restyled by scoped CSS, so there is exactly one geocoder and one clock timer in
// the app. See the CSS block below for the overrides each one needs.
//
// ─── CSS THIS COMPONENT NEEDS (integrator owns app/globals.css) ───────────────
// All scoped under .tn-terminal, using the --tnx-* token block.
//
// SEARCH (restyle of components/console/MapSearch)
// .tnx-stage-search     position:absolute; top:30px; left:50%; transform:translateX(-50%);
//                       width:min(420px, calc(100% - 16px));
//                       z-index:6; display:flex; align-items:center; gap:6px; padding:0 8px;
//                       background:rgba(8,11,15,.9); border:1px solid var(--tnx-line-strong);
//                       pointer-events:auto;
// .tnx-stage-search-pfx font-size:11px; font-weight:700; color:var(--tnx-accent); flex:none;
//   /* MapSearch's root is position:absolute; top:12px; left:50%; translateX(-50%) — it has to
//      be flattened or it re-centres itself inside this frame instead of filling it. */
// .tnx-stage-search .tn-mapsearch        position:static; transform:none; width:100%;
//                                        max-width:none; flex:1; min-width:0;
// .tnx-stage-search .tn-mapsearch-bar    background:none; border:0; box-shadow:none;
//                                        border-radius:0; padding:4px 0; gap:0;
// .tnx-stage-search .tn-mapsearch-icon   display:none;   /* replaced by the "/" prefix */
// .tnx-stage-search .tn-mapsearch-input  font-size:10.5px; color:var(--tnx-ink);
//                                        font-family:inherit; min-height:0;
// .tnx-stage-search .tn-mapsearch-input::placeholder { color:var(--tnx-ink-ghost); }
// .tnx-stage-search .tn-mapsearch-results{ margin-top:5px; border-radius:0;
//                                        background:rgba(8,11,15,.96);
//                                        border:1px solid var(--tnx-line-strong); box-shadow:none; }
// .tnx-stage-search .tn-mapsearch-item   font-size:10.5px; color:var(--tnx-ink); padding:5px 8px;
// .tnx-stage-search .tn-mapsearch-item:hover { background:var(--tnx-accent-soft); }
// .tnx-stage-search .tn-mapsearch-item-meta,
// .tnx-stage-search .tn-mapsearch-status { font-size:9px; color:var(--tnx-ink-faint); }
//
// RIGHT-HAND STACK — the area filter, and the camera picker under it
// .tnx-stage-right      position:absolute; top:30px; right:8px; z-index:6; width:200px;
//                       display:flex; flex-direction:column; align-items:stretch; gap:6px;
//                       pointer-events:none;   /* children re-enable it */
//   /* The .tnx-stage-legend / .tnx-legend-* rules that used to be specified here are
//      deleted from globals.css along with the key itself. */
//
// CLOCK BAR (restyle of components/console/WorldClock)
// .tnx-stage-foot       position:absolute; left:0; right:0; bottom:0; height:24px; z-index:6;
//                       display:flex; align-items:center; padding:0 8px;
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
// .tnx-stage-foot .tn-worldclock { display:flex; }   /* undo the <900px display:none if the
//                                  Terminal footer should keep the clocks on narrow screens */
//
// ATTRIBUTION — a licensing requirement (OpenFreeMap/OpenMapTiles/OSM, Esri,
// OpenTopoMap, CARTO), and it is
// MapLibre's own AttributionControl (WorldMap.tsx:1322), not text we write, so it
// stays correct when the basemap changes. It shares one bottom-right container with
// the NavigationControl, so both are raised clear of the 24px clock bar:
// .tn-terminal .maplibregl-ctrl-bottom-right { bottom:28px; right:8px; }
// .tn-terminal .maplibregl-ctrl-attrib       { background:rgba(8,11,15,.85); font-size:9px;
//                                              color:var(--tnx-ink-ghost); }
// .tn-terminal .maplibregl-ctrl-attrib a     { color:var(--tnx-ink-faint); }

import { useShellLayout } from "@/lib/console/store";
import CameraTray from "@/components/console/CameraTray";
import MapRail, { MAP_RAIL_ID } from "@/components/console/maprail/MapRail";
import { mapRailStore } from "@/lib/console/mapRail";
export { STAGE_SEARCH_ID } from "@/components/console/maprail/SearchFlyout";
import { STAGE_SEARCH_ID as SEARCH_ID } from "@/components/console/maprail/SearchFlyout";
import WorldClock from "@/components/console/WorldClock";


/**
 * Focus the stage search box. Returns false when it is not on screen — the stage
 * chrome unmounts while a widget is focused onto the stage — so a caller can
 * decide whether to swallow the keystroke or let it type a literal "/".
 *
 * Exported so the shell's keyboard handler does not have to know that the search
 * frame wraps a component whose input it would otherwise have to guess at.
 */
export function focusStageSearch(): boolean {
  // Is the rail on screen at all? The stage chrome unmounts while a widget is
  // expanded onto the stage, and returning false there is the existing contract:
  // ConsoleShell does NOT preventDefault, so "/" types a literal slash and
  // Firefox's quick-find still opens.
  if (!document.getElementById(MAP_RAIL_ID)) return false;

  // Already open — focus and select, so a second "/" types over an old query.
  const input = document.getElementById(SEARCH_ID)?.querySelector("input");
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.select();
    return true;
  }

  // Closed. Open it and let SearchFlyout focus its own input on mount: React has
  // not rendered the input yet on this tick, so there is nothing to focus here.
  // Returning true before the focus lands is correct — the return value answers
  // "did we act on this keystroke", and we did.
  mapRailStore.open("search");
  return true;
}

// THE STAGE LEGEND IS GONE — the key that listed CAMERAS, — OFFLINE, SATELLITES,
// WEBCAMS and every signal layer that was switched on, in the colours the map was
// painting them.
//
// It took a component (StageLegend), a hook (useLegendRows) and two helpers
// (familySwatch, MAX_LEGEND_ROWS) with it, and with those the only reason this file
// imported useLayers, useSignals, SIGNALS and five colour tables from lib/icons/svg.
// Those imports are removed too: the legend was the single consumer, and a stage bar
// that still subscribed to every layer store in order to render nothing would re-run
// on each toggle for no output.
//
// WHAT IS LOST IS REAL, and is worth stating rather than glossing. The legend was
// DERIVED — it listed the layers that were actually on, in the colours the map
// actually used, which is why it could not assert a colour the map did not paint.
// Nothing else on the stage names a layer's colour now. The Sources rail still lists
// every layer and its on/off state, and clicking a pin still opens a dossier naming
// its source, so no layer is unidentifiable; but reading the map by colour alone is
// no longer something the console teaches.

export default function StageBar() {
  const { stage, focusedWidgetId } = useShellLayout();

  // The same gate ConsoleWorkspace applies to MapControls/MapSearch/PinNavigator/
  // WorldClock (ConsoleWorkspace.tsx:101). Without it, this chrome floats on top of
  // a widget that has been expanded onto the stage — a search box and a legend
  // painted over a fullscreened chart. Keeping the gate inside the component means
  // the shell can mount <StageBar /> unconditionally.
  //
  // In a Terminal layout that never focuses a widget onto the stage this is inert,
  // which is the correct cost for a guard that cannot then be forgotten.
  if (focusedWidgetId != null || (stage !== "map3d" && stage !== "map2d")) return null;

  return (
    <>
      {/*
        THE STAGE RAIL replaces both things that used to live here: the centred
        search box, and the right-hand text stack (AoiControl + CameraPickControl).
        Four icon groups on the right edge, one flyout open at a time, expanding
        leftward into the map. See components/console/maprail/MapRail.tsx.
      */}
      <MapRail />

      {/* The tray. Bottom of the STAGE, not of the viewport — it is about the map,
          and a bar pinned to the window would sit over whichever widget happened to
          be at the foot of the board. It renders nothing at all when the basket is
          empty and picking is off. */}
      <CameraTray />

      {/*
        THE CLOCKS ARE CENTRED UNDER THE GLOBE, and the flex spacer that used to sit
        beside them is gone rather than kept at width zero. It existed to push the
        clock hard left and reserve the right-hand end for an attribution that was
        never typed there — attribution is a licensing requirement for OpenFreeMap,
        Esri, OpenTopoMap and CARTO and it changes with the basemap, so it stays
        MapLibre's own AttributionControl (WorldMap.tsx, raised by CSS to sit just
        above this bar). With nothing to reserve, a spacer is just an off-centre
        clock: `justify-content: center` on `.tnx-stage-foot` does the centring and
        this element has no second job to justify keeping it.
      */}
      <div className="tnx-stage-foot">
        <WorldClock />
      </div>
    </>
  );
}
