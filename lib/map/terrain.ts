// Whether a setTerrain call would actually change anything — the pure half.
//
// WHY THIS EXISTS. WorldMap syncs terrain from a map "zoom" handler, and MapLibre
// fires "zoom" once per RENDER FRAME for the whole of a wheel, pinch, easeTo or
// flyTo (HandlerManager._applyChanges -> _fireEvents, and Camera._fireMoveEvents
// for programmatic moves). An unconditional setTerrain on that handler is not a
// redundant no-op, it is destructive: Map.setTerrain's "add terrain" branch builds
// a new Terrain (discarding the terrain tile cache and the mesh cache) and a new
// RenderToTexture (a RenderPool of up to 30 render targets, 1024x1024 here) and
// NEVER destroys the pair it replaces. destroy()/destruct() live only on the
// removal branch. So every frame orphaned a pool of framebuffers and textures.
//
// Measured on a production build, one wheel-zoom over London on a real GPU:
//
//                        before      after this guard
//   setTerrain calls        53        1  (144 skipped)
//   WebGL context         LOST        survives
//   console errors         107        1
//   gesture wall time    38.5 s       6.7 s
//   zoom reached          8.45        11.13
//   frame gap mean/p95  84/248 ms     31/80 ms
//
// The context loss is the user-visible bug: GPU memory is exhausted, the driver
// kills the context, and WorldMap's own webglcontextlost handler is correct that
// it cannot be recovered in place. The map is frozen from then on.
//
// Kept pure and separate so it has a unit test: vitest here is the node
// environment with no React testing library, so the component cannot be mounted
// and this decision is the only part that can be pinned.

import type { TerrainSpecification } from "maplibre-gl";

/** MapLibre's own default when a TerrainSpecification omits `exaggeration`. */
const DEFAULT_EXAGGERATION = 1;

export const TERRAIN_EXAGGERATION = 1.3;

/** The terrain spec WorldMap wants for a given on/off decision. */
export function wantedTerrain(on: boolean, source: string): TerrainSpecification | null {
  return on ? { source, exaggeration: TERRAIN_EXAGGERATION } : null;
}

/**
 * Would setting `wanted` differ from what the map already has?
 *
 * `current` is whatever `map.getTerrain()` returns — the spec previously passed to
 * setTerrain, or null. Compares by value, because the caller builds a fresh object
 * every frame and an identity check would never match.
 */
export function terrainChanged(
  current: TerrainSpecification | null | undefined,
  wanted: TerrainSpecification | null,
): boolean {
  if (!current && !wanted) return false;
  if (!current || !wanted) return true;
  if (current.source !== wanted.source) return true;
  return (current.exaggeration ?? DEFAULT_EXAGGERATION) !== (wanted.exaggeration ?? DEFAULT_EXAGGERATION);
}

/**
 * Zoom at or above which true 3D terrain (setTerrain) may engage.
 *
 * setTerrain crashes MapLibre's depth pass on globe projection
 * ("Cannot read properties of undefined (reading 'shaderPreludeCode')"), so it is
 * held back until the camera has descended into the mercator regime.
 */
export const TERRAIN_MIN_ZOOM = 6;

/**
 * Zoom at or above which the hillshade RELIEF layer is drawn.
 *
 * This is a bandwidth gate, not a correctness one, and it was missing for the whole
 * of the globe-first console's life. The hillshade layer shares the Terrarium DEM
 * source with 3D terrain, but unlike setTerrain it is a normal layer that is legal
 * at any zoom — so it was added with no `minzoom` and only a `visibility` gate that
 * follows the terrain toggle, and that toggle defaults ON (lib/mapView.ts, an
 * unpersisted store) on every cold load.
 *
 * The result, measured against production on 2026-09-04: a globe resting at
 * HOME.zoom = 1.4 fetched 1,018 KB of Terrarium DEM PNGs across 11 requests to
 * shade relief that cannot be resolved on a sphere that size. On a Slow-4G / 4x-CPU
 * profile, blocking exactly those tiles moved time-to-map-load from 25.7 s to
 * 21.4 s. Nothing visible changes at globe zoom.
 *
 * It is deliberately the SAME value as TERRAIN_MIN_ZOOM: the DEM is worth
 * downloading once the camera is low enough for either feature to use it, and two
 * numbers that must agree are better written as two names in one file than as two
 * literals in two.
 *
 * MapLibre does not request tiles for a layer outside its zoom range — the same
 * mechanism the 3D-buildings layer already relies on to avoid pulling its z14
 * tiles on approach.
 */
export const HILLSHADE_MIN_ZOOM = TERRAIN_MIN_ZOOM;
