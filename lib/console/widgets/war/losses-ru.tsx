"use client";
// lib/console/widgets/war/losses-ru.tsx
// Vehicle losses, Russian: the card the rail's ＋ places, and its expanded view.
// Reads the layer's own feed (features = located losses of the last 30 days) and its
// summary (lib/signals/losses-ru.ts): WarSpotting's record, the General Staff's claims,
// and the hand-made match between their categories. Styles: the "Vehicle losses"
// block in app/globals.css (.tn-loss*). Do not import ../signals.tsx here (circular).
//
// Three things every view here keeps: a claim is attributed to the General Staff, never
// stated as a loss; a row with no geolocation is listed with a hollow mark and never
// put on the map; and the category match is said to be made by hand.
import { useEffect, useMemo } from "react";
import type { WidgetBodyProps, WidgetDetailProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { freshness } from "@/lib/console/signals/signalDetail";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";
import { signalsStore } from "@/lib/signals/store";
import { shellLayoutStore } from "@/lib/console/store";
import { openSignalFeature } from "@/lib/widgets/openSignal";
import { toCsv, downloadText, exportFilename } from "@/lib/export";
import type { SignalFeature } from "@/lib/signals/types";
import {
  LOSSES_RU_SOURCE as SOURCE,
  readLossesRuSummary,
  type ClaimRow,
  type LossRuRow,
  type LossesRuSummary,
} from "@/lib/signals/losses-ru";

// ── Shared by both loss widgets (losses-ua.tsx imports these) ───────────────

export const fmt = (n: number) => n.toLocaleString("en-GB");

/** "today", "1d", "12d": whole UTC days from an ISO day to now. */
export function dayAge(day: string, now: number): string {
  const days = Math.floor((now - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  return days <= 0 ? "today" : `${days}d`;
}

/** "28 Oct" (and the year when it is not this one). */
export function shortDay(day: string, now: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

/** "read 20 min ago": how long since provenance-1 read the upstream. */
export function readAgo(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 2) return "read just now";
  if (mins < 120) return `read ${mins} min ago`;
  return `read ${Math.round(mins / 60)} h ago`;
}

/** The honest states of a body that has no summary to draw: loading, failed, or a
 *  feed that answered without the figures this layer reads. */
export function FeedState({ label, status }: { label: string; status: string }) {
  if (status === "loading") return <p className="tn-w-empty">Loading {label}…</p>;
  if (status === "error") return <p className="tn-w-empty">{label} unavailable.</p>;
  return <p className="tn-w-empty">{label}: the feed answered without the figures this view reads.</p>;
}

// ── This layer ──────────────────────────────────────────────────────────────

function useLossesRu() {
  const feed = useSignalFeed(SOURCE.id, SOURCE.refreshMs);
  const summary = useMemo(() => readLossesRuSummary(feed.summary), [feed.summary]);
  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: [],
      count: summary?.window.total,
      fresh: { lastOk: feed.updatedAt, ok: feed.ok, count: feed.features.length, refreshMs: SOURCE.refreshMs, sourceAt: feed.sourceAt },
    });
  }, [report, summary, feed.updatedAt, feed.ok, feed.features.length, feed.sourceAt]);
  return { ...feed, summary };
}

function statusWord(status: string) {
  return status.toLowerCase();
}

/** One claimed-against-documented bar: the hatched track is the claim, the solid part what is documented. */
function ClaimBar({ row }: { row: ClaimRow }) {
  const share = row.claimed > 0 ? Math.min(100, (row.documented / row.claimed) * 100) : 0;
  return (
    <div className="tn-loss-gap" role="img" aria-label={`${row.label}: ${fmt(row.documented)} documented by WarSpotting, ${fmt(row.claimed)} claimed by the General Staff`}>
      <span className="tn-loss-gap-name">{row.label}</span>
      <span className="tn-loss-gb" aria-hidden><i style={{ width: `${share}%` }} /></span>
      <span className="tn-loss-gn" aria-hidden><b>{fmt(row.documented)}</b> of {fmt(row.claimed)}</span>
    </div>
  );
}

/** Filled: on the map. Hollow: not on it. Shape and label carry it, not colour alone. */
function LossMark({ on }: { on: boolean }) {
  return <span className={`tn-loss-dot${on ? "" : " is-off"}`} role="img" aria-label={on ? "On the map" : "Not on the map"} />;
}

/** On the map = geolocated AND inside the map's window of days. */
const onMap = (r: LossRuRow, from: string) => r.located && r.date >= from;

function RecentList({ rows, now, max, from }: { rows: LossRuRow[]; now: number; max: number; from: string }) {
  return (
    <ul className="tn-loss-list">
      {rows.slice(0, max).map((r) => (
        <li key={r.id}>
          <LossMark on={onMap(r, from)} />
          <span className="t">{r.model}, {statusWord(r.status)}</span>
          <span className="a">{dayAge(r.date, now)}</span>
          <span className="s">{r.place ?? r.type}</span>
        </li>
      ))}
    </ul>
  );
}

const CARD_BARS = ["tanks", "armoured_fighting_vehicles"];

function LossesRuCard(_props: WidgetBodyProps) {
  const { status, summary } = useLossesRu();
  if (!summary) return <FeedState label={SOURCE.label} status={status} />;
  const now = Date.now();
  const bars = summary.claims?.rows.filter((r) => CARD_BARS.includes(r.key)) ?? [];
  return (
    <div className="tn-loss">
      {bars.length > 0 ? (
        <>
          <p className="tn-loss-k">Claimed by Ukraine&apos;s General Staff against documented by WarSpotting, all time</p>
          {bars.map((r) => <ClaimBar key={r.key} row={r} />)}
        </>
      ) : (
        <p className="tn-loss-k">Documented by WarSpotting, all time: <b>{fmt(summary.allTime.total)}</b>. The General Staff&apos;s claimed totals have not arrived.</p>
      )}
      <p className="tn-loss-k tn-loss-window">
        Last {summary.window.days} days: <b>{fmt(summary.window.total)}</b> documented, <b>{fmt(summary.window.located)}</b> with a location (filled marks are on the map)
      </p>
      {summary.recent.length > 0 ? <RecentList rows={summary.recent} now={now} max={8} from={summary.window.from} /> : <p className="tn-w-empty">No loss documented since {summary.historyFrom}.</p>}
    </div>
  );
}

function LossesRuDetail(_props: WidgetDetailProps) {
  const { status, summary, features } = useLossesRu();
  const now = Date.now();
  const byId = useMemo(() => new Map(features.map((f) => [f.id, f])), [features]);
  if (!summary) {
    return (
      <div className="tn-sd tn-loss-x">
        <header className="tn-sd-head"><div className="tn-sd-title">{SOURCE.label}</div></header>
        <FeedState label={SOURCE.label} status={status} />
      </div>
    );
  }
  // The chip ages from when provenance-1 READ WarSpotting, not from this browser's poll.
  const fresh = freshness(Date.parse(summary.fetchedAt), SOURCE.refreshMs, now);
  const claims = summary.claims;
  const byStatus = summary.allTime.byStatus;
  const typeMax = Math.max(1, ...summary.window.byType.map((t) => t.count));
  const mapPoints: InsetPoint[] = features.map((f) => ({ lat: f.lat, lon: f.lon, id: f.id, color: f.color ?? SOURCE.color, props: { title: f.title } }));
  const show = (f: SignalFeature) => { openSignalFeature(f, SOURCE.label); shellLayoutStore.unfocus(); };
  const exportRows = summary.recent.map((r) => ({ id: r.id, model: r.model, type: r.type, status: r.status, date: r.date, place: r.place ?? "", located: r.located, record: r.link }));

  return (
    <div className="tn-sd tn-loss-x">
      <header className="tn-sd-head">
        <div className="tn-sd-title">{SOURCE.label}</div>
        <div className="tn-sd-stat">
          <b>{fmt(summary.window.total)}</b> documented in {summary.window.days} days, {fmt(summary.window.located)} on the map
          <span className={`tn-sd-fresh is-${fresh.state}`} title={`WarSpotting ${readAgo(summary.fetchedAt, now)} by provenance-1`}>
            <i className="tn-sd-fresh-dot" />WarSpotting {readAgo(summary.fetchedAt, now)}
          </span>
        </div>
      </header>

      <div className="tn-sd-kpis">
        <div className="tn-sd-kpi">
          <div className="tn-sd-kpi-label">Documented, all time</div>
          <div className="tn-sd-kpi-value">{fmt(summary.allTime.total)}</div>
          <div className="tn-sd-kpi-sub">
            {fmt(byStatus.destroyed ?? 0)} destroyed, {fmt(byStatus.captured ?? 0)} captured, {fmt(byStatus.abandoned ?? 0)} abandoned, {fmt(byStatus.damaged ?? 0)} damaged
          </div>
        </div>
        <div className="tn-sd-kpi">
          <div className="tn-sd-kpi-label">Last {summary.window.days} days</div>
          <div className="tn-sd-kpi-value">{fmt(summary.window.total)}</div>
          <div className="tn-sd-kpi-sub">{fmt(summary.window.located)} with a location; WarSpotting adds losses for past days as footage appears</div>
        </div>
        <div className="tn-sd-kpi">
          <div className="tn-sd-kpi-label">Claimed on {claims ? shortDay(claims.date, now) : "the latest day"}</div>
          {claims ? <ClaimedToday claims={claims} /> : <div className="tn-sd-kpi-value">Not received</div>}
          <div className="tn-sd-kpi-sub">{claims ? `General Staff of Ukraine, day ${fmt(claims.day)} of the full-scale war` : "The General Staff's totals have not reached this server."}</div>
        </div>
      </div>

      <section className="tn-loss-sec" aria-labelledby="tn-loss-ru-claims">
        <h3 id="tn-loss-ru-claims">Claimed against documented, all time</h3>
        {claims && claims.rows.length > 0 ? (
          <>
            <table className="tn-sd-table tn-loss-table">
              <thead>
                <tr><th scope="col">Category</th><th scope="col">Claimed</th><th scope="col">Documented</th><th scope="col">Claimed ÷ documented</th></tr>
              </thead>
              <tbody>
                {claims.rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row">{r.label}<span className="tn-loss-match">WarSpotting: {r.documentedTypes.join(" + ")}</span></th>
                    <td>{fmt(r.claimed)}</td>
                    <td>{fmt(r.documented)}</td>
                    <td className="tn-loss-ratio">{r.ratio == null ? "none documented" : `${r.ratio.toFixed(1)}×`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tn-loss-note">
              The two sources group vehicles differently, so these categories are matched by hand, as each row shows.
              Categories with no fair match (drones, special equipment, missiles, personnel) are left out.
              Claimed: the General Staff of Ukraine, a party to the war, as of {shortDay(claims.date, now)}
              {claims.crossCheck ? `, the same figures as index.minfin.com.ua for that day` : `; not yet cross-checked against index.minfin.com.ua`}.
              Documented: losses WarSpotting shows with a photo or video, not counting the ones it lists as damaged.
            </p>
          </>
        ) : (
          <p className="tn-w-empty">The General Staff&apos;s claimed totals have not reached this server, so there is nothing to set beside the record yet.</p>
        )}
      </section>

      <div className="tn-sd-panels">
        <section className="tn-sd-panel" aria-labelledby="tn-loss-ru-types">
          <h3 id="tn-loss-ru-types">Last {summary.window.days} days by type</h3>
          {summary.window.byType.length > 0 ? (
            <div className="tn-loss-cat is-ru">
              {summary.window.byType.map((t) => (
                <div key={t.type} className="tn-loss-cat-row">
                  <span>{t.type}</span>
                  <span className="b" aria-hidden><i style={{ width: `${(t.count / typeMax) * 100}%` }} /></span>
                  <span className="n">{fmt(t.count)}</span>
                </div>
              ))}
            </div>
          ) : <p className="tn-w-empty">None documented in these days.</p>}
        </section>
        <section className="tn-sd-panel" aria-labelledby="tn-loss-ru-map">
          <h3 id="tn-loss-ru-map">On the map, {fmt(mapPoints.length)} located</h3>
          {mapPoints.length > 0 ? (
            <InsetMap points={mapPoints} height={220} onSelect={(id) => { const f = byId.get(id); if (f) show(f); }} />
          ) : <p className="tn-w-empty">No loss in these days has a geolocation.</p>}
        </section>
      </div>

      <section className="tn-loss-sec" aria-labelledby="tn-loss-ru-recent">
        <h3 id="tn-loss-ru-recent">Recent losses, located or not</h3>
        <table className="tn-sd-table tn-loss-table">
          <thead>
            <tr><th scope="col">Vehicle</th><th scope="col">Status</th><th scope="col">Nearest place</th><th scope="col">Date</th><th scope="col">Map</th><th scope="col">Evidence</th></tr>
          </thead>
          <tbody>
            {summary.recent.map((r) => {
              const f = byId.get(`warspotting:${r.id}`);
              return (
                <tr key={r.id}>
                  <th scope="row">{r.model}<span className="tn-loss-match">{r.type}</span></th>
                  <td>{r.status}</td>
                  <td className="w">{r.place ?? "Not given"}</td>
                  <td>{shortDay(r.date, now)}</td>
                  <td>
                    {f ? (
                      <button type="button" className="tn-loss-show" onClick={() => show(f)} aria-label={`Show ${r.model} on the map`}><LossMark on />Show</button>
                    ) : (
                      <span className="tn-loss-off"><LossMark on={false} />{r.located ? `Located, older than ${summary.window.days} days` : "No location"}</span>
                    )}
                  </td>
                  <td><a href={r.link} target="_blank" rel="noreferrer">WarSpotting ↗</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <footer className="tn-sd-foot">
        <span className="tn-sd-attr">{SOURCE.attribution}, via russianwarship.rip. History held since {shortDay(summary.historyFrom, now)}.</span>
        <span className="tn-sd-actions">
          <button type="button" onClick={() => { signalsStore.set(SOURCE.id, true); shellLayoutStore.unfocus(); }}>Show on map</button>
          <button type="button" disabled={!exportRows.length} onClick={() => downloadText(`${exportFilename("losses-ru", Date.now())}.csv`, "text/csv", toCsv(exportRows))}>Download CSV</button>
        </span>
      </footer>
    </div>
  );
}

function ClaimedToday({ claims }: { claims: NonNullable<LossesRuSummary["claims"]> }) {
  const change = (key: string) => claims.rows.find((r) => r.key === key)?.claimedChange ?? 0;
  const tanks = change("tanks");
  return (
    <>
      <div className="tn-sd-kpi-value">+{fmt(tanks)} {tanks === 1 ? "tank" : "tanks"}</div>
      <div className="tn-sd-kpi-sub">+{fmt(change("armoured_fighting_vehicles"))} armoured vehicles, +{fmt(change("artillery_systems"))} artillery</div>
    </>
  );
}

export const Card = LossesRuCard;
export const Detail = LossesRuDetail;
