"use client";
// Asset-DIRECTORY focus view — the fit-for-purpose template for permanent
// infrastructure that is browsed and RANKED, not tracked over time (ports,
// airports, nuclear plants). It answers "where does this asset sit, and how big
// is it vs the others" — a ranked leaderboard + a clickable located map + a
// region breakdown — instead of the event template's dead magnitude / severity /
// "last 24h" cells.
//
// CAPABILITY-DRIVEN, not one-size-fits-all (assets genuinely differ):
//   • ranks by the source's declared `metric` (nuclear plant MW), else by a
//     `rank` prop (ports carry their published throughput rank);
//   • a layer with NO magnitude to rank by (airports) shows a short identifier
//     column instead — its `directory.codeKey` (e.g. IATA);
//   • the Country / Region columns, the region breakdown and the Countries KPI
//     only appear when the features actually carry those props (nuclear has no
//     country, so those simply vanish rather than rendering dead "—" cells);
//   • one optional descriptor column (`directory.detailKey`: operator, city).
// No time axis, no severity — an asset directory.
import { Fragment, useMemo, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { useScope, withinScope } from "@/lib/shell/scope";
import { signalsStore } from "@/lib/signals/store";
import { shellLayoutStore } from "@/lib/console/store";
import { openSignalFeature } from "@/lib/widgets/openSignal";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";
import ExportExtras from "@/components/console/ExportExtras";
import { humaniseKey } from "@/lib/text/humanise";
import { freshness } from "@/lib/console/signals/signalDetail";
import { rowMetric } from "@/lib/console/signals/signalCard";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";

/** Country ISO-3166-1 alpha-2 → flag emoji (regional-indicator pair). "" when unusable. */
function flagEmoji(iso2: unknown): string {
  if (typeof iso2 !== "string" || iso2.length !== 2 || !/^[a-z]{2}$/i.test(iso2)) return "";
  const A = 0x1f1e6;
  const cc = iso2.toUpperCase();
  return String.fromCodePoint(A + cc.charCodeAt(0) - 65, A + cc.charCodeAt(1) - 65);
}

const numProp = (f: SignalFeature, key: string): number | null => {
  const v = f.props?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const strProp = (f: SignalFeature, key: string): string => {
  const v = f.props?.[key];
  return typeof v === "string" ? v : "";
};

type DirSortKey = "primary" | "code" | "title" | "detail" | "country" | "region";

export function makeDirectoryDetail(source: SignalSource) {
  const metric = source.metric;
  const hasMetric = !!metric;
  const spec = source.directory ?? {};
  const codeKey = spec.codeKey;
  const detailKey = spec.detailKey;
  const codeLabel = spec.codeLabel ?? (codeKey ? humaniseKey(codeKey) : "");
  const detailLabel = spec.detailLabel ?? (detailKey ? humaniseKey(detailKey) : "");

  function DirectoryView(_props: WidgetDetailProps) {
    const scope = useScope();
    const { features, status, updatedAt } = useSignalFeed(source.id, source.refreshMs);
    const [query, setQuery] = useState("");
    const now = Date.now();
    const fresh = freshness(updatedAt, source.refreshMs, now);

    // Which dimensions this layer actually carries — the columns/panels adapt to it.
    const hasRank = useMemo(() => features.some((f) => numProp(f, "rank") != null), [features]);
    const hasCountry = useMemo(() => features.some((f) => strProp(f, "country")), [features]);
    const hasRegion = useMemo(() => features.some((f) => strProp(f, "region")), [features]);
    const hasPrimary = hasMetric || hasRank; // a magnitude/rank column with a bar
    const hasCode = !hasPrimary && !!codeKey; // else fall back to a short identifier column

    const [sortKey, setSortKey] = useState<DirSortKey>(hasPrimary ? "primary" : "title");
    // Metric ranks high→low (biggest first); a rank prop ranks low→high (#1 first).
    const [dir, setDir] = useState<1 | -1>(hasMetric ? -1 : 1);
    const [open, setOpen] = useState<string | null>(null);

    const scoped = useMemo(() => features.filter((f) => withinScope(f.lat, f.lon, scope)), [features, scope]);

    // The scalar the leaderboard bar + ranking use: the declared metric, else a `rank` prop.
    const primaryVal = (f: SignalFeature): number | null => (hasMetric ? rowMetric(f, metric!)?.value ?? null : numProp(f, "rank"));
    const maxRank = useMemo(() => Math.max(1, ...scoped.map((f) => numProp(f, "rank") ?? 0)), [scoped]);
    // Bar fill 0..1: metric normalised by its domain top; rank inverted so #1 fills.
    const barNorm = (f: SignalFeature): number => {
      if (hasMetric) { const v = primaryVal(f); return v == null ? 0 : Math.max(0, Math.min(1, v / (metric!.domain[1] || 1))); }
      const r = numProp(f, "rank");
      return r == null ? 0 : Math.max(0.06, (maxRank - r + 1) / maxRank);
    };
    const primaryLabel = (f: SignalFeature): string => {
      if (hasMetric) { const rm = rowMetric(f, metric!); return rm ? rm.label : "—"; }
      const r = numProp(f, "rank");
      return r == null ? "—" : `#${r}`;
    };

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return scoped;
      return scoped.filter((f) => {
        const hay = [f.title, strProp(f, "country"), strProp(f, "region"), codeKey ? strProp(f, codeKey) : "", detailKey ? strProp(f, detailKey) : ""].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }, [scoped, query]);

    const rows = useMemo(() => {
      const val = (f: SignalFeature): string | number => {
        if (sortKey === "title") return f.title.toLowerCase();
        if (sortKey === "country") return strProp(f, "country").toLowerCase();
        if (sortKey === "region") return strProp(f, "region").toLowerCase();
        if (sortKey === "code") return (codeKey ? strProp(f, codeKey) : "").toLowerCase();
        if (sortKey === "detail") return (detailKey ? strProp(f, detailKey) : "").toLowerCase();
        const p = primaryVal(f);
        return p == null ? (hasMetric ? -Infinity : Infinity) : p; // valueless sorts last
      };
      return [...filtered].sort((a, b) => {
        const va = val(a), vb = val(b);
        if (typeof va === "string" || typeof vb === "string") return dir * String(va).localeCompare(String(vb));
        return dir * (va - vb);
      });
    }, [filtered, sortKey, dir]);

    const regionCounts = useMemo(() => {
      const m = new Map<string, number>();
      for (const f of filtered) { const r = strProp(f, "region"); if (!r) continue; m.set(r, (m.get(r) ?? 0) + 1); }
      return [...m.entries()].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count);
    }, [filtered]);
    const regionMax = Math.max(1, ...regionCounts.map((r) => r.count));
    const countries = useMemo(() => new Set(filtered.map((f) => strProp(f, "country")).filter(Boolean)).size, [filtered]);
    const metricTotal = useMemo(() => (hasMetric ? filtered.reduce((s, f) => s + (primaryVal(f) ?? 0), 0) : 0), [filtered]);

    const mapPoints: InsetPoint[] = filtered.map((f) => ({ lat: f.lat, lon: f.lon, id: f.id, color: f.color ?? source.color, props: { title: f.title } }));
    const selectFromMap = (id: string) => {
      setOpen(id);
      if (typeof document !== "undefined") requestAnimationFrame(() => document.getElementById(`dirrow-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    };
    const clickHead = (k: DirSortKey) => {
      if (sortKey === k) setDir((d) => (d === 1 ? -1 : 1));
      else { setSortKey(k); setDir(k === "primary" && hasMetric ? -1 : 1); }
    };
    const flyTo = (f: SignalFeature) => { signalsStore.set(source.id, true); openSignalFeature(f, source.label, 5); shellLayoutStore.unfocus(); };
    const showOnMap = () => { signalsStore.set(source.id, true); shellLayoutStore.unfocus(); };

    const exportRows = rows.map((f) => ({
      id: f.id, name: f.title,
      ...(hasRank ? { rank: numProp(f, "rank") ?? "" } : {}),
      ...(hasMetric ? { [metric!.field]: primaryVal(f) ?? "" } : {}),
      ...(codeKey ? { [codeKey]: strProp(f, codeKey) } : {}),
      ...(detailKey ? { [detailKey]: strProp(f, detailKey) } : {}),
      ...(hasCountry ? { country: strProp(f, "country") } : {}),
      ...(hasRegion ? { region: strProp(f, "region") } : {}),
      lat: f.lat, lon: f.lon,
    }));
    const exportGeo = rows.map((f) => ({ lat: f.lat, lon: f.lon, properties: { id: f.id, name: f.title, ...(f.props ?? {}) } }));
    // The three columns that are named after this layer's own fields. Only this view
    // knows what they are, so it tells the data dictionary.
    const exportMeanings: Record<string, string> = {
      ...(hasMetric ? { [metric!.field]: `The layer's own measure of the record${metric!.unit ? `, in ${metric!.unit}` : ""}.` } : {}),
      ...(codeKey ? { [codeKey]: `${codeLabel}: the short code of the record, as the layer gives it.` } : {}),
      ...(detailKey ? { [detailKey]: `${detailLabel}, as the layer gives it.` } : {}),
    };

    // Props to hide from the drill-down (they already have their own column).
    const shownKeys = new Set<string>(["rank", "region", "country"]);
    if (codeKey) shownKeys.add(codeKey);
    if (detailKey) shownKeys.add(detailKey);
    if (hasMetric) shownKeys.add(metric!.field);

    const primaryHead = hasMetric ? humaniseKey(metric!.field) : "Rank";
    const titleHead = source.label.replace(/^Major /, "");
    const arrow = (k: DirSortKey) => (sortKey === k ? (dir === -1 ? " ↓" : " ↑") : "");
    // Column count for drill-down colSpan, matching the <thead> below.
    const colSpan = (hasPrimary || hasCode ? 1 : 0) + 1 + (detailKey ? 1 : 0) + (hasCountry ? 1 : 0) + (hasRegion ? 1 : 0);

    return (
      <div className="tn-sd">
        <header className="tn-sd-head">
          <div className="tn-sd-title">{source.label}</div>
          <div className="tn-sd-stat"><b>{filtered.length}</b> of {features.length} in {scope.label}
            <span className={`tn-sd-fresh is-${fresh.state}`}><i className="tn-sd-fresh-dot" />{fresh.state === "live" ? "live" : fresh.label}</span>
          </div>
        </header>

        {scoped.length > 0 && (
          <div className="tn-sd-kpis">
            <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">In view</div><div className="tn-sd-kpi-value">{filtered.length}</div><div className="tn-sd-kpi-sub">of {features.length} listed</div></div>
            {hasMetric && <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Total</div><div className="tn-sd-kpi-value">{Math.round(metricTotal).toLocaleString()}</div><div className="tn-sd-kpi-sub">{(metric!.unit ?? "").trim() || "sum"}</div></div>}
            {hasCountry && <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Countries</div><div className="tn-sd-kpi-value">{countries}</div><div className="tn-sd-kpi-sub">represented</div></div>}
            {hasRegion && regionCounts[0] && <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Top region</div><div className="tn-sd-kpi-value" style={{ fontSize: 15 }}>{regionCounts[0].region}</div><div className="tn-sd-kpi-sub">{regionCounts[0].count} of {filtered.length}</div></div>}
          </div>
        )}

        {scoped.length > 0 && (
          <div className="tn-sd-filter">
            <input type="text" value={query} placeholder={`Search ${source.label.toLowerCase()}…`} aria-label="Search" onChange={(e) => setQuery(e.target.value)} />
            {query && <button className="tn-sd-filter-clear" onClick={() => setQuery("")}>Clear</button>}
          </div>
        )}

        {status === "loading" && scoped.length === 0 && <p className="tn-w-empty">Loading {source.label}…</p>}
        {status !== "loading" && scoped.length === 0 && <p className="tn-w-empty">Nothing in {scope.label}.</p>}
        {scoped.length > 0 && filtered.length === 0 && <p className="tn-w-empty">No matches.</p>}

        {filtered.length > 0 && mapPoints.length > 0 && (
          <div className="tn-sd-mappanel">
            <h3>Locations <span className="tn-sd-maphint">· click a dot to find its row</span></h3>
            <InsetMap points={mapPoints} height={220} selectedId={open ?? undefined} onSelect={selectFromMap} />
          </div>
        )}

        {hasRegion && regionCounts.length > 1 && (
          <div className="tn-sd-panel">
            <h3>By region</h3>
            <div className="tn-dir-regions">
              {regionCounts.map((r) => (
                <div key={r.region} className="tn-dir-region">
                  <span className="tn-dir-region-name">{r.region}</span>
                  <span className="tn-dir-region-track"><i style={{ width: `${(r.count / regionMax) * 100}%` }} /></span>
                  <span className="tn-dir-region-n">{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {filtered.length > 0 && (
          <table className="tn-sd-table tn-dir-table">
            <thead>
              <tr>
                {hasPrimary && <th onClick={() => clickHead("primary")} style={{ width: 118 }}>{primaryHead}{arrow("primary")}</th>}
                {hasCode && <th onClick={() => clickHead("code")} style={{ width: 72 }}>{codeLabel}{arrow("code")}</th>}
                <th onClick={() => clickHead("title")}>{titleHead}{arrow("title")}</th>
                {detailKey && <th onClick={() => clickHead("detail")}>{detailLabel}{arrow("detail")}</th>}
                {hasCountry && <th onClick={() => clickHead("country")}>Country{arrow("country")}</th>}
                {hasRegion && <th onClick={() => clickHead("region")}>Region{arrow("region")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const isOpen = open === f.id;
                const country = strProp(f, "country");
                const flag = flagEmoji(country);
                const entries = Object.entries(f.props ?? {}).filter(([k, v]) => v != null && v !== "" && !shownKeys.has(k));
                return (
                  <Fragment key={f.id}>
                    <tr id={`dirrow-${f.id}`} className={`tn-sd-row${isOpen ? " is-selected" : ""}`} onClick={() => setOpen(isOpen ? null : f.id)}>
                      {hasPrimary && (
                        <td>
                          <span className="tn-dir-primary">
                            <b>{primaryLabel(f)}</b>
                            <span className="tn-dir-bar"><i style={{ width: `${barNorm(f) * 100}%`, background: f.color ?? source.color }} /></span>
                          </span>
                        </td>
                      )}
                      {hasCode && <td><span className="tn-dir-code">{(codeKey && strProp(f, codeKey)) || "—"}</span></td>}
                      <td style={{ fontWeight: 600 }}>{flag && <span className="tn-dir-flag">{flag}</span>}{f.title}</td>
                      {detailKey && <td style={{ color: "var(--tn-text-muted)" }}>{strProp(f, detailKey) || "—"}</td>}
                      {hasCountry && <td style={{ color: "var(--tn-text-muted)" }}>{country || "—"}</td>}
                      {hasRegion && <td style={{ color: "var(--tn-text-muted)" }}>{strProp(f, "region") || "—"}</td>}
                    </tr>
                    {isOpen && (
                      <tr className="tn-sd-drill">
                        <td colSpan={colSpan}>
                          {entries.length > 0 ? (
                            <dl>{entries.map(([k, v]) => (<div key={k} style={{ display: "contents" }}><dt>{humaniseKey(k)}</dt><dd>{String(v)}</dd></div>))}</dl>
                          ) : <span className="tn-w-empty">No extra properties.</span>}
                          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                            <button onClick={(e) => { e.stopPropagation(); flyTo(f); }} style={{ background: "none", border: 0, color: "var(--tn-accent)", cursor: "pointer", padding: 0 }}>Fly to on globe ↗</button>
                            {f.link && <a href={f.link} target="_blank" rel="noreferrer" style={{ color: "var(--tn-accent)" }} onClick={(e) => e.stopPropagation()}>Source ↗</a>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}

        <footer className="tn-sd-foot">
          <span className="tn-sd-attr">{source.attribution}</span>
          <span className="tn-sd-actions">
            <button onClick={showOnMap}>🗺 Show on map</button>
            <button disabled={!exportRows.length} onClick={() => downloadText(`${exportFilename(source.id, Date.now())}.csv`, "text/csv", toCsv(exportRows))}>⬇ CSV</button>
            <button disabled={!exportGeo.length} onClick={() => downloadText(`${exportFilename(source.id, Date.now())}.geojson`, "application/geo+json", toGeoJson(exportGeo))}>⬇ GeoJSON</button>
            <ExportExtras name={source.id} kind="directory" rows={exportRows} geo={exportGeo} source={`${source.label}: ${source.attribution}`} extra={exportMeanings} />
          </span>
        </footer>
      </div>
    );
  }
  return DirectoryView;
}
