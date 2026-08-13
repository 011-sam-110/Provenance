// Typed basemap registry for the unified MapLibre globe engine.
//
// One map instance, swappable base style. `positron` is the calm light default
// (CARTO Positron vector — morphs globe→mercator natively); `satellite` is the
// Esri World Imagery raster for the deep-zoom photographic payoff; `topo` is a
// keyless OpenTopoMap raster for terrain context. All keyless.
//
// Switching a basemap (`map.setStyle`) wipes every source/layer/image/terrain, so
// WorldMap re-adds the app layers on the `style.load` event — see addAppLayers().

import type { StyleSpecification } from "maplibre-gl";

export type BasemapKey = "dark" | "positron" | "satellite" | "topo";

export interface BasemapDef {
  key: BasemapKey;
  label: string;
  /** A style URL (vector) or a full inline StyleSpecification (raster). */
  style: string | StyleSpecification;
  /** Vector styles auto-morph globe↔mercator; raster styles still drape the globe. */
  vector: boolean;
}

// Keyless CARTO glyph server (the same one the Positron vector style uses) so
// our own symbol-text layers — the cluster count badges — render on the raster
// basemaps too, which otherwise ship no `glyphs`. "Open Sans Regular" is served
// by this endpoint and by Positron's glyphs, so one font works on all basemaps.
const CARTO_GLYPHS = "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf";

// Esri World Imagery — the photographic deep-zoom layer (also used pre-rewrite).
const ESRI_STYLE: StyleSpecification = {
  version: 8,
  glyphs: CARTO_GLYPHS,
  sources: {
    "esri-imagery": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#0b1220" } },
    { id: "esri-imagery", type: "raster", source: "esri-imagery" },
  ],
};

// CARTO Dark Matter — keyless near-black raster. The OpenData Terminal's chrome is
// #06080b, and a light or photographic basemap under it turns the stage into the one
// bright rectangle on the page; this is the only basemap the terminal palette reads
// against without the map fighting the shell.
//
// RASTER, not the vector dark-matter style URL, and that is a deliberate choice with
// two consequences worth stating:
//   • `isRasterBasemap()` in WorldMap.tsx is `b !== "positron"`, so a raster DARK is
//     correctly classified and our own country-name labels are drawn over it (the
//     vector style would ship its own and we would double-label). A VECTOR dark entry
//     would need that predicate changed to read `BASEMAPS[b].vector`.
//   • `glyphs` is mandatory. Every symbol layer we add — cluster counts, country
//     labels, signal labels, pin labels — asks for "Open Sans Regular", and a style
//     with no glyphs endpoint drops all of them silently rather than erroring.
//   • An inline style also cannot fail the way a remote style URL can, so DARK is a
//     legal fallback target for lib/map/resilience.ts (see fallbackBasemap).
const DARK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: CARTO_GLYPHS,
  sources: {
    "carto-dark": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 20,
      attribution: "© CARTO · © OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#06080b" } },
    { id: "carto-dark", type: "raster", source: "carto-dark" },
  ],
};

// OpenTopoMap — keyless topographic raster (relief + contours).
const TOPO_STYLE: StyleSpecification = {
  version: 8,
  glyphs: CARTO_GLYPHS,
  sources: {
    opentopomap: {
      type: "raster",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution: "© OpenTopoMap (CC-BY-SA) · © OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#e8eef0" } },
    { id: "opentopomap", type: "raster", source: "opentopomap" },
  ],
};

// Order matters twice over, so it is set here rather than at any call site: every
// basemap switcher iterates `Object.keys(BASEMAPS)` (the Terminal stage bar, the old
// MapControls, the ⌘K palette), and `fallbackBasemap()` walks the same order looking
// for the first INLINE style to recover onto. DARK leads on both counts.
export const BASEMAPS: Record<BasemapKey, BasemapDef> = {
  dark: {
    key: "dark",
    label: "Dark",
    style: DARK_STYLE,
    vector: false,
  },
  positron: {
    key: "positron",
    label: "Light",
    style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    vector: true,
  },
  satellite: {
    key: "satellite",
    label: "Satellite",
    style: ESRI_STYLE,
    vector: false,
  },
  topo: {
    key: "topo",
    label: "Topographic",
    style: TOPO_STYLE,
    vector: false,
  },
};

// DARK by default — the OpenData Terminal shell is near-black chrome around one
// map, and Esri's photographic imagery under it made the stage the only bright
// surface on the page. Satellite, Light and Topographic all stay one tap away in
// the stage bar's basemap group; nothing was removed.
//
// This does NOT reintroduce the persistence hazard lib/mapView.ts warns about. The
// basemap is still deliberately unpersisted: this constant is the value the store
// STARTS at, read synchronously before the map is constructed, so it can never race
// the async style.load the way a localStorage read after first paint would. A
// deep-link `?base=satellite` still wins (readInitialViewState runs before the map
// is built).
export const DEFAULT_BASEMAP: BasemapKey = "dark";
