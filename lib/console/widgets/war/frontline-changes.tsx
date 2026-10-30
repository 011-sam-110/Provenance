"use client";
// lib/console/widgets/war/frontline-changes.tsx
// The Front line changes card and its expanded view.
//
// CARD: how many spots DeepState logged in the last 14 days, by side, then one row per
// DeepState update in its own words, newest first. A row opens that spot's dossier and
// flies the map to it. EXPANDED: the mini-map of the spots, the changes per day over the
// 60 days the relay holds, and the full list, each spot linked to DeepState's own map at
// that place. Updates older than 14 days are listed under a divider: they are not on the map.
//
// The side is DeepState's sentence read by the sender ("The enemy has advanced" is a
// Russian advance); the badge says which, so colour is never the only cue. Do not import
// ../signals.tsx here.
import { useEffect, useMemo, useState } from "react";
import type { WidgetBodyProps, WidgetDetailProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { freshness } from "@/lib/console/signals/signalDetail";
import { signalsStore } from "@/lib/signals/store";
import { shellLayoutStore } from "@/lib/console/store";
import { openSignalFeature } from "@/lib/widgets/openSignal";
import { downloadText, exportFilename, toCsv } from "@/lib/export";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";
import type { SignalFeature } from "@/lib/signals/types";
import {
  FRONTLINE_CHANGES_SOURCE,
  WINDOW_DAYS,
  entrySides,
  readFrontlineSummary,
  type FrontlineDay,
  type FrontlineEntry,
  type FrontlineSide,
  type FrontlineSummary,
} from "@/lib/signals/frontline-changes";

const SRC = FRONTLINE_CHANGES_SOURCE;
const DAY_MS = 86_400_000;

/** The badge words: short, and always beside the mark. */
const SIDE_BADGE: Record<FrontlineSide, string> = { ru: "RU advance", ua: "UA gain", unknown: "No side stated" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (day: string) => {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
function whenLabel(iso: string): string {
  const t = new Date(iso);
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}, ${hh}:${mm} UTC`;
}
function ageLabel(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 172_800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

function inWindow(s: FrontlineSummary): FrontlineEntry[] {
  const end = Date.parse(s.windowEnd);
  return s.entries.filter((e) => {
    const t = Date.parse(e.at);
    return t <= end && t >= end - s.windowDays * DAY_MS;
  });
}

function exportRows(s: FrontlineSummary | null): Record<string, unknown>[] {
  if (!s) return [];
  return s.entries.flatMap((e) =>
    e.spots.map((p) => ({ at: e.at, place: p.place, side: p.side, lat: p.lat, lon: p.lon, deepState: e.text, link: p.link })),
  );
}

// --- shared pieces -------------------------------------------------------------------------

function Mark({ side }: { side: FrontlineSide }) {
  return <i className={`tn-flc-mark ${side}`} aria-hidden />;
}

function SideBadge({ side }: { side: FrontlineSide }) {
  return <span className={`tn-flc-side ${side}`}>{SIDE_BADGE[side]}</span>;
}

/**
 * Spots per day, stacked by side, in the map's own colours, with a legend in words. Read
 * by the War zones expanded view too. The label states the totals for a screen reader.
 */
export function DayBars({ days, height = 110 }: { days: FrontlineDay[]; height?: number }) {
  if (days.length === 0) return null;
  const totals = days.map((d) => d.ru + d.ua + d.unknown);
  const max = Math.max(1, ...totals);
  const sum = { ru: 0, ua: 0, unknown: 0 };
  for (const d of days) {
    sum.ru += d.ru;
    sum.ua += d.ua;
    sum.unknown += d.unknown;
  }
  const label = `Front line changes per day from ${dayLabel(days[0].day)} to ${dayLabel(days[days.length - 1].day)}: ${plural(
    sum.ru,
    "Russian advance",
    "Russian advances",
  )}, ${plural(sum.ua, "Ukrainian gain", "Ukrainian gains")}, ${sum.unknown} with no side stated.`;
  return (
    <div>
      <div className="tn-flc-bars" style={{ height }} role="img" aria-label={label}>
        {days.map((d) => {
          const total = d.ru + d.ua + d.unknown;
          const title = `${dayLabel(d.day)}: ${total === 0 ? "no change logged" : [d.ru && `${d.ru} RU`, d.ua && `${d.ua} UA`, d.unknown && `${d.unknown} no side`].filter(Boolean).join(", ")}`;
          return (
            <div key={d.day} className="tn-flc-bar" title={title}>
              {(["ru", "ua", "unknown"] as const).map((k) =>
                d[k] > 0 ? <i key={k} className={k} style={{ height: `${(d[k] / max) * 100}%` }} /> : null,
              )}
            </div>
          );
        })}
      </div>
      <div className="tn-wz-axis" aria-hidden>
        <span>{dayLabel(days[0].day)}</span>
        <span>Most in a day: {max}</span>
        <span>{dayLabel(days[days.length - 1].day)}</span>
      </div>
      <div className="tn-wz-legend" aria-hidden>
        <span>
          <Mark side="ru" />
          Russian advance ({sum.ru})
        </span>
        <span>
          <Mark side="ua" />
          Ukrainian gain ({sum.ua})
        </span>
        {sum.unknown > 0 && (
          <span>
            <Mark side="unknown" />
            No side stated ({sum.unknown})
          </span>
        )}
      </div>
    </div>
  );
}

function Counts({ s }: { s: FrontlineSummary }) {
  return (
    <ul className="tn-wz-chips" aria-label={`Spots logged in the last ${s.windowDays} days, by side`}>
      <li className={`tn-wz-chip${s.counts.ru ? " is-ru" : ""}`}>
        <b>{plural(s.counts.ru, "Russian advance", "Russian advances")}</b>
      </li>
      <li className={`tn-wz-chip${s.counts.ua ? " is-ua" : ""}`}>
        <b>{plural(s.counts.ua, "Ukrainian gain", "Ukrainian gains")}</b>
      </li>
      {s.counts.unknown > 0 && (
        <li className="tn-wz-chip">
          <b>{s.counts.unknown}</b> with no side stated
        </li>
      )}
    </ul>
  );
}

function useFrontline() {
  const feed = useSignalFeed(SRC.id, SRC.refreshMs);
  const s = useMemo(() => readFrontlineSummary(feed.summary), [feed.summary]);
  return { ...feed, s };
}

function emptyState(status: string, ok: boolean, s: FrontlineSummary | null): string | null {
  if (s) return null;
  if (status === "loading") return "Loading Front line changes…";
  if (!ok || status === "error")
    return "Front line changes unavailable: no DeepState change log has reached this server yet. provenance-1 sends one every 30 minutes.";
  return "The change log arrived without its list of updates.";
}

/** Open the dossier of an update's first spot that is on the map, and fly there. */
function openEntry(entry: FrontlineEntry, features: SignalFeature[]): void {
  const f = features.find((x) => x.id.startsWith(`frontline-changes:${entry.id}:`));
  if (f) openSignalFeature(f, SRC.label, 11);
}

// --- the card -------------------------------------------------------------------------

function FrontlineChangesCard(_props: WidgetBodyProps) {
  const { features, status, updatedAt, ok, sourceAt, s } = useFrontline();
  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: [],
      count: features.length,
      fresh: { lastOk: updatedAt, ok, count: features.length, refreshMs: SRC.refreshMs, sourceAt },
      export: { rows: exportRows(s), name: "frontline-changes" },
    });
  }, [report, s, updatedAt, ok, features.length, sourceAt]);

  const empty = emptyState(status, ok, s);
  if (empty) return <p className="tn-w-empty">{empty}</p>;
  const now = Date.now();
  const recent = inWindow(s!);

  return (
    <div className="tn-flc tn-flc-card">
      <Counts s={s!} />
      <div className="tn-flc-window">
        Last {s!.windowDays} days, from {plural(s!.updates, "DeepState update", "DeepState updates")}
      </div>
      {recent.length === 0 ? (
        <p className="tn-w-empty">
          DeepState logged no change with a map link in the last {s!.windowDays} days.
          {s!.newestAt ? ` Its newest is from ${whenLabel(s!.newestAt)}.` : ""}
        </p>
      ) : (
        <ul className="tn-flc-list">
          {recent.map((e) => {
            const sides = entrySides(e);
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className="tn-flc-row"
                  onClick={() => openEntry(e, features)}
                  aria-label={`${sides.map((x) => SIDE_BADGE[x]).join(" and ")}, ${whenLabel(e.at)}: ${e.text} Show on the map.`}
                >
                  <Mark side={sides[0]} />
                  <span className="tn-flc-text">{e.text}</span>
                  <time className="tn-flc-age" dateTime={e.at} title={whenLabel(e.at)}>
                    {ageLabel(e.at, now)}
                  </time>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="tn-wz-foot">
        In{" "}
        <a href={SRC.sourceUrl} target="_blank" rel="noreferrer">
          DeepState
        </a>
        &apos;s words. Each ring sits where its link centres the map, not on a measured spot.
      </p>
    </div>
  );
}

// --- the expanded view ---------------------------------------------------------------

function FrontlineChangesDetail(_props: WidgetDetailProps) {
  const { features, status, updatedAt, ok, sourceAt, s } = useFrontline();
  const [selected, setSelected] = useState<number | null>(null);
  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: [],
      count: features.length,
      fresh: { lastOk: updatedAt, ok, count: features.length, refreshMs: SRC.refreshMs, sourceAt },
      export: { rows: exportRows(s), name: "frontline-changes" },
    });
  }, [report, s, updatedAt, ok, features.length, sourceAt]);

  const now = Date.now();
  const fresh = freshness(updatedAt, SRC.refreshMs, now);
  const points: InsetPoint[] = useMemo(
    () =>
      features.map((f) => ({
        id: f.id,
        lat: f.lat,
        lon: f.lon,
        color: f.color ?? SRC.color,
        props: { title: f.title },
      })),
    [features],
  );
  const rows = exportRows(s);
  const empty = emptyState(status, ok, s);
  const windowStart = s ? Date.parse(s.windowEnd) - s.windowDays * DAY_MS : 0;
  const firstOld = s ? s.entries.findIndex((e) => Date.parse(e.at) < windowStart) : -1;

  const selectFromMap = (featureId: string) => {
    const id = Number(featureId.split(":")[1]);
    if (!Number.isFinite(id)) return;
    setSelected(id);
    requestAnimationFrame(() => document.getElementById(`flc-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const selectedFeature = selected == null ? undefined : features.find((f) => f.id.startsWith(`frontline-changes:${selected}:`))?.id;
  const showOnMap = () => {
    signalsStore.set(SRC.id, true);
    shellLayoutStore.unfocus();
  };

  return (
    <div className="tn-sd tn-flc">
      <header className="tn-sd-head">
        <div className="tn-sd-title">Front line changes</div>
        <div className="tn-sd-stat">
          <b>{features.length}</b> {features.length === 1 ? "spot" : "spots"} in the last {WINDOW_DAYS} days
          {s ? `, from ${plural(s.updates, "DeepState update", "DeepState updates")}` : ""}
          <span className={`tn-sd-fresh is-${fresh.state}`} title={`provenance-1 reads DeepState every ${Math.round(SRC.refreshMs / 60_000)} minutes`}>
            <i className="tn-sd-fresh-dot" />
            {fresh.label}
          </span>
        </div>
      </header>

      {empty && <p className="tn-wz-empty">{empty}</p>}

      {s && (
        <>
          <Counts s={s} />
          <div className="tn-sd-panels">
            <div className="tn-sd-panel">
              <h3>Spots on the map, last {WINDOW_DAYS} days</h3>
              {points.length > 0 ? (
                <InsetMap points={points} height={240} maxZoom={9} selectedId={selectedFeature} onSelect={selectFromMap} />
              ) : (
                <p className="tn-wz-note">No spot in the last {WINDOW_DAYS} days.</p>
              )}
              <p className="tn-wz-note">Each spot is where DeepState&apos;s link centres its map, not a measured position.</p>
            </div>
            <div className="tn-sd-panel">
              <h3>Changes per day, {s.perDay.length - 1} days</h3>
              <DayBars days={s.perDay} height={150} />
            </div>
          </div>

          <ol className="tn-flc-entries" aria-label="DeepState's updates, newest first">
            {s.entries.map((e, i) => (
              <EntryRow
                key={e.id}
                entry={e}
                divider={i === firstOld ? `Older than ${s.windowDays} days: listed here, not on the map` : null}
                selected={selected === e.id}
              />
            ))}
          </ol>
        </>
      )}

      <footer className="tn-sd-foot">
        <span className="tn-sd-attr">
          {SRC.attribution}. In DeepState&apos;s own words; the side is read from its sentence. Credited and linked; it comes off on request.
        </span>
        <span className="tn-sd-actions">
          <button onClick={showOnMap}>Show on map</button>
          <button
            disabled={!rows.length}
            onClick={() => downloadText(`${exportFilename("frontline-changes", Date.now())}.csv`, "text/csv", toCsv(rows))}
          >
            Download CSV
          </button>
        </span>
      </footer>
    </div>
  );
}

function EntryRow({ entry, divider, selected }: { entry: FrontlineEntry; divider: string | null; selected: boolean }) {
  return (
    <>
      {divider && (
        <li className="tn-flc-divider" aria-hidden>
          {divider}
        </li>
      )}
      <li id={`flc-${entry.id}`} className={`tn-flc-entry${selected ? " is-selected" : ""}`}>
        <time dateTime={entry.at}>{whenLabel(entry.at)}</time>
        <p>{entry.text}</p>
        <ul className="tn-flc-spots" aria-label="Places this update links">
          {entry.spots.map((p, i) => (
            <li key={`${p.link}-${i}`}>
              <SideBadge side={p.side} />
              <a href={p.link} target="_blank" rel="noreferrer">
                {p.place} on DeepState&apos;s map
              </a>
            </li>
          ))}
        </ul>
      </li>
    </>
  );
}


export const Card = FrontlineChangesCard;
export const Detail = FrontlineChangesDetail;
