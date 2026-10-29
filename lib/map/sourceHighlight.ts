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
