// A one-slot registry for the live MapLibre instance.
//
// WorldMap keeps its map in a component ref, which is right — nothing outside it
// should be steering the camera. But an export control has to READ the map: its
// centre, its zoom, its canvas. Threading a ref through the console layout to
// reach a button in the map's own control cluster would couple half the tree to
// a detail neither end cares about.
//
// So: one module-level slot. Write-once-per-mount by WorldMap, cleared on
// unmount, read by anyone. Deliberately NOT a store with subscribers — nothing
// should re-render because a map appeared, and a subscriber list here would be
// an invitation to build exactly the coupling this avoids.
//
// Null is a normal, expected value: the stage can be a fullscreened widget, and
// during SSR there is no map at all. Every caller handles it.

import type { Map as MapLibreMap } from "maplibre-gl";

let current: MapLibreMap | null = null;

export function setMapInstance(map: MapLibreMap | null): void {
  current = map;
}

/** The live map, or null when no map is mounted. Never throws. */
export function getMapInstance(): MapLibreMap | null {
  return current;
}
