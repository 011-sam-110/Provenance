"use client";
// Signals focus view — ONE parameterised template covering every registered signal
// layer. makeSignalDetail(source) mirrors makeSignalBody(source): it reuses the SAME
// live pipeline (useSignalFeed → projectSignal) but renders deep — masthead + count
// sparkline, KPI cards, a filter bar, source map + colour legend, honest magnitude/
// severity + time distributions (with light axes), a sortable feature table with
// per-row props drill-down, attribution, and export/show-on-map.
import { Fragment, useEffect, useMemo, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import type { SignalSource } from "@/lib/signals/types";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { useScope, withinScope } from "@/lib/shell/scope";
import { recordSeries, seriesSamples } from "@/lib/series";
import { deltaOf } from "@/lib/widgets/history";
import { Chart, type ChartPoint } from "@/components/Chart";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";
import { timeBins } from "@/lib/widgets/buckets";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";
import { signalsStore } from "@/lib/signals/store";
import { shellLayoutStore } from "@/lib/console/store";
import { openSignalFeature } from "@/lib/widgets/openSignal";
import { humaniseKey } from "@/lib/text/humanise";
import { useCapabilityStatus } from "@/lib/sources/useStatus";
import type { StatusEntry } from "@/lib/sources/statusReport";
import {
  distribution, timeModel, sortFeatures, relativeAge, filterDetailFeatures, detailKpis, rowValue,
  freshness, type SortKey,
} from "@/lib/console/signals/signalDetail";
import { rowMetric } from "@/lib/console/signals/signalCard";
import { makeAssetDetail } from "./cables.detail";
import { makeScheduleDetail } from "./schedule.detail";
import { makeForecastDetail } from "./forecast.detail";
import { makeAisDetail } from "./ais.detail";

/**
 * Whether the footer should say "needs an API key". Reads the SAME live status the rail
 * badge and the generic widget body use (lib/sources/useStatus.ts → GET /api/status),
 * rather than a hand-maintained id list.
 *
 * That list used to be here (`const KEYED = new Set(["acled", "firms", "aisstream",
 * "openaq", "reliefweb", "entsoe"])`) and had drifted from the real signal ids: of the
 * six, only "reliefweb" matched a real source. "acled" named a layer removed on
 * 2026-09-05; "firms", "aisstream" and "openaq" were the upstream/vendor names, not the
 * registry ids (`fire-active`, `ais`, `air-quality-stations`), and "entsoe" should have
 * been `grid-load`. So four of the five real key-gated layers could sit locked with an
 * empty footer and no explanation — the inventory finding W7 (2026-09-12,
 * `.claude/local/WIDGETS_INVENTARIO.md`). Reading the live status instead of a second,
 * hand-copied list means there is no list left to drift.
 */
export function needsKeyNote(capability: Pick<StatusEntry, "state"> | null | undefined): boolean {
  return capability?.state === "locked";
}

/** Fixed reference severity swatches for the map legend (theme-independent status hues). */
const SEV_SEVERE = "#d9534f";
const SEV_WARNING = "#d9882f";

/** Append a 2-digit alpha to a 6-digit hex; pass others through unchanged. */
function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  return `#${h}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
}

export function makeSignalDetail(source: SignalSource) {
  // Permanent-infrastructure layers (cables, ports, airports, plants) render an
  // ASSET directory — attributes + ranking, no magnitude / severity / time window.
  // Forward-looking, time-anchored layers (rocket launches) render a SCHEDULE — a
  // countdown-ordered agenda. Event layers (earthquakes, storms, …) keep the
  // schema below unchanged.
  if (source.kind === "asset") return makeAssetDetail(source);
  if (source.kind === "schedule") return makeScheduleDetail(source);
  if (source.kind === "forecast") return makeForecastDetail(source);
  // Real-time AIS is neither an event nor an asset directory — it's a live
  // congestion picture, so it gets a bespoke per-chokepoint status board.
  if (source.id === "ais") return makeAisDetail(source);

  const metric = source.metric;
  const hasMetric = !!metric;

  function SignalDetailView(_props: WidgetDetailProps) {
    const scope = useScope();
    const { features, status, updatedAt } = useSignalFeed(source.id, source.refreshMs);
    const capability = useCapabilityStatus(source.id);
    const [sortKey, setSortKey] = useState<SortKey>("magnitude");
    const [dir, setDir] = useState<1 | -1>(-1);
    const [open, setOpen] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [minValue, setMinValue] = useState(0);

    const scoped = useMemo(() => features.filter((f) => withinScope(f.lat, f.lon, scope)), [features, scope]);

    // Wire count-history recording (spec: no signal records into the series yet).
    useEffect(() => {
      if (updatedAt) recordSeries(`sig:${source.id}`, scoped.length, updatedAt);
    }, [updatedAt, scoped.length]);

    // Read the persisted series AND fold in the CURRENT poll's live count. recordSeries
    // (above) only writes it in a post-commit effect and lib/series has no React
    // subscription, so without folding it in here the delta/sparkline would trail the
    // count shown beside them by one poll — and could even show a wrong-direction arrow.
    const samples = useMemo(() => {
      const base = seriesSamples(`sig:${source.id}`);
      const last = base[base.length - 1];
      if (updatedAt && (!last || last.t !== updatedAt || last.n !== scoped.length)) {
        return [...base, { t: updatedAt, n: scoped.length }];
      }
      return base;
    }, [updatedAt, scoped.length]);
    const spark: ChartPoint[] = useMemo(() => samples.map((s) => ({ x: s.t, y: s.n })), [samples]);
    const delta = useMemo(() => deltaOf(samples), [samples]);

    // Largest resolved value across the scope → the min-value slider ceiling.
    const maxValue = useMemo(() => {
      let m = 0;
      for (const f of scoped) { const v = rowValue(f, metric); if (v != null && v > m) m = v; }
      return m;
    }, [scoped]);
    const sliderMax = Math.max(1, Math.ceil(maxValue));

    // Filter (title search + min value) feeds EVERYTHING downstream: map, panels,
    // table, KPIs and export — one honest, shared view of the data.
    const filtered = useMemo(
      () => filterDetailFeatures(scoped, { query, min: minValue }, metric),
      [scoped, query, minValue],
    );

    const rows = useMemo(() => sortFeatures(filtered, sortKey, dir, metric), [filtered, sortKey, dir]);
    const dist = useMemo(() => distribution(filtered), [filtered]);
    const tm = useMemo(() => timeModel(filtered), [filtered]);
    const now = Date.now();
    const kpis = useMemo(() => detailKpis(filtered, samples, metric), [filtered, samples]);

    // Min/max resolved value across the filtered set → gradient legend labels.
    const valueRange = useMemo(() => {
      let lo = Infinity, hi = -Infinity;
      for (const f of filtered) { const v = rowValue(f, metric); if (v == null) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
      return Number.isFinite(lo) ? { min: lo, max: hi } : null;
    }, [filtered]);

    const distMax = Math.max(1, ...dist.bins.map((b) => b.count));
    const timePoints: ChartPoint[] = timeBins(tm.values, 60 * 60_000, now, 24 * 60 * 60_000).map((b) => ({ x: b.start, y: b.count }));
    const timeMax = Math.max(0, ...timePoints.map((p) => p.y));
    const mapPoints: InsetPoint[] = filtered.map((f) => ({ lat: f.lat, lon: f.lon, id: f.id, color: f.color ?? source.color, props: { title: f.title } }));
    const filterActive = query.trim() !== "" || minValue > 0;
    const fresh = freshness(updatedAt, source.refreshMs, now);
    // Which analytics panels carry a real signal for THIS source — dead panels
    // ("declares no magnitude or severity", "no timestamped features") are hidden,
    // not shown empty, so the layout matches what the data can actually say.
    const showDist = dist.kind !== "none";
    const showTime = timePoints.some((p) => p.y > 0);

    // Click a map dot → select its row, scroll it into view and open its drill-down
    // (bidirectional with the selected-dot highlight). This is what makes the dots feel
    // clickable instead of inert.
    const selectFromMap = (id: string) => {
      setOpen(id);
      if (typeof document !== "undefined") {
        requestAnimationFrame(() => document.getElementById(`sdrow-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
      }
    };

    const exportRows = rows.map((f) => ({ id: f.id, title: f.title, magnitude: f.props?.magnitude ?? "", value: rowValue(f, metric) ?? "", lat: f.lat, lon: f.lon, ts: f.ts ?? "", link: f.link ?? "" }));
    const exportGeo = rows.map((f) => ({ lat: f.lat, lon: f.lon, properties: { id: f.id, title: f.title, ...(f.props ?? {}) } }));

    const showOnMap = () => { signalsStore.set(source.id, true); shellLayoutStore.unfocus(); };

    // Value column: metric label (with unit) when the source declares one, else the
    // plain props.magnitude, else a dash. Coloured by the feature's severity ramp.
    const valueLabel = (f: (typeof rows)[number]): string => {
      const rm = metric ? rowMetric(f, metric) : undefined;
      if (rm) return rm.label;
      const v = rowValue(f, undefined);
      return v != null ? String(v) : "—";
    };
    const changeCls = kpis.change24h.startsWith("+") ? "up" : kpis.change24h.startsWith("-") ? "down" : "";

    return (
      <div className="tn-sd">
        <header className="tn-sd-head">
          <div className="tn-sd-title">{source.label}</div>
          <div className="tn-sd-stat"><b>{scoped.length}</b> of {features.length} in {scope.label}
            <span className={`tn-sd-fresh is-${fresh.state}`} title={`Feed cadence ${Math.round(source.refreshMs / 60000)}m`}><i className="tn-sd-fresh-dot" />{fresh.state === "live" ? "live" : fresh.label}</span>
            {delta !== 0 && <span className={`tn-sd-delta ${delta > 0 ? "up" : "down"}`}> {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span>}
          </div>
          {spark.length >= 2 && <div className="tn-sd-spark"><Chart points={spark} height={40} up={null} /></div>}
        </header>

        {scoped.length > 0 && (
          <div className="tn-sd-kpis">
            <div className="tn-sd-kpi">
              <div className="tn-sd-kpi-label">In view</div>
              <div className="tn-sd-kpi-value">{kpis.inView}</div>
              <div className="tn-sd-kpi-sub">{filterActive ? `of ${scoped.length} in scope` : "in scope"}</div>
            </div>
            {kpis.peak && (
              <div className="tn-sd-kpi">
                <div className="tn-sd-kpi-label">Peak</div>
                <div className="tn-sd-kpi-value">{kpis.peak.label}</div>
                <div className="tn-sd-kpi-sub">{hasMetric ? "metric max" : "magnitude"}</div>
              </div>
            )}
            {kpis.change24h !== "—" && (
              <div className="tn-sd-kpi">
                <div className="tn-sd-kpi-label">24h Δ</div>
                <div className={`tn-sd-kpi-value ${changeCls}`}>{kpis.change24h}</div>
                <div className="tn-sd-kpi-sub">count vs ≤24h ago</div>
              </div>
            )}
          </div>
        )}

        {scoped.length > 0 && (
          <div className="tn-sd-filter">
            <input
              type="text"
              value={query}
              placeholder={`Search ${source.label.toLowerCase()}…`}
              aria-label="Filter by title"
              onChange={(e) => setQuery(e.target.value)}
            />
            {maxValue > 0 && (
              <label className="tn-sd-range">
                <span>{hasMetric ? "Min value" : "Min mag"}</span>
                <input
                  type="range"
                  min={0}
                  max={sliderMax}
                  step={sliderMax <= 12 ? 0.1 : 1}
                  value={Math.min(minValue, sliderMax)}
                  aria-label="Minimum value"
                  onChange={(e) => setMinValue(Number(e.target.value))}
                />
                <b>{minValue > 0 ? minValue : "0"}</b>
              </label>
            )}
            {filterActive && (
              <button className="tn-sd-filter-clear" onClick={() => { setQuery(""); setMinValue(0); }}>Clear</button>
            )}
          </div>
        )}

        {status === "loading" && scoped.length === 0 && <p className="tn-w-empty">Loading {source.label}…</p>}
        {status !== "loading" && scoped.length === 0 && <p className="tn-w-empty">Nothing in {scope.label}.</p>}
        {scoped.length > 0 && filtered.length === 0 && <p className="tn-w-empty">No features match the filter.</p>}

        {filtered.length > 0 && mapPoints.length > 0 && (
          <div className="tn-sd-mappanel">
            <h3>Locations <span className="tn-sd-maphint">· click a dot to find its row</span></h3>
            <InsetMap points={mapPoints} height={220} selectedId={open ?? undefined} onSelect={selectFromMap} />
            {(dist.kind === "severity" || valueRange) && (
              <div className="tn-sd-legend">
                {dist.kind === "severity" ? (
                  <>
                    <span className="tn-sd-legend-item"><i className="tn-sd-swatch" style={{ background: SEV_SEVERE }} />Severe</span>
                    <span className="tn-sd-legend-item"><i className="tn-sd-swatch" style={{ background: SEV_WARNING }} />Warning</span>
                    <span className="tn-sd-legend-item"><i className="tn-sd-swatch tn-sd-swatch-other" />Other</span>
                  </>
                ) : valueRange ? (
                  <div className="tn-sd-legend-grad">
                    <span className="tn-sd-bar-label">{valueRange.min}</span>
                    <span className="tn-sd-gradbar" style={{ background: `linear-gradient(90deg, ${withAlpha(source.color, 0.15)}, ${source.color})` }} />
                    <span className="tn-sd-bar-label">{valueRange.max}{metric?.unit ?? ""}</span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {filtered.length > 0 && (showDist || showTime) && (
          <div className="tn-sd-panels">
            {showDist && (
              <div className="tn-sd-panel">
                <h3>{dist.kind === "magnitude" ? "Magnitude distribution" : "Severity"}</h3>
                <div className="tn-sd-plot">
                  <div className="tn-sd-yaxis"><span>{distMax}</span><span>0</span></div>
                  <div className="tn-sd-plot-body">
                    <div className="tn-sd-bars">
                      {dist.bins.map((b, i) => (
                        <div key={i} className="tn-sd-bar" style={{ height: `${(b.count / distMax) * 100}%` }} title={`${b.label}: ${b.count}`} />
                      ))}
                    </div>
                    <div className="tn-sd-binlabels">{dist.bins.map((b, i) => <span key={i} className="tn-sd-bar-label" style={{ flex: 1 }}>{b.label}</span>)}</div>
                  </div>
                </div>
              </div>
            )}
            {showTime && (
              <div className="tn-sd-panel">
                <h3>Over the last 24h {tm.undated > 0 && <span className="tn-sd-bar-label">· {tm.undated} undated</span>}</h3>
                <div className="tn-sd-plot">
                  <div className="tn-sd-yaxis"><span>{timeMax}</span><span>0</span></div>
                  <div className="tn-sd-plot-body">
                    <Chart points={timePoints} height={120} up={null} />
                    <div className="tn-sd-xaxis"><span>−24h</span><span>−12h</span><span>now</span></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <table className="tn-sd-table">
            <thead>
              <tr>
                {(["magnitude", "title", "recency"] as SortKey[]).map((k) => (
                  <th key={k} onClick={() => { if (sortKey === k) setDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setDir(-1); } }}>
                    {k === "recency" ? "When" : k === "magnitude" ? (hasMetric ? "Value" : "Magnitude") : humaniseKey(k)}{sortKey === k ? (dir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const entries = Object.entries(f.props ?? {}).filter(([, v]) => v != null && v !== "");
                const isOpen = open === f.id;
                const age = relativeAge(f.ts, now);
                return (
                  <Fragment key={f.id}>
                    <tr id={`sdrow-${f.id}`} className={`tn-sd-row${isOpen ? " is-selected" : ""}`} onClick={() => setOpen(isOpen ? null : f.id)}>
                      <td>
                        <span className="tn-sd-val">
                          <i className="tn-sd-dot" style={{ background: f.color ?? source.color }} />
                          {valueLabel(f)}
                        </span>
                      </td>
                      <td>{f.title}</td>
                      <td title={f.ts ?? undefined}>{age || "—"}</td>
                    </tr>
                    {isOpen && (
                      <tr className="tn-sd-drill">
                        <td colSpan={3}>
                          {entries.length > 0 ? (
                            <dl>{entries.map(([k, v]) => (<div key={k} style={{ display: "contents" }}><dt>{humaniseKey(k)}</dt><dd>{String(v)}</dd></div>))}</dl>
                          ) : <span className="tn-w-empty">No extra properties.</span>}
                          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                            <button className="tn-sd-actions" onClick={(e) => { e.stopPropagation(); openSignalFeature(f, source.label); shellLayoutStore.unfocus(); }} style={{ background: "none", border: 0, color: "var(--tn-accent)", cursor: "pointer", padding: 0 }}>Show on globe ↗</button>
                            {f.link && <a href={f.link} target="_blank" rel="noreferrer" style={{ color: "var(--tn-accent)" }}>Source ↗</a>}
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
          <span className="tn-sd-attr">{source.attribution}{needsKeyNote(capability) && " · needs an API key (dormant when unset)"}</span>
          <span className="tn-sd-actions">
            <button onClick={showOnMap}>🗺 Show on map</button>
            <button disabled={!exportRows.length} onClick={() => downloadText(`${exportFilename(`signal-${source.id}`, Date.now())}.csv`, "text/csv", toCsv(exportRows))}>⬇ CSV</button>
            <button disabled={!exportGeo.length} onClick={() => downloadText(`${exportFilename(`signal-${source.id}`, Date.now())}.geojson`, "application/geo+json", toGeoJson(exportGeo))}>⬇ GeoJSON</button>
          </span>
        </footer>
      </div>
    );
  }
  return SignalDetailView;
}
