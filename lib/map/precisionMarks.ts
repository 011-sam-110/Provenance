// lib/map/precisionMarks.ts
// Which MARK the map draws for a signal, decided from how precise its place is.
//
// THE RULE. A place NAME is never drawn as a precise point. A pin says "this thing is
// here". A country total, a headline that names a city and an oblast under an alert
// are not "here", so they do not get a pin:
//
//   exact, facility        a pin, as before (or the feature's own line)
//   area, with a polygon   the polygon, shaded (as before: GPS jamming hexagons)
//   area, without one      a soft shaded disc, with the figure when the layer has one
//   country, with outline  the country's outline from public/geo/countries-110m.geojson,
//                          shaded, with the figure at the label anchor
//   country, no outline    a dashed ring with the figure. That file has 177 outlines,
//                          so Bahrain, Malta, Singapore and others have none.
//
// No branch below gives an area or a country a pin. tests/unit/precision-marks.test.ts
// holds that for every mark and for every registered layer.
//
// Pure: no MapLibre, no DOM. WorldMap owns the sources, the layers and the paint.

import type { WorldObject } from "@/lib/world";
import type { SignalGeometry, SignalMetric } from "@/lib/signals/types";
import { isSignalPrecision } from "@/lib/signals/precision";

/** The five marks. "pin" also stands for a feature's own line (a cable route). */
export type SignalMark = "pin" | "shape" | "disc" | "country" | "ring";

/** Every mark, in the order the legend lists them. */
export const SIGNAL_MARKS: readonly SignalMark[] = ["pin", "shape", "disc", "country", "ring"];

/** What the builders need to know that a signal object does not carry. */
export interface MarkContext {
  /** The outline of a country by ISO 3166-1 alpha-3 code, or undefined when the file has none. */
  countryOutline(iso3: string): GeoJSON.Geometry | undefined;
  /** The layer's declared metric (lib/signals/types.ts), or undefined when it has none. */
  metricOf(signalId: string): SignalMetric | undefined;
  /**
   * The ISO alpha-3 code for a country NAME, or undefined. Used only for a
   * country-level feature that carries no `countryIso3`: a payload that a browser or
   * a CDN cached before the adapters sent the code still names its country in
   * `props.country`. A name lookup can shade the right country or none. It is NOT a
   * point-in-polygon test, and must never become one: the centroid of San Marino is
   * inside the outline of Italy.
   */
  iso3OfName(name: string): string | undefined;
}

/** A context with no outlines and no metrics: every country becomes a dashed ring. */
export const EMPTY_MARK_CONTEXT: MarkContext = {
  countryOutline: () => undefined,
  metricOf: () => undefined,
  iso3OfName: () => undefined,
};

/**
 * Index the country file by ISO alpha-3 code. Features with no usable code are left
 * out, so a lookup for them answers undefined and the caller draws a ring.
 */
export function buildCountryOutlines(
  fc: GeoJSON.FeatureCollection | null | undefined,
): Map<string, GeoJSON.Geometry> {
  const out = new Map<string, GeoJSON.Geometry>();
  for (const f of fc?.features ?? []) {
    const iso3 = (f.properties as { ISO_A3?: unknown } | null)?.ISO_A3;
    if (typeof iso3 !== "string" || !/^[A-Z]{3}$/.test(iso3) || !f.geometry) continue;
    if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;
    out.set(iso3, f.geometry);
  }
  return out;
}

function geometryOf(s: WorldObject): SignalGeometry | undefined {
  const g = s.meta?.geometry as SignalGeometry | undefined;
  if (!g) return undefined;
  return g.type === "LineString" || g.type === "MultiLineString" || g.type === "Polygon" || g.type === "MultiPolygon"
    ? g
    : undefined;
}

/** The country a country-level feature stands for: its own code, else its named country. */
function iso3Of(s: WorldObject, ctx: MarkContext): string | undefined {
  const v = s.meta?.countryIso3;
  if (typeof v === "string" && /^[A-Z]{3}$/.test(v)) return v;
  const name = (s.meta?.props as Record<string, unknown> | undefined)?.country;
  return typeof name === "string" && name.trim() ? ctx.iso3OfName(name) : undefined;
}

/**
 * The mark for one signal object.
 *
 * An object with no precision level is a pin: that is an object built before the
 * level existed, and guessing "area" for it would hide a real point.
 */
export function markOf(s: WorldObject, ctx: MarkContext): SignalMark {
  const g = geometryOf(s);
  if (g && (g.type === "Polygon" || g.type === "MultiPolygon")) return "shape";
  if (g) return "pin"; // a line: drawn as the line it is
  const precision = isSignalPrecision(s.meta?.precision) ? s.meta!.precision : undefined;
  if (precision === "country") {
    const iso3 = iso3Of(s, ctx);
    return iso3 && ctx.countryOutline(iso3) ? "country" : "ring";
  }
  if (precision === "area") return "disc";
  return "pin";
}

/** True when the signal is a point that the pin layer draws. */
export function isPinPoint(s: WorldObject, ctx: MarkContext): boolean {
  return !geometryOf(s) && markOf(s, ctx) === "pin";
}

/** A short figure for the map: 3220274 -> "3.2M", 45210 -> "45K", 412 -> "412", 2.46 -> "2.5". */
export function formatFigure(n: number): string {
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const short = (v: number, suffix: string) => `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${suffix}`;
  if (abs >= 1e9) return short(n / 1e9, "B");
  if (abs >= 1e6) return short(n / 1e6, "M");
  if (abs >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (abs >= 1e3) return short(n / 1e3, "K");
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** The value of the layer's metric on this object, or undefined. */
function metricValue(s: WorldObject, metric: SignalMetric | undefined): number | undefined {
  if (!metric) return undefined;
  const raw = (s.meta?.props as Record<string, unknown> | undefined)?.[metric.field];
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** The figure text for a value of this metric. Only "%" is short enough to print on the map. */
function figureText(value: number, metric: SignalMetric): string {
  return `${formatFigure(value)}${metric.unit?.trim() === "%" ? "%" : ""}`;
}

/** The disc radius in pixels, from the same `magnitude` convention the pin uses. */
function discRadius(s: WorldObject): number {
  const mag = Number((s.meta?.props as Record<string, unknown> | undefined)?.magnitude);
  const pin = Number.isFinite(mag) ? Math.max(4, Math.min(26, 4 + mag * 1.6)) : 7;
  // Wider than the pin of the same magnitude: the mark stands for an area.
  return Math.round((pin * 1.5 + 3) * 10) / 10;
}

/**
 * A dark ink of the same hue as the feature colour, for the figure.
 *
 * Two country layers on at once put two figures near one anchor. In one shared black
 * a reader could not tell which layer a figure came from, so each figure takes the
 * hue of its own shading. Half the value of each channel keeps every layer colour in
 * use dark enough to read on the white halo (pale amber #fbbf24 becomes #7e6012).
 * Anything that is not a 6-digit hex colour gets the neutral ink.
 */
export function figureInk(color: string | undefined): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color ?? "");
  if (!m) return "#0f172a";
  const half = (h: string) => Math.round(parseInt(h, 16) * 0.5).toString(16).padStart(2, "0");
  return `#${half(m[1])}${half(m[2])}${half(m[3])}`;
}

function baseProps(s: WorldObject) {
  return {
    id: s.id,
    signalId: (s.meta?.signalId as string) ?? "",
    label: s.label,
    color: s.color ?? "#64748b",
  };
}

/**
 * One entry for each anchor-only mark the map draws.
 *
 * A layer WITH a metric has one figure for each feature: the metric's value. A layer
 * WITHOUT one has nothing to print for a single feature, so its country features are
 * grouped by country and the figure is how many of them the country has (ReliefWeb
 * publishes one feature for each emergency). The group keeps the id of its first
 * feature, which is the dossier a click opens. Discs are never grouped.
 */
interface AnchorMark {
  signal: WorldObject;
  mark: "disc" | "country" | "ring";
  figure: string;
  /** Sort weight for label placement: a larger figure keeps its label first. */
  weight: number;
  iso3?: string;
}

function anchorMarks(signals: readonly WorldObject[], ctx: MarkContext): AnchorMark[] {
  const out: AnchorMark[] = [];
  const groups = new Map<string, AnchorMark & { n: number }>();
  for (const s of signals) {
    const mark = markOf(s, ctx);
    if (mark !== "disc" && mark !== "country" && mark !== "ring") continue;
    const signalId = (s.meta?.signalId as string) ?? "";
    const metric = ctx.metricOf(signalId);
    const value = metricValue(s, metric);
    if (mark === "disc") {
      out.push({ signal: s, mark, figure: metric && value != null ? figureText(value, metric) : "", weight: value ?? 0 });
      continue;
    }
    const iso3 = iso3Of(s, ctx);
    if (metric) {
      out.push({ signal: s, mark, figure: value != null ? figureText(value, metric) : "", weight: value ?? 0, iso3 });
      continue;
    }
    // No metric: count the layer's features for this country. A feature with no
    // country code cannot be grouped and counts as itself.
    const key = `${signalId}|${iso3 ?? `id:${s.id}`}`;
    const held = groups.get(key);
    if (held) {
      held.n += 1;
      held.figure = String(held.n);
      held.weight = held.n;
    } else {
      const entry = { signal: s, mark, figure: "1", weight: 1, iso3, n: 1 };
      groups.set(key, entry);
      out.push(entry);
    }
  }
  return out;
}

/**
 * Point signals that keep a pin: exact points and named facilities.
 * Area and country features are NOT in here. That absence is the rule.
 */
export function pinSignals(signals: readonly WorldObject[], ctx: MarkContext): WorldObject[] {
  return signals.filter((s) => isPinPoint(s, ctx));
}

/**
 * The anchor points of every disc, country and ring mark: where the figure and the
 * name sit, and what a click hits. `mark` selects the layer that draws each one.
 */
export function toSignalAnchorFC(signals: readonly WorldObject[], ctx: MarkContext): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: anchorMarks(signals, ctx).map((m) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [m.signal.lon, m.signal.lat] },
      properties: {
        ...baseProps(m.signal),
        mark: m.mark,
        ink: figureInk(m.signal.color),
        figure: m.figure,
        weight: m.weight,
        radius: discRadius(m.signal),
      },
    })),
  };
}

/** The shaded outline of each country that a country-level feature stands for. */
export function toSignalCountryFC(signals: readonly WorldObject[], ctx: MarkContext): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const m of anchorMarks(signals, ctx)) {
    if (m.mark !== "country" || !m.iso3) continue;
    const outline = ctx.countryOutline(m.iso3);
    if (!outline) continue;
    features.push({ type: "Feature", geometry: outline, properties: { ...baseProps(m.signal), iso3: m.iso3 } });
  }
  return { type: "FeatureCollection", features };
}

/** Which marks are on the map now, for the legend. In SIGNAL_MARKS order. */
export function marksPresent(signals: readonly WorldObject[], ctx: MarkContext): SignalMark[] {
  const seen = new Set<SignalMark>();
  for (const s of signals) {
    seen.add(markOf(s, ctx));
    if (seen.size === SIGNAL_MARKS.length) break;
  }
  return SIGNAL_MARKS.filter((m) => seen.has(m));
}

/** The legend's words for each mark. */
export const MARK_LEGEND: Readonly<Record<SignalMark, { name: string; meaning: string }>> = {
  pin: { name: "Pin", meaning: "An exact point or a named site" },
  shape: { name: "Shaded shape", meaning: "An area with a known outline" },
  disc: { name: "Soft disc", meaning: "An area or a city, not an exact point" },
  country: { name: "Shaded country", meaning: "A figure for the whole country" },
  ring: { name: "Dashed ring", meaning: "A country figure. This map has no outline for that country" },
};
