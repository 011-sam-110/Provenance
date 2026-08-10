"use client";
// Markets widget — the financial data piece as a monitor card. Reads the keyless
// /api/markets payload (CoinGecko crypto + ECB FX live; keyed equities/macro stay
// dormant) and lists each section's rows, flagging big movers as alerts. Reuses
// the shared .tn-w-* row classes; the +/- colour is the only inline styling.

import { useEffect, useMemo, useState } from "react";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import type { Alert, AlertSeverity } from "@/lib/console/alerts";
import type { MarketsPayload } from "@/lib/markets";
import { useJsonPoll } from "@/lib/console/widgets/useJsonPoll";
import { recordSeries, seriesTrend } from "@/lib/series";
import { Sparkline } from "@/components/Sparkline";
import MarketsDetail from "./markets.detail";

const EMPTY: MarketsPayload = { generatedAt: 0, sections: [] };
const RANK: Record<AlertSeverity, number> = { info: 0, warn: 1, critical: 2 };

const POLL_MS = 120_000;

function MarketsBody({ config }: WidgetBodyProps) {
  const { data, status, lastOk, ok } = useJsonPoll<MarketsPayload>("/api/markets", POLL_MS, EMPTY);
  const moveMin = typeof config.alertMin === "number" ? config.alertMin : 5;
  // Keep dormant (key-gated) sections too — show them as a "needs key" note
  // rather than hiding them, so the capability is discoverable (not invisible).
  const sections = useMemo(() => (data.sections ?? []).filter((s) => s.rows.length || s.dormant), [data.sections]);
  const allRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  const alerts: Alert[] = useMemo(() => {
    const out: Alert[] = [];
    for (const r of allRows) {
      if (r.changePct == null) continue;
      const mag = Math.abs(r.changePct);
      if (mag < moveMin) continue;
      out.push({
        id: `mkt-${r.id}`,
        severity: mag >= moveMin * 2 ? "critical" : "warn",
        text: `${r.symbol ?? r.name} ${r.changePct >= 0 ? "+" : ""}${r.changePct}%`,
        ref: r.id,
      });
    }
    return out.sort((a, b) => RANK[b.severity] - RANK[a.severity]).slice(0, 4);
  }, [allRows, moveMin]);

  // Record each row's raw value into the PERSISTED series so the sparklines
  // accumulate across polls and reloads; bump a tick so the fresh sample shows.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!data.generatedAt) return;
    for (const r of allRows) if (typeof r.num === "number") recordSeries(`mkt:${r.id}`, r.num, data.generatedAt);
    setTick((t) => t + 1);
  }, [data.generatedAt, allRows]);

  const exportRows = useMemo(
    () =>
      sections.flatMap((s) =>
        s.rows.map((r) => ({
          section: s.label,
          symbol: r.symbol ?? "",
          name: r.name,
          value: r.value,
          num: r.num ?? "",
          changePct: r.changePct ?? "",
        })),
      ),
    [sections],
  );

  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts,
      count: allRows.length,
      // sourceAt is the server's generatedAt — markets can be a cached payload that
      // is much older than our last fetch of it, and a price chip has no business
      // saying "live" about a stale quote.
      fresh: { lastOk, ok, count: allRows.length, refreshMs: POLL_MS, sourceAt: data.generatedAt || null },
      export: { rows: exportRows, name: "markets" },
    });
  }, [alerts, allRows.length, report, exportRows, lastOk, ok, data.generatedAt]);

  if (status === "loading" && allRows.length === 0) return <p className="tn-w-empty">Loading markets…</p>;
  if (allRows.length === 0) return <p className="tn-w-empty">Markets unavailable.</p>;

  return (
    <div>
      {sections.map((sec) => (
        <div key={sec.key}>
          <div className="tn-w-muted" style={{ margin: "6px 0 2px", fontWeight: 600 }}>{sec.label}</div>
          {sec.dormant ? (
            <p className="tn-w-empty" style={{ margin: "2px 0 4px" }}>🔒 {sec.note ?? "Needs an API key."}</p>
          ) : (
          <ul className="tn-w-list">
            {sec.rows.map((r) => (
              <li key={r.id}>
                <span className="tn-w-strong">{r.symbol ?? r.name}</span>{" "}
                <span className="tn-w-num">{r.value}</span>
                {r.changePct != null && (
                  <span style={{ color: r.changePct >= 0 ? "#16a34a" : "#dc2626" }}>
                    {" "}
                    {r.changePct >= 0 ? "+" : ""}
                    {r.changePct}%
                  </span>
                )}
                <span style={{ float: "right", verticalAlign: "middle" }}>
                  <Sparkline
                    values={seriesTrend(`mkt:${r.id}`, 24)}
                    up={r.changePct == null ? null : r.changePct >= 0}
                  />
                </span>
              </li>
            ))}
          </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export const MARKETS_WIDGET = {
  id: "markets",
  title: "Markets",
  icon: "📈",
  category: "Markets",
  defaultHeight: 300,
  defaultConfig: {},
  component: MarketsBody,
  detail: MarketsDetail,
  help: {
    what: "Live prices for commodities, crypto, FX and major equities, flagging any big daily mover as an alert. Sparklines build up as it polls.",
    source: "Yahoo Finance + CoinGecko + ECB (keyless); more with a key",
  },
};
registerWidget(MARKETS_WIDGET);
