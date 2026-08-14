"use client";
// Satellites focus view — the orbital command console (spec §7.8, Option C: orbital
// detail AND imagery). Reuses the SAME live pipeline as the docked widget
// (useSatellites → locally-propagated WorldObject[]), then renders deep: a masthead
// with a count sparkline + TLE-source honesty, category chips + a roster search,
// full orbital vitals parsed from the TLE (lib/satellites/elements), a live ±1-period
// ground track on the shared <InsetMap>, NASA GIBS true-color imagery of the region
// beneath the sub-point (honestly captioned — NOT a live satellite photo), and a
// searchable/sortable roster whose rows drill into the existing <SatelliteDetail>
// dossier (its Esri close-up complements the GIBS regional tile).
import { Fragment, useEffect, useMemo, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import type { WorldObject } from "@/lib/world";
import { useSatellites } from "@/lib/satellites/useSatellites";
import { parseElements } from "@/lib/satellites/elements";
import { groundTrack } from "@/lib/satellites/groundTrack";
import { gibsTileUrl, gibsDate } from "@/lib/sources/gibs";
import { recordSeries, seriesSamples } from "@/lib/series";
import { deltaOf } from "@/lib/widgets/history";
import { Chart, type ChartPoint } from "@/components/Chart";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";
import SatelliteDetail from "@/components/SatelliteDetail";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";
import { useLiveVideoIds } from "@/lib/console/news/useLiveVideoIds";

// The satellite meta the propagation hook attaches (see lib/satellites/useSatellites).
// meta is Record<string, unknown> on WorldObject, so we narrow it here.
interface SatMeta {
  noradId?: string;
  objectName?: string;
  line1?: string;
  line2?: string;
  altKm?: number;
  velocityKmS?: number;
  periodMin?: number;
  typeLabel?: string;
}
const metaOf = (o: WorldObject | undefined): SatMeta => (o?.meta ?? {}) as SatMeta;

// NASA's official (main) YouTube channel.
//
// This used to be embedded as `youtube.com/embed/live_stream?channel=${NASA_CHANNEL}`,
// on the assumption that YouTube would resolve the channel's current broadcast for us.
// IT NO LONGER DOES — that endpoint is retired. Loaded in a real browser against this
// exact channel id it renders "Error 153 — Video player configuration error" and builds
// a link to `watch?v=live_stream`, i.e. it takes the literal string as a video id. The
// panel has been a dead player for every user since YouTube pulled it.
//
// The channel id is still the right thing to register — it is durable where a video id
// is not — but it now has to be resolved server-side. See lib/youtube/live.ts.
const NASA_CHANNEL = "UCLA_DiR1FfKNvjuUpBHmylQ";
const ISS_NORAD = "25544";

const TABLE_CAP = 300;

type SatSortKey = "name" | "norad" | "category" | "altKm" | "periodMin";

export default function SatellitesDetail(props: WidgetDetailProps) {
  const group = (props.config?.group as string) ?? "visual";
  const objects = useSatellites(group, 5000);
  const total = objects.length;

  // Resolved server-side (lib/youtube/live.ts): "iss" prefers NASA's HD Earth-viewing
  // stream, "nasa" its other concurrent feed. Undefined when nothing is live or the
  // resolver is dormant — the panel then says so instead of rendering a dead player.
  const liveIds = useLiveVideoIds();
  const issVideoId = liveIds["iss"] ?? liveIds["nasa"];
  const [selId, setSelId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SatSortKey>("altKm");
  const [dir, setDir] = useState<1 | -1>(-1);

  // Count sparkline: only stamp the series ONCE REAL DATA HAS ARRIVED (the W4 fix).
  // useSatellites hands back a fresh array every propagation tick, so its reference
  // change is our per-poll clock; the initial mount array is empty, and stamping then
  // would persist a spurious count=0 into the series.
  const [updatedAt, setUpdatedAt] = useState(0);
  useEffect(() => { if (objects.length > 0) setUpdatedAt(Date.now()); }, [objects]);
  useEffect(() => { if (updatedAt) recordSeries("sat:count", total, updatedAt); }, [updatedAt, total]);

  // Read the persisted series AND fold in the CURRENT poll's live count — recordSeries
  // only writes in a post-commit effect and lib/series has no React subscription, so
  // without folding it in the delta/sparkline would trail the count beside them by one
  // poll (exactly as aviation.detail.tsx / cameras.detail.tsx do).
  const samples = useMemo(() => {
    const base = seriesSamples("sat:count");
    const last = base[base.length - 1];
    if (updatedAt && (!last || last.t !== updatedAt || last.n !== total)) {
      return [...base, { t: updatedAt, n: total }];
    }
    return base;
  }, [updatedAt, total]);
  const spark: ChartPoint[] = useMemo(() => samples.map((s) => ({ x: s.t, y: s.n })), [samples]);
  const delta = useMemo(() => deltaOf(samples), [samples]);

  // Category chips (counts by human type label).
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of objects) {
      const label = o.typeLabel ?? "Other";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, [objects]);

  // Roster filter (category chip + search over name / NORAD id).
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return objects.filter((o) => {
      if (cat && (o.typeLabel ?? "Other") !== cat) return false;
      if (!needle) return true;
      const m = metaOf(o);
      return o.label.toLowerCase().includes(needle) || (m.noradId ?? "").toLowerCase().includes(needle);
    });
  }, [objects, q, cat]);

  // Selected satellite — resolved from the full set so a selection survives filtering
  // and per-poll array churn; falls back to the first object.
  const sel = useMemo(() => objects.find((o) => o.id === selId) ?? objects[0], [objects, selId]);
  const selMeta = metaOf(sel);
  const elements = useMemo(
    () => (sel ? parseElements(selMeta.line1 ?? "", selMeta.line2 ?? "") : null),
    // Recompute only when the underlying TLE changes, not on every propagation poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selMeta.line1, selMeta.line2],
  );

  // Live ±1-period ground track (dormant-safe: [] on any propagation error). Keyed on
  // the TLE identity so it computes once per selection, not every 5s poll.
  const track = useMemo(
    () => (sel ? groundTrack(selMeta.line1 ?? "", selMeta.line2 ?? "", Date.now(), selMeta.periodMin ?? NaN) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selMeta.line1, selMeta.line2, selMeta.periodMin],
  );

  const mapPoints: InsetPoint[] = useMemo(
    () => (sel ? [{ lat: sel.lat, lon: sel.lon, id: sel.id, color: sel.color, props: { name: sel.label } }] : []),
    [sel],
  );

  const gibsUrl = sel ? gibsTileUrl(sel.lat, sel.lon, 4, gibsDate(Date.now())) : "";
  const gibsWhen = gibsDate(Date.now());

  // Sortable roster (capped for DOM sanity).
  const rows = useMemo(() => {
    const val = (o: WorldObject): string | number => {
      const m = metaOf(o);
      switch (sortKey) {
        case "name": return o.label.toLowerCase();
        case "norad": return Number(m.noradId ?? 0);
        case "category": return (o.typeLabel ?? "").toLowerCase();
        case "altKm": return o.altKm ?? 0;
        case "periodMin": return m.periodMin ?? 0;
      }
    };
    return [...filtered]
      .sort((a, b) => {
        const va = val(a), vb = val(b);
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      })
      .slice(0, TABLE_CAP);
  }, [filtered, sortKey, dir]);
  const toggleSort = (k: SatSortKey) => {
    if (sortKey === k) setDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setDir(k === "name" || k === "category" ? 1 : -1); }
  };
  const sortMark = (k: SatSortKey) => (sortKey === k ? (dir === 1 ? " ↑" : " ↓") : "");

  const liveAlt = selMeta.altKm ?? sel?.altKm ?? 0;

  // Export the FILTERED roster (what's on screen) as CSV, and the current sub-points
  // of the filtered set as GeoJSON.
  const exportRows = useMemo(
    () => filtered.map((o) => {
      const m = metaOf(o);
      return {
        name: o.label,
        norad: m.noradId ?? "",
        category: o.typeLabel ?? "",
        altKm: typeof o.altKm === "number" ? Number(o.altKm.toFixed(1)) : "",
        periodMin: m.periodMin && Number.isFinite(m.periodMin) ? Number(m.periodMin.toFixed(1)) : "",
        lat: Number(o.lat.toFixed(4)),
        lon: Number(o.lon.toFixed(4)),
      };
    }),
    [filtered],
  );
  const exportGeo = useMemo(
    () => filtered.map((o) => ({ lat: o.lat, lon: o.lon, properties: { name: o.label, norad: metaOf(o).noradId } })),
    [filtered],
  );

  return (
    <div className="tn-sat">
      <header className="tn-sat-head">
        <div className="tn-sat-title">Orbital command</div>
        <div className="tn-sat-stat">
          <b>{total}</b> tracked · propagated locally · TLEs via CelesTrak · SGP4
          {delta !== 0 && (
            <span className={`tn-sat-delta ${delta > 0 ? "up" : "down"}`}> {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span>
          )}
        </div>
        {spark.length >= 2 && <div className="tn-sat-spark"><Chart points={spark} height={40} up={null} /></div>}
        {categories.length > 0 && (
          <div className="tn-sat-chips">
            <button className={`tn-sat-chip ${cat === null ? "active" : ""}`} onClick={() => setCat(null)}>All · {total}</button>
            {categories.map((c) => (
              <button
                key={c.label}
                className={`tn-sat-chip ${cat === c.label ? "active" : ""}`}
                onClick={() => setCat(cat === c.label ? null : c.label)}
              >
                {c.label} · {c.count}
              </button>
            ))}
          </div>
        )}
        <input
          className="tn-sat-search"
          placeholder="Search name or NORAD id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </header>

      {total === 0 && <p className="tn-w-empty">Loading satellites…</p>}

      {sel && (
        <div className="tn-sat-panels">
          <div className="tn-sat-panel">
            <h3>Orbital vitals · {sel.label}</h3>
            {elements ? (
              <dl className="tn-sat-vitals">
                <div><dt>Inclination</dt><dd>{elements.inclinationDeg.toFixed(2)}°</dd></div>
                <div><dt>Eccentricity</dt><dd>{elements.eccentricity.toFixed(7)}</dd></div>
                <div><dt>RAAN</dt><dd>{elements.raanDeg.toFixed(2)}°</dd></div>
                <div><dt>Arg. of perigee</dt><dd>{elements.argPerigeeDeg.toFixed(2)}°</dd></div>
                <div><dt>Mean anomaly</dt><dd>{elements.meanAnomalyDeg.toFixed(2)}°</dd></div>
                <div><dt>Mean motion</dt><dd>{elements.meanMotionRevPerDay.toFixed(4)} rev/day</dd></div>
                <div><dt>Period</dt><dd>{elements.periodMin.toFixed(1)} min</dd></div>
                <div><dt>Semi-major axis</dt><dd>{elements.semiMajorAxisKm.toFixed(0)} km</dd></div>
                <div><dt>Apogee</dt><dd>{elements.apogeeKm.toFixed(0)} km</dd></div>
                <div><dt>Perigee</dt><dd>{elements.perigeeKm.toFixed(0)} km</dd></div>
                <div><dt>Sub-point</dt><dd>{sel.lat.toFixed(2)}, {sel.lon.toFixed(2)}</dd></div>
                <div><dt>Altitude (live)</dt><dd>{liveAlt.toFixed(0)} km</dd></div>
                <div><dt>Velocity (live)</dt><dd>{(selMeta.velocityKmS ?? 0).toFixed(2)} km/s</dd></div>
                <div><dt>NORAD id</dt><dd>{selMeta.noradId ?? "—"}</dd></div>
              </dl>
            ) : (
              <p className="tn-w-empty">No orbital elements for this object.</p>
            )}
          </div>

          <div className="tn-sat-panel">
            <h3>Ground track · ±1 orbit</h3>
            {track.length > 0
              ? <InsetMap points={mapPoints} track={track} height={240} />
              : <p className="tn-w-empty">No ground track (propagation unavailable for this TLE).</p>}
          </div>

          <div className="tn-sat-panel">
            <h3>Imagery beneath the sub-point</h3>
            <figure className="tn-sat-img-fig">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="tn-sat-img"
                src={gibsUrl}
                alt={`NASA true-color imagery of the region beneath ${sel.label}`}
                loading="lazy"
                // Gracefully hide a failed/unavailable NASA tile (outage/404) instead of the
                // browser's broken-image glyph; self-heals when the sub-point crosses to a
                // new (working) tile and the src changes.
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                onLoad={(e) => { e.currentTarget.style.display = ""; }}
              />
              <figcaption className="tn-sat-cap">
                NASA GIBS true-color · {gibsWhen} · region beneath the sub-point (not a live satellite photo)
              </figcaption>
            </figure>
          </div>

          <div className="tn-sat-panel">
            <h3>Live feed</h3>
            {selMeta.noradId === ISS_NORAD ? (
              <div className="tn-sat-live">
                {issVideoId ? (
                  <iframe
                    className="tn-sat-live-frame"
                    src={`https://www.youtube.com/embed/${issVideoId}?playsinline=1`}
                    title="NASA live channel"
                    allow="encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  // Say nothing is playing rather than render a player that fails.
                  // An empty state a user can act on beats "Error 153".
                  <p className="tn-w-empty">
                    NASA is not broadcasting a live stream right now, or live resolution is
                    unavailable.{" "}
                    <a
                      href={`https://www.youtube.com/channel/${NASA_CHANNEL}/streams`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open NASA&apos;s channel
                    </a>
                  </p>
                )}
                <p className="tn-sat-cap">
                  NASA&apos;s live channel — carries the ISS HD cameras when NASA is broadcasting them (other NASA programming otherwise).
                </p>
              </div>
            ) : (
              <p className="tn-w-empty">No public live feed for this satellite.</p>
            )}
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <table className="tn-sat-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("name")}>Name{sortMark("name")}</th>
              <th className="sortable" onClick={() => toggleSort("norad")}>NORAD{sortMark("norad")}</th>
              <th className="sortable" onClick={() => toggleSort("category")}>Category{sortMark("category")}</th>
              <th className="sortable" onClick={() => toggleSort("altKm")}>Alt{sortMark("altKm")}</th>
              <th className="sortable" onClick={() => toggleSort("periodMin")}>Period{sortMark("periodMin")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const m = metaOf(o);
              const isOpen = openId === o.id;
              const isSel = sel?.id === o.id;
              return (
                <Fragment key={o.id}>
                  <tr
                    className={`tn-sat-row ${isSel ? "sel" : ""}`}
                    onClick={() => { setSelId(o.id); setOpenId(isOpen ? null : o.id); }}
                  >
                    <td className="tn-w-strong">{o.label}</td>
                    <td className="tn-w-muted">{m.noradId ?? "—"}</td>
                    <td>{o.typeLabel ?? "—"}</td>
                    <td>{o.altKm != null ? `${Math.round(o.altKm)} km` : "—"}</td>
                    <td>{m.periodMin && Number.isFinite(m.periodMin) ? `${m.periodMin.toFixed(1)} min` : "—"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="tn-sat-drill">
                      <td colSpan={5}><SatelliteDetail object={o} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {filtered.length > TABLE_CAP && (
        <p className="tn-w-empty">Showing the first {TABLE_CAP} of {filtered.length} — refine with the search or category chips above.</p>
      )}

      <footer className="tn-sat-foot">
        <span className="tn-sat-attr">
          TLEs: CelesTrak · propagation: SGP4 (satellite.js) · imagery: NASA GIBS + Esri World Imagery
        </span>
        <span className="tn-sat-actions">
          <button
            disabled={exportRows.length === 0}
            onClick={() => downloadText(`${exportFilename("satellites", Date.now())}.csv`, "text/csv", toCsv(exportRows))}
          >⬇ CSV</button>
          <button
            disabled={exportGeo.length === 0}
            onClick={() => downloadText(`${exportFilename("satellites", Date.now())}.geojson`, "application/geo+json", toGeoJson(exportGeo))}
          >⬇ GeoJSON</button>
        </span>
      </footer>
    </div>
  );
}
