"use client";
// The View group: projection, basemap, terrain, 3D buildings.
//
// These controls used to live in a row on the stage and were deleted wholesale
// when the console was stripped to a bare globe (#153), which routed the basemap
// and the 2D/3D switch into the ⌘K palette and nothing else. That left the map's
// own view settings with no on-screen home at all. This puts them back.
//
// TERRAIN AND 3D BUILDINGS HAVE NEVER HAD A CONTROL. Both live in mapViewStore,
// both are read by WorldMap on every style load, and nothing in the app has ever
// called their setters. This is their first UI.
//
// 2D/3D WRITES THE BOARD'S STAGE, NOT viewModeStore, and that is not a detail.
// StageHost sets viewModeStore from the active board's stage in a mount effect,
// so layout.stage is upstream and viewModeStore is downstream. Writing the store
// directly produces a value that is correct until the next mount and then
// silently reverts — lib/shell/viewMode.ts's own header warns about exactly this.
// It also matches the only other caller: CommandPalette's "Stage → 3D map" calls
// shellLayoutStore.stage() and nothing else, and two controls for one concept
// must not use two mechanisms. The switch does not remount the map: StageHost
// returns <WorldMap/> for both stages, so this is a projection change, not a
// WebGL rebuild.
//
// THE DARK/LIGHT PAIR BUTTON HAS GONE, and so has the skin note that used to sit
// here about ConsoleShell swapping the basemap when the skin changed. There is no
// skin to change any more and no Dark or Light basemap to swap to — the console is
// light, and the strip offers the three basemaps that are actually different maps.

import { BASEMAPS } from "@/lib/basemaps";
import { mapViewStore, useMapView } from "@/lib/mapView";
import { shellLayoutStore, useShellLayout } from "@/lib/console/store";
import {
  RAIL_BASEMAP_LABEL,
  modeForStage,
  railBasemapKeys,
  stageForMode,
} from "@/lib/console/mapRail";

export default function ViewFlyout() {
  const view = useMapView();
  const { stage } = useShellLayout();
  const mode = modeForStage(stage);

  return (
    <>
      <span className="tnx-maprail-label" aria-hidden>
        View
      </span>
      {/* ONE button, not a pair, and it is labelled with what you will GET rather
          than with what is on. That is this product's own convention: the console
          header's skin button reads `skin === "dark" ? "LIGHT" : "DARK"`. Two
          buttons for two mutually exclusive states spend a chip of strip width to
          say something one button already says. */}
      <button
        type="button"
        className="tnx-maprail-act"
        onClick={() => shellLayoutStore.stage(stageForMode(mode === "3d" ? "2d" : "3d"))}
        title={
          mode === "3d"
            ? "Showing the 3D globe. Switch to the flat 2D map."
            : "Showing the flat 2D map. Switch to the 3D globe."
        }
      >
        {mode === "3d" ? "2D" : "3D"}
      </button>

      <span className="tnx-maprail-rule" aria-hidden />

      {/* Iterated from the registry and never hand-listed: lib/basemaps.ts
          states that its key order is load-bearing. A sixth basemap appears here
          with no edit, and tests/unit/map-rail.test.ts fails if it has no label. */}
      <span className="tnx-maprail-seg" role="radiogroup" aria-label="Basemap">
        {railBasemapKeys().map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={view.basemap === k}
            tabIndex={view.basemap === k ? 0 : -1}
            className="tnx-maprail-act"
            onClick={() => mapViewStore.setBasemap(k)}
            // The full name rides in the title, so the abbreviation on the chip
            // is never the only name the user is given.
            title={BASEMAPS[k].label}
          >
            {RAIL_BASEMAP_LABEL[k]}
          </button>
        ))}
      </span>

      <span className="tnx-maprail-rule" aria-hidden />

      <button
        type="button"
        className="tnx-maprail-act"
        aria-pressed={view.terrain}
        onClick={() => mapViewStore.setTerrain(!view.terrain)}
        // Honest about when it does anything. WorldMap only attaches the DEM
        // above TERRAIN_MIN_ZOOM (6) and only outside the globe regime, so
        // switching this on at world zoom changes nothing you can see. Saying so
        // is better than shipping a toggle that silently no-ops.
        title="3D terrain. Takes effect once you zoom past about level 6, on the flat map."
      >
        Terrain
      </button>
      <button
        type="button"
        className="tnx-maprail-act"
        aria-pressed={view.buildings}
        onClick={() => mapViewStore.setBuildings(!view.buildings)}
        title="Raise buildings at street level"
      >
        Buildings
      </button>
    </>
  );
}
