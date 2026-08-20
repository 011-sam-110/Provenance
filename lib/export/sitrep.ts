// A SITREP: the sourced, plain-text account of exactly what one screen was
// showing at one moment.
//
// WHY IT EXISTS. An OSINT investigator reviewing the console asked whether he
// could export a report, or a screenshot, of the data he was looking at.
// Per-widget CSV/GeoJSON already existed (lib/export.ts); what did not was
// anything that captured the VIEW — the scope, the moment, and which feeds were
// actually answering when the numbers on screen were drawn.
//
// WHY IT IS SO CAUTIOUS. A generated document that looks like a sitrep will be
// pasted into somebody's report, and by then nobody remembers a machine wrote
// it. So three rules are structural here, not stylistic:
//
//   1. A layer that is ON but DOWN, STALE or LOCKED is LISTED, with its state.
//      Dropping it would be the worst available lie — absence from a report
//      reads as "nothing was happening there", when the truth is "we could not
//      see". Same reasoning as lib/terminal/feedHealth's refusal to fold
//      `refused` into `key`.
//   2. Counts are of FEATURES RENDERED IN THIS VIEW, and every count says so.
//      They are shaped by the scope, the zoom and what each upstream returned;
//      they are not counts of events in the world, and the document must never
//      let a reader think they are.
//   3. There is no assessment, no summary and no severity ranking. The document
//      reports what was on screen and who published it. Judgement is the
//      analyst's job, and a machine-written "Assessment" heading would invite
//      them to skip it.
//
// Pure and isomorphic — every function here is unit-tested. The browser-only
// assembly (reading the live stores, capturing the map) lives in
// lib/export/view.ts, which is a thin shell over this.

/** Honest per-layer state, mirroring lib/terminal/feedHealth's vocabulary. */
export type SitrepFeedState =
  | "live"
  | "empty"
  | "lag"
  | "stale"
  | "down"
  | "refused"
  | "locked"
  | "dormant"
  | "unknown";

/** How each state prints, and what it actually claims. Exhaustive by construction. */
const STATE_TEXT: Record<SitrepFeedState, string> = {
  live: "live",
  empty: "live, nothing to report in view",
  lag: "behind its refresh",
  stale: "stale - stopped answering",
  down: "not answering",
  refused: "credential refused upstream",
  locked: "needs a credential this deployment does not hold",
  dormant: "switched on, nothing returned yet",
  unknown: "state unknown",
};

/** True when the state means we could NOT see, as opposed to saw nothing. */
export function isBlindState(state: SitrepFeedState): boolean {
  return state === "stale" || state === "down" || state === "refused" || state === "locked";
}

export interface SitrepProvider {
  label: string;
  href: string;
  licence?: { label: string; url: string };
}

export interface SitrepLayer {
  id: string;
  title: string;
  state: SitrepFeedState;
  /**
   * Features this layer had rendered in the view at capture time. `null` when the
   * caller genuinely does not know - which prints as "not counted", never as 0.
   * Conflating "we counted zero" with "we did not count" is the whole point.
   */
  count: number | null;
  providers: SitrepProvider[];
}

export interface SitrepView {
  /** [lon, lat] map centre. */
  center: [number, number];
  zoom: number;
  /** [west, south, east, north] of the rendered viewport, when the caller has it. */
  bounds?: [number, number, number, number];
  basemap?: string;
  projection?: string;
}

export interface SitrepScope {
  mode: string;
  label: string;
  radiusKm?: number;
  center?: { lat: number; lon: number };
  bbox?: [number, number, number, number];
}

export interface SitrepInput {
  /** Epoch ms. Passed in, never read from the clock here, so this stays pure. */
  generatedAt: number;
  product: { name: string; url: string };
  scope: SitrepScope;
  view: SitrepView;
  layers: SitrepLayer[];
  /** Widget types on the board, for "what was on screen besides the map". */
  board?: { title: string; type: string }[];
}

/** ISO-8601 UTC to the second - the only timestamp format this document uses. */
export function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Lat/lon to 4dp (~11 m). Enough to relocate a view, honest about precision. */
export function coord(n: number): string {
  return n.toFixed(4);
}

/** One human line describing the scope filter in force. */
export function describeScope(s: SitrepScope): string {
  switch (s.mode) {
    case "near-me":
    case "region":
      if (!s.center || s.radiusKm == null) return `${s.label} (unbounded - no centre set)`;
      return `${s.label} - within ${s.radiusKm} km of ${coord(s.center.lat)}, ${coord(s.center.lon)}`;
    case "aoi":
      if (!s.bbox) return `${s.label} (unbounded - no area drawn)`;
      return `${s.label} - area ${s.bbox.map(coord).join(", ")} (W, S, E, N)`;
    default:
      return `${s.label} - no geographic filter, every feed at full extent`;
  }
}

function providerText(p: SitrepProvider): string {
  return p.licence
    ? `${p.label} (${p.href}, ${p.licence.label}: ${p.licence.url})`
    : `${p.label} (${p.href})`;
}

/** One layer's line. Sorted/grouped by the caller - this stays a pure formatter. */
export function layerLine(l: SitrepLayer): string {
  const count =
    l.count == null ? "not counted" : `${l.count} ${l.count === 1 ? "feature" : "features"} in view`;
  const src = l.providers.length
    ? l.providers.map(providerText).join("; ")
    : "no published source on record";
  return `- ${l.title} - ${STATE_TEXT[l.state]}; ${count}. Source: ${src}`;
}

/**
 * The whole document. Markdown, because it pastes into a report intact and reads
 * fine as plain text if it does not.
 */
export function toSitrepMarkdown(input: SitrepInput): string {
  const { generatedAt, product, scope, view, layers } = input;
  const stamp = utcStamp(generatedAt);

  const reporting = layers.filter((l) => !isBlindState(l.state));
  const blind = layers.filter((l) => isBlindState(l.state));
  const counted = reporting.reduce((n, l) => n + (l.count ?? 0), 0);
  const uncounted = reporting.filter((l) => l.count == null).length;

  const out: string[] = [];

  out.push(`# Situation snapshot - ${stamp}`);
  out.push("");
  out.push(
    `Generated by ${product.name} (${product.url}). This is a record of one screen at ` +
      "one moment, not an assessment.",
  );
  out.push("");

  out.push("## View");
  out.push("");
  out.push(`- Captured: ${stamp}`);
  out.push(`- Scope: ${describeScope(scope)}`);
  out.push(
    `- Map centre: ${coord(view.center[1])}, ${coord(view.center[0])} at zoom ${view.zoom.toFixed(2)}`,
  );
  if (view.bounds) out.push(`- Viewport: ${view.bounds.map(coord).join(", ")} (W, S, E, N)`);
  if (view.basemap) out.push(`- Basemap: ${view.basemap}`);
  if (view.projection) out.push(`- Projection: ${view.projection}`);
  out.push("");

  out.push("## Layers reporting");
  out.push("");
  if (reporting.length === 0) {
    out.push("None. No layer in this view was answering at capture time.");
  } else {
    for (const l of reporting) out.push(layerLine(l));
  }
  out.push("");

  // The section that exists so a gap in coverage cannot pass as a quiet map.
  out.push("## Layers that could not be seen");
  out.push("");
  if (blind.length === 0) {
    out.push("None. Every layer switched on in this view was answering.");
  } else {
    out.push(
      "These layers were switched on but could not report. **Their absence from the " +
        "list above is a gap in coverage, not evidence of quiet.**",
    );
    out.push("");
    for (const l of blind) out.push(layerLine(l));
  }
  out.push("");

  if (input.board?.length) {
    out.push("## Also on screen");
    out.push("");
    for (const w of input.board) out.push(`- ${w.title} (${w.type})`);
    out.push("");
  }

  out.push("## What this document is not");
  out.push("");
  out.push(
    `- **Counts are of features rendered in this view** - ${counted} across ` +
      `${reporting.length} reporting ${reporting.length === 1 ? "layer" : "layers"}` +
      (uncounted ? `, with ${uncounted} not counted` : "") +
      ". They are shaped by the scope and the zoom above, and by what each upstream " +
      `returned at ${stamp}. They are not counts of events in the world.`,
  );
  out.push(
    "- **No analysis has been applied.** Nothing here is ranked, correlated or " +
      "assessed. Two things appearing in the same snapshot are not thereby related.",
  );
  out.push(
    "- **It expires.** Every feed above refreshes on its own cycle; a reader " +
      `looking at this later is reading history, dated ${stamp}.`,
  );
  out.push(
    "- **Licences travel with the data.** Where a source is listed with a licence, " +
      "that licence governs any reuse of its rows, including inside this document.",
  );
  out.push("");

  return out.join("\n");
}

/** Stable, sortable filename - mirrors lib/export.ts's convention. */
export function sitrepFilename(at: number): string {
  return `provenance-sitrep-${utcStamp(at).replace(/[:\-]/g, "")}.md`;
}
