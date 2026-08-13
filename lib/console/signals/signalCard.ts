// lib/console/signals/signalCard.ts
// PURE projection for the GENERIC signal-monitor widget: SignalFeature[] →
// scoped, ranked rows + honest counts + a "needs attention" alert list.
//
// One component (lib/console/widgets/signals.tsx) renders EVERY registered signal
// source through this function, so the logic that turns a heterogeneous feed into
// a glanceable monitor card lives here, once, and is unit-tested. The component
// and the per-signal fetch hook are dumb shells around it.

import type { SignalFeature, SignalMetric } from "@/lib/signals/types";
import { withinScope, type Scope } from "@/lib/shell/scope";
import type { Alert, AlertSeverity } from "@/lib/console/alerts";
import {
  coverageCountLabel,
  coverageNote,
  groupDigits,
  readCoverage,
  type SignalCoverage,
} from "@/lib/signals/coverage";

export interface RowMetric {
  /** Raw scalar (drives the bar fill). */
  value: number;
  /** [calm, extreme] normalisation domain from the source. */
  domain: [number, number];
  /** Pre-formatted label, e.g. "5.8", "88". */
  label: string;
}

export interface SignalRow {
  id: string;
  title: string;
  /** props.magnitude when it is a finite number (drives ranking + radius elsewhere). */
  magnitude?: number;
  ts?: string;
  link?: string;
  /** Per-feature severity-ramp colour → the row's bar/dot. */
  color?: string;
  /** The source's declared metric resolved for this feature → a <MetricBar>. Absent ⇒ a dot. */
  metric?: RowMetric;
}

/** Compact numeric label: integers bare, else one decimal. Thousands are grouped —
 *  the displacement card was rendering a bare `4176592` beside a title that had
 *  already grouped the same number, so the row showed both spellings at once. */
function fmtMetric(v: number): string {
  return Number.isInteger(v) ? groupDigits(v) : v.toFixed(1);
}

// ── The row label ───────────────────────────────────────────────────────────
//
// A monitor row is `[bar] <value> <title> · <age>`, and the value column is the
// one the eye scans. Every source composed its `title` before that column
// existed, so most of them restate the value inside it and the scan column
// carries nothing:
//
//   5.5        M 5.5 - 69 km SSW of Chirilagua, El Salvador
//   55 AQI     London - AQI 55 (Moderate)
//   31.5 °C    London - 32°C * Clear          <- and the two numbers DISAGREE
//   4,176,592  United States - 4,176,592 displaced
//   47         Nigeria - instability >=47/100 (floor, 3/4 factors)
//
// Five of six reviewers flagged this independently, and one named the weather
// row specifically: a page that argues with itself about the temperature in
// London is a page whose numbers about Sudan you stop believing.
//
// The fix is HERE and not in the ~20 adapters, because `title` has a second
// audience: it is the map's pin label (components/WorldMap.tsx), where there is
// no value column and stripping the magnitude would make the label useless. The
// duplication only exists in the row, so it is removed in the row.
//
// Conservative by construction: it strips only a number it can actually find,
// and returns the title untouched whenever the result would be empty or
// implausibly short. A row that keeps a redundant number is a cosmetic problem;
// a row that has lost its place name is a broken row.

/** Every plausible spelling of a number as an adapter might have written it. */
function numberForms(v: number): string[] {
  const forms = new Set<string>([
    String(v), groupDigits(v), v.toFixed(0), v.toFixed(1), String(Math.round(v)),
  ]);
  // Adapters routinely round for display (weather prints Math.round(temp)), so
  // the title's number is often NOT the metric's raw value.
  if (Number.isFinite(v)) forms.add(groupDigits(Math.round(v)));
  return [...forms].filter(Boolean).sort((a, b) => b.length - a.length);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The title with the metric's own value removed, when it can be removed cleanly.
 * PURE and unit-tested against the real strings above.
 */
export function rowLabel(title: string, metric?: RowMetric): string {
  if (!metric || !title) return title;

  // A unit as adapters actually write it: "°C", "%", or a short word ("AQI",
  // "displaced", "kt"). Optional, because plenty of titles state a bare number.
  const UNIT = String.raw`(?:\s*(?:°[A-Za-z]?|%|[A-Za-z]{1,9}))?`;
  // A denominator, for scores written as a bounded fraction ("≥47/100").
  const DENOM = String.raw`(?:\s*\/\s*\d+)?`;

  let out = title;
  for (const num of numberForms(metric.value)) {
    const n = escapeRe(num);
    // BOTH boundaries matter. Without the trailing one, a metric of 5.5 (whose
    // rounded form is "6") turns "Route 66 Interchange" into "Route 6
    // Interchange" — silently corrupting a place name, which is far worse than
    // the duplication being removed. The leading lookbehind stops a match
    // starting mid-number.
    const OPEN = String.raw`(?<![\w.,])`;
    const CLOSE = String.raw`(?![\d.,])`;

    // A leading "M 5.5 — " stanza: the value, then the separator dividing it
    // from the place it belongs to.
    const lead = new RegExp(`^\\s*(?:[A-Za-z]{1,4}\\s+)?[≥≤~<>]?${n}${CLOSE}${UNIT}${DENOM}\\s*[—–\\-·:]\\s*`, "u");
    if (lead.test(out)) { out = out.replace(lead, ""); break; }

    // An inline restatement: "AQI 55", "32°C", "≥47/100", "4,176,592 displaced".
    const inline = new RegExp(`\\s*${OPEN}(?:[A-Za-z]{1,4}\\s+)?[≥≤~<>]?${n}${CLOSE}${UNIT}${DENOM}`, "u");
    if (inline.test(out)) { out = out.replace(inline, " "); break; }
  }

  const tidy = out
    .replace(/\(\s*\)/g, "")               // parens emptied by the removal
    .replace(/\s*\(\s*/g, " (")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s—–\-·:,]+/u, "")         // a separator left leading
    .replace(/[\s—–\-·:,]+$/u, "")         // …or trailing
    .replace(/([—–\-·:])\s*\1+/gu, "$1")   // doubled separators
    .trim();

  // A stripped-to-nothing row has lost its place name, which is worse than the
  // duplication this function exists to remove.
  return tidy.length >= 2 ? tidy : title;
}

/**
 * Resolve a source's declared metric for one feature into a bar spec, or undefined
 * when the source declares no metric or the field is missing/non-finite. PURE + unit-
 * tested — reads the REAL field the source named (never the overloaded radius proxy).
 */
export function rowMetric(f: SignalFeature, metric?: SignalMetric): RowMetric | undefined {
  if (!metric) return undefined;
  const raw = metric.field === "magnitude" ? f.props?.magnitude : f.props?.[metric.field];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return { value: raw, domain: metric.domain, label: metric.unit ? `${fmtMetric(raw)}${metric.unit}` : fmtMetric(raw) };
}

export interface SignalProjection {
  rows: SignalRow[];
  /** Features emitted before scope trimming (for "N of M" honesty). */
  total: number;
  /** Features inside the active scope (the widget's headline count). */
  shown: number;
  alerts: Alert[];
  /**
   * The adapter's truncation record, when it published one. `undefined` means the
   * source declared nothing — NOT that the feed is complete.
   */
  coverage?: SignalCoverage;
  /**
   * The headline count as text. Identical to `String(total)` for an uncapped feed;
   * for a capped one it carries the denominator the cap cut from ("1,500 of
   * 41,203"), so the widget cannot print a cap as if it were a measurement.
   */
  totalLabel: string;
  /** One plain sentence naming what was hidden and how survivors were chosen. */
  capNote?: string;
}

export interface SignalCardConfig {
  /** Flag features whose numeric magnitude is at/above this as alerts. Off when unset. */
  alertMin?: number;
  /** Max rows rendered (default 60). */
  limit?: number;
}

const DEFAULT_LIMIT = 60;
const MAX_ALERTS = 4;
const SEV_RANK: Record<AlertSeverity, number> = { info: 0, warn: 1, critical: 2 };

/** A finite numeric magnitude from a feature's props, else undefined. */
function magnitudeOf(f: SignalFeature): number | undefined {
  const m = f.props?.magnitude;
  return typeof m === "number" && Number.isFinite(m) ? m : undefined;
}

/**
 * Soft, source-agnostic severity read from common alert-level props. Only fires
 * on words that unambiguously mean "severe" so the generic card never invents
 * urgency a source did not declare. Returns null when nothing qualifies.
 */
function severityFromProps(props: Record<string, unknown> | undefined): AlertSeverity | null {
  if (!props) return null;
  for (const key of ["alertlevel", "alertLevel", "severity", "level", "status"]) {
    const v = props[key];
    if (typeof v !== "string") continue;
    const s = v.toLowerCase();
    if (/red|extreme|severe|critical|emergency/.test(s)) return "critical";
    if (/orange|warning|high|moderate/.test(s)) return "warn";
  }
  return null;
}

function tsMillis(ts: string | undefined): number {
  if (!ts) return -Infinity; // undated sorts last under recency
  const t = Date.parse(ts);
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * Project a single source's features into a ranked monitor card.
 * - Rows are trimmed to the active scope, then ranked: by magnitude (desc) when
 *   any feature carries one, otherwise by recency (desc; undated last).
 * - Alerts surface declared-severe features (always) plus, when `alertMin` is
 *   set, features at/above that magnitude — deduped, ranked, capped at 4.
 * - `totalLabel` / `capNote` carry the source's RENDER-CAP record, so a capped
 *   feed cannot present its ceiling as a count. Pass `coverage` from the
 *   `/api/signals/<id>` payload on the client (the server-side side-channel does
 *   not survive JSON); server-side callers can omit it and it is read off the array.
 */
export function projectSignal(
  features: SignalFeature[],
  scope: Scope,
  config: SignalCardConfig,
  metric?: SignalMetric,
  coverage?: SignalCoverage,
): SignalProjection {
  const total = features.length;
  const cov = coverage ?? readCoverage(features);
  const scoped = features.filter((f) => withinScope(f.lat, f.lon, scope));

  const rows: SignalRow[] = scoped.map((f) => ({
    id: f.id,
    title: f.title,
    magnitude: magnitudeOf(f),
    ts: f.ts,
    link: f.link,
    color: f.color,
    metric: rowMetric(f, metric),
  }));

  const hasMagnitude = rows.some((r) => r.magnitude != null);
  rows.sort((a, b) => {
    if (hasMagnitude) {
      const diff = (b.magnitude ?? -Infinity) - (a.magnitude ?? -Infinity);
      if (diff !== 0) return diff;
    }
    return tsMillis(b.ts) - tsMillis(a.ts);
  });

  // Alerts — keyed by feature id so magnitude + prop-severity hits collapse.
  const alertMap = new Map<string, Alert>();
  const consider = (f: SignalFeature, severity: AlertSeverity, mag?: number) => {
    const prev = alertMap.get(f.id);
    if (prev && SEV_RANK[prev.severity] >= SEV_RANK[severity]) return;
    const tail = mag != null ? ` · ${mag}` : "";
    alertMap.set(f.id, { id: `sig-${f.id}`, severity, text: `${f.title}${tail}`, ref: f.id });
  };
  for (const f of scoped) {
    const sev = severityFromProps(f.props);
    if (sev) consider(f, sev);
    if (config.alertMin != null) {
      const mag = magnitudeOf(f);
      if (mag != null && mag >= config.alertMin) {
        consider(f, mag >= config.alertMin + 2 ? "critical" : "warn", mag);
      }
    }
  }
  const alerts = [...alertMap.values()]
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])
    .slice(0, MAX_ALERTS);

  const limit = config.limit ?? DEFAULT_LIMIT;
  return {
    rows: rows.slice(0, limit),
    total,
    shown: scoped.length,
    alerts,
    ...(cov ? { coverage: cov } : {}),
    totalLabel: cov ? coverageCountLabel(cov, total) : groupDigits(total),
    ...(coverageNote(cov) ? { capNote: coverageNote(cov) } : {}),
  };
}
