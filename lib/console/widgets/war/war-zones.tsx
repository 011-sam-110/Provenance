"use client";
// lib/console/widgets/war/war-zones.tsx
// The War zones card and its expanded view.
//
// CARD: per war zone, the Russian-held area on DeepState's newest map, its change over 7,
// 30 and 90 days, the 90-day line, and the contested area under it, with the map's date
// and source. EXPANDED: three tiles (held, 30-day change, contested), the area line with
// its own scale, the front line changes per day, a table with one row per zone, and a
// sketch of the zone drawn from the same polygons the map draws.
//
// Every figure is read from the layer's summary (lib/signals/war-zones.ts), which
// provenance-1 measured from DeepState's own maps. A change is shown only when the series
// holds a row for that exact day; otherwise the chip says it is not measured yet. The line
// does not start at zero (a 90-day change is about 0.1 % of the area), so both its ends
// are printed and the expanded view prints its scale. Do not import ../signals.tsx here.
import { useEffect, useId, useMemo, useState } from "react";
import type { WidgetBodyProps, WidgetDetailProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { freshness } from "@/lib/console/signals/signalDetail";
import { signalsStore } from "@/lib/signals/store";
import { shellLayoutStore } from "@/lib/console/store";
import { downloadText, exportFilename, toCsv } from "@/lib/export";
import { loadOutlines } from "@/lib/shell/askPlaceLookup";
import type { SignalFeature, SignalGeometry } from "@/lib/signals/types";
import {
  WAR_ZONES_SOURCE,
  WAR_ZONE_COLORS,
  readWarZonesSummary,
  type WarZoneSeriesRow,
  type WarZoneSummaryZone,
  type WarZonesSummary,
} from "@/lib/signals/war-zones";
import { FRONTLINE_CHANGES_SOURCE, readFrontlineSummary, WINDOW_DAYS } from "@/lib/signals/frontline-changes";
import { DayBars } from "./frontline-changes";

const SRC = WAR_ZONES_SOURCE;
const LINE_DAYS = 90;
/** The country outline a zone sits in, for the sketch. */
const ZONE_COUNTRY: Record<string, string> = { ukraine: "UKR" };

// --- formatting ----------------------------------------------------------------------

const km = (n: number) => Math.round(n).toLocaleString("en-GB");
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "28 Oct, 21:33 UTC" */
export function mapTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}, ${hh}:${mm} UTC`;
}

/** The chip class: more Russian-held ground is the Russian side's gain, less is Ukraine's. */
const changeClass = (n: number | null) => (n == null || Math.round(n) === 0 ? "" : n > 0 ? " is-ru" : " is-ua");

function lastDays(series: readonly WarZoneSeriesRow[], days: number): WarZoneSeriesRow[] {
  return series.slice(-(days + 1));
}

function exportRows(s: WarZonesSummary | null): Record<string, unknown>[] {
  if (!s) return [];
  return s.zones.flatMap((z) =>
    z.series.map((r) => ({ zone: z.name, day: r.day, russianHeldKm2: r.heldKm2, contestedKm2: r.contestedKm2, source: z.source })),
  );
}

// --- the area line ---------------------------------------------------------------------

/**
 * The held area over time, scaled to its own range (not from zero), drawn in a fixed
 * viewBox stretched to the width. Not interactive: the values a reader needs are printed
 * beside it, and the label names the range for a screen reader.
 */
function AreaLine({ rows, height, label }: { rows: WarZoneSeriesRow[]; height: number; label: string }) {
  if (rows.length < 2) return null;
  const W = 300;
  const H = 100;
  const vals = rows.map((r) => r.heldKm2);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const pad = span * 0.08;
  const y = (v: number) => H - ((v - (lo - pad)) / (span + 2 * pad)) * H;
  const x = (i: number) => (i / (rows.length - 1)) * W;
  const line = rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(r.heldKm2).toFixed(2)}`).join(" ");
  return (
    <svg className="tn-wz-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={label}>
      <line className="grid" x1="0" x2={W} y1={y(hi)} y2={y(hi)} />
      <line className="grid" x1="0" x2={W} y1={y(lo)} y2={y(lo)} />
      <path className="fill" d={`${line} L${W},${H} L0,${H} Z`} />
      <path className="stroke" d={line} />
    </svg>
  );
}

function lineLabel(z: WarZoneSummaryZone, rows: WarZoneSeriesRow[]): string {
  const a = rows[0];
  const b = rows[rows.length - 1];
  return `Russian-held area in ${z.name}, ${dayLabel(a.day)} to ${dayLabel(b.day)}: from ${km(a.heldKm2)} to ${km(b.heldKm2)} square kilometres.`;
}

function ChangeChips({ z }: { z: WarZoneSummaryZone }) {
  const chips: [number | null, string][] = [
    [z.change7, "7 days"],
    [z.change30, "30 days"],
    [z.change90, "90 days"],
  ];
  return (
    <ul className="tn-wz-chips" aria-label="Change in the Russian-held area">
      {chips.map(([n, span], i) => (
        <li key={span} className={`tn-wz-chip${changeClass(n)}`}>
          {n == null ? (
            <>{span}: not measured yet</>
          ) : (
            <>
              {/* The unit once, on the first chip, as the plan drew it: the row stays one line. */}
              <b>{i === 0 ? `${signed(n)} km²` : signed(n)}</b> in {span}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

// --- the card -------------------------------------------------------------------------

function useWarZones() {
  const feed = useSignalFeed(SRC.id, SRC.refreshMs);
  const summary = useMemo(() => readWarZonesSummary(feed.summary), [feed.summary]);
  return { ...feed, s: summary };
}

/** The honest state when there is nothing to draw, or null when there is. */
function emptyState(status: string, ok: boolean, s: WarZonesSummary | null, features: SignalFeature[]): string | null {
  if (s && s.zones.length > 0) return null;
  if (status === "loading") return "Loading War zones…";
  if (!ok || status === "error") return "War zones unavailable: no DeepState map has reached this server yet. provenance-1 sends one every 30 minutes.";
  if (features.length > 0) return `${features.length} areas are on the map, but their area figures did not arrive with them.`;
  return "DeepState's latest map holds no war zone.";
}

function WarZonesCard(_props: WidgetBodyProps) {
  const { features, status, updatedAt, ok, sourceAt, s } = useWarZones();
  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: [],
      count: s?.zones.length ?? 0,
      fresh: { lastOk: updatedAt, ok, count: features.length, refreshMs: SRC.refreshMs, sourceAt },
      export: { rows: exportRows(s), name: "war-zones-held-area" },
    });
  }, [report, s, updatedAt, ok, features.length, sourceAt]);

  const empty = emptyState(status, ok, s, features);
  if (empty) return <p className="tn-w-empty">{empty}</p>;

  return (
    <div className="tn-wz tn-wz-card">
      {s!.zones.map((z) => {
        const rows = lastDays(z.series, LINE_DAYS);
        return (
          <section key={z.id} className="tn-wz-zone" aria-label={`War zone: ${z.name}`}>
            <div className="tn-wz-row">
              <span className="tn-wz-name">{z.name}</span>
              <span className="tn-wz-meta" title={`${z.source}'s map published ${mapTime(z.mapAt)}`}>
                {z.source} map, {mapTime(z.mapAt)}
              </span>
            </div>
            {z.heldKm2 == null ? (
              <p className="tn-wz-contested">The held area of this map is not measured yet.</p>
            ) : (
              <>
                <div className="tn-wz-big">
                  {km(z.heldKm2)} km²<small>Russian-held</small>
                </div>
                <ChangeChips z={z} />
                {rows.length >= 2 && (
                  <div>
                    <AreaLine rows={rows} height={40} label={lineLabel(z, rows)} />
                    <div className="tn-wz-axis" aria-hidden>
                      <span>
                        {dayLabel(rows[0].day)}: {km(rows[0].heldKm2)}
                      </span>
                      <span>
                        {dayLabel(rows[rows.length - 1].day)}: {km(rows[rows.length - 1].heldKm2)}
                      </span>
                    </div>
                  </div>
                )}
                <div className="tn-wz-contested">
                  <i className="tn-wz-swatch contested" aria-hidden />
                  <span>
                    <b>{km(z.contestedKm2 ?? 0)} km²</b> contested, hatched on the map
                  </span>
                </div>
              </>
            )}
          </section>
        );
      })}
      <p className="tn-wz-foot">
        Measured from{" "}
        <a href={SRC.sourceUrl} target="_blank" rel="noreferrer">
          DeepState
        </a>
        &apos;s own maps. Not an official line.
      </p>
    </div>
  );
}

// --- the sketch (expanded view) -------------------------------------------------------------

type Ring = [number, number][];

function polygonsOf(g: GeoJSON.Geometry | SignalGeometry | undefined): Ring[][] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates as Ring[]];
  if (g.type === "MultiPolygon") return g.coordinates as Ring[][];
  return [];
}

interface Box {
  w: number;
  s: number;
  e: number;
  n: number;
}

function boxOf(features: SignalFeature[]): Box | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of features) {
    for (const p of polygonsOf(f.geometry)) {
      for (const [x, y] of p[0] ?? []) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
    }
  }
  if (!Number.isFinite(w)) return null;
  const pad = Math.max(e - w, n - s) * 0.04;
  return { w: w - pad, s: s - pad, e: e + pad, n: n + pad };
}

/**
 * The zone drawn from the layer's own polygons, on the country outlines the map loads
 * (public/geo/countries-110m.geojson): equirectangular, with longitude scaled by the
 * cosine of the middle latitude so the shape is not stretched. The 14-day front line
 * changes are soft discs, as on the map: an area, never a pin.
 */
function ZoneSketch({
  zoneId,
  features,
  changes,
}: {
  zoneId: string;
  features: SignalFeature[];
  changes: SignalFeature[];
}) {
  const pid = useId().replace(/:/g, "");
  const [outlines, setOutlines] = useState<Map<string, GeoJSON.Geometry> | null>(null);
  useEffect(() => {
    let live = true;
    void loadOutlines().then((m) => live && setOutlines(m));
    return () => {
      live = false;
    };
  }, []);

  const box = useMemo(() => boxOf(features), [features]);
  const drawn = useMemo(() => {
    if (!box) return null;
    const k = Math.cos((((box.s + box.n) / 2) * Math.PI) / 180);
    const px = (lon: number) => ((lon - box.w) * k).toFixed(3);
    const py = (lat: number) => (box.n - lat).toFixed(3);
    const path = (polys: Ring[][]) =>
      polys.map((p) => p.map((r) => `M${r.map(([x, y]) => `${px(x)},${py(y)}`).join("L")}Z`).join("")).join("");
    const byClass = { held: "", contested: "", retaken: "" };
    for (const f of features) {
      const cls = f.fill === "hatch" ? "contested" : f.color === WAR_ZONE_COLORS.liberated ? "retaken" : "held";
      byClass[cls] += path(polygonsOf(f.geometry));
    }
    const land: { iso3: string; d: string }[] = [];
    for (const [iso3, g] of outlines ?? []) {
      const polys = polygonsOf(g);
      const hit = polys.some((p) => p[0]?.some(([x, y]) => x >= box.w - 6 && x <= box.e + 6 && y >= box.s - 6 && y <= box.n + 6));
      if (hit) land.push({ iso3, d: path(polys) });
    }
    return {
      vw: (box.e - box.w) * k,
      vh: box.n - box.s,
      byClass,
      land,
      dots: changes.map((c) => ({ id: c.id, x: px(c.lon), y: py(c.lat), title: `${c.title}: ${String(c.props?.side ?? "")}` })),
    };
  }, [box, features, outlines, changes]);

  if (!drawn) return null;
  const hatch = drawn.vw / 150;
  const home = ZONE_COUNTRY[zoneId];
  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="tn-wz-sketch"
        viewBox={`0 0 ${drawn.vw.toFixed(3)} ${drawn.vh.toFixed(3)}`}
        role="img"
        aria-label="Sketch of the war zone: Russian-held ground in red, contested ground hatched, ground retaken by Ukraine in blue, and the front line changes of the last 14 days as amber discs."
      >
        <defs>
          <pattern id={`${pid}h`} patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={hatch} style={{ stroke: "var(--wz-contested)" }} strokeWidth={hatch * 0.45} />
          </pattern>
        </defs>
        {drawn.land.map((l) => (
          <path key={l.iso3} className={`land${l.iso3 === home ? " home" : ""}`} d={l.d} fillRule="evenodd" />
        ))}
        <path className="retaken" d={drawn.byClass.retaken} fillRule="evenodd" />
        <path className="held" d={drawn.byClass.held} fillRule="evenodd" />
        <path className="contested" d={drawn.byClass.contested} fill={`url(#${pid}h)`} fillRule="evenodd" />
        {drawn.dots.map((d) => (
          <circle key={d.id} cx={d.x} cy={d.y} r={drawn.vw / 140} style={{ fill: "var(--wz-change)", fillOpacity: 0.55, stroke: "var(--wz-change)" }} strokeWidth={drawn.vw / 600}>
            <title>{d.title}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="tn-wz-legend">
        <span>
          <i className="tn-wz-swatch held" aria-hidden />
          Russian-held
        </span>
        <span>
          <i className="tn-wz-swatch contested" aria-hidden />
          Contested, status unknown
        </span>
        <span>
          <i className="tn-wz-swatch retaken" aria-hidden />
          Retaken by Ukraine
        </span>
        {drawn.dots.length > 0 && (
          <span>
            <i className="tn-wz-swatch change" aria-hidden />
            Front line change, last {WINDOW_DAYS} days
          </span>
        )}
      </figcaption>
    </figure>
  );
}

// --- the expanded view ---------------------------------------------------------------

function WarZonesDetail(_props: WidgetDetailProps) {
  const { features, status, updatedAt, ok, sourceAt, s } = useWarZones();
  const changesFeed = useSignalFeed(FRONTLINE_CHANGES_SOURCE.id, FRONTLINE_CHANGES_SOURCE.refreshMs);
  const changes = useMemo(() => readFrontlineSummary(changesFeed.summary), [changesFeed.summary]);
  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: [],
      count: s?.zones.length ?? 0,
      fresh: { lastOk: updatedAt, ok, count: features.length, refreshMs: SRC.refreshMs, sourceAt },
      export: { rows: exportRows(s), name: "war-zones-held-area" },
    });
  }, [report, s, updatedAt, ok, features.length, sourceAt]);

  const now = Date.now();
  const fresh = freshness(updatedAt, SRC.refreshMs, now);
  const showOnMap = () => {
    signalsStore.set(SRC.id, true);
    shellLayoutStore.unfocus();
  };
  const rows = exportRows(s);
  const empty = emptyState(status, ok, s, features);
  // The calendar days the 14-day window touches: its first day is a partial one.
  const perDay = changes ? changes.perDay.slice(-(WINDOW_DAYS + 1)) : [];
  const attacks = s?.zones.reduce((n, z) => n + z.attacks, 0) ?? 0;

  return (
    <div className="tn-sd tn-wz">
      <header className="tn-sd-head">
        <div className="tn-sd-title">War zones</div>
        <div className="tn-sd-stat">
          <b>{s?.zones.length ?? 0}</b> war zone{s?.zones.length === 1 ? "" : "s"}, drawn by DeepState
          <span className={`tn-sd-fresh is-${fresh.state}`} title={`provenance-1 reads DeepState every ${Math.round(SRC.refreshMs / 60_000)} minutes`}>
            <i className="tn-sd-fresh-dot" />
            {fresh.label}
          </span>
        </div>
      </header>

      {empty && <p className="tn-wz-empty">{empty}</p>}

      {s?.zones.map((z) => {
        const line = lastDays(z.series, LINE_DAYS);
        const zoneFeatures = features.filter((f) => f.id.startsWith(`war-zones:${z.id}:`));
        return (
          <section key={z.id} style={{ display: "grid", gap: 14 }} aria-label={`War zone: ${z.name}`}>
            <h3 className="tn-wz-zonehead">
              {z.name}
              <span>
                {z.source}&apos;s map of {mapTime(z.mapAt)}
              </span>
            </h3>
            <div className="tn-sd-kpis">
              <div className="tn-sd-kpi">
                <div className="tn-sd-kpi-label">Russian-held</div>
                <div className="tn-sd-kpi-value">{z.heldKm2 == null ? "Not measured" : `${km(z.heldKm2)} km²`}</div>
                <div className="tn-sd-kpi-sub">Measured from this map</div>
              </div>
              <div className="tn-sd-kpi">
                <div className="tn-sd-kpi-label">Change in 30 days</div>
                <div className={`tn-sd-kpi-value${changeClass(z.change30)}`}>{z.change30 == null ? "Not measured yet" : `${signed(z.change30)} km²`}</div>
                <div className="tn-sd-kpi-sub">{z.change7 == null ? "7-day change not measured yet" : `${signed(z.change7)} km² in the last 7 days`}</div>
              </div>
              <div className="tn-sd-kpi">
                <div className="tn-sd-kpi-label">Contested</div>
                <div className="tn-sd-kpi-value">{z.contestedKm2 == null ? "Not measured" : `${km(z.contestedKm2)} km²`}</div>
                <div className="tn-sd-kpi-sub">Status unknown on DeepState, hatched</div>
              </div>
            </div>

            <div className="tn-sd-panels">
              <div className="tn-sd-panel">
                <h3>Russian-held area, {line.length > 1 ? `${line.length - 1} days` : "series"}</h3>
                {line.length >= 2 ? (
                  <>
                    <div className="tn-wz-yaxis">
                      <div aria-hidden>
                        <span>{km(Math.max(...line.map((r) => r.heldKm2)))}</span>
                        <span>{km(Math.min(...line.map((r) => r.heldKm2)))}</span>
                      </div>
                      <AreaLine rows={line} height={150} label={lineLabel(z, line)} />
                    </div>
                    <div className="tn-wz-axis" aria-hidden>
                      <span>{dayLabel(line[0].day)}</span>
                      <span>{dayLabel(line[Math.floor(line.length / 2)].day)}</span>
                      <span>{dayLabel(line[line.length - 1].day)}</span>
                    </div>
                    <p className="tn-wz-note">The scale starts at {km(Math.min(...line.map((r) => r.heldKm2)))} km², not at zero.</p>
                  </>
                ) : (
                  <p className="tn-wz-note">The series has fewer than two days so far. It grows by one row a day.</p>
                )}
              </div>
              <div className="tn-sd-panel">
                <h3>Front line changes per day, last {WINDOW_DAYS} days</h3>
                {changes ? (
                  <DayBars days={perDay} />
                ) : (
                  <p className="tn-wz-note">
                    {changesFeed.status === "loading" ? "Loading the front line changes…" : "The front line changes are unavailable right now."}
                  </p>
                )}
              </div>
            </div>

            <ZoneSketch zoneId={z.id} features={zoneFeatures} changes={changesFeed.features} />
          </section>
        );
      })}

      {s && s.zones.length > 0 && (
        <table className="tn-sd-table">
          <thead>
            <tr>
              <th scope="col">War zone</th>
              <th scope="col">Russian-held</th>
              <th scope="col">7 days</th>
              <th scope="col">30 days</th>
              <th scope="col">90 days</th>
              <th scope="col">Contested</th>
              <th scope="col">Map date</th>
            </tr>
          </thead>
          <tbody>
            {s.zones.map((z) => (
              <tr key={z.id}>
                <td>{z.name}</td>
                <td>{z.heldKm2 == null ? "Not measured" : `${km(z.heldKm2)} km²`}</td>
                <td>{z.change7 == null ? "Not yet" : signed(z.change7)}</td>
                <td>{z.change30 == null ? "Not yet" : signed(z.change30)}</td>
                <td>{z.change90 == null ? "Not yet" : signed(z.change90)}</td>
                <td>{z.contestedKm2 == null ? "Not measured" : `${km(z.contestedKm2)} km²`}</td>
                <td>{mapTime(z.mapAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {s && s.zones.length > 0 && (
        <p className="tn-wz-note">
          Areas are measured on provenance-1 from DeepState&apos;s own past maps, the last map of each day. DeepState&apos;s
          political shapes (East Prussia, Karelia, Abkhazia and others) are not drawn or counted. DeepState also marks{" "}
          {attacks} directions of attack; they are not drawn, because its data does not give their direction.
        </p>
      )}

      <footer className="tn-sd-foot">
        <span className="tn-sd-attr">
          {SRC.attribution}. Credited and linked; it comes off on request.{" "}
          <a href={SRC.sourceUrl} target="_blank" rel="noreferrer">
            Open DeepState&apos;s map
          </a>
        </span>
        <span className="tn-sd-actions">
          <button onClick={showOnMap}>Show on map</button>
          <button
            disabled={!rows.length}
            onClick={() => downloadText(`${exportFilename("war-zones-held-area", Date.now())}.csv`, "text/csv", toCsv(rows))}
          >
            Download CSV
          </button>
        </span>
      </footer>
    </div>
  );
}

export const Card = WarZonesCard;
export const Detail = WarZonesDetail;
