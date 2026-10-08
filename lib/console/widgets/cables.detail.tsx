"use client";
// Cable ASSET focus view — the layer-aware replacement for the generic event
// detail when a source is `kind: "asset"`. Submarine cables are permanent
// infrastructure, so this template drops magnitude / severity / "last 24h" and
// renders asset attributes instead: an RFS / length / capacity / owners / status
// table, a Status·Owner·Region filter panel, and a per-cable technical drill-down
// that highlights the route on the globe (cross-filtering). A sibling template
// covers landing-station hubs. Reuses the shared `.tn-sd-*` classes — no new CSS.

import { Fragment, useMemo, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import type { SignalSource } from "@/lib/signals/types";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { useScope, withinScope } from "@/lib/shell/scope";
import { signalsStore } from "@/lib/signals/store";
import { shellLayoutStore } from "@/lib/console/store";
import { openSignalFeature } from "@/lib/widgets/openSignal";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";
import ExportExtras from "@/components/console/ExportExtras";
import {
  cableAssets,
  filterCables,
  sortCables,
  statusOptions,
  regionOptions,
  ownerOptions,
  summarize,
  EMPTY_FILTER,
  landingAssets,
  filterLandings,
  sortLandings,
  type CableFilter,
  type CableSortKey,
  type CableAsset,
} from "@/lib/console/signals/cableDetail";
import { makeDirectoryDetail } from "./directory.detail";

const selStyle: React.CSSProperties = {
  background: "var(--tn-surface-2)",
  border: "1px solid var(--tn-border)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 12,
  color: "var(--tn-text)",
};
const km = (n: number | null) => (n == null ? "—" : n.toLocaleString());

// ── Cables ──────────────────────────────────────────────────────────────────

function makeCableDetail(source: SignalSource) {
  const COLS: { key: CableSortKey; label: string }[] = [
    { key: "name", label: "Cable" },
    { key: "rfsYear", label: "RFS" },
    { key: "lengthKm", label: "Length (km)" },
    { key: "capacity", label: "Capacity" },
    { key: "owners", label: "Owners / operators" },
    { key: "status", label: "Status" },
  ];

  function CableDetailView(_props: WidgetDetailProps) {
    const scope = useScope();
    const { features, status, updatedAt } = useSignalFeed(source.id, source.refreshMs);
    const [filter, setFilter] = useState<CableFilter>(EMPTY_FILTER);
    const [sortKey, setSortKey] = useState<CableSortKey>("rfsYear");
    const [dir, setDir] = useState<1 | -1>(-1);
    const [open, setOpen] = useState<string | null>(null);

    const scoped = useMemo(
      () => cableAssets(features).filter((r) => withinScope(r.lat, r.lon, scope)),
      [features, scope],
    );
    const statuses = useMemo(() => statusOptions(scoped), [scoped]);
    const regions = useMemo(() => regionOptions(scoped), [scoped]);
    const owners = useMemo(() => ownerOptions(scoped), [scoped]);
    const filtered = useMemo(() => filterCables(scoped, filter), [scoped, filter]);
    const rows = useMemo(() => sortCables(filtered, sortKey, dir), [filtered, sortKey, dir]);
    const sum = useMemo(() => summarize(filtered), [filtered]);

    const freshAge = updatedAt ? `${Math.max(0, Math.round((Date.now() - updatedAt) / 60000))}m ago` : "—";
    const clickHead = (k: CableSortKey) => {
      if (sortKey === k) setDir((d) => (d === 1 ? -1 : 1));
      else {
        setSortKey(k);
        setDir(k === "name" || k === "owners" || k === "status" ? 1 : -1);
      }
    };
    const showRoute = (r: CableAsset) => {
      signalsStore.set("cables", true);
      openSignalFeature(r.feature, source.label, 4);
      shellLayoutStore.unfocus();
    };
    const showAll = () => {
      signalsStore.set("cables", true);
      shellLayoutStore.unfocus();
    };

    const exportRows = rows.map((r) => ({
      cable: r.name, rfsYear: r.rfsYear ?? "", lengthKm: r.lengthKm ?? "", capacity: r.capacity,
      owners: r.owners, suppliers: r.suppliers, status: r.status, region: r.region,
      landingPoints: r.landingCount, countries: r.countries, lat: r.lat, lon: r.lon,
    }));
    const exportGeo = rows.map((r) => ({ lat: r.lat, lon: r.lon, properties: { id: r.id, cable: r.name, ...(r.feature.props ?? {}) } }));

    return (
      <div className="tn-sd">
        <header className="tn-sd-head">
          <div className="tn-sd-title">{source.label}</div>
          <div className="tn-sd-stat">
            <b>{filtered.length}</b> of {features.length} cables in {scope.label} · updated {freshAge}
          </div>
          {/* Asset summary strip — replaces the event magnitude/severity histograms. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: "var(--tn-text-muted)", marginTop: 2 }}>
            <span><b style={{ color: "var(--tn-text)" }}>{sum.operational}</b> operational</span>
            <span><b style={{ color: "var(--tn-text)" }}>{sum.planned}</b> planned</span>
            <span><b style={{ color: "var(--tn-text)" }}>{sum.totalLengthKm.toLocaleString()}</b> km mapped ({sum.knownLength} cables)</span>
            {sum.regions.slice(0, 4).map((rg) => (
              <span key={rg.region}>{rg.region}: <b style={{ color: "var(--tn-text)" }}>{rg.count}</b></span>
            ))}
          </div>
        </header>

        {/* Filter panel — Status · Owner/Operator · Landing region */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select style={selStyle} value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s === "—" ? "Unknown" : s}</option>)}
          </select>
          <select style={selStyle} value={filter.region} onChange={(e) => setFilter((f) => ({ ...f, region: e.target.value }))}>
            <option value="">All regions</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input
            style={{ ...selStyle, minWidth: 180 }}
            list="tn-cable-owners"
            placeholder="Owner / operator…"
            value={filter.owner}
            onChange={(e) => setFilter((f) => ({ ...f, owner: e.target.value }))}
          />
          <datalist id="tn-cable-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
          {(filter.status || filter.region || filter.owner) && (
            <button className="tn-sd-actions" style={{ background: "none", border: 0, color: "var(--tn-accent)", cursor: "pointer", fontSize: 12, padding: 0 }} onClick={() => setFilter(EMPTY_FILTER)}>Clear</button>
          )}
        </div>

        {status === "loading" && scoped.length === 0 && <p className="tn-w-empty">Loading {source.label}…</p>}
        {status !== "loading" && scoped.length === 0 && <p className="tn-w-empty">No cables in {scope.label}.</p>}
        {scoped.length > 0 && filtered.length === 0 && <p className="tn-w-empty">No cables match the current filter.</p>}

        {filtered.length > 0 && (
          <table className="tn-sd-table">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} onClick={() => clickHead(c.key)} title={c.key === "capacity" ? "Design capacity is not published by the source" : undefined}>
                    {c.label}{sortKey === c.key ? (dir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="tn-sd-row" onClick={() => setOpen(isOpen ? null : r.id)}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.rfsYear ?? "—"}</td>
                      <td>{km(r.lengthKm)}</td>
                      <td style={{ color: "var(--tn-text-faint)" }}>{r.capacity}</td>
                      <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.owners}>{r.owners}</td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: r.status === "Planned" ? "#f59e0b" : r.status === "Operational" ? "#0d9488" : "#94a3b8" }} />
                          {r.status}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="tn-sd-drill">
                        <td colSpan={COLS.length}>
                          {/* Technical layout — the cross-filter sidebar for one cable. */}
                          <dl>
                            <div style={{ display: "contents" }}><dt>Status</dt><dd>{r.status}</dd></div>
                            <div style={{ display: "contents" }}><dt>Ready for service</dt><dd>{r.feature.props?.rfs != null ? String(r.feature.props.rfs) : r.rfsYear ?? "—"}</dd></div>
                            <div style={{ display: "contents" }}><dt>Length</dt><dd>{r.lengthLabel}</dd></div>
                            <div style={{ display: "contents" }}><dt>Design capacity</dt><dd>{r.capacity} <span style={{ color: "var(--tn-text-faint)" }}>(not published)</span></dd></div>
                            <div style={{ display: "contents" }}><dt>Owners / consortium</dt><dd>{r.owners}</dd></div>
                            <div style={{ display: "contents" }}><dt>Supplier</dt><dd>{r.suppliers}</dd></div>
                            <div style={{ display: "contents" }}><dt>Landing region</dt><dd>{r.region}</dd></div>
                            <div style={{ display: "contents" }}><dt>Landing points ({r.landingCount})</dt><dd>{r.landings}</dd></div>
                          </dl>
                          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                            <button onClick={(e) => { e.stopPropagation(); showRoute(r); }} style={{ background: "none", border: 0, color: "var(--tn-accent)", cursor: "pointer", padding: 0 }}>Highlight route on globe ↗</button>
                            {r.link && <a href={r.link} target="_blank" rel="noreferrer" style={{ color: "var(--tn-accent)" }} onClick={(e) => e.stopPropagation()}>Source ↗</a>}
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
            <button onClick={showAll}>🗺 Show on map</button>
            <button disabled={!exportRows.length} onClick={() => downloadText(`${exportFilename("cables", Date.now())}.csv`, "text/csv", toCsv(exportRows))}>⬇ CSV</button>
            <button disabled={!exportGeo.length} onClick={() => downloadText(`${exportFilename("cables", Date.now())}.geojson`, "application/geo+json", toGeoJson(exportGeo))}>⬇ GeoJSON</button>
            <ExportExtras name={"cables"} kind="cables" rows={exportRows} geo={exportGeo} source={`${source.label}: ${source.attribution}`} />
          </span>
        </footer>
      </div>
    );
  }
  return CableDetailView;
}

// ── Landing stations ─────────────────────────────────────────────────────────

function makeLandingDetail(source: SignalSource) {
  function LandingDetailView(_props: WidgetDetailProps) {
    const scope = useScope();
    const { features, status, updatedAt } = useSignalFeed(source.id, source.refreshMs);
    const [query, setQuery] = useState("");
    const [dir, setDir] = useState<1 | -1>(-1);
    const [open, setOpen] = useState<string | null>(null);

    const scoped = useMemo(() => landingAssets(features).filter((r) => withinScope(r.lat, r.lon, scope)), [features, scope]);
    const rows = useMemo(() => sortLandings(filterLandings(scoped, query), "cableCount", dir), [scoped, query, dir]);
    const freshAge = updatedAt ? `${Math.max(0, Math.round((Date.now() - updatedAt) / 60000))}m ago` : "—";

    const showNode = (id: string, lat: number, lon: number, feature: (typeof rows)[number]["feature"]) => {
      signalsStore.set("cable-landings", true);
      openSignalFeature(feature, source.label, 6);
      shellLayoutStore.unfocus();
    };

    return (
      <div className="tn-sd">
        <header className="tn-sd-head">
          <div className="tn-sd-title">{source.label}</div>
          <div className="tn-sd-stat"><b>{scoped.length}</b> of {features.length} in {scope.label} · updated {freshAge}</div>
        </header>
        <input style={{ ...selStyle, maxWidth: 260 }} placeholder="Search station or cable…" value={query} onChange={(e) => setQuery(e.target.value)} />

        {status === "loading" && scoped.length === 0 && <p className="tn-w-empty">Loading {source.label}…</p>}
        {status !== "loading" && scoped.length === 0 && <p className="tn-w-empty">No landing stations in {scope.label}.</p>}

        {rows.length > 0 && (
          <table className="tn-sd-table">
            <thead>
              <tr>
                <th onClick={() => setDir(1)}>Landing station</th>
                <th onClick={() => setDir((d) => (d === 1 ? -1 : 1))}>Cables {dir === -1 ? "↓" : "↑"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map((r) => {
                const isOpen = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="tn-sd-row" onClick={() => setOpen(isOpen ? null : r.id)}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.cableCount}</td>
                    </tr>
                    {isOpen && (
                      <tr className="tn-sd-drill">
                        <td colSpan={2}>
                          <dl><div style={{ display: "contents" }}><dt>Cables landing here</dt><dd>{r.cables}</dd></div></dl>
                          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                            <button onClick={(e) => { e.stopPropagation(); showNode(r.id, r.lat, r.lon, r.feature); }} style={{ background: "none", border: 0, color: "var(--tn-accent)", cursor: "pointer", padding: 0 }}>Show on globe ↗</button>
                            {r.link && <a href={r.link} target="_blank" rel="noreferrer" style={{ color: "var(--tn-accent)" }} onClick={(e) => e.stopPropagation()}>Source ↗</a>}
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
            <button onClick={() => { signalsStore.set("cable-landings", true); shellLayoutStore.unfocus(); }}>🗺 Show on map</button>
          </span>
        </footer>
      </div>
    );
  }
  return LandingDetailView;
}

/** Dispatch the right asset template for a `kind: "asset"` source. Cables/landings
 *  have a bespoke technical schema; browsable/ranked infrastructure (ports, and
 *  next airports/nuclear) uses the generic ranked asset directory. */
export function makeAssetDetail(source: SignalSource) {
  if (source.id === "cable-landings") return makeLandingDetail(source);
  if (source.id === "cables") return makeCableDetail(source);
  return makeDirectoryDetail(source);
}
