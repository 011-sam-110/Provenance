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
// THE LOOK (2026-10-16). Colour, light, opacity, slot and the label rules below were
// chosen from before/after captures of production with each change applied at
// runtime; the review page with those pictures is linked from the PR. Nothing here
// fetches anything new: same tiles, same sources.
//
// WorldMap owns the MapLibre side effects; everything here is pure so it can be
// unit-tested in the node vitest env, which cannot mount WorldMap at all.

import type { LightSpecification } from "maplibre-gl";
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
 * Per-basemap neutral. Buildings are drawn over three very different grounds, and
 * one colour cannot serve all of them: a pale grey that reads as massing on
 * Liberty's paper disappears into Esri imagery.
 *
 * WAS FIVE. Positron and Dark left the registry with the console's dark skin; their
 * two entries went with them rather than being kept "in case", because a
 * Record<BasemapKey, …> with a key that is not a BasemapKey does not compile, and a
 * commented-out one is a value nobody can see is stale.
 *
 * Streets moved from a green-grey to a warm one close to Liberty's own building
 * colour, because under a white light the green read as olive.
 */
const BUILDING_NEUTRAL: Record<BasemapKey, string> = {
  streets: "#dedad3",
  satellite: "#d0d3d8",
  topo: "#cfc9bd",
};

/**
 * How much of OSM's own building colour survives the mix into the neutral.
 *
 * `colour` is a real field on the OMT building layer, filled from building:colour or
 * the material, and it is NOT mostly null: 431 of 567 buildings over the City of
 * London carry one (2026-10-16). At full strength that was pure blue, red and yellow
 * boxes. At 35% a glass tower is still a hint of blue and brick still reads warm.
 * `blue` itself lands on a soft lavender, which is the price of not washing out
 * every glass tower to fix one building.
 */
const OSM_COLOUR_SHARE = 0.35;

/**
 * Opacity per basemap. Solid on the drawn basemaps. Just short of solid over
 * photography: at the old 0.72 the photo showed through every tower and the
 * satellite view read as frosted glass rather than as buildings.
 */
const BUILDING_OPACITY: Record<BasemapKey, number> = {
  streets: 1,
  satellite: 0.95,
  topo: 1,
};

/** The `fill-extrusion` paint for `tn-buildings-3d` on a given basemap. Pure. */
export function buildingsPaint(basemap: BasemapKey): Record<string, unknown> {
  const neutral = BUILDING_NEUTRAL[basemap];
  return {
    // OSM's colour, read with a FALLBACK, then mixed into the neutral in Lab.
    //
    // `to-color` and not `coalesce`, and the difference is a bug fix: OSM's field
    // holds words MapLibre cannot parse ("light_brown", "darkbrown", "black;white",
    // even "5"). `coalesce` passed those through, the colour failed, and the
    // property default won — every such building rendered pure black. `to-color`
    // tries the value and falls to the neutral when it cannot read it.
    //
    // The interpolate input is a constant: it is a mix, not a ramp. `literal` keeps
    // the validator from reading a bare number as a malformed input expression.
    "fill-extrusion-color": [
      "interpolate-lab",
      ["linear"],
      ["literal", 1 - OSM_COLOUR_SHARE],
      0,
      ["to-color", ["get", "colour"], neutral],
      1,
      neutral,
    ],
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

// NO ANTI-ALIASING, and that is measured. A multisampled canvas does smooth the
// stair-steps on a roof edge, and it was tried with this look on 2026-10-16: on the
// Intel Arc laptop that runs the console at 1.75x and 120 Hz, a 6 s rotation over
// the City of London went from a median frame of 8.4 ms to 25 ms, with half the
// frames late (two runs each, headed Chrome, on mains). It is a context attribute,
// so it would cost that on every pan of every map, buildings on or off. Do not add
// `antialias: true` to the map without a frame measurement that says otherwise.
// The rest of this look measured level with the old one: the same rotation over
// Midtown held a median of 8.4 ms in all six runs, old paint and new.

/**
 * The style's light, set by WorldMap on every style load (a basemap swap replaces
 * the whole style, light included). Only fill-extrusion layers read it, and ours
 * is the only one we draw, so this is the buildings' setting in all but name.
 *
 * MapLibre's default is anchored to the VIEWPORT at intensity 0.5 from 30°: it
 * turns with the camera, so every wall facing the screen gets nearly the same grey
 * and a block reads as a flat shape. Anchored to the MAP, it is a sun: walls that
 * face away from it fall into shade, and rotating the map moves the shade the way
 * daylight would. Azimuth 210 puts that sun in the south-south-west, 45° up.
 */
export const BUILDINGS_LIGHT: LightSpecification = {
  anchor: "map",
  position: [1.5, 210, 45],
  color: "#ffffff",
  intensity: 0.5,
};

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
 * On a style that ships its own `building-3d` (Liberty), the slot straight after it:
 * that is where the style's designer put extrusions, above every bridge, the flat
 * footprints and the road casings. The old rule — the first symbol layer — landed on
 * Liberty's one-way arrows at layer 61, UNDER the twenty bridge layers and the 2D
 * `building` fill, so a railway bridge behind a tower was drawn across its face.
 *
 * Otherwise the style's first symbol layer, MapLibre's documented approach, so a
 * street name is not buried inside a block of flats. Returns undefined when the
 * style has no symbol layer (every inline raster style we ship), and addLayer then
 * appends — correct, because there is nothing there to sit under.
 */
export function buildingsBeforeId(layers: readonly StyleLayerLike[] | undefined): string | undefined {
  if (!layers) return undefined;
  const own = layers.findIndex((l) => l.id === STYLE_OWN_BUILDING_3D);
  if (own >= 0) return layers[own + 1]?.id;
  return layers.find((l) => l.type === "symbol")?.id;
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

// ---------------------------------------------------------------------------
// Labels while the buildings are up.
//
// A label layer drawn AFTER the extrusions is painted over them wherever it falls on
// screen, depth or no depth. For a street name laid flat along the road that is the
// "West 45th Street printed across a tower" look. For it to be hidden by a building
// in front, its layer has to sit UNDER the buildings, and that has a cost the code
// below exists to pay:
//
//   LABEL SPACE IS HANDED OUT TOP LAYER FIRST. A street name moved under the
//   buildings loses its space to every point layer still above them. Measured on
//   production 2026-10-16: shop pins went 29 -> 93 over the City of London and
//   36 -> 98 over Midtown; with shops gone, bus stops took Midtown (82); with those
//   gone, fountain and pond names floated over the towers.
//
// So while the buildings are on, from the zoom they are drawn at, Liberty's own pins
// are cut to stations and airports and its point water names are hidden. Place names
// and road numbers stay. Below BUILDINGS_MIN_ZOOM nothing is cut: the same point
// water layer carries the sea and ocean names, and there are no buildings there to
// make room for.
// POINT labels are never moved under: a pin with a building in front of it is cut
// in half ("Banl", "Monum"), which reads as a bug.
//
// Only the basemap's own layers are ever touched (source `openmaptiles`). Our pins,
// cameras and signals ride on their own sources and stay on top. Turning the
// buildings off puts back every layer and filter the style shipped.
// ---------------------------------------------------------------------------

/** A style layer as `map.getStyle().layers` returns it, read loosely. */
export interface LabelLayerLike extends StyleLayerLike {
  source?: string;
  "source-layer"?: string;
  layout?: Record<string, unknown>;
  filter?: unknown;
}

export interface BuildingLabelPlan {
  /** Flat names that go under the buildings, in style order, with the layer each sat in front of. */
  sink: { id: string; restoreBefore: string | undefined }[];
  /** Point layers cut from the buildings' zoom up, with the filter the style shipped. */
  filter: { id: string; on: unknown; off: unknown }[];
}

/** Where the cuts apply: the zooms the buildings are drawn at, and no lower. */
const AT_BUILDING_ZOOM: unknown[] = [">=", ["zoom"], BUILDINGS_MIN_ZOOM];

/** OMT's classes for rail and metro stations and for airports. Everything else in `poi` goes. */
const KEEP_POI: unknown[] = ["match", ["get", "class"], ["railway", "airport"], true, false];

const isBasemapSymbol = (l: LabelLayerLike) => l.type === "symbol" && l.source === OMT_SOURCE;

/**
 * Laid flat along a line and text only. A layer whose placement is an expression
 * (Liberty's shields switch from point to line by zoom) or that draws an icon (the
 * shields, the one-way arrows) is not a flat name. Line placement with automatic
 * rotation IS map-aligned, so an absent rotation counts.
 */
function isFlatName(l: LabelLayerLike): boolean {
  const layout = l.layout ?? {};
  const rotation = layout["text-rotation-alignment"];
  return (
    layout["symbol-placement"] === "line" &&
    layout["icon-image"] === undefined &&
    (rotation === undefined || rotation === "map" || rotation === "auto")
  );
}

/** The style's own filter AND the cut, or the cut alone when the layer had none. */
const withCut = (original: unknown, cut: unknown[]) => (original ? ["all", original, cut] : cut);

/**
 * What to change in a style's own label layers while the buildings are on. Pure:
 * computed once per style load from `map.getStyle().layers`, then turned into
 * MapLibre calls by `buildingLabelOps`.
 */
export function buildingLabelPlan(layers: readonly LabelLayerLike[] | undefined): BuildingLabelPlan {
  const plan: BuildingLabelPlan = { sink: [], filter: [] };
  if (!layers) return plan;
  layers.forEach((l, i) => {
    if (!isBasemapSymbol(l)) return;
    if (isFlatName(l)) {
      plan.sink.push({ id: l.id, restoreBefore: layers[i + 1]?.id });
    } else if (l["source-layer"] === "poi") {
      // A pin survives below the buildings' zoom, or as a station or an airport.
      const cut = ["any", ["!", AT_BUILDING_ZOOM], KEEP_POI];
      plan.filter.push({ id: l.id, on: withCut(l.filter, cut), off: l.filter });
    } else if (l["source-layer"] === "water_name") {
      // A point water name survives only below the buildings' zoom.
      const cut = ["!", AT_BUILDING_ZOOM];
      plan.filter.push({ id: l.id, on: withCut(l.filter, cut), off: l.filter });
    }
  });
  return plan;
}

export type LabelOp =
  | { kind: "move"; id: string; before: string | undefined }
  | { kind: "filter"; id: string; filter: unknown };

/**
 * The plan as MapLibre calls, for buildings on or off.
 *
 * On: each flat name moves to just under the buildings, in style order, so they
 * keep their order among themselves. Off: they go back LAST FIRST, because a layer's
 * remembered neighbour can itself be a sunk layer (highway-name-minor sat in front
 * of highway-name-major), and that neighbour has to be home before it is aimed at.
 * Both directions are idempotent.
 */
export function buildingLabelOps(plan: BuildingLabelPlan, on: boolean): LabelOp[] {
  const ops: LabelOp[] = [];
  if (on) {
    for (const s of plan.sink) ops.push({ kind: "move", id: s.id, before: BUILDING_LAYER });
  } else {
    for (const s of [...plan.sink].reverse()) ops.push({ kind: "move", id: s.id, before: s.restoreBefore });
  }
  for (const f of plan.filter) ops.push({ kind: "filter", id: f.id, filter: on ? f.on : f.off });
  return ops;
}
