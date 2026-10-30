"use client";
// lib/console/widgets/war/losses-ua.tsx
// Vehicle losses, Ukrainian: the card the rail's ＋ places, and its expanded view.
// The record is LostArmour's, a Russian-side project, and every line here says so.
// Names are shown in English where the sender's fixed tables could say it, with the
// Russian name kept beside it; otherwise in Russian. There is no "claimed" column, and
// the expanded view says why. Styles: the "Vehicle losses" block in app/globals.css.
// Do not import ../signals.tsx here (circular).
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
import { LOSSES_UA_SOURCE as SOURCE, readLossesUaSummary, type LossUaRow, type LossesUaSummary } from "@/lib/signals/losses-ua";
import { FeedState, dayAge, fmt, readAgo, shortDay } from "./losses-ru";

function useLossesUa() {
  const feed = useSignalFeed(SOURCE.id, SOURCE.refreshMs);
  const summary = useMemo(() => readLossesUaSummary(feed.summary), [feed.summary]);
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

const statusWord = (r: LossUaRow) => (r.status ? r.status.toLowerCase() : "status not given");

function Diamond() {
  return <span className="tn-loss-dia" role="img" aria-label="On the map" />;
}

function CategoryBars({ summary }: { summary: LossesUaSummary }) {
  const max = Math.max(1, ...summary.window.byCategory.map((c) => c.count));
  return (
    <div className="tn-loss-cat is-ua">
      {summary.window.byCategory.map((c) => (
        <div key={c.category} className="tn-loss-cat-row">
          <span>{c.category}</span>
          <span className="b" aria-hidden><i style={{ width: `${(c.count / max) * 100}%` }} /></span>
          <span className="n">{fmt(c.count)}</span>
        </div>
      ))}
    </div>
  );
}

function LossesUaCard(_props: WidgetBodyProps) {
  const { status, summary } = useLossesUa();
  if (!summary) return <FeedState label={SOURCE.label} status={status} />;
  const now = Date.now();
  return (
    <div className="tn-loss">
      <p className="tn-loss-k">
        Documented by LostArmour, the Russian side. Last {summary.window.days} days: <b>{fmt(summary.window.total)}</b>, all located.
      </p>
      {summary.window.total > 0 ? <CategoryBars summary={summary} /> : <p className="tn-w-empty">None documented in these days.</p>}
      <ul className="tn-loss-list">
        {summary.recent.slice(0, 8).map((r) => (
          <li key={r.id}>
            <Diamond />
            <span className="t" lang={guessLang(r.name)}>
              {r.name}
            </span>
            <span className="a">{dayAge(r.date, now)}</span>
            <span className="s">{r.category}, {statusWord(r)}. Russian-side record{r.translated ? <>. Russian name <span lang="ru">{r.nameRu}</span></> : null}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A name with Cyrillic in it is marked Russian for screen readers. */
function guessLang(name: string): string | undefined {
  return /[Ѐ-ӿ]/.test(name) ? "ru" : undefined;
}

function LossesUaDetail(_props: WidgetDetailProps) {
  const { status, summary, features } = useLossesUa();
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
  const fresh = freshness(Date.parse(summary.fetchedAt), SOURCE.refreshMs, now);
  const top = summary.window.byCategory[0];
  const newest = summary.recent[0];
  const mapPoints: InsetPoint[] = features.map((f) => ({ lat: f.lat, lon: f.lon, id: f.id, color: f.color ?? SOURCE.color, props: { title: f.title } }));
  const show = (f: SignalFeature) => { openSignalFeature(f, SOURCE.label); shellLayoutStore.unfocus(); };
  const exportRows = summary.recent.map((r) => ({ id: r.id, name: r.nameRu, nameEnglish: r.translated ? r.name : "", category: r.category, status: r.status ?? "", date: r.date, lat: r.lat, lon: r.lon, record: r.link, documentedBy: "LostArmour (Russian side)" }));

  return (
    <div className="tn-sd tn-loss-x">
      <header className="tn-sd-head">
        <div className="tn-sd-title">{SOURCE.label}</div>
        <div className="tn-sd-stat">
          <b>{fmt(summary.window.total)}</b> documented by the Russian side in {summary.window.days} days, all on the map
          <span className={`tn-sd-fresh is-${fresh.state}`} title={`The KML ${readAgo(summary.fetchedAt, now)} by provenance-1`}>
            <i className="tn-sd-fresh-dot" />LostArmour {readAgo(summary.fetchedAt, now)}
          </span>
        </div>
      </header>

      <div className="tn-sd-kpis">
        <div className="tn-sd-kpi">
          <div className="tn-sd-kpi-label">Last {summary.window.days} days</div>
          <div className="tn-sd-kpi-value">{fmt(summary.window.total)}</div>
          <div className="tn-sd-kpi-sub">{top ? `Most: ${top.category.toLowerCase()}, ${fmt(top.count)}` : "None documented"}</div>
        </div>
        <div className="tn-sd-kpi">
          <div className="tn-sd-kpi-label">Since {shortDay(summary.historyFrom, now)}</div>
          <div className="tn-sd-kpi-value">{fmt(summary.yearTotal)}</div>
          <div className="tn-sd-kpi-sub">Located records with a LostArmour page</div>
        </div>
        <div className="tn-sd-kpi">
          <div className="tn-sd-kpi-label">Newest record</div>
          <div className="tn-sd-kpi-value">{newest ? shortDay(newest.date, now) : "None"}</div>
          <div className="tn-sd-kpi-sub">{newest ? `${newest.name}, ${statusWord(newest)}` : ""}</div>
        </div>
      </div>

      <p className="tn-loss-note">
        LostArmour is a Russian project that records Ukrainian losses from photos and videos, most of them posted by Russian units.
        No neutral party has checked these records. There is no &quot;claimed&quot; column here because this layer has no source for
        the Russian side&apos;s claimed totals; only what LostArmour documents is shown.
      </p>

      <div className="tn-sd-panels">
        <section className="tn-sd-panel" aria-labelledby="tn-loss-ua-cats">
          <h3 id="tn-loss-ua-cats">Last {summary.window.days} days by category</h3>
          {summary.window.total > 0 ? <CategoryBars summary={summary} /> : <p className="tn-w-empty">None documented in these days.</p>}
        </section>
        <section className="tn-sd-panel" aria-labelledby="tn-loss-ua-map">
          <h3 id="tn-loss-ua-map">On the map, {fmt(mapPoints.length)}</h3>
          {mapPoints.length > 0 ? (
            <InsetMap points={mapPoints} height={220} onSelect={(id) => { const f = byId.get(id); if (f) show(f); }} />
          ) : <p className="tn-w-empty">Nothing to draw in these days.</p>}
        </section>
      </div>

      <section className="tn-loss-sec" aria-labelledby="tn-loss-ua-recent">
        <h3 id="tn-loss-ua-recent">Recent losses</h3>
        <table className="tn-sd-table tn-loss-table">
          <thead>
            <tr><th scope="col">Vehicle</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col">Map</th><th scope="col">Record</th></tr>
          </thead>
          <tbody>
            {summary.recent.map((r) => {
              const f = byId.get(`lostarmour:${r.id}`);
              return (
                <tr key={r.id}>
                  <th scope="row">
                    {r.name}
                    {r.translated && <span className="tn-loss-match" lang="ru">{r.nameRu}</span>}
                  </th>
                  <td className="w">{r.category}</td>
                  <td>{r.status ?? "Not given"}</td>
                  <td>{shortDay(r.date, now)}</td>
                  <td>
                    {f ? (
                      <button type="button" className="tn-loss-show" onClick={() => show(f)} aria-label={`Show ${r.name} on the map`}><Diamond />Show</button>
                    ) : (
                      <span className="tn-loss-off">Older than {summary.window.days} days</span>
                    )}
                  </td>
                  <td>
                    <a href={r.link} target="_blank" rel="noreferrer">LostArmour ↗</a>
                    {r.cited > 0 && <span className="tn-loss-match">cites {r.cited} {r.cited === 1 ? "post" : "posts"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <footer className="tn-sd-foot">
        <span className="tn-sd-attr">{SOURCE.attribution}. Names translated from Russian with fixed tables; the Russian name is kept.</span>
        <span className="tn-sd-actions">
          <button type="button" onClick={() => { signalsStore.set(SOURCE.id, true); shellLayoutStore.unfocus(); }}>Show on map</button>
          <button type="button" disabled={!exportRows.length} onClick={() => downloadText(`${exportFilename("losses-ua", Date.now())}.csv`, "text/csv", toCsv(exportRows))}>Download CSV</button>
        </span>
      </footer>
    </div>
  );
}

export const Card = LossesUaCard;
export const Detail = LossesUaDetail;
