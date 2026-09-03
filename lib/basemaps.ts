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

// The fontstack every symbol layer WE add asks for, and the one measurement that
// picks it.
//
// Our label layers (country names, signal labels, pin labels) are drawn on top of
// whichever basemap is active, so they resolve their glyphs against THAT style
// glyphs endpoint, not against a font we control. Two endpoints are now in play and
// they do not serve the same fonts. Measured 2026-09-03 against both, live:
//
//   CARTO        Open Sans Regular 200 | Noto Sans Regular 200 | Noto Sans Bold 404
//   OpenFreeMap  Open Sans Regular 404 | Noto Sans Regular 200 | Noto Sans Bold 200
//
// So "Noto Sans Regular" is the only stack BOTH answer, and it is therefore the only
// safe choice while the registry mixes CARTO rasters with OpenFreeMap vector styles.
// A composite fallback stack does not rescue this: OpenFreeMap 404s
// "Open Sans Regular,Noto Sans Regular" as one unit rather than falling through.
//
// KEEP IT A SINGLE ELEMENT for that reason, and note that the failure it prevents is
// silent: a symbol layer whose fontstack 404s does not throw and does not warn. It
// draws the icon and drops the text. tests/unit/map-font.test.ts pins the value and
// fails if an Open Sans literal returns to WorldMap.
export const MAP_LABEL_FONT = ["Noto Sans Regular"] as const;

/**
 * Does this basemap draw its OWN place labels?
 *
 * Every vector style in the registry ships a full label set (OpenFreeMap positron
 * and liberty both carry label_country_1/2/3, label_state, label_city and the rest);
 * the inline raster styles ship none, which is why we draw our own country names
 * over them. Drawing ours over a style that already has its own doubles every name.
 *
 * This lived in WorldMap.tsx as `isRasterBasemap = (b) => b !== "positron"`, which
 * was correct only while positron was the single vector entry. It is now here, and
 * reads the registry flag, for two reasons: a second vector basemap breaks the
 * hardcoded form, and WorldMap.tsx cannot be imported by the test suite at all (it is
 * a client component that imports maplibre CSS, and vitest runs in a node
 * environment) so a predicate living there is structurally untestable.
 *
 * NOTE it also stands in for a second question at its call site - whether the ground
 * is dark enough to need a light country border. Those two happen to split on the
 * same line today, because every vector entry is light paper and every raster entry
 * is photographic or near-black. Add a DARK vector style and they come apart; that
 * wants a second flag on BasemapDef, not a looser reading of this one.
 */
export function usesOwnLabels(b: BasemapKey): boolean {
  return BASEMAPS[b].vector;
}

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
//   • `usesOwnLabels()` above reads `vector`, so a raster DARK is correctly classified
//     and our own country-name labels are drawn over it (a vector style ships its own
//     and we would double-label). That predicate used to be spelled `b !== "positron"`
//     inside WorldMap and this comment predicted it would need changing; adding the
//     OpenFreeMap styles is what forced it, and it now reads the flag.
//   • `glyphs` is mandatory. Every symbol layer we add — country labels, signal labels,
//     pin labels — asks for MAP_LABEL_FONT, and a style with no glyphs endpoint drops
//     all of them silently rather than erroring. CARTO_GLYPHS serves that stack; see
//     the measurement beside MAP_LABEL_FONT for why the stack is Noto and not Open Sans.
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

// POSITRON by default, and it has to be: this constant is the map half of a PAIR
// whose chrome half is DEFAULT_TERMINAL_SKIN, and that is now light.
//
// The pairing is the whole point, and it used to read the other way round. When the
// Terminal opened as near-black chrome, Esri's photographic imagery under it made
// the stage the only bright surface on the page, so the default was dark. Light
// chrome around CARTO Dark Matter is the same mistake with the values swapped —
// ConsoleShell says so in as many words at its skin⇄basemap effect. Flipping the
// skin without flipping this would have shipped exactly the render that effect
// exists to prevent, to every first-time visitor, because that effect deliberately
// skips its first run so a deep-linked `?base=` is never clobbered.
//
// tests/unit/terminal-skin.test.ts pins the two together, so the next person to
// change either one finds out from a red test rather than from a screenshot.
//
// Dark, Satellite and Topographic all stay one tap away in the view controls;
// nothing was removed.
//
// This does NOT reintroduce the persistence hazard lib/mapView.ts warns about. The
// basemap is still deliberately unpersisted: this constant is the value the store
// STARTS at, read synchronously before the map is constructed, so it can never race
// the async style.load the way a localStorage read after first paint would. A
// deep-link `?base=satellite` still wins (readInitialViewState runs before the map
// is built).
export const DEFAULT_BASEMAP: BasemapKey = "positron";
