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

/** Compact numeric label: integers bare, else one decimal. */
function fmtMetric(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
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
