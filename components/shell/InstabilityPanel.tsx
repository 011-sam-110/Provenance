"use client";
// Country Instability widget — the CII ranked as a list (WorldMonitor's signature
// panel, built from data we already compute). Dock-only (v1): renders as a
// workspace tile. Each row → fly + open the country's instability dossier.

import { useSignalFeatures } from "@/lib/widgets/useSignalFeatures";
import { instabilityRows } from "@/lib/widgets/instability";
import { openSignalFeature } from "@/lib/widgets/openSignal";
import { useNow, formatAge } from "@/lib/shell/useNow";
import { SIGNAL_COMPOSITE_SOURCES } from "@/lib/signals/sourceLink";

// Read from the same table the dossier's "contributing sources" list uses (lib/signals/sourceLink.ts),
// instead of a second hand-typed list — a hand-typed copy is what kept saying "ACLED" here after it
// was removed from the index on 2026-09-05 and the index was rebuilt around UCDP/INFORM/FEWS NET/WGI.
const INSTABILITY_SOURCE_LABELS = SIGNAL_COMPOSITE_SOURCES.instability.map((s) => s.label).join(" · ");

export default function InstabilityPanel({ docked = false }: { docked?: boolean } = {}) {
  const { features, status, updatedAt } = useSignalFeatures("instability", docked);
  const now = useNow(1000);
  if (!docked) return null;

  const rows = instabilityRows(features);
  return (
    <aside className="tn-widget tn-docked" role="region" aria-label="Country instability">
      <header className="tn-widget-head">
        <h2 className="tn-widget-title">Country Instability</h2>
        <span className="tn-widget-source">CII · 0–100</span>
      </header>
      {status === "loading" && rows.length === 0 && <p className="tn-widget-status">Loading…</p>}
      {status !== "loading" && rows.length === 0 && <p className="tn-widget-status">No data right now.</p>}
      <ol className="tn-widget-list">
        {rows.map((r, i) => (
          <li key={r.id}>
            <button type="button" className="tn-widget-row" onClick={() => openSignalFeature(r.feature, "Country Instability Index")}>
              <span className="tn-widget-rank">{i + 1}</span>
              <span className="tn-widget-row-main">
                <span className="tn-widget-row-title">{r.country}</span>
                <span className="tn-widget-row-sub">{r.drivers || r.coverage}</span>
              </span>
              <span className="tn-widget-metric tn-num" style={{ color: r.color }}>{r.score}</span>
            </button>
          </li>
        ))}
      </ol>
      {updatedAt != null && (
        <p className="tn-widget-foot">Updated {formatAge(now - updatedAt)} ago · {INSTABILITY_SOURCE_LABELS}</p>
      )}
    </aside>
  );
}
