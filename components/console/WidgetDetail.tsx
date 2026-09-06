"use client";
// The focused widget, on the centre stage.
//
// WHAT CHANGED AND WHY IT MATTERED. This used to be a thin header (a back link,
// an icon, a title) above either the widget's bespoke `detail` component or —
// for every widget without one — `GenericDetail`, which rendered the ordinary
// card body at full width and nothing else.
//
// MEASURED, because counting the `*.detail.tsx` files on disk gets this wrong:
// there are 14 of them but 46 of the 70 registered types have a `detail`, since
// the ~35 generic signal widgets all share signals.detail.tsx through the
// registration loop. The 24 that fall back to GenericDetail are the 17 category
// roll-ups, the 6 recon tools and livecams-brazil. Those 24 answered the expand
// button with a card stretched sideways — not a fullscreen, just the same card
// with more whitespace.
//
// The masthead below is generic on purpose. Every part of it reads something the
// widget ALREADY publishes, so none of the 70 needs an edit to gain one:
//
//   • the figure and the freshness pill come from the report the body sends the
//     frame through ReportCtx — which is the piece that was missing here, and the
//     reason the old GenericDetail could not show either. This component now
//     provides that context itself instead of letting the body's report fall into
//     the no-op default.
//   • the provenance line comes from resolveWidgetHelp(type).source, which is
//     already resolved for every registered type (from the layer registry for the
//     generic signal widgets, from lib/console/help.ts for the bespoke ones).
//     On a product called Provenance, "where did this come from" belongs on the
//     screen and not only behind a ? popover.
//   • Export reuses the report's own export payload, the same one the ⋯ menu
//     offers, so a widget that can be exported can be exported from both places
//     and one that cannot shows no button rather than a dead one.
//
// The 46 bespoke details are UNCHANGED and render inside the same masthead — they
// keep their own body, they just stop having to draw their own chrome.
import { useCallback, useState } from "react";
import type { WidgetInstance } from "@/lib/console/types";
import { getWidgetType, type WidgetType } from "@/lib/console/registry";
import { shellLayoutStore } from "@/lib/console/store";
import { resolveWidgetHelp } from "@/lib/console/help";
import { notificationsStore, useRule, requestNotifyPermission } from "@/lib/shell/notifications";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";
import FreshChip from "@/components/console/FreshChip";
import { ReportCtx, type Report } from "@/components/console/WidgetFrame";

export default function WidgetDetail({ instance }: { instance: WidgetInstance }) {
  const type = getWidgetType(instance.type);
  const [report, setReport] = useState<Report>({ alerts: [] });
  const onReport = useCallback((r: Report) => setReport(r), []);
  // Hooks run before the early return, or their order changes between renders.
  const rule = useRule(instance.type);

  if (!type) return null;
  const Detail = type.detail;
  const help = resolveWidgetHelp(type);
  const title = type.titleOf?.(instance.config) || type.title;
  const rows = report.export?.rows;
  const geo = report.export?.geo;

  const doExport = (kind: "csv" | "geojson") => {
    const base = exportFilename(report.export?.name ?? instance.type, Date.now());
    if (kind === "csv" && rows) downloadText(`${base}.csv`, "text/csv", toCsv(rows));
    if (kind === "geojson" && geo) downloadText(`${base}.geojson`, "application/geo+json", toGeoJson(geo));
  };

  return (
    <div className="tn-detail" role="region" aria-label={`${title} — expanded`}>
      <header className="tn-detail-head">
        <button className="tn-detail-back" onClick={() => shellLayoutStore.unfocus()}>‹ Map</button>
        <span className="tn-detail-chip" aria-hidden>{type.icon}</span>
        <h2 className="tn-detail-title">{title}</h2>
        {report.count != null && <span className="tn-detail-count">{report.count}</span>}
        {report.fresh && <FreshChip obs={report.fresh} />}
        <span className="tn-detail-sp" />
        {/* Notify me, as a real toggle rather than a bell that opens a panel.
            This is where the reference puts it and it is the right place: the
            decision to watch something is one you make while looking at it in
            full, not while glancing at a card in a rail. It writes the SAME
            per-type rule as the card's ⋯ → Notify me, so the two stay in sync
            with no extra state — flipping it here is visible there immediately. */}
        <button
          type="button"
          className={`tn-detail-notify${rule.enabled ? " is-on" : ""}`}
          role="switch"
          aria-checked={rule.enabled}
          onClick={() => {
            const next = !rule.enabled;
            notificationsStore.setRule(instance.type, { enabled: next });
            if (next) void requestNotifyPermission();
          }}
        >
          <span aria-hidden>🔔</span> Notify me
          <span className="tn-detail-sw" aria-hidden />
        </button>
        {rows && rows.length > 0 && (
          <button className="tn-detail-act" onClick={() => doExport("csv")}>⬇ CSV</button>
        )}
        {geo && geo.length > 0 && (
          <button className="tn-detail-act" onClick={() => doExport("geojson")}>⬇ GeoJSON</button>
        )}
      </header>

      {/* THE HERO. Rendered only when the widget actually reported a count — a
          hero figure reading "0" because a widget publishes no count at all
          would be a fabricated statistic, which is the one thing this codebase's
          dormant-safe rule exists to prevent. The provenance line stands on its
          own when there is no figure. */}
      {(report.count != null || help.source) && (
        <div className="tn-detail-hero">
          {report.count != null && (
            <p className="tn-detail-fig">
              <b>{report.count.toLocaleString()}</b>
              <span>{countNoun(type, report.count)}</span>
            </p>
          )}
          {help.source && (
            <p className="tn-detail-prov">
              <span className="tn-detail-prov-k">Source</span> {help.source}
            </p>
          )}
        </div>
      )}

      <div className="tn-detail-body">
        <ReportCtx.Provider value={onReport}>
          {Detail
            ? <Detail instanceId={instance.id} config={instance.config} />
            : <GenericDetail type={type} instance={instance} />}
        </ReportCtx.Provider>
      </div>
    </div>
  );
}

/**
 * What the hero figure counts.
 *
 * Deliberately NOT a per-widget noun invented here. The reference reads "64
 * tracked objects", which is right for satellites and wrong for 69 other things,
 * and guessing one per widget from its title is how a card ends up confidently
 * mislabelling its own data. `countNoun` is an opt-in field on WidgetType; until
 * a type sets one, this says something that is true of every widget — the figure
 * is how many rows the widget is currently showing.
 */
function countNoun(type: WidgetType, n: number): string {
  if (type.countNoun) return type.countNoun;
  return n === 1 ? "row in view" : "rows in view";
}

function GenericDetail({ type, instance }: { type: WidgetType; instance: WidgetInstance }) {
  const Body = type.component;
  return <div className="tn-detail-generic"><Body instanceId={instance.id} config={instance.config} /></div>;
}
