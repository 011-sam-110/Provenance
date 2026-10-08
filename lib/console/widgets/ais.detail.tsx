"use client";
// AIS CHOKEPOINT board — the fit-for-purpose view for the real-time vessel stream.
// A flat list of 1,200 ships answers nothing; what matters is whether the world's
// strategic straits are FLOWING or CONGESTED. So it leads with one status card per
// chokepoint (vessel count, moving vs stopped split, average speed, a congestion
// read), then a located map and a searchable vessel table for the detail. Honest
// when dormant: AIS is key-gated, so an empty stream says so instead of looking broken.
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
import { freshness } from "@/lib/console/signals/signalDetail";
import { summarizeChokepoints, congestionColor } from "@/lib/console/signals/chokepoints";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";

const strProp = (f: SignalFeature, key: string): string => {
  const v = f.props?.[key];
  return typeof v === "string" ? v : "";
};
const TABLE_CAP = 250; // keep the vessel table legible on a busy snapshot

export function makeAisDetail(source: SignalSource) {
  function AisView(_props: WidgetDetailProps) {
    const scope = useScope();
    const { features, status, updatedAt } = useSignalFeed(source.id, source.refreshMs);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState<string | null>(null);
    const now = Date.now();
    const fresh = freshness(updatedAt, source.refreshMs, now);

    const scoped = useMemo(() => features.filter((f) => withinScope(f.lat, f.lon, scope)), [features, scope]);
    const stats = useMemo(() => summarizeChokepoints(scoped), [scoped]);
    const activeStraits = stats.filter((s) => s.name !== "Open water").length;
    const movingTotal = stats.reduce((s, x) => s + x.moving, 0);
    const worst = stats.find((s) => s.congestion === "congested") ?? stats.find((s) => s.congestion === "busy");

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      const rows = q ? scoped.filter((f) => [f.title, strProp(f, "chokepoint"), strProp(f, "status")].join(" ").toLowerCase().includes(q)) : scoped;
      const cp = (f: SignalFeature) => strProp(f, "chokepoint") || "~"; // untagged last
      const sp = (f: SignalFeature) => (typeof f.props?.speedKt === "number" ? f.props.speedKt : -1);
      return [...rows].sort((a, b) => cp(a).localeCompare(cp(b)) || sp(b) - sp(a));
    }, [scoped, query]);
    const tableRows = filtered.slice(0, TABLE_CAP);

    const mapPoints: InsetPoint[] = scoped.map((f) => ({ lat: f.lat, lon: f.lon, id: f.id, color: f.color ?? source.color, props: { title: f.title } }));
    const selectFromMap = (id: string) => {
      setOpen(id);
      if (typeof document !== "undefined") requestAnimationFrame(() => document.getElementById(`aisrow-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    };
    const flyTo = (f: SignalFeature) => { signalsStore.set(source.id, true); openSignalFeature(f, source.label, 6); shellLayoutStore.unfocus(); };
    const showOnMap = () => { signalsStore.set(source.id, true); shellLayoutStore.unfocus(); };

    const exportRows = filtered.map((f) => ({ id: f.id, vessel: f.title, mmsi: strProp(f, "mmsi") || (f.props?.mmsi ?? ""), chokepoint: strProp(f, "chokepoint"), speed: strProp(f, "speed"), course: strProp(f, "course"), status: strProp(f, "status"), lat: f.lat, lon: f.lon }));
    const exportGeo = filtered.map((f) => ({ lat: f.lat, lon: f.lon, properties: { id: f.id, name: f.title, ...(f.props ?? {}) } }));

    return (
      <div className="tn-sd tn-ais">
        <header className="tn-sd-head">
          <div className="tn-sd-title">{source.label}</div>
          <div className="tn-sd-stat"><b>{scoped.length}</b> vessels · {activeStraits} straits in {scope.label}
            <span className={`tn-sd-fresh is-${fresh.state}`}><i className="tn-sd-fresh-dot" />{fresh.state === "live" ? "live" : fresh.label}</span>
          </div>
        </header>

        {status === "loading" && scoped.length === 0 && <p className="tn-w-empty">Opening the AIS stream…</p>}
        {status !== "loading" && scoped.length === 0 && (
          <div className="tn-ais-dormant">
            <b>No live vessels right now.</b>
            <span>AIS is key-gated — set <code>AISSTREAM_API_KEY</code> (free, no card). Coverage is terrestrial-station AIS (~200&nbsp;km offshore), so it lights up when ships are inside the chokepoint boxes and the key is set.</span>
          </div>
        )}

        {scoped.length > 0 && (
          <div className="tn-sd-kpis">
            <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Vessels</div><div className="tn-sd-kpi-value">{scoped.length}</div><div className="tn-sd-kpi-sub">in view</div></div>
            <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Straits active</div><div className="tn-sd-kpi-value">{activeStraits}</div><div className="tn-sd-kpi-sub">of {stats.length} groups</div></div>
            <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Under way</div><div className="tn-sd-kpi-value">{movingTotal}</div><div className="tn-sd-kpi-sub">{scoped.length - movingTotal} stopped</div></div>
            <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Most congested</div><div className="tn-sd-kpi-value" style={{ fontSize: 14, color: worst ? congestionColor(worst.congestion) : undefined }}>{worst ? worst.name : "All flowing"}</div><div className="tn-sd-kpi-sub">{worst ? `${worst.stopped}/${worst.total} stopped` : "no congestion"}</div></div>
          </div>
        )}

        {stats.length > 0 && (
          <div className="tn-ais-cards">
            {stats.map((s) => {
              const movePct = s.total ? (s.moving / s.total) * 100 : 0;
              const col = congestionColor(s.congestion);
              return (
                <div key={s.name} className="tn-ais-card" style={{ borderLeftColor: col }}>
                  <div className="tn-ais-card-top">
                    <span className="tn-ais-card-name">{s.name}</span>
                    <span className="tn-ais-pill" style={{ background: col }}>{s.congestion}</span>
                  </div>
                  <div className="tn-ais-card-count">{s.total}<span> vessels</span></div>
                  <div className="tn-ais-split"><i style={{ width: `${movePct}%` }} /></div>
                  <div className="tn-ais-card-foot">
                    <span>{s.moving} under way · {s.stopped} stopped</span>
                    <span>{s.avgSpeed != null ? `avg ${s.avgSpeed.toFixed(1)} kt` : "—"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {scoped.length > 0 && mapPoints.length > 0 && (
          <div className="tn-sd-mappanel">
            <h3>Vessels <span className="tn-sd-maphint">· teal = under way, slate = stopped · click a dot to find its row</span></h3>
            <InsetMap points={mapPoints} height={220} selectedId={open ?? undefined} onSelect={selectFromMap} />
          </div>
        )}

        {scoped.length > 0 && (
          <div className="tn-sd-filter">
            <input type="text" value={query} placeholder="Search vessel, strait or status…" aria-label="Search" onChange={(e) => setQuery(e.target.value)} />
            {query && <button className="tn-sd-filter-clear" onClick={() => setQuery("")}>Clear</button>}
          </div>
        )}

        {tableRows.length > 0 && (
          <table className="tn-sd-table tn-ais-table">
            <thead><tr><th>Vessel</th><th>Strait</th><th>Speed</th><th>Status</th></tr></thead>
            <tbody>
              {tableRows.map((f) => {
                const isOpen = open === f.id;
                const moving = (typeof f.props?.speedKt === "number" ? f.props.speedKt : 0) > 0.5;
                return (
                  <Fragment key={f.id}>
                    <tr id={`aisrow-${f.id}`} className={`tn-sd-row${isOpen ? " is-selected" : ""}`} onClick={() => setOpen(isOpen ? null : f.id)}>
                      <td style={{ fontWeight: 600 }}><i className="tn-ais-dot" style={{ background: moving ? "#0d9488" : "#64748b" }} />{f.title}</td>
                      <td style={{ color: "var(--tn-text-muted)" }}>{strProp(f, "chokepoint") || "open water"}</td>
                      <td style={{ fontFamily: "var(--tn-mono)" }}>{strProp(f, "speed")}</td>
                      <td style={{ color: "var(--tn-text-muted)" }}>{strProp(f, "status")}</td>
                    </tr>
                    {isOpen && (
                      <tr className="tn-sd-drill"><td colSpan={4}>
                        <dl>
                          <div style={{ display: "contents" }}><dt>MMSI</dt><dd>{String(f.props?.mmsi ?? "—")}</dd></div>
                          <div style={{ display: "contents" }}><dt>Course</dt><dd>{strProp(f, "course")}</dd></div>
                          <div style={{ display: "contents" }}><dt>Heading</dt><dd>{strProp(f, "heading")}</dd></div>
                          {f.ts && <div style={{ display: "contents" }}><dt>Last report</dt><dd>{f.ts}</dd></div>}
                        </dl>
                        <button onClick={(e) => { e.stopPropagation(); flyTo(f); }} style={{ background: "none", border: 0, color: "var(--tn-accent)", cursor: "pointer", padding: 0 }}>Fly to vessel ↗</button>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {filtered.length > TABLE_CAP && <p className="tn-sd-more">Showing {TABLE_CAP} of {filtered.length} vessels — refine the search or open a specific strait on the map.</p>}

        <footer className="tn-sd-foot">
          <span className="tn-sd-attr">{source.attribution}</span>
          <span className="tn-sd-actions">
            <button onClick={showOnMap}>🗺 Show on map</button>
            <button disabled={!exportRows.length} onClick={() => downloadText(`${exportFilename(source.id, Date.now())}.csv`, "text/csv", toCsv(exportRows))}>⬇ CSV</button>
            <button disabled={!exportGeo.length} onClick={() => downloadText(`${exportFilename(source.id, Date.now())}.geojson`, "application/geo+json", toGeoJson(exportGeo))}>⬇ GeoJSON</button>
            <ExportExtras name={source.id} kind="ais" rows={exportRows} geo={exportGeo} source={`${source.label}: ${source.attribution}`} />
          </span>
        </footer>
      </div>
    );
  }
  return AisView;
}
