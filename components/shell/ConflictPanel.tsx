"use client";
// Armed Conflict widget — the deadliest UCDP verified events from the conflict layer
// (ACLED first if that layer ever returns). Honestly labels which source is live.
// Dock-only (v1). Each row → fly + open the event dossier.

import { useSignalFeatures } from "@/lib/widgets/useSignalFeatures";
import { conflictView } from "@/lib/widgets/conflict";
import { openSignalFeature } from "@/lib/widgets/openSignal";
import { useNow, formatAge } from "@/lib/shell/useNow";

export default function ConflictPanel({ docked = false }: { docked?: boolean } = {}) {
  const acled = useSignalFeatures("acled", docked);
  const gdelt = useSignalFeatures("conflict", docked); // the conflict layer (UCDP since 2026-10-16)
  const now = useNow(1000);
  if (!docked) return null;

  const view = conflictView(acled.features, gdelt.features);
  const loading = acled.status === "loading" || gdelt.status === "loading";
  const updatedAt = Math.max(acled.updatedAt ?? 0, gdelt.updatedAt ?? 0) || null;
  return (
    <aside className="tn-widget tn-docked" role="region" aria-label="Armed conflict">
      <header className="tn-widget-head">
        <h2 className="tn-widget-title">Armed Conflict</h2>
        <span className="tn-widget-source">{view.mode === "none" ? "—" : view.sourceLabel}</span>
      </header>
      {loading && view.rows.length === 0 && <p className="tn-widget-status">Loading…</p>}
      {!loading && view.rows.length === 0 && <p className="tn-widget-status">No live conflict data right now.</p>}
      <ol className="tn-widget-list">
        {view.rows.map((r) => (
          <li key={r.id}>
            <button type="button" className="tn-widget-row" onClick={() => openSignalFeature(r.feature, view.sourceLabel)}>
              <span className="tn-widget-row-main">
                <span className="tn-widget-row-title">{r.title}</span>
                <span className="tn-widget-row-sub">{r.sub}</span>
              </span>
              <span className="tn-widget-metric tn-num">
                {r.metric}
                <span className="tn-widget-metric-unit">{r.metricLabel === "fatalities" ? "dead" : "news"}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {updatedAt != null && <p className="tn-widget-foot">Updated {formatAge(now - updatedAt)} ago</p>}
    </aside>
  );
}
