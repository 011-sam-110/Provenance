// Pure projection helpers for the Signals FOCUS detail view. The distribution
// logic is deliberately honest: it shows a magnitude histogram only when the
// source actually carries numeric magnitudes, falls back to declared severity
// counts, and reports "none" when neither exists (the caller then hides the panel).
import type { SignalFeature, SignalMetric } from "@/lib/signals/types";
import { histogram } from "@/lib/widgets/buckets";
import { rowMetric } from "@/lib/console/signals/signalCard";
import type { CountSample } from "@/lib/widgets/history";

/** Declared severity read from common alert-level props — only unambiguous words. */
export function declaredSeverity(props?: Record<string, unknown>): "critical" | "warn" | null {
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

/** Finite numeric props.magnitude values. */
export function magnitudeValues(features: SignalFeature[]): number[] {
  const out: number[] = [];
  for (const f of features) {
    const m = f.props?.magnitude;
    if (typeof m === "number" && Number.isFinite(m)) out.push(m);
  }
  return out;
}

export interface Distribution {
  kind: "magnitude" | "severity" | "none";
  bins: { label: string; count: number }[];
}

/** Honest distribution: magnitude histogram → severity counts → none. */
export function distribution(features: SignalFeature[]): Distribution {
  const mags = magnitudeValues(features);
  if (mags.length > 0) {
    const lo = Math.floor(Math.min(...mags));
    const maxV = Math.max(...mags);
    // When the max is an exact integer, extend the top edge by one so it gets its
    // OWN bucket instead of merging into the penultimate one (off-by-one guard).
    const hi = Math.ceil(maxV) + (Number.isInteger(maxV) ? 1 : 0);
    const span = Math.max(1, hi - lo);
    const step = Math.max(1, Math.ceil(span / 8)); // ≤8 integer-width buckets
    const edges: number[] = [];
    for (let e = lo; e < hi; e += step) edges.push(e);
    edges.push(hi);
    // Reuse the node-tested histogram (last bin inclusive of the top edge).
    const bins = histogram(mags, edges).map((count, i) => ({
      label: step === 1 ? `${edges[i]}` : `${edges[i]}–${edges[i + 1]}`,
      count,
    }));
    return { kind: "magnitude", bins };
  }
  let critical = 0, warn = 0, other = 0;
  for (const f of features) {
    const s = declaredSeverity(f.props);
    if (s === "critical") critical++;
    else if (s === "warn") warn++;
    else other++;
  }
  // A severity BAR is only informative when a non-trivial share is actually graded —
  // otherwise a single false-positive keyword match (e.g. a vessel nav-status) turns
  // the whole panel into a meaningless all-"Other" chart. Require ≥2 graded features.
  if (critical + warn >= 2) {
    return { kind: "severity", bins: [
      { label: "Severe", count: critical },
      { label: "Warning", count: warn },
      { label: "Other", count: other },
    ] };
  }
  return { kind: "none", bins: [] };
}

/** Parseable ISO timestamps → ms, plus the count of undated features. */
export function timeModel(features: SignalFeature[]): { values: number[]; undated: number } {
  const values: number[] = [];
  let undated = 0;
  for (const f of features) {
    const t = f.ts ? Date.parse(f.ts) : NaN;
    if (Number.isFinite(t)) values.push(t);
    else undated++;
  }
  return { values, undated };
}

export type SortKey = "magnitude" | "recency" | "title";

/** Compact numeric label: integers bare, else one decimal (mirrors signalCard). */
export function fmtValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * The scalar shown in the "Value"/"Magnitude" column and used for ranking, the
 * min-value filter and the KPI peak. Metric-first: when the source declares a
 * `metric` its REAL scalar wins (e.g. instability score 0–100, not the overloaded
 * props.magnitude radius proxy); otherwise the plain props.magnitude; else undefined.
 */
export function rowValue(f: SignalFeature, metric?: SignalMetric): number | undefined {
  if (metric) return rowMetric(f, metric)?.value;
  const m = f.props?.magnitude;
  return typeof m === "number" && Number.isFinite(m) ? m : undefined;
}

/** Stable-ish sort by value / recency / title. Missing values sort last.
 *  With a `metric` the value axis ranks by the resolved metric (so metric-only
 *  sources — no props.magnitude — become sortable), else by props.magnitude. */
export function sortFeatures(features: SignalFeature[], key: SortKey, dir: 1 | -1, metric?: SignalMetric): SignalFeature[] {
  const val = (f: SignalFeature) => {
    const v = rowValue(f, metric);
    return v == null ? -Infinity : v;
  };
  const rec = (f: SignalFeature) => (f.ts ? Date.parse(f.ts) : NaN);
  const cmp = (a: SignalFeature, b: SignalFeature): number => {
    if (key === "title") return a.title.localeCompare(b.title);
    if (key === "magnitude") return val(a) - val(b);
    const ra = rec(a), rb = rec(b);
    return (Number.isFinite(ra) ? ra : -Infinity) - (Number.isFinite(rb) ? rb : -Infinity);
  };
  return [...features].sort((a, b) => dir * cmp(a, b));
}

/** Human "time ago" for the When column: "12s" / "5m" / "2h" / "3d", and
 *  "in 4h" / "in 3d" for a stamp in the FUTURE. "" when undated or unparseable
 *  (the caller renders a dash).
 *
 *  Future stamps used to clamp to "0s". That is wrong for any forward-looking
 *  layer — every rocket launch in the schedule read "· 0s" regardless of whether
 *  it was tomorrow or in three months. Clamping hid the sign instead of showing it. */
export function relativeAge(ts: string | undefined, now: number): string {
  if (!ts) return "";
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "";
  const deltaS = Math.floor((now - t) / 1000);
  const future = deltaS < 0;
  const s = Math.abs(deltaS);
  const span = () => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };
  return future ? `in ${span()}` : span();
}

export type FreshnessState = "live" | "lagging" | "stale" | "none";

/**
 * Honest feed freshness for the provenance badge: compares the last successful
 * poll against the source's own refresh cadence. "live" within ~1.5× the cadence,
 * "lagging" up to ~4×, "stale" beyond, "none" when never fetched. Lets the header
 * say WHY a quiet map is quiet — a fresh calm vs a dead feed — which every pro user
 * said was make-or-break for trust.
 */
export function freshness(updatedAt: number | null | undefined, refreshMs: number, now: number): { state: FreshnessState; label: string } {
  if (!updatedAt) return { state: "none", label: "no data yet" };
  const ageMs = Math.max(0, now - updatedAt);
  const mins = Math.round(ageMs / 60_000);
  const label = mins < 1 ? "updated just now" : `updated ${mins}m ago`;
  const cadence = Number.isFinite(refreshMs) && refreshMs > 0 ? refreshMs : 300_000;
  if (ageMs <= cadence * 1.5) return { state: "live", label };
  if (ageMs <= cadence * 4) return { state: "lagging", label };
  return { state: "stale", label };
}

export interface DetailFilter {
  /** Case-insensitive substring matched against the feature title. */
  query: string;
  /** Minimum resolved value; 0 lets everything through (incl. valueless features). */
  min: number;
}

/** Apply the FOCUS filter bar: title search + min-value threshold. When min > 0,
 *  features with no resolvable value are excluded (can't clear a positive bar). */
export function filterDetailFeatures(features: SignalFeature[], filter: DetailFilter, metric?: SignalMetric): SignalFeature[] {
  const q = filter.query.trim().toLowerCase();
  const min = Number.isFinite(filter.min) ? filter.min : 0;
  return features.filter((f) => {
    if (q && !f.title.toLowerCase().includes(q)) return false;
    if (min > 0) {
      const v = rowValue(f, metric);
      if (v == null || v < min) return false;
    }
    return true;
  });
}

export interface DetailKpis {
  /** Features currently in view (post-filter). */
  inView: number;
  /** Highest resolved value + its formatted label, or null when none carry a value. */
  peak: { value: number; label: string } | null;
  /** Signed percent change of the count series over ≤24h, or "—" when uncomputable. */
  change24h: string;
}

/** Percent change of the persisted count series across the last ≤24h. Baseline =
 *  earliest sample within 24h of the latest (⇒ the whole series when it spans <24h). */
function change24hOf(samples: CountSample[]): string {
  if (samples.length < 2) return "—";
  const last = samples[samples.length - 1];
  const base = samples.find((s) => s.t >= last.t - 86_400_000) ?? samples[0];
  if (base === last || base.n === 0) return "—";
  const pct = Math.round(((last.n - base.n) / base.n) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** KPI cards under the masthead: In view / Peak / 24h Δ. Pure — `samples` is the
 *  count series already computed in the component; `features` is the filtered set. */
export function detailKpis(features: SignalFeature[], samples: CountSample[], metric?: SignalMetric): DetailKpis {
  let peak: { value: number; label: string } | null = null;
  for (const f of features) {
    const rm = metric ? rowMetric(f, metric) : undefined;
    const value = rm ? rm.value : rowValue(f, undefined);
    if (value == null) continue;
    if (!peak || value > peak.value) peak = { value, label: rm ? rm.label : fmtValue(value) };
  }
  return { inView: features.length, peak, change24h: change24hOf(samples) };
}
