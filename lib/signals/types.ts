// Shared contract for the GENERIC "global signals" layer framework.
//
// A "signal" is any keyless, global, opt-in point dataset (earthquakes, wildfires,
// aurora, …). Unlike the core cameras/planes/satellites layers — which each have
// bespoke rendering — every signal source is rendered by ONE data-driven MapLibre
// circle+label layer in WorldMap. Adding a new layer therefore = one adapter
// (fetch → SignalFeature[]) + one registry entry, with NO new WorldMap code.
//
// Batch A was POINT-only (all the natural-hazard sources need). Batch B added the
// geometry variant below: a signal feature may ALSO carry a line/area `geometry`,
// in which case WorldMap renders it on a second/third aggregated source (a `line`
// layer + a `fill` layer) instead of the circle layer — while lat/lon stays the
// click / label / dossier anchor (a representative centroid). The registry / store
// / route / dossier plumbing is unchanged. See lib/signals/registry.ts.

/**
 * Optional line/area geometry for a signal feature. GeoJSON coordinate order
 * ([lon, lat], rings for polygons). When present, the feature renders as a line
 * or fill rather than a circle; lat/lon remains the anchor point used for the
 * click hit-test, the label, the deep-link and the dossier "lat, lon" line.
 */
export type SignalGeometry =
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "MultiLineString"; coordinates: [number, number][][] }
  | { type: "Polygon"; coordinates: [number, number][][] }
  | { type: "MultiPolygon"; coordinates: [number, number][][][] };

/** One renderable signal: a point, or (with `geometry`) a line / area. */
export interface SignalFeature {
  /** Globally-unique, namespaced id, e.g. "usgs:nc75385096", "eonet:EONET_20558". */
  id: string;
  /** Anchor latitude — for area features this is a representative centroid. */
  lat: number;
  /** Anchor longitude — for area features this is a representative centroid. */
  lon: number;
  /** Short human label — the dossier title and (optionally) the on-map label. */
  title: string;
  /** Which registry source produced this feature (rides into the GeoJSON props). */
  signalId: string;
  /**
   * Optional line/area geometry. Absent ⇒ a plain point (the circle layer).
   * Present ⇒ rendered by WorldMap's signal `line` (LineString/MultiLineString)
   * or `fill` (Polygon/MultiPolygon) layer, anchored at lat/lon for interaction.
   */
  geometry?: SignalGeometry;
  /** Per-feature marker colour (CSS hex). Falls back to the source colour. */
  color?: string;
  /**
   * Free-form key→value pairs rendered as the dossier definition list.
   * Convention: a numeric `magnitude` (≈0–10 scale) scales the marker radius —
   * sources whose "magnitude" is on a different scale (e.g. wind in kts) should
   * name it differently so it does not distort the dot size.
   */
  props?: Record<string, unknown>;
  /** Canonical upstream detail page for this event. */
  link?: string;
  /** ISO timestamp of the observation/event, when known. */
  ts?: string;
}

/**
 * Declares the scalar that drives a monitor row's <MetricBar>. Kept separate from
 * the overloaded `props.magnitude` (which is a Richter value for quakes but a rescaled
 * radius proxy for GDACS/cyclones/instability) so a bar never mislabels a source: each
 * source names the REAL field + its [calm, extreme] domain. Sources without a metric
 * render a severity-coloured dot instead of a bar (honest — no invented scale).
 */
export interface SignalMetric {
  /** props key holding the raw scalar, or the literal "magnitude". */
  field: string;
  /** [calm, extreme] — normalises the bar fill to 0..1. */
  domain: [number, number];
  /** Optional unit suffix on the numeric label (e.g. "kt"). */
  unit?: string;
}

/**
 * Optional presentation hints for the asset-DIRECTORY focus view (kind:"asset").
 * The directory template is capability-driven — it auto-hides the country/region
 * columns when the layer carries no such props, and ranks by `metric` (or a `rank`
 * prop) when it has one. A source only declares what is NON-obvious: a short
 * identifier to show as the left column when it has no magnitude to rank by (e.g.
 * an airport's IATA code) and/or one extra descriptor column (e.g. a plant's
 * operator). Everything else is inferred from the features. Omit ⇒ ports-style.
 */
export interface DirectorySpec {
  /** props key for a short identifier, used as the left column when the layer has
   *  no metric/rank to rank by (e.g. "iata"). */
  codeKey?: string;
  /** Header for the code column (e.g. "IATA"). Defaults to a humanised codeKey. */
  codeLabel?: string;
  /** props key for one extra descriptor column (e.g. "operator", "city"). */
  detailKey?: string;
  /** Header for the descriptor column. Defaults to a humanised detailKey. */
  detailLabel?: string;
}

/** A qualitative band on a forecast index — the highest band whose `min` a value clears. */
export interface ForecastBand {
  min: number;
  label: string;
  /** Status hue (theme-independent, like the map severity swatches). */
  color: string;
}

/**
 * Presentation hints for the forecast/index focus view (kind:"forecast"). The
 * headline reads the source's `metric` (peak value across features); this spec
 * supplies the qualitative bands, the quiet threshold below which the feed reads
 * as "all-clear", the plain-language quiet note, and — for index feeds — which
 * props to surface as secondary scale chips.
 */
export interface ForecastSpec {
  /** Ascending bands mapping the index value → a label + status colour. */
  bands: ForecastBand[];
  /** Peak metric below this ⇒ render the compact all-clear card. Omit ⇒ quiet only when empty. */
  quietBelow?: number;
  /** Plain-language line for the all-clear state (e.g. "No visible aurora right now."). */
  quietNote: string;
  /** True for a spatial FIELD (aurora grid) → show the where/hemisphere summary + map. */
  spatial?: boolean;
  /** Noun for the active-cell count on a spatial field (e.g. "cells ≥50% likely"). */
  activeNoun?: string;
  /** props keys shown as secondary scale chips on an index feed (e.g. G/R/S storm scales). */
  scaleKeys?: string[];
}

/** A registered signal layer: metadata + a pure-ish fetch that yields points. */
export interface SignalSource {
  /** Stable id; also the dynamic route segment (/api/signals/<id>) + store key. */
  id: string;
  /**
   * Semantic layer kind, selecting the focus-view archetype:
   *   • "event" (default) — transient occurrences (earthquakes, storms, news):
   *     magnitude/severity + a "last N hours" time window.
   *   • "asset" — permanent infrastructure (cables, ports, airports, plants):
   *     a ranked/browsable directory, no magnitude/severity/"when".
   *   • "schedule" — forward-looking, time-anchored items (rocket launches):
   *     a countdown-ordered agenda grouped by day with a "next up" hero, driven
   *     off each feature's `ts` (the scheduled time). No map-blob, no severity.
   *   • "forecast" — an index / forecast field (space-weather Kp, aurora): a
   *     headline gauge with qualitative bands and a compact "all-clear" state when
   *     the feed is quiet, plus a spatial "where" summary for field forecasts.
   */
  kind?: "event" | "asset" | "schedule" | "forecast";
  /** Human label shown in the rail. */
  label: string;
  /** Rail grouping, e.g. "Natural hazards" / "Space weather". */
  group: string;
  /** Representative colour for the rail dot + per-feature fallback. */
  color: string;
  /** Suggested client refresh + server cache TTL, in ms. */
  refreshMs: number;
  /** Mandatory upstream credit, shown in the rail and the dossier. */
  attribution: string;
  /**
   * Optional provider dataset / home page for the dossier's mandatory clickable
   * source, used when a feature carries no deep record `link`. Keyless + honest.
   * When omitted, SignalDetail resolves it from the keyed table in
   * lib/signals/sourceLink.ts (which a unit test proves covers every layer).
   */
  sourceUrl?: string;
  /** Optional: the scalar → magnitude bar in the monitor row. Omit for a plain dot. */
  metric?: SignalMetric;
  /** Optional: presentation hints for the asset-directory focus view (kind:"asset"). */
  directory?: DirectorySpec;
  /** Optional: bands + all-clear copy for the forecast/index focus view (kind:"forecast"). */
  forecast?: ForecastSpec;
  /**
   * TRUE = registered and fetchable, but NOT offered as a map layer.
   *
   * A data-only source still has a `/api/signals/<id>` route and still feeds whatever
   * panels/widgets read it — but it is deliberately absent from the source catalog, the
   * Sources rail, the map, the monitor presets, the ⌘K palette, the variant profiles and
   * the `?sig=` share URL. Nothing can toggle it on, so it can never draw a pin.
   *
   * WHY THIS EXISTS. "Remove the layer" and "delete the data" are different requests, and
   * before this flag the registry could only express the second. The Country Instability
   * Index was asked to come off the map on 2026-09-05 while the Daily Brief, the Country
   * Instability widget, the Strategic Risk panel and the country dossier all keep reading
   * it. Deleting the source would have taken those four surfaces with it; leaving it
   * registered would have left the layer on the map. This is the third option.
   *
   * The split is enforced by `MAP_SIGNALS` in lib/signals/registry.ts — layer-facing code
   * reads that, registry-facing code (the route, /api/status, the explainers) reads
   * `SIGNALS`. Do not reintroduce a raw `SIGNALS` import in anything that draws or lists
   * layers, or a data-only source silently becomes a layer again.
   */
  dataOnly?: boolean;
  /** Fetch + normalise upstream into points. MUST resolve (never reject) to []. */
  fetch(): Promise<SignalFeature[]>;
}
