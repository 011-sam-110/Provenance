// 3D buildings for the unified MapLibre engine — the pure, testable half.
//
// WHY THIS IS APP-OWNED RATHER THAN A BASEMAP FEATURE. Of the five OpenFreeMap
// styles, only Liberty ships a fill-extrusion layer at all, and we do not own any
// remote style's layer list. If buildings were left to the basemap they would exist
// on exactly one of our five basemaps. So WorldMap adds its own extrusion layer,
// which means buildings rise over Dark, Topographic and — the payoff — over Esri
// satellite imagery too.
//
// The two facts that shape everything below, both measured against the live
// endpoints on 2026-09-03:
//
//   • https://tiles.openfreemap.org/planet is TileJSON 3.0, minzoom 0 / maxzoom 14,
//     and its `building` vector layer carries render_height, render_min_height,
//     hide_3d and colour, from z13. A real z14 tile over central London
//     (14/8186/5448) came back in 0.27 s at 569 KB — fat, and a pitched street view
//     pulls several, which is why this is a toggle and not just always on.
//   • Both OpenFreeMap styles already carry that same TileJSON as their
//     `openmaptiles` source. Reusing it there means one set of tiles fetched once
//     rather than the same bytes under two source ids.
//
// WorldMap owns the MapLibre side effects; everything here is pure so it can be
// unit-tested in the node vitest env, which cannot mount WorldMap at all.

import type { BasemapKey } from "@/lib/basemaps";

/**
 * The vector source id we add when the active style has none of its own.
 * Namespaced `tn-` for the same reason the layer is: we are a guest in someone
 * else's style document.
 */
export const BUILDING_SRC = "tn-buildings";

/**
 * NAMESPACED DELIBERATELY. OpenFreeMap Liberty already defines a layer with the id
 * `building-3d` (and both OFM styles define `building`), and map.addLayer THROWS on
 * a duplicate id — an uncaught throw here would take the whole map down, not just
 * the buildings. Verified against the live style documents rather than assumed.
 */
export const BUILDING_LAYER = "tn-buildings-3d";

/** Liberty's own extrusion layer, hidden so it cannot z-fight or double our opacity. */
export const STYLE_OWN_BUILDING_3D = "building-3d";

/** The OpenMapTiles source id both OpenFreeMap styles use for the planet TileJSON. */
export const OMT_SOURCE = "openmaptiles";

/** The planet TileJSON. Given to MapLibre as `url:`, never as a `tiles:` array. */
export const BUILDING_TILEJSON = "https://tiles.openfreemap.org/planet";

/**
 * Buildings start at z14, and the number is the data's, not a taste call: the
 * `building` layer exists from z13 and the tileset stops at z14, so below 14 there
 * is either nothing to draw or a single overzoomed tile's worth of it. It also
 * keeps the fat tiles out of the overview, where nobody can see a building anyway.
 */
export const BUILDINGS_MIN_ZOOM = 14;

/**
 * Per-basemap extrusion colour. Buildings are drawn over three very different
 * grounds, and one colour cannot serve all of them: a pale grey that reads as
 * massing on Liberty's paper disappears into Esri imagery.
 *
 * WAS FIVE. Positron and Dark left the registry with the console's dark skin; their
 * two entries went with them rather than being kept "in case", because a
 * Record<BasemapKey, …> with a key that is not a BasemapKey does not compile, and a
 * commented-out one is a value nobody can see is stale.
 *
 * `colour` is a real field on the OMT building layer (a per-building colour, mostly
 * null), so it wins where OSM has one and these are the fallback.
 */
const BUILDING_COLOR: Record<BasemapKey, string> = {
  streets: "#d5d8cf",
  satellite: "#c8ccd2",
  topo: "#cfc9bd",
};

/**
 * Opacity per basemap. Lower over photography, where the imagery underneath is the
 * thing the user came for and the extrusions are there to give it relief rather
 * than to cover it.
 */
const BUILDING_OPACITY: Record<BasemapKey, number> = {
  streets: 0.9,
  satellite: 0.72,
  topo: 0.8,
};

/** The `fill-extrusion` paint for `tn-buildings-3d` on a given basemap. Pure. */
export function buildingsPaint(basemap: BasemapKey): Record<string, unknown> {
  return {
    // OSM's own colour where a building has one, our per-basemap default otherwise.
    "fill-extrusion-color": ["coalesce", ["get", "colour"], BUILDING_COLOR[basemap]],
    // render_min_height lifts a building that starts above ground (a bridge deck, an
    // upper storey mapped separately). Defaulted because the field can be absent.
    "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
    "fill-extrusion-height": ["coalesce", ["get", "render_height"], 0],
    // Fade in across one zoom level rather than popping into existence at 14.
    "fill-extrusion-opacity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      BUILDINGS_MIN_ZOOM,
      0,
      BUILDINGS_MIN_ZOOM + 0.6,
      BUILDING_OPACITY[basemap],
    ],
  };
}

/**
 * `hide_3d` is OpenMapTiles' own opt-out: it marks building parts that would double
 * up or float if extruded. Honouring it is the difference between a skyline and a
 * pile of boxes.
 *
 * Written as `!=` against true rather than `== false`, because the field is absent
 * on most buildings and an absent field must not filter the building out.
 */
export function buildingsFilter(): unknown[] {
  return ["!=", ["get", "hide_3d"], true];
}

interface StyleLayerLike {
  id: string;
  type: string;
}

/**
 * Which existing layer to insert the buildings BENEATH.
 *
 * Extrusions must sit under the basemap's own labels, or a street name ends up
 * buried inside a block of flats. MapLibre's documented approach is to insert
 * before the style's first symbol layer, which is what this finds. Returns
 * undefined when the style has no symbol layer (every inline raster style we ship),
 * and addLayer then appends — correct, because there is nothing there to sit under.
 */
export function buildingsBeforeId(layers: readonly StyleLayerLike[] | undefined): string | undefined {
  return layers?.find((l) => l.type === "symbol")?.id;
}

/**
 * Which source the extrusion layer should read from, given the source ids already
 * present in the active style.
 *
 * Reuse OpenFreeMap's `openmaptiles` when it is there (same TileJSON, so adding our
 * own would fetch identical bytes twice under two ids); otherwise we bring our own.
 */
export function buildingsSourceId(existingSourceIds: readonly string[]): string {
  return existingSourceIds.includes(OMT_SOURCE) ? OMT_SOURCE : BUILDING_SRC;
}

/** True when WorldMap must add its own vector source before adding the layer. */
export function needsOwnBuildingSource(existingSourceIds: readonly string[]): boolean {
  return buildingsSourceId(existingSourceIds) === BUILDING_SRC;
}
