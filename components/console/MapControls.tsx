"use client";
// The map-view control cluster, floated at the top-right corner of the centre stage
// (moved out of the top bar). Holds the 3D/2D projection switch and the basemap
// picker — both are properties of the map, so they live on the map. ConsoleWorkspace
// mounts this only while a map stage is showing and no widget is focused, so it (like
// the world clock) vanishes the moment a widget is fullscreened onto the stage.

import { useMapView, mapViewStore } from "@/lib/mapView";
import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";
import StageSwitch from "@/components/console/StageSwitch";

export default function MapControls() {
  const view = useMapView();
  return (
    <div className="tn-map-controls">
      <StageSwitch />
      <div className="tn-basemap" role="group" aria-label="Basemap">
        {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
          <button
            key={k}
            type="button"
            className="tn-basemap-btn"
            aria-pressed={view.basemap === k}
            onClick={() => mapViewStore.setBasemap(k)}
          >
            {BASEMAPS[k].label}
          </button>
        ))}
      </div>
    </div>
  );
}
