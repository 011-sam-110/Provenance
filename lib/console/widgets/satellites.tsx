"use client";
// Satellites widget — the last core map layer to get a monitor card. Mirrors the
// Aviation widget: useSatellites() yields WorldObject[] (locally propagated from a
// TLE set), which we list by altitude. A slow propagation step keeps a pinned list
// cheap (the globe uses 1s for smooth motion; a list does not need it).

import { useEffect, useMemo } from "react";
import { useSatellites } from "@/lib/satellites/useSatellites";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import SatellitesDetail from "./satellites.detail";

function SatellitesBody({ config }: WidgetBodyProps) {
  const group = (config.group as string) ?? "visual";
  const sats = useSatellites(group, 10_000);

  const rows = useMemo(
    () => [...sats].sort((a, b) => (b.altKm ?? 0) - (a.altKm ?? 0)).slice(0, 200),
    [sats],
  );

  // Satellites are the one honest "live": positions are propagated in-browser by
  // SGP4 every tick, so there is no fetch that can go stale. `local` says exactly
  // that, and the chip's tooltip explains it rather than asserting freshness we
  // cannot observe.
  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: [],
      count: sats.length,
      fresh: { lastOk: Date.now(), ok: true, count: sats.length, refreshMs: 10_000, local: true },
    });
  }, [sats.length, report]);

  if (sats.length === 0) return <p className="tn-w-empty">Loading satellites…</p>;

  return (
    <table className="tn-w-table">
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td className="tn-w-strong">{s.label}</td>
            <td className="tn-w-muted">{s.typeLabel ?? ""}</td>
            <td className="tn-w-num">{s.altKm != null ? `${Math.round(s.altKm)}km` : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const SATELLITES_WIDGET = {
  id: "satellites",
  title: "Satellites",
  icon: "🛰",
  category: "Space",
  defaultHeight: 280,
  defaultConfig: { group: "visual" },
  component: SatellitesBody,
  detail: SatellitesDetail,
  help: {
    what: "Satellites overhead, listed by altitude — the ISS and other bright objects. Positions are computed in your browser from public orbital elements, not observed.",
    source: "CelesTrak TLE sets, propagated with satellite.js (keyless)",
  },
  capabilities: { filter: true, sort: true },
};
registerWidget(SATELLITES_WIDGET);
