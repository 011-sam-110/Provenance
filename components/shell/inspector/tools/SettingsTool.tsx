"use client";
// The Map settings tool — projection, basemap, terrain, 3D buildings. It was the
// stage rail's View flyout (components/console/maprail/ViewFlyout.tsx): a lateral
// strip of chips over the map, sized for a 40px column. The panel is a column now,
// so every control is a labelled ROW and the abbreviations the strip needed are
// gone with it (see lib/console/viewControls.ts).
//
// THESE CONTROLS USED TO LIVE ON THE STAGE and were deleted wholesale when the
// console was stripped to a bare globe (#153), which routed the basemap and the
// 2D/3D switch into the command palette and nothing else — leaving the map's own
// view settings with no on-screen home. This is that home; it moved off the map's
// edge and into the Inspector on 2026-09-16.
//
// TERRAIN AND 3D BUILDINGS HAVE NEVER HAD ANY OTHER CONTROL. Both live in
// mapViewStore, both are read by WorldMap on every style load, and nothing else in
// the app calls their setters.
//
// 2D/3D WRITES THE BOARD'S STAGE, NOT viewModeStore, and that is not a detail.
// StageHost sets viewModeStore from the active board's stage in a mount effect, so
// layout.stage is upstream and viewModeStore is downstream. Writing the store
// directly produces a value that is correct until the next mount and then silently
// reverts — lib/shell/viewMode.ts's own header warns about exactly this. It also
// matches the only other caller: CommandPalette's "Stage → 3D map" calls
// shellLayoutStore.stage() and nothing else, and two controls for one concept must
// not use two mechanisms. The switch does not remount the map: StageHost returns
// <WorldMap/> for both stages, so this is a projection change, not a WebGL rebuild.

import { BASEMAPS } from "@/lib/basemaps";
import { mapViewStore, useMapView } from "@/lib/mapView";
import { shellLayoutStore, useShellLayout } from "@/lib/console/store";
import { basemapKeys, modeForStage, stageForMode } from "@/lib/console/viewControls";

export default function SettingsTool() {
  const view = useMapView();
  const { stage } = useShellLayout();
  const mode = modeForStage(stage);

  // NO HEAD OF ITS OWN — InspectorPanel renders the panel head once for every tool.
  return (
    <>
      {/* ONE button, not a pair, and it is labelled with what you will GET rather
          than with what is on. That is this product's own convention: the console
          header's skin button reads `skin === "dark" ? "LIGHT" : "DARK"`. Two
          buttons for two mutually exclusive states spend a row to say something one
          button already says. */}
      <div className="tn-insp-tool-row">
        <span className="tn-insp-tool-lab">Projection</span>
        <button
          type="button"
          className="tn-insp-proj"
          onClick={() => shellLayoutStore.stage(stageForMode(mode === "3d" ? "2d" : "3d"))}
          title={
            mode === "3d"
              ? "Showing the 3D globe. Switch to the flat 2D map."
              : "Showing the flat 2D map. Switch to the 3D globe."
          }
        >
          {mode === "3d" ? "2D" : "3D"}
        </button>
      </div>

      {/* Iterated from the registry and never hand-listed: lib/basemaps.ts states
          that its key order is load-bearing. A sixth basemap appears here with no
          edit, and tests/unit/view-controls.test.ts fails if the registry and the
          helper disagree.

          A RADIOGROUP, NOT A SEGMENTED PAIR OF CHIPS. Three full names do not fit
          across a 380px column as chips with any breathing room, and this is the one
          setting on the tool whose options are worth reading rather than decoding. */}
      <div className="tn-insp-tool-lab-row" id="tn-insp-basemap" role="radiogroup" aria-label="Basemap">
        <span className="tn-insp-tool-lab">Basemap</span>
        {basemapKeys().map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={view.basemap === k}
            tabIndex={view.basemap === k ? 0 : -1}
            className="tn-insp-choice"
            onClick={() => mapViewStore.setBasemap(k)}
          >
            <span className="tn-insp-choice-dot" aria-hidden />
            {BASEMAPS[k].label}
          </button>
        ))}
      </div>

      <div className="tn-insp-tool-row">
        <span className="tn-insp-tool-lab">Terrain</span>
        <button
          type="button"
          className="tn-insp-switch"
          role="switch"
          aria-checked={view.terrain}
          onClick={() => mapViewStore.setTerrain(!view.terrain)}
          // Honest about when it does anything. WorldMap only attaches the DEM above
          // TERRAIN_MIN_ZOOM (6) and only outside the globe regime, so switching this
          // on at world zoom changes nothing you can see. Saying so is better than
          // shipping a toggle that silently no-ops — and the sentence is repeated
          // under the rows rather than hidden in a `title`, because a tooltip is not
          // where a condition like that survives contact with a user.
          title="3D terrain. Takes effect once you zoom past about level 6, on the flat map."
        >
          <span className="tn-insp-switch-knob" aria-hidden />
        </button>
      </div>

      <div className="tn-insp-tool-row">
        <span className="tn-insp-tool-lab">Buildings</span>
        <button
          type="button"
          className="tn-insp-switch"
          role="switch"
          aria-checked={view.buildings}
          onClick={() => mapViewStore.setBuildings(!view.buildings)}
          title="Raise buildings at street level"
        >
          <span className="tn-insp-switch-knob" aria-hidden />
        </button>
      </div>

      <p className="tn-insp-tool-foot">
        Terrain only paints past about zoom 6, and only on the flat map.
      </p>
    </>
  );
}
