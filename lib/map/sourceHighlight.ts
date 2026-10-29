// Pick one source's marks out on the map by fading every other app mark.
//
// Hovering a row in the Sources rail (or a section heading) lights that source:
// its marks stay exactly as drawn and everything else drops to FADE of its own
// opacity. This file is the map half. It is pure (no React, no DOM, no maplibre
// import), so a fake map can test it; lib/shell/sourceHover.ts is the pointer half.
//
// WHY ONE GLOBAL-STATE KEY. All 49 signal layers are drawn into FIVE shared sources
// (signals, signal-lines, signal-fills, signal-country-shapes, signal-area-marks),
// and every feature carries `properties.signalId`. There is no per-source layer to
// restyle, so the fade is a DATA-DRIVEN opacity: each layer's opacity is wrapped in
//   ["case", idle, v, mine, v, v * FADE]
// where `idle` and `mine` read ONE MapLibre global-state key (`srcHover`, an array of
// rail ids). A hover is then a single `setGlobalStateProperty` call. No GeoJSON is
// rebuilt, nothing is copied into an overlay source (that was measured and rejected:
// 25k still cameras cost 346 ms plus a 98 ms main-thread long task) and the React
// tree never hears about it.
//
// THE ZOOM-CURVE RULE. MapLibre rejects a layer whose opacity is an `interpolate` or
// `step` over ["zoom"] unless ["zoom"] stays at the TOP LEVEL ("Input/output pairs
// for interpolate expressions must be defined using literal numeric values"). So a
// curve is wrapped output by output: the stops stay numbers, each output becomes the
// fade expression. Never wrap the inputs and never wrap the whole curve.
//
// THE ORDER RULE. `setGlobalStateProperty` must run BEFORE the first wrapping
// `setPaintProperty`. An undeclared global-state reads as null, `["length", null]`
// fails, and MapLibre silently falls back to opacity 1: the layer would look fine
// and never fade.
//
// MEASURED COST (MapLibre 5.24.0, 12 sources on, 7,077 signal marks, 39,480 cameras):
// a hover change reloads the sources whose wrapped paint is data-driven (the five
// signal sources, `cameras`, `country-polys`) in the worker, with no main-thread long
// task. It settles in 24-34 ms zoomed in (Europe, z5), 140-230 ms at whole-world zoom
// (one tile holds every mark), and 48-72 ms for the camera source alone. The
// whole-layer sources (planes, satellites, webcams) update uniformly with no reload.
//
// THE GLOW. Fading the rest is half of it; the lit marks also get a bright halo drawn
// BENEATH them, so they stay exactly as drawn and read as picked out. The halo layers
// (HALO_PREFIX, haloSpecs) sit on the same sources as the marks and carry the same
// owner match as their FILTER, so with nothing lit they hold no features at all: no
// bucket, no draw, no cost at rest and while panning. A hover reloads the sources it
// already reloads for the fade. There is no animation and no per-frame work.
//
// EVERY MAP SOURCE IS CLASSED. A source is either in SOURCE_OWNERS (it fades) or in
// NEVER_FADE_SOURCES (user pins, rings, drawn areas, terrain, buildings). A test reads
// WorldMap.tsx for every source id and fails on one that is in neither, so a future
// layer cannot slip in unfaded or, worse, faded when it should not.

/** The one MapLibre global-state key. An array of rail ids; [] when nothing is lit. */
export const HIGHLIGHT_STATE_KEY = "srcHover";

/** What an unlit mark keeps of its own opacity while something else is lit. */
export const FADE = 0.15;

/** A MapLibre expression, kept loose on purpose: this file never imports maplibre. */
export type Expr = readonly unknown[];

/** The paint properties that carry opacity, by layer type. */
export const OPACITY_PROPS: Readonly<Record<string, readonly string[]>> = {
  circle: ["circle-opacity", "circle-stroke-opacity"],
  symbol: ["icon-opacity", "text-opacity"],
  line: ["line-opacity"],
  fill: ["fill-opacity"],
};

/**
 * Who owns the marks in a map source.
 *   - "signal": one of the five aggregated signal sources; owned per feature by
 *     `properties.signalId`.
 *   - "camera-tier": the `cameras` source, shared by Live cams (feed "video") and
 *     Static cams (feed "still").
 *   - anything else is the rail key that owns the whole source.
 */
export type SourceOwner = "signal" | "camera-tier" | "staticcams" | "planes" | "satellites" | "countries";

export const SOURCE_OWNERS: Readonly<Record<string, SourceOwner>> = {
  signals: "signal",
  "signal-lines": "signal",
  "signal-fills": "signal",
  "signal-country-shapes": "signal",
  "signal-area-marks": "signal",
  cameras: "camera-tier",
  webcams: "staticcams",
  planes: "planes",
  trails: "planes",
  satellites: "satellites",
  "country-polys": "countries",
  "country-label-pts": "countries",
};

/**
 * Sources whose layers never fade: what the user put on the map (pins, the area they
 * drew), the rings that mark a selection, and the ground itself.
 */
export const NEVER_FADE_SOURCES: readonly string[] = [
  "user-pins",
  "selection-highlight",
  "track-highlight",
  "tn-watching-src",
  "tn-watch-ring-src",
  "recon-ip-area",
  "terrain-dem",
  "aoi-scope",
  "aoi-areas",
  "aoi-draft",
  "tn-buildings",
];

const H: Expr = ["global-state", HIGHLIGHT_STATE_KEY];
const IDLE: Expr = ["==", ["length", H], 0];
const lit = (key: string): Expr => ["in", key, H];

/**
 * The expression that is true for a feature of this source that is lit right now, or
 * null when the source never fades (or is not one of ours).
 */
export function ownerMatch(sourceId: string): Expr | null {
  const owner = SOURCE_OWNERS[sourceId];
  switch (owner) {
    case undefined:
      return null;
    case "signal":
      return ["in", ["get", "signalId"], H];
    case "camera-tier":
      return [
        "any",
        ["all", lit("livecams"), ["==", ["get", "feed"], "video"]],
        ["all", lit("staticcams"), ["==", ["get", "feed"], "still"]],
      ];
    default:
      return lit(owner);
  }
}

/** `v` while idle or lit, `v * FADE` otherwise. A number folds to a literal. */
function fade(v: unknown, mine: Expr): Expr {
  const dim = typeof v === "number" ? +(v * FADE).toFixed(4) : ["*", FADE, v];
  return ["case", IDLE, v, mine, v, dim];
}

const isZoom = (e: unknown): boolean => Array.isArray(e) && e.length === 1 && e[0] === "zoom";

const alreadyWrapped = (v: unknown): boolean => JSON.stringify(v).includes('"global-state"');

/**
 * Wrap one opacity value so it fades unless `mine` is true.
 *
 * Returns the SAME reference when there is nothing to do (already wrapped, or a
 * legacy function object), which is how applySourceHighlight knows to skip the write.
 */
export function wrapOpacity(base: unknown, mine: Expr): unknown {
  // A layer that leaves the property at the spec default draws at 1.
  if (base === undefined) base = 1;
  if (alreadyWrapped(base)) return base;
  if (typeof base === "number") return fade(base, mine);
  if (!Array.isArray(base)) return base; // legacy {stops: ...}: leave it alone

  const op = String(base[0]);
  // Wrap OUTPUTS only. interpolate: [op, interp, ["zoom"], in0, out0, in1, out1, ...]
  if (op.startsWith("interpolate") && isZoom(base[2])) {
    return base.map((v, i) => (i >= 4 && i % 2 === 0 ? fade(v, mine) : v));
  }
  // step: ["step", ["zoom"], out0, in1, out1, ...]
  if (op === "step" && isZoom(base[1])) {
    return base.map((v, i) => (i >= 2 && i % 2 === 0 ? fade(v, mine) : v));
  }
  // Data-driven (camera-markers' availability, the country hover feature-state).
  return fade(base, mine);
}

/** The slice of a maplibre Map this file touches, so a fake map can stand in. */
export interface HighlightMap {
  setGlobalStateProperty(name: string, value: unknown): unknown;
  getStyle(): { layers?: ReadonlyArray<{ id: string; type: string; source?: string }> } | null | undefined;
  getPaintProperty(layerId: string, name: string): unknown;
  setPaintProperty(layerId: string, name: string, value: unknown): unknown;
}

/**
 * Set the lit ids and make sure every fading layer reads them.
 *
 * Safe to call again at any time: the state is rewritten, and a layer that is already
 * wrapped is left alone. WorldMap calls it at the end of every addAppLayers, because
 * a basemap switch (`setStyle`) throws away both the layers and the global state.
 *
 * Returns how many paint properties it wrapped (0 on a repeat call).
 */
export function applySourceHighlight(map: HighlightMap, ids: readonly string[]): number {
  try {
    map.setGlobalStateProperty(HIGHLIGHT_STATE_KEY, [...ids]); // state FIRST, see the header
  } catch {
    return 0; // style mid-swap; the next addAppLayers calls this again
  }
  let layers: ReturnType<HighlightMap["getStyle"]>;
  try {
    layers = map.getStyle();
  } catch {
    return 0;
  }
  let wrapped = 0;
  for (const layer of layers?.layers ?? []) {
    if (layer.id.startsWith(HALO_PREFIX)) continue; // the glow is lit marks only: nothing to fade
    const props = OPACITY_PROPS[layer.type];
    const mine = layer.source ? ownerMatch(layer.source) : null;
    if (!props || !mine) continue;
    for (const prop of props) {
      try {
        const base = map.getPaintProperty(layer.id, prop);
        const next = wrapOpacity(base, mine);
        if (next === base) continue;
        map.setPaintProperty(layer.id, prop, next);
        wrapped += 1;
      } catch {
        // A style torn down mid-swap must not throw out of addAppLayers.
      }
    }
  }
  return wrapped;
}

/**
 * Keep the ids that have at least one mark loaded. A source that is off, or has
 * nothing anywhere, fades nothing: the map gets [] and stays as it was.
 */
export function presentIds(ids: readonly string[], hasMarks: (id: string) => boolean): string[] {
  return ids.filter((id) => hasMarks(id));
}

// --- The glow --------------------------------------------------------------------

/** Every highlight layer id starts with this, so the fade never wraps one. */
export const HALO_PREFIX = "srchl-";

type PaintValue = unknown;

export interface HaloSpec {
  id: string;
  source: string;
  type: "circle" | "line";
  layout?: Record<string, PaintValue>;
  paint: Record<string, PaintValue>;
  minzoom?: number;
}

/** A zoom curve through three numbers: [z0, z6, z12]. */
const byZoom = (a: PaintValue, b: PaintValue, c: PaintValue): Expr => [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  a,
  6,
  b,
  12,
  c,
];

/** The glow of a mark that is an ICON (cameras, planes, satellites), which grows as you zoom in. */
const iconHalo = (world: number, mid: number, near: number): Expr => [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  world,
  6,
  mid,
  10,
  mid + (near - mid) / 2,
  13,
  near,
];

/** The signal disc's own radius curve (per-feature `radius`, scaled by zoom), plus `add` px. */
const discHalo = (add: number): Expr =>
  byZoom(
    ["+", ["*", ["get", "radius"], 0.7], add],
    ["+", ["get", "radius"], add],
    ["+", ["*", ["get", "radius"], 1.5], add],
  );

const WHITE = "#ffffff";

/**
 * The glow, per map source. In the mark's own colour, with a white edge so it holds on
 * both a dark satellite basemap and a light one, and in the console's light and dark
 * skins alike (the skin changes the chrome, never the map).
 *
 * A point source gets one circle: a soft disc in the colour, ringed in white. The dense
 * ones (cameras, webcams) get the disc alone at world zoom: a white ring around 40,000
 * dots is noise, and the discs run together into a field, which is what "where are
 * they" needs. Zoomed in there are few enough to ring, and the ring fades in from z8.
 * A line or an outline gets a white casing under a coloured band.
 */
export function haloSpecs(opts: { webcamColor: string }): HaloSpec[] {
  const ring = (radius: Expr, color: PaintValue): HaloSpec["paint"] => ({
    "circle-color": color,
    "circle-radius": radius,
    "circle-opacity": 0.6,
    "circle-blur": 0.25,
    "circle-stroke-color": WHITE,
    "circle-stroke-width": 2.5,
    "circle-stroke-opacity": 1,
  });
  // The dense sources: a soft disc that runs into its neighbours at world zoom, where a white
  // ring around 40,000 dots is noise. Zoomed in there are few enough to ring, and a disc in
  // the mark's OWN colour alone would vanish behind it, so the white edge fades in from z8.
  const field = (radius: Expr, color: PaintValue): HaloSpec["paint"] => ({
    "circle-color": color,
    "circle-radius": radius,
    "circle-opacity": 0.55,
    "circle-blur": 0.8,
    "circle-stroke-color": WHITE,
    "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 8, 0, 11, 2.5],
    "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 11, 1],
  });
  const casing = (width: Expr): HaloSpec["paint"] => ({
    "line-color": WHITE,
    "line-width": width,
    "line-opacity": 0.8,
  });
  const band = (width: Expr, color: PaintValue): HaloSpec["paint"] => ({
    "line-color": color,
    "line-width": width,
    "line-opacity": 0.85,
    "line-blur": 1,
  });
  const roundLine = { "line-cap": "round", "line-join": "round" };
  const lineBand = byZoom(4, 6, 9);
  const lineCase = byZoom(8, 10, 14);
  const shapeBand = byZoom(4, 5, 6);
  const shapeCase = byZoom(8, 9, 11);
  return [
    // Casings first so each band sits on its own casing.
    { id: `${HALO_PREFIX}countries-casing`, source: "country-polys", type: "line", layout: roundLine, paint: casing(byZoom(5, 6, 8)) },
    { id: `${HALO_PREFIX}countries`, source: "country-polys", type: "line", layout: roundLine, paint: band(byZoom(3, 4, 5), "#64748b") },
    { id: `${HALO_PREFIX}signal-countries-casing`, source: "signal-country-shapes", type: "line", layout: roundLine, paint: casing(shapeCase) },
    { id: `${HALO_PREFIX}signal-countries`, source: "signal-country-shapes", type: "line", layout: roundLine, paint: band(shapeBand, ["get", "color"]) },
    { id: `${HALO_PREFIX}signal-fills-casing`, source: "signal-fills", type: "line", layout: roundLine, paint: casing(shapeCase) },
    { id: `${HALO_PREFIX}signal-fills`, source: "signal-fills", type: "line", layout: roundLine, paint: band(shapeBand, ["get", "color"]) },
    { id: `${HALO_PREFIX}signal-lines-casing`, source: "signal-lines", type: "line", layout: roundLine, paint: casing(lineCase) },
    { id: `${HALO_PREFIX}signal-lines`, source: "signal-lines", type: "line", layout: roundLine, paint: band(lineBand, ["get", "color"]) },
    { id: `${HALO_PREFIX}trails`, source: "trails", type: "line", layout: roundLine, paint: band(byZoom(4, 5, 6), ["get", "color"]) },
    { id: `${HALO_PREFIX}signal-marks`, source: "signal-area-marks", type: "circle", paint: ring(discHalo(12), ["get", "color"]) },
    { id: `${HALO_PREFIX}signal-points`, source: "signals", type: "circle", paint: ring(discHalo(11), ["get", "color"]) },
    { id: `${HALO_PREFIX}cameras`, source: "cameras", type: "circle", paint: field(iconHalo(6, 8, 24), ["get", "regionColor"]) },
    { id: `${HALO_PREFIX}webcams`, source: "webcams", type: "circle", minzoom: 3, paint: field(iconHalo(6, 8, 24), opts.webcamColor) },
    { id: `${HALO_PREFIX}satellites`, source: "satellites", type: "circle", paint: ring(iconHalo(16, 18, 24), ["get", "color"]) },
    { id: `${HALO_PREFIX}planes`, source: "planes", type: "circle", paint: ring(iconHalo(15, 17, 24), ["get", "color"]) },
  ];
}

/** Where the glow goes: under the first of these that exists, which is the lowest app mark. */
export const HALO_BEFORE: readonly string[] = [
  "trail-lines",
  "satellite-glow",
  "camera-dots",
  "webcam-dots",
  "plane-markers",
  "signal-country-fill",
];

/** The slice of a maplibre Map the glow touches. */
export interface HaloMap {
  getLayer(id: string): unknown;
  getSource(id: string): unknown;
  addLayer(spec: unknown, beforeId?: string): unknown;
}

/**
 * Add the glow layers the style does not have yet. Safe to call again, and called after
 * every style load (a basemap switch throws the layers away). Returns how many it added.
 */
export function ensureHighlightLayers(map: HaloMap, opts: { webcamColor: string }): number {
  let before: string | undefined;
  for (const id of HALO_BEFORE) {
    if (map.getLayer(id)) {
      before = id;
      break;
    }
  }
  let added = 0;
  for (const spec of haloSpecs(opts)) {
    try {
      const filter = ownerMatch(spec.source);
      if (!filter || map.getLayer(spec.id) || !map.getSource(spec.source)) continue;
      map.addLayer(
        {
          id: spec.id,
          type: spec.type,
          source: spec.source,
          filter,
          ...(spec.layout ? { layout: spec.layout } : {}),
          ...(spec.minzoom !== undefined ? { minzoom: spec.minzoom } : {}),
          paint: spec.paint,
        },
        before,
      );
      added += 1;
    } catch {
      // A style torn down mid-swap must not throw out of addAppLayers.
    }
  }
  return added;
}
