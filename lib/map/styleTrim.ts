// What a fetched basemap style may draw while the camera is out at globe zoom.
//
// THE PROBLEM. The default basemap is OpenFreeMap Liberty, a 111-layer style we
// fetch and do not own. Measured against production on 2026-09-04, a first load of
// /app at HOME.zoom = 1.4 spent 3.2 MB on basemap before the map was usable, and on
// a Slow-4G / 4x-CPU profile the map's `load` event did not fire until 25.7 s. Two
// of the three big items are Liberty's own layers, drawn at a zoom where they are
// either invisible or illegible:
//
//   Natural Earth relief   11 requests   1,306 KB   `natural_earth`, source `ne2_shaded`
//   Label glyph PBFs       19 requests     866 KB   country labels in Noto Sans Bold
//                                                   across 15 Unicode ranges, plus
//                                                   water names in Italic
//
// Blocking them in the browser, as an ablation on the shipped build, moved
// time-to-map-load from 21.4 s (with the DEM already blocked) to 15.7 s and then to
// 13.2 s. 13.2 s is the floor set by JavaScript, the style and the vector tiles, so
// these two are worth 8.2 s of the 12.5 s available.
//
// WHY ZOOM RANGES AND NOT VISIBILITY OR SOURCE REMOVAL. MapLibre does not request
// tiles for a layer outside its zoom range, so raising `minzoom` stops the fetch
// while leaving the layer, its paint and its source exactly as the style author
// wrote them — the relief and the labels come back on their own as the camera
// descends, with no second code path to keep in sync.
//
// Removing the SOURCES would also stop the fetch and would be wrong. lib/basemaps.ts
// records that neither OpenFreeMap style declares `attribution` on its sources: the
// OpenStreetMap / OpenMapTiles / OpenFreeMap credit is resolved from the TileJSON
// that a source's `url:` points at. Editing sources is how that credit gets dropped
// silently, which is an ODbL problem rather than a cosmetic one. Nothing here writes
// to `sources`.
//
// WHY THIS IS SCOPED, AND THE TRAP IT AVOIDS. Three of the five registered basemaps
// — Dark, Satellite and Topographic — are inline StyleSpecifications whose entire
// content is ONE raster layer. A rule as loose as "raster layers start at z3" would
// blank those basemaps completely below zoom 3, which is where the globe lives. So
// the relief rule matches the tile URL, and the label rule requires the style to
// carry a vector source, which no inline raster basemap does. `layersToTrim` returns
// [] for all three, and there is a test for each.

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

/**
 * Zoom at which Natural Earth shaded relief starts drawing.
 *
 * Liberty fades this raster from `raster-opacity` 0.6 at z0 to 0.1 by z6, so it is
 * at its strongest exactly where it costs the most and shows the least — 11 PNGs of
 * roughly 120 KB each, painted under a globe a few hundred pixels across. 3 is the
 * point where enough of one continent fills the viewport for shaded relief to read
 * as terrain rather than as a grey wash.
 */
export const RELIEF_MIN_ZOOM = 3;

/**
 * Zoom at which the basemap's own labels start drawing.
 *
 * The cost here is not the labels, it is the FONTS. Liberty asks for country names
 * in Noto Sans Bold and water names in Noto Sans Italic; a glyph PBF covers 256
 * codepoints, so rendering the world's country names at once pulls 15 ranges of Bold
 * before anything else can paint. Our own symbol layers use MAP_LABEL_FONT — Noto
 * Sans Regular, one weight — and the console's signal labels do not start until z4,
 * so below z2 the basemap's labels are the only reason any glyph is fetched at all.
 */
export const LABEL_MIN_ZOOM = 2;

/** Marks a raster source as Natural Earth shaded relief rather than a basemap. */
const NATURAL_EARTH_TILE_MARK = "/natural_earth/";

export interface LayerTrim {
  id: string;
  minzoom: number;
  /**
   * The layer's EXISTING maxzoom, carried through untouched.
   *
   * `map.setLayerZoomRange(id, minzoom, maxzoom)` sets both ends, so the caller has
   * to hand back the top of the range or it moves. Liberty's relief layer stops at
   * z7 on purpose — it is a low-zoom backdrop and the vector landcover takes over
   * above that — and dropping the ceiling would leave a Natural Earth raster drawn
   * over street-level tiles. `MAPLIBRE_DEFAULT_MAXZOOM` stands in for a layer that
   * declares none, which is what MapLibre itself uses.
   */
  maxzoom: number;
}

/** MapLibre's own ceiling for a layer that declares no `maxzoom`. */
export const MAPLIBRE_DEFAULT_MAXZOOM = 24;

/** Does this source serve Natural Earth relief rather than the basemap itself? */
function isReliefSource(source: StyleSpecification["sources"][string] | undefined): boolean {
  if (!source || source.type !== "raster") return false;
  const tiles = "tiles" in source ? source.tiles : undefined;
  const url = "url" in source ? source.url : undefined;
  return [...(tiles ?? []), url ?? ""].some((u) => u.includes(NATURAL_EARTH_TILE_MARK));
}

/** A layer that already starts at or after `min` needs no help. */
function startsBefore(layer: LayerSpecification, min: number): boolean {
  return !(typeof layer.minzoom === "number" && layer.minzoom >= min);
}

function ceilingOf(layer: LayerSpecification): number {
  return typeof layer.maxzoom === "number" ? layer.maxzoom : MAPLIBRE_DEFAULT_MAXZOOM;
}

/**
 * The zoom-range raises to apply to a freshly loaded basemap style, in the order
 * they should be applied. Returns [] for any style that has nothing to trim, which
 * includes all three inline raster basemaps.
 *
 * Pure so it can be tested: vitest here is the node environment with no DOM, so a
 * MapLibre map cannot be constructed and this decision is the only part that can be
 * pinned against a captured copy of the real Liberty style.
 */
export function layersToTrim(style: StyleSpecification | undefined | null): LayerTrim[] {
  if (!style?.layers) return [];
  const sources = style.sources ?? {};

  // The label rule is scoped to vector basemaps. An inline raster style has no
  // symbol layers today, but this is the guard that keeps a future one — a raster
  // basemap that ships a label layer of its own — from losing its labels silently.
  const hasVectorSource = Object.values(sources).some((s) => s?.type === "vector");

  const out: LayerTrim[] = [];
  for (const layer of style.layers) {
    if (!("source" in layer) || typeof layer.source !== "string") continue;

    if (layer.type === "raster" && isReliefSource(sources[layer.source])) {
      if (startsBefore(layer, RELIEF_MIN_ZOOM)) {
        out.push({ id: layer.id, minzoom: RELIEF_MIN_ZOOM, maxzoom: ceilingOf(layer) });
      }
      continue;
    }

    if (hasVectorSource && layer.type === "symbol" && startsBefore(layer, LABEL_MIN_ZOOM)) {
      out.push({ id: layer.id, minzoom: LABEL_MIN_ZOOM, maxzoom: ceilingOf(layer) });
    }
  }
  return out;
}
