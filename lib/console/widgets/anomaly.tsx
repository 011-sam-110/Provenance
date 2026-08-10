"use client";
// "What's abnormal" — the anomaly-first triage widget. Reads a curated set of the
// highest-signal layers, ranks the genuinely notable items across ALL of them
// (real-metric severity + recency, routine stuff filtered out) into one feed that
// answers "what should I look at right now?" — with provenance + freshness + a
// click-to-fly. Pure ranking lives in lib/console/anomaly/anomaly.ts.
import { useEffect, useMemo } from "react";
import { registerWidget, type WidgetBodyProps, type WidgetDetailProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { useSignalFeatures } from "@/lib/widgets/useSignalFeatures";
import { getSignal } from "@/lib/signals/registry";
import { rankAnomalies, type AnomalyInput, type AnomalyRow } from "@/lib/console/anomaly/anomaly";
import { openSignalFeature } from "@/lib/widgets/openSignal";
import { useScope, withinScope } from "@/lib/shell/scope";
import { useNow, formatAge } from "@/lib/shell/useNow";
import { signalsStore } from "@/lib/signals/store";
import { shellLayoutStore } from "@/lib/console/store";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";

// The curated layers scanned for anomalies — high-signal, metric-bearing sources
// spanning natural hazards, space weather, macro-instability and infrastructure.
const ANOMALY_IDS = ["earthquakes", "gdacs", "tropical-cyclones", "floods", "wildfires", "space-weather", "instability", "internet-outages"];

/** Subscribe to the fixed curated set (unrolled → hook order is stable) and rank. */
function useAnomalyRows(
  now: number,
  cap: number,
): { rows: AnomalyRow[]; updatedAt: number | null; loading: boolean; okCount: number; total: number } {
  const quakes = useSignalFeatures("earthquakes", true);
  const gdacs = useSignalFeatures("gdacs", true);
  const cyclones = useSignalFeatures("tropical-cyclones", true);
  const floods = useSignalFeatures("floods", true);
  const fires = useSignalFeatures("wildfires", true);
  const space = useSignalFeatures("space-weather", true);
  const instab = useSignalFeatures("instability", true);
  const outages = useSignalFeatures("internet-outages", true);
  const feeds = [quakes, gdacs, cyclones, floods, fires, space, instab, outages];

  const scope = useScope();
  const rows = useMemo(() => {
    const inputs: AnomalyInput[] = ANOMALY_IDS.map((id, i) => {
      const s = getSignal(id);
      return {
        id,
        label: s?.label ?? id,
        color: s?.color ?? "#64748b",
        metric: s?.metric,
        features: feeds[i].features.filter((f) => withinScope(f.lat, f.lon, scope)),
      };
    });
    return rankAnomalies(inputs, now, { cap });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, cap, now, ...feeds.map((f) => f.updatedAt)]);

  // OLDEST, not newest: this widget ranks anomalies ACROSS eight layers, so the
  // trustworthy age of the ranking is the age of its most out-of-date input. Taking
  // the max would let one fast feed vouch for seven frozen ones.
  const succeeded = feeds.filter((f) => f.updatedAt != null);
  const updatedAt = succeeded.length ? Math.min(...succeeded.map((f) => f.updatedAt as number)) : null;
  const loading = feeds.some((f) => f.status === "loading") && updatedAt == null;
  return { rows, updatedAt, loading, okCount: succeeded.length, total: feeds.length };
}

function AnomalyList({ rows, now }: { rows: AnomalyRow[]; now: number }) {
  return (
    <ul className="tn-anom-list">
      {rows.map((r) => (
        <li key={`${r.layerId}:${r.id}`}>
          <button type="button" className="tn-anom-row" onClick={() => openSignalFeature(r.feature, r.layerLabel)}>
            <span className="tn-anom-sev" title={`severity ${(r.severity * 100).toFixed(0)}%`}>
              <i style={{ width: `${Math.max(8, r.severity * 100)}%`, background: r.color }} />
            </span>
            <span className="tn-anom-main">
              <span className="tn-anom-title">{r.title}</span>
              <span className="tn-anom-meta">
                <span className="tn-anom-layer" style={{ color: r.color }}>{r.layerLabel}</span>
                {r.valueLabel && <> · <b>{r.valueLabel}</b></>}
                {r.ageMs != null && <> · {formatAge(r.ageMs)} ago</>}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AnomalyBody(_p: WidgetBodyProps) {
  const now = useNow(30_000);
  const { rows, loading, updatedAt, okCount, total } = useAnomalyRows(now, 12);
  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: [],
      count: rows.length,
      fresh: {
        lastOk: updatedAt,
        ok: okCount > 0,
        count: rows.length,
        refreshMs: 5 * 60_000,
        coverage: { ok: okCount, total },
      },
    });
  }, [rows.length, report, updatedAt, okCount, total]);

  if (loading && rows.length === 0) return <p className="tn-w-empty">Scanning layers…</p>;
  if (rows.length === 0) return <p className="tn-w-empty">All quiet — nothing abnormal across the monitored layers.</p>;
  return <AnomalyList rows={rows} now={now} />;
}

function AnomalyDetail(_p: WidgetDetailProps) {
  const now = useNow(30_000);
  const { rows, updatedAt, loading } = useAnomalyRows(now, 24);
  const showOnMap = () => { for (const id of ANOMALY_IDS) signalsStore.set(id, true); shellLayoutStore.unfocus(); };
  const mapPoints: InsetPoint[] = rows.map((r) => ({ lat: r.lat, lon: r.lon, id: r.id, color: r.color, props: { title: r.title } }));
  const bands = useMemo(() => ({
    critical: rows.filter((r) => r.severity >= 0.8).length,
    elevated: rows.filter((r) => r.severity >= 0.6 && r.severity < 0.8).length,
    layers: new Set(rows.map((r) => r.layerId)).size,
  }), [rows]);

  return (
    <div className="tn-sd tn-anom">
      <header className="tn-sd-head">
        <div className="tn-sd-title">What&apos;s abnormal</div>
        <div className="tn-sd-stat"><b>{rows.length}</b> notable across {ANOMALY_IDS.length} layers
          {updatedAt && <span className="tn-sd-fresh is-live"><i className="tn-sd-fresh-dot" />live</span>}
        </div>
      </header>

      {rows.length > 0 && (
        <div className="tn-sd-kpis">
          <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Critical</div><div className="tn-sd-kpi-value">{bands.critical}</div><div className="tn-sd-kpi-sub">severity ≥ 80%</div></div>
          <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Elevated</div><div className="tn-sd-kpi-value">{bands.elevated}</div><div className="tn-sd-kpi-sub">60–80%</div></div>
          <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Layers hit</div><div className="tn-sd-kpi-value">{bands.layers}</div><div className="tn-sd-kpi-sub">of {ANOMALY_IDS.length} scanned</div></div>
        </div>
      )}

      {loading && rows.length === 0 && <p className="tn-w-empty">Scanning layers…</p>}
      {!loading && rows.length === 0 && <p className="tn-w-empty">All quiet — nothing abnormal across the monitored layers right now.</p>}

      {mapPoints.length > 0 && (
        <div className="tn-sd-mappanel">
          <h3>Where <span className="tn-sd-maphint">· the notable items, sized-in by severity</span></h3>
          <InsetMap points={mapPoints} height={220} />
        </div>
      )}

      {rows.length > 0 && <AnomalyList rows={rows} now={now} />}

      <footer className="tn-sd-foot">
        <span className="tn-sd-attr">Composited from {ANOMALY_IDS.length} keyless layers · severity from each source&apos;s real metric</span>
        <span className="tn-sd-actions"><button onClick={showOnMap}>🗺 Light all layers</button></span>
      </footer>
    </div>
  );
}

registerWidget({
  id: "anomaly",
  title: "What's abnormal",
  icon: "🧭",
  category: "Synthesis",
  defaultHeight: 260,
  defaultConfig: {},
  component: AnomalyBody,
  detail: AnomalyDetail,
});
