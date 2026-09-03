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
