"use client";
// FORECAST / INDEX focus view — the fit-for-purpose template for an index or a
// forecast field (space-weather Kp storm index; the OVATION aurora-visibility
// field). Instead of the event template's dead severity + a 300-dot map blob, it
// leads with a headline GAUGE (the peak index, its qualitative band + colour) and
// then either a compact ALL-CLEAR card when the feed is quiet, an index feed's
// storm-scale chips, or a spatial field's "where it's visible" summary + map.
import { useMemo } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { useScope, withinScope } from "@/lib/shell/scope";
import { signalsStore } from "@/lib/signals/store";
import { shellLayoutStore } from "@/lib/console/store";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";
import ExportExtras from "@/components/console/ExportExtras";
import { humaniseKey } from "@/lib/text/humanise";
import { freshness } from "@/lib/console/signals/signalDetail";
import { rowMetric } from "@/lib/console/signals/signalCard";
import { pickBand, hemisphereExtent, extentLabel } from "@/lib/console/signals/forecast";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";

const strProp = (f: SignalFeature | undefined, key: string): string => {
  const v = f?.props?.[key];
  return typeof v === "string" ? v : "";
};

export function makeForecastDetail(source: SignalSource) {
  const metric = source.metric;
  const spec = source.forecast;

  function ForecastView(_props: WidgetDetailProps) {
    const scope = useScope();
    const { features, status, updatedAt } = useSignalFeed(source.id, source.refreshMs);
    const now = Date.now();
    const fresh = freshness(updatedAt, source.refreshMs, now);

    const scoped = useMemo(() => features.filter((f) => withinScope(f.lat, f.lon, scope)), [features, scope]);

    const values = useMemo(() => scoped.map((f) => (metric ? rowMetric(f, metric)?.value ?? null : null)).filter((v): v is number => v != null), [scoped]);
    const peak = values.length ? Math.max(...values) : null;
    const band = peak != null ? pickBand(peak, spec?.bands) : null;
    const accent = band?.color ?? source.color;
    const domainTop = metric?.domain[1] || 100;
    const lead = scoped[0];
    const validAt = lead?.ts || strProp(lead, "forecastFor") || strProp(lead, "updated") || "";

    // Quiet ⇒ compact all-clear: an empty field, or an index below its quiet threshold.
    const isQuiet = scoped.length === 0 || (spec?.quietBelow != null && peak != null && peak < spec.quietBelow);

    const headlineValue = (v: number): string => (metric?.unit ? `${v}${metric.unit}` : `${humaniseKey(metric?.field ?? "")} ${v}`.trim());

    const showOnMap = () => { signalsStore.set(source.id, true); shellLayoutStore.unfocus(); };
    const mapPoints: InsetPoint[] = scoped.map((f) => ({ lat: f.lat, lon: f.lon, id: f.id, color: f.color ?? source.color, props: { title: f.title } }));
    const exportRows = scoped.map((f) => ({ id: f.id, name: f.title, value: metric ? rowMetric(f, metric)?.value ?? "" : "", lat: f.lat, lon: f.lon }));
    const exportGeo = scoped.map((f) => ({ lat: f.lat, lon: f.lon, properties: { id: f.id, name: f.title, ...(f.props ?? {}) } }));

    const Header = (
      <header className="tn-sd-head">
        <div className="tn-sd-title">{source.label}</div>
        <div className="tn-sd-stat">forecast
          <span className={`tn-sd-fresh is-${fresh.state}`}><i className="tn-sd-fresh-dot" />{fresh.state === "live" ? "live" : fresh.label}</span>
        </div>
      </header>
    );
    const Foot = (
      <footer className="tn-sd-foot">
        <span className="tn-sd-attr">{source.attribution}{validAt ? ` · forecast for ${validAt}` : ""}</span>
        <span className="tn-sd-actions">
          <button onClick={showOnMap}>🗺 Show on map</button>
          <button disabled={!exportRows.length} onClick={() => downloadText(`${exportFilename(source.id, Date.now())}.csv`, "text/csv", toCsv(exportRows))}>⬇ CSV</button>
          <button disabled={!exportGeo.length} onClick={() => downloadText(`${exportFilename(source.id, Date.now())}.geojson`, "application/geo+json", toGeoJson(exportGeo))}>⬇ GeoJSON</button>
          <ExportExtras name={source.id} kind="forecast" rows={exportRows} geo={exportGeo} source={`${source.label}: ${source.attribution}`} />
        </span>
      </footer>
    );

    if (status === "loading" && scoped.length === 0) {
      return <div className="tn-sd tn-fc">{Header}<p className="tn-w-empty">Loading {source.label}…</p></div>;
    }

    if (isQuiet) {
      return (
        <div className="tn-sd tn-fc">
          {Header}
          <div className="tn-fc-allclear">
            <span className="tn-fc-check" aria-hidden>✓</span>
            <div>
              <div className="tn-fc-allclear-title">{peak != null ? `${headlineValue(peak)} · ${band?.label ?? "Quiet"}` : "All clear"}</div>
              <div className="tn-fc-allclear-note">{spec?.quietNote ?? `Nothing notable in ${scope.label}.`}</div>
            </div>
          </div>
          {Foot}
        </div>
      );
    }

    const ext = spec?.spatial ? hemisphereExtent(scoped.map((f) => f.lat)) : { north: null, south: null };

    return (
      <div className="tn-sd tn-fc">
        {Header}

        <div className="tn-fc-gauge" style={{ borderLeftColor: accent }}>
          <div className="tn-fc-headline">
            <span className="tn-fc-value" style={{ color: accent }}>{peak != null ? headlineValue(peak) : "—"}</span>
            {band && <span className="tn-fc-band" style={{ background: accent }}>{band.label}</span>}
          </div>
          <div className="tn-fc-bar"><i style={{ width: `${Math.min(100, ((peak ?? 0) / domainTop) * 100)}%`, background: accent }} /></div>
          {validAt && <div className="tn-fc-when">Forecast for {validAt}</div>}
        </div>

        {spec?.spatial ? (
          <>
            <div className="tn-sd-kpis">
              <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Peak</div><div className="tn-sd-kpi-value">{peak != null ? headlineValue(peak) : "—"}</div><div className="tn-sd-kpi-sub">most likely cell</div></div>
              <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Active</div><div className="tn-sd-kpi-value">{scoped.length}</div><div className="tn-sd-kpi-sub">{spec.activeNoun ?? "cells"}</div></div>
              {ext.north != null && <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Reaches (N)</div><div className="tn-sd-kpi-value">{extentLabel(ext.north)}</div><div className="tn-sd-kpi-sub">most equatorward</div></div>}
              {ext.south != null && <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Reaches (S)</div><div className="tn-sd-kpi-value">{extentLabel(ext.south)}</div><div className="tn-sd-kpi-sub">most equatorward</div></div>}
            </div>
            {mapPoints.length > 0 && (
              <div className="tn-sd-mappanel">
                <h3>Where it's visible <span className="tn-sd-maphint">· brighter = more likely</span></h3>
                <InsetMap points={mapPoints} height={230} />
              </div>
            )}
          </>
        ) : (
          spec?.scaleKeys && spec.scaleKeys.length > 0 && (
            <div className="tn-fc-scales">
              {spec.scaleKeys.map((k) => {
                const v = strProp(lead, k);
                const active = v !== "" && v.toLowerCase() !== "none";
                return (
                  <div key={k} className={`tn-fc-scale${active ? " is-active" : ""}`}>
                    <span className="tn-fc-scale-label">{humaniseKey(k)}</span>
                    <span className="tn-fc-scale-value">{active ? v : "none"}</span>
                  </div>
                );
              })}
            </div>
          )
        )}

        {Foot}
      </div>
    );
  }
  return ForecastView;
}
