"use client";
// Aviation focus view — the airspace console. Reuses the SAME live pipeline as the
// docked widget (usePlanes → { objects, trails }) but renders deep: an ops-summary
// masthead with a count sparkline, an emergency-squawk banner, region + altitude
// filters, a region map and altitude histogram, a sortable uncapped flight table
// with a per-flight PlaneDetail dossier, and an attribution footer with export.
// All aviation maths lives in the unit-tested lib/planes/ops.ts; this is a shell.
import { Fragment, useEffect, useMemo, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import { usePlanes } from "@/lib/planes/usePlanes";
import {
  opsSummary, altitudeBand, regionOf, sortFlights, filterFlights, isBizjetObject,
  ALT_BANDS, REGION_LABELS,
  type AltBand, type FlightSortKey,
} from "@/lib/planes/ops";
import { ownerOf } from "@/lib/planes/bizjet";
import { trackStore, useTrack } from "@/lib/planes/track";
import { layersStore } from "@/lib/layers";
import { shellLayoutStore } from "@/lib/console/store";
import { recordSeries, seriesSamples } from "@/lib/series";
import { deltaOf } from "@/lib/widgets/history";
import { Chart, type ChartPoint } from "@/components/Chart";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";
import PlaneDetail from "@/components/PlaneDetail";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";

const MS_TO_KT = 1.94384;
const MS_TO_KMH = 3.6;
const FT_TO_KM = 0.0003048;
const EMERGENCY_REASON: Record<string, string> = { "7500": "hijack", "7600": "radio failure", "7700": "emergency" };

// The 16-point compass copy — PlaneDetail's is private, so aviation.detail keeps its own.
function headingToCompass(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

export default function AviationDetail({ instanceId, config }: WidgetDetailProps) {
  const layer = usePlanes();
  const objects = layer.objects;

  // Private-jet surge alert threshold, persisted on the widget config so the
  // aviation alert rule (and the per-widget notification engine) honour it.
  const jetSurgeMin = typeof config.jetSurgeMin === "number" ? config.jetSurgeMin : 0;
  const setJetSurgeMin = (n: number) =>
    shellLayoutStore.configure(instanceId, { jetSurgeMin: n > 0 ? n : undefined });

  const summary = useMemo(() => opsSummary(objects), [objects]);
  const total = summary.total;

  // Filter / sort / dossier state — consumed by the panels and table added in the
  // later tasks. Declared here as the skeleton so the component grows in place.
  const [region, setRegion] = useState<string | null>(null);
  const [band, setBand] = useState<AltBand | null>(null);
  const [query, setQuery] = useState("");
  const [bizjetOnly, setBizjetOnly] = useState(false);
  const [sortKey, setSortKey] = useState<FlightSortKey>("altitude");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [openId, setOpenId] = useState<string | null>(null);
  const track = useTrack();

  // Start tracking a plane on the globe (and make sure the map's plane layer is on
  // so the followed aircraft actually renders). The track lives in an external store,
  // so it survives leaving this focus view — see lib/planes/track + WorldMap.
  const startTrack = (id: string, label: string) => {
    layersStore.set("planes", true);
    trackStore.track(id, label);
  };

  // usePlanes hands back a fresh objects array every poll (even when unchanged), so
  // its reference change is our per-poll clock — the stable timestamp the count
  // sparkline needs (usePlanes exposes no updatedAt of its own). Only stamp once REAL
  // data has arrived: the initial mount array is empty, and stamping then would defeat
  // the `if (updatedAt)` guard below and persist a spurious count=0 into the series.
  const [updatedAt, setUpdatedAt] = useState(0);
  useEffect(() => { if (objects.length > 0) setUpdatedAt(Date.now()); }, [objects]);

  useEffect(() => {
    if (updatedAt) recordSeries("av:count", total, updatedAt);
  }, [updatedAt, total]);

  // Read the persisted series AND fold in the CURRENT poll's live count. recordSeries
  // only writes in a post-commit effect and lib/series has no React subscription, so
  // without folding it in here the delta/sparkline would trail the count beside them
  // by one poll (exactly as signals.detail.tsx does).
  const samples = useMemo(() => {
    const base = seriesSamples("av:count");
    const last = base[base.length - 1];
    if (updatedAt && (!last || last.t !== updatedAt || last.n !== total)) {
      return [...base, { t: updatedAt, n: total }];
    }
    return base;
  }, [updatedAt, total]);
  const spark: ChartPoint[] = useMemo(() => samples.map((s) => ({ x: s.t, y: s.n })), [samples]);
  const delta = useMemo(() => deltaOf(samples), [samples]);

  const emergencies = useMemo(
    () => objects.filter((o) => {
      const sq = o.meta?.squawk;
      return typeof sq === "string" && sq in EMERGENCY_REASON;
    }),
    [objects],
  );

  // Region + altitude + search + business-jet filters. Every downstream panel/table
  // reads `filtered` (see filterFlights — pure + unit-tested).
  const filtered = useMemo(
    () => filterFlights(objects, { region, band, query, bizjetOnly }),
    [objects, region, band, query, bizjetOnly],
  );

  const mapPoints: InsetPoint[] = useMemo(
    () => filtered.map((o) => ({ lat: o.lat, lon: o.lon, id: o.id, color: o.color, props: { callsign: o.label } })),
    [filtered],
  );

  const altHistogram = useMemo(() => {
    const counts = new Map<AltBand, number>();
    for (const o of filtered) { const b = altitudeBand(o); counts.set(b, (counts.get(b) ?? 0) + 1); }
    return ALT_BANDS.map((b) => ({ band: b, count: counts.get(b) ?? 0 }));
  }, [filtered]);
  const altMax = Math.max(1, ...altHistogram.map((h) => h.count));

  // Uncapped, sorted flight list (region/altitude filters already applied).
  const rows = useMemo(() => sortFlights(filtered, sortKey, dir), [filtered, sortKey, dir]);
  const toggleSort = (k: FlightSortKey) => {
    if (sortKey === k) setDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setDir(-1); }
  };
  const sortMark = (k: FlightSortKey) => (sortKey === k ? (dir === -1 ? " ↓" : " ↑") : "");

  const exportRows = useMemo(
    () => rows.map((o) => {
      const meta = o.meta ?? {};
      const velocityMs = typeof meta.velocityMs === "number" ? (meta.velocityMs as number) : null;
      return {
        callsign: o.label,
        type: o.typeLabel ?? "",
        altKm: typeof o.altKm === "number" ? Number(o.altKm.toFixed(2)) : "",
        speedKt: velocityMs != null ? Number((velocityMs * MS_TO_KT).toFixed(0)) : "",
        headingDeg: typeof meta.headingDeg === "number" ? Math.round(meta.headingDeg as number) : "",
        verticalRateMs: typeof meta.verticalRateMs === "number" ? (meta.verticalRateMs as number) : "",
        registration: (meta.registration as string) || "",
        region: regionOf(o.lat, o.lon),
        squawk: (meta.squawk as string) || "",
      };
    }),
    [rows],
  );
  const exportGeo = useMemo(
    () => filtered.map((o) => ({ lat: o.lat, lon: o.lon, properties: { callsign: o.label, ...(o.meta ?? {}) } })),
    [filtered],
  );

  return (
    <div className="tn-av">
      <header className="tn-av-head">
        <div className="tn-av-title">Airspace</div>
        <div className="tn-av-stat">
          <b>{total}</b> live · {summary.airborne} airborne · {summary.ground} ground · max{" "}
          {summary.maxAltKm.toFixed(1)} km · {(summary.maxSpeedMs * MS_TO_KT).toFixed(0)} kt
          {delta !== 0 && (
            <span className={`tn-av-delta ${delta > 0 ? "up" : "down"}`}> {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span>
          )}
        </div>
        {spark.length >= 2 && <div className="tn-av-spark"><Chart points={spark} height={40} up={null} /></div>}
        {(summary.byCategory.length > 0 || summary.bizjets > 0) && (
          <div className="tn-av-ops">
            {summary.byCategory.map((c) => (
              <span key={c.category} className="tn-av-chip">{c.label} · {c.count}</span>
            ))}
            {summary.bizjets > 0 && (
              <span className="tn-av-chip tn-av-chip-jet" title="Business / private jets by ICAO type (airborne shown in ×)">
                ✦ Private jets · {summary.bizjets}
                {summary.bizjetsAirborne > 0 && ` (${summary.bizjetsAirborne} airborne)`}
              </span>
            )}
          </div>
        )}
      </header>

      {emergencies.length > 0 && (
        <div className="tn-av-emg-list">
          {emergencies.map((o) => {
            const code = o.meta?.squawk as string;
            return (
              <div key={o.id} className="tn-av-emg">
                ⚠ {o.label} squawking {code} — {EMERGENCY_REASON[code]}
              </div>
            );
          })}
        </div>
      )}

      {objects.length === 0 && <p className="tn-w-empty">No aircraft in range right now.</p>}

      {objects.length > 0 && (
        <div className="tn-av-filters">
          <div className="tn-av-filter-row">
            <span className="tn-av-filter-label">Search</span>
            <input
              className="tn-av-search"
              type="search"
              value={query}
              placeholder="callsign, registration, type or hex…"
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              className={`tn-av-fchip ${bizjetOnly ? "active" : ""}`}
              onClick={() => setBizjetOnly((v) => !v)}
              title="Show only business / private jets"
            >✦ Private jets</button>
            {(query || bizjetOnly) && (
              <button className="tn-av-fclear" onClick={() => { setQuery(""); setBizjetOnly(false); }}>Clear</button>
            )}
          </div>
          <div className="tn-av-filter-row">
            <span className="tn-av-filter-label">Region</span>
            <button className={`tn-av-fchip ${region === null ? "active" : ""}`} onClick={() => setRegion(null)}>All</button>
            {REGION_LABELS.map((r) => (
              <button key={r} className={`tn-av-fchip ${region === r ? "active" : ""}`} onClick={() => setRegion(region === r ? null : r)}>{r}</button>
            ))}
          </div>
          <div className="tn-av-filter-row">
            <span className="tn-av-filter-label">Altitude</span>
            <button className={`tn-av-fchip ${band === null ? "active" : ""}`} onClick={() => setBand(null)}>All</button>
            {ALT_BANDS.map((b) => (
              <button key={b} className={`tn-av-fchip ${band === b ? "active" : ""}`} onClick={() => setBand(band === b ? null : b)}>{b}</button>
            ))}
          </div>
          <div className="tn-av-filter-row">
            <span className="tn-av-filter-label">Alert</span>
            <label className="tn-av-surge">
              🔔 when ≥
              <input
                type="number" min={0} max={999} step={1} value={jetSurgeMin || ""}
                placeholder="off"
                onChange={(e) => setJetSurgeMin(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
              private jets airborne at once
            </label>
            <span className="tn-av-surge-hint">
              {jetSurgeMin > 0
                ? `armed · ${summary.bizjetsAirborne} airborne now`
                : "choose channels with the 🔔 on the widget"}
            </span>
          </div>
        </div>
      )}

      {objects.length > 0 && (
        <div className="tn-av-panels">
          <div className="tn-av-panel">
            <h3>Locations · {filtered.length}</h3>
            {mapPoints.length > 0
              ? <InsetMap points={mapPoints} height={220} onSelect={(id) => setOpenId(id)} />
              : <p className="tn-w-empty">No aircraft match this filter.</p>}
          </div>
          <div className="tn-av-panel">
            <h3>Altitude bands</h3>
            {filtered.length > 0 ? (
              <>
                <div className="tn-av-bars">
                  {altHistogram.map((h) => (
                    <div key={h.band} className="tn-av-bar" style={{ height: `${(h.count / altMax) * 100}%` }} title={`${h.band}: ${h.count}`} />
                  ))}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {altHistogram.map((h) => <span key={h.band} className="tn-av-bar-label" style={{ flex: 1 }}>{h.band}</span>)}
                </div>
              </>
            ) : <p className="tn-w-empty">No aircraft match this filter.</p>}
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <table className="tn-av-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("callsign")}>Callsign{sortMark("callsign")}</th>
              <th>Type</th>
              <th className="sortable" onClick={() => toggleSort("altitude")}>Alt{sortMark("altitude")}</th>
              <th className="sortable" onClick={() => toggleSort("speed")}>Speed{sortMark("speed")}</th>
              <th>Heading</th>
              <th>V/S</th>
              <th>Reg</th>
              <th className="sortable" onClick={() => toggleSort("region")}>Region{sortMark("region")}</th>
              <th>Squawk</th>
              <th>Track</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const meta = o.meta ?? {};
              const typeCode = (meta.typeCode as string) || "";
              const altKm = typeof o.altKm === "number" ? o.altKm : null;
              const velocityMs = typeof meta.velocityMs === "number" ? (meta.velocityMs as number) : null;
              const headingDeg = typeof meta.headingDeg === "number" ? (meta.headingDeg as number) : (o.heading ?? 0);
              const vs = typeof meta.verticalRateMs === "number" ? (meta.verticalRateMs as number) : null;
              const reg = (meta.registration as string) || "";
              const squawk = (meta.squawk as string) || "";
              const isEmergency = squawk in EMERGENCY_REASON;
              const isOpen = openId === o.id;
              const isJet = isBizjetObject(o);
              const owner = ownerOf(reg);
              const isTracked = track.id === o.id;
              return (
                <Fragment key={o.id}>
                  <tr className={`tn-av-row ${isTracked ? "is-tracked" : ""}`} onClick={() => setOpenId(isOpen ? null : o.id)}>
                    <td className="tn-w-strong">
                      {o.label}
                      {owner && <span className="tn-av-owner" title={owner.owner}>★ {owner.owner}</span>}
                    </td>
                    <td className="tn-w-muted">
                      {isJet && <span className="tn-av-jet-tag" title="Business / private jet">✦</span>}
                      {o.typeLabel ?? "—"}{typeCode ? ` · ${typeCode}` : ""}
                    </td>
                    <td>{altKm != null ? `${altKm.toFixed(1)} km / ${(altKm / FT_TO_KM).toFixed(0)} ft` : "—"}</td>
                    <td>{velocityMs != null ? `${(velocityMs * MS_TO_KT).toFixed(0)} kt / ${(velocityMs * MS_TO_KMH).toFixed(0)} km/h` : "—"}</td>
                    <td>{Math.round(headingDeg)}° {headingToCompass(headingDeg)}</td>
                    <td>{vs != null ? `${vs.toFixed(1)} m/s` : "—"}</td>
                    <td>{reg || "—"}</td>
                    <td>{regionOf(o.lat, o.lon)}</td>
                    <td className={isEmergency ? "tn-av-sq-emg" : ""}>{squawk || "—"}</td>
                    <td>
                      <button
                        className={`tn-av-track-btn ${isTracked ? "is-on" : ""}`}
                        onClick={(e) => { e.stopPropagation(); isTracked ? trackStore.stop() : startTrack(o.id, o.label); }}
                        title={isTracked ? "Stop tracking on the globe" : "Track this plane on the globe"}
                      >
                        {isTracked ? "◉ Tracking" : "◎ Track"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="tn-av-drill">
                      <td colSpan={10}><PlaneDetail object={o} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      <footer className="tn-av-foot">
        <span className="tn-av-attr">Aircraft: adsb.lol · enrichment: adsbdb · pulled by type, worldwide (cached snapshot)</span>
        <span className="tn-av-actions">
          <button
            disabled={exportRows.length === 0}
            onClick={() => downloadText(`${exportFilename("aviation", Date.now())}.csv`, "text/csv", toCsv(exportRows))}
          >⬇ CSV</button>
          <button
            disabled={exportGeo.length === 0}
            onClick={() => downloadText(`${exportFilename("aviation", Date.now())}.geojson`, "application/geo+json", toGeoJson(exportGeo))}
          >⬇ GeoJSON</button>
        </span>
      </footer>
    </div>
  );
}
