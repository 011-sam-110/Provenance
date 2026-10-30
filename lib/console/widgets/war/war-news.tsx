"use client";
// lib/console/widgets/war/war-news.tsx
// War news: the card the rail's + places, and its expanded view. Data: the `war-news`
// layer's summary (lib/signals/war-news.ts), which carries EVERY post; the map features
// carry only the placed ones and feed the mini-map. Do not import ../signals.tsx here
// (it imports this file through ./index.ts).
//
// Three rules the view keeps:
//   - the side is TEXT on every row (UA, RU, IND), with its colour as a second cue only;
//   - a translated post says so, and its original is one click away;
//   - a filter never hides posts silently: the zone filter's hidden count is printed.
import { Fragment, useEffect, useMemo, useState, type ComponentType } from "react";
import type { WidgetBodyProps, WidgetDetailProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";
import {
  WAR_NEWS_SIDES,
  WAR_NEWS_SIDE_LABEL,
  WAR_NEWS_SIDE_SHORT,
  WAR_NEWS_SOURCE,
  ZONE_ALL,
  ZONE_NONE,
  defaultWarNewsZone,
  readWarNewsSummary,
  warNewsAge,
  warNewsByline,
  warNewsFeatureId,
  warNewsHiddenLine,
  warNewsLanguage,
  warNewsView,
  warNewsZoneLabel,
  type WarNewsFilter,
  type WarNewsPost,
  type WarNewsSide,
  type WarNewsSummary,
} from "@/lib/signals/war-news";

const SOURCE = WAR_NEWS_SOURCE;
/** Rows the card draws. The expanded view has them all. */
const CARD_ROWS = 60;
/** Rows the expanded table draws before "Show more". */
const PAGE_ROWS = 150;

function SideBadge({ side }: { side: WarNewsSide }) {
  return (
    <span className={`tn-wn-badge is-${side}`} title={`${WAR_NEWS_SIDE_LABEL[side]} outlet`}>
      {WAR_NEWS_SIDE_SHORT[side]}
    </span>
  );
}

/** Side buttons (All, UA, RU, Independent) and the war-zone select. Shared by both views. */
function Filters({
  summary,
  filter,
  onChange,
  counts,
}: {
  summary: WarNewsSummary;
  filter: WarNewsFilter;
  onChange: (next: WarNewsFilter) => void;
  counts?: boolean;
}) {
  const zones = summary.byZone;
  const zoneKnown = filter.zone === ZONE_ALL || filter.zone === ZONE_NONE || zones.some((z) => z.zone === filter.zone);
  const total = summary.posts.length;
  return (
    <div className="tn-wn-filters">
      <div className="tn-wn-seg" role="group" aria-label="Side">
        <button type="button" aria-pressed={filter.side === "all"} onClick={() => onChange({ ...filter, side: "all" })}>
          All{counts && <span className="tn-wn-n">{total}</span>}
        </button>
        {WAR_NEWS_SIDES.map((side) => (
          <button
            key={side}
            type="button"
            aria-pressed={filter.side === side}
            title={`${WAR_NEWS_SIDE_LABEL[side]} outlets`}
            onClick={() => onChange({ ...filter, side })}
          >
            {side === "independent" ? "Independent" : WAR_NEWS_SIDE_SHORT[side]}
            {counts && <span className="tn-wn-n">{summary.bySide[side]}</span>}
          </button>
        ))}
      </div>
      <label className="tn-wn-zone">
        <span className="tn-wn-visually-hidden">War zone</span>
        <select value={zoneKnown ? filter.zone : ZONE_ALL} onChange={(e) => onChange({ ...filter, zone: e.target.value })}>
          <option value={ZONE_ALL}>All zones</option>
          {zones.map((z) => (
            <option key={z.zone ?? ZONE_NONE} value={z.zone ?? ZONE_NONE}>
              {warNewsZoneLabel(z.zone)} ({z.count})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** The summary from the feed, the filter state, and the view under it. */
function useWarNews() {
  const feed = useSignalFeed(SOURCE.id, SOURCE.refreshMs);
  const summary = useMemo(() => readWarNewsSummary(feed.summary), [feed.summary]);
  const [filter, setFilter] = useState<WarNewsFilter | null>(null);
  // The card opens on Ukraine once the first summary says it has posts there.
  const active: WarNewsFilter = filter ?? { side: "all", zone: summary ? defaultWarNewsZone(summary) : ZONE_ALL };
  const view = useMemo(() => warNewsView(summary?.posts ?? [], active), [summary, active.side, active.zone, active.query]);
  return { feed, summary, filter: active, setFilter, view };
}

/** The empty, loading and failed states, in the generic body's words. Null when there is a list. */
function feedState(feed: ReturnType<typeof useSignalFeed>, summary: WarNewsSummary | null): string | null {
  if (summary) return null;
  if (feed.status === "loading") return `Loading ${SOURCE.label}…`;
  if (feed.status === "error" || !feed.ok) return `${SOURCE.label} unavailable.`;
  // The route answered, but not with this layer's summary: say so rather than show an empty list.
  return `${SOURCE.label} sent a list this view cannot read.`;
}

/** New posts the model has not read. The card says it in one line; the expanded view says why. */
function PendingNote({ summary, compact }: { summary: WarNewsSummary; compact?: boolean }) {
  if (summary.pending.count === 0) return null;
  const n = summary.pending.count;
  const reason = summary.pending.reason;
  return (
    <p className="tn-w-capnote" role="status" title={compact && reason ? `Why: ${reason}.` : undefined}>
      {compact
        ? `${n} new ${n === 1 ? "post waits" : "posts wait"} for the model check.`
        : `${n} new ${n === 1 ? "post waits" : "posts wait"} for the model to check, translate and place ${n === 1 ? "it" : "them"}${reason ? `: ${reason}` : ""}. English ones are listed meanwhile, marked "Not checked yet".`}
    </p>
  );
}

/** Said on every post the model has not read, so it never looks like a checked one. */
function UncheckedFlag({ post }: { post: WarNewsPost }) {
  if (post.checked) return null;
  return <span className="tn-wn-flag">Not checked yet: war zone and place unknown</span>;
}

function WarNewsCard(_props: WidgetBodyProps) {
  const { feed, summary, filter, setFilter, view } = useWarNews();
  const report = useWidgetReport();
  const total = summary?.posts.length ?? 0;
  useEffect(() => {
    report({
      alerts: [],
      count: view.shown.length,
      fresh: {
        lastOk: feed.updatedAt,
        ok: feed.ok,
        count: total,
        refreshMs: SOURCE.refreshMs,
        sourceAt: summary ? Date.parse(summary.fetchedAt) : null,
      },
    });
  }, [report, view.shown.length, feed.updatedAt, feed.ok, total, summary]);

  const state = feedState(feed, summary);
  if (state || !summary) return <p className="tn-w-empty">{state}</p>;
  const now = Date.now();
  const hiddenLine = warNewsHiddenLine(view);
  const rows = view.shown.slice(0, CARD_ROWS);
  return (
    <div className="tn-wn">
      <Filters summary={summary} filter={filter} onChange={setFilter} />
      <PendingNote summary={summary} compact />
      {rows.length === 0 ? (
        <p className="tn-w-empty">
          {total === 0 ? "No posts in the last 7 days." : "No posts match these filters."}
        </p>
      ) : (
        <ul className="tn-wn-list">
          {rows.map((post) => (
            <li key={post.id}>
              <SideBadge side={post.side} />
              <a className="tn-wn-title" href={post.url} target="_blank" rel="noreferrer">
                {post.title}
              </a>
              <span className="tn-wn-age" title={post.publishedAt}>{warNewsAge(post.publishedAt, now)}</span>
              <span className="tn-wn-by">
                {warNewsByline(post)}
                <UncheckedFlag post={post} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {view.shown.length > rows.length && (
        <p className="tn-wn-foot">Showing the newest {rows.length} of {view.shown.length}. Expand the card for all of them.</p>
      )}
      {hiddenLine && <p className="tn-wn-foot">{hiddenLine}</p>}
    </div>
  );
}

function OutletTable({ summary }: { summary: WarNewsSummary }) {
  const outlets = [...summary.outlets].sort(
    (a, b) => WAR_NEWS_SIDES.indexOf(a.side) - WAR_NEWS_SIDES.indexOf(b.side) || b.posts - a.posts || a.name.localeCompare(b.name),
  );
  return (
    <table className="tn-sd-table tn-wn-outlets">
      <caption className="tn-wn-visually-hidden">Posts per outlet, with each outlet's side</caption>
      <thead>
        <tr>
          <th scope="col">Side</th>
          <th scope="col">Outlet</th>
          <th scope="col" className="tn-wn-num">Posts</th>
        </tr>
      </thead>
      <tbody>
        {outlets.map((o) => (
          <tr key={o.id}>
            <td><SideBadge side={o.side} /></td>
            <td>
              <a href={o.home} target="_blank" rel="noreferrer">{o.name}</a>
              {o.channel === "telegram" && <span className="tn-wn-muted">, Telegram</span>}
              {o.opinion && <span className="tn-wn-muted">. Opinion, never on the map</span>}
              <span className="tn-wn-why">{o.why}</span>
              {o.status !== "ok" && (
                <span className="tn-wn-why is-warn">
                  {o.status === "failed" ? "Not read this run" : "Not read"}
                  {o.detail ? `: ${o.detail}` : ""}
                </span>
              )}
            </td>
            <td className="tn-wn-num">{o.status === "no-feed" ? "none" : o.posts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WarNewsDetail(_props: WidgetDetailProps) {
  const { feed, summary, filter, setFilter, view } = useWarNews();
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_ROWS);
  const report = useWidgetReport();
  useEffect(() => {
    report({ alerts: [], count: view.shown.length });
  }, [report, view.shown.length]);

  const shownIds = useMemo(() => new Set(view.shown.map((p) => warNewsFeatureId(p.id))), [view.shown]);
  const points: InsetPoint[] = useMemo(
    () =>
      feed.features
        .filter((f) => shownIds.has(f.id))
        .map((f) => ({ lat: f.lat, lon: f.lon, id: f.id, color: SOURCE.color, props: { title: f.title } })),
    [feed.features, shownIds],
  );

  const state = feedState(feed, summary);
  if (state || !summary) {
    return (
      <div className="tn-sd">
        <header className="tn-sd-head"><div className="tn-sd-title">{SOURCE.label}</div></header>
        <p className="tn-w-empty">{state}</p>
      </div>
    );
  }

  const now = Date.now();
  const hiddenLine = warNewsHiddenLine(view);
  const read = warNewsAge(summary.fetchedAt, now);
  const outletsRead = summary.outlets.filter((o) => o.status === "ok").length;
  const selectFromMap = (featureId: string) => {
    const id = featureId.replace(/^war-news:/, "");
    setOpen(id);
    const index = view.shown.findIndex((p) => p.id === id);
    if (index >= limit) setLimit(index + 1);
    requestAnimationFrame(() => document.getElementById(`wnrow-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const toggle = (post: WarNewsPost) => setOpen((current) => (current === post.id ? null : post.id));

  return (
    <div className="tn-sd tn-wn-detail">
      <header className="tn-sd-head">
        <div className="tn-sd-title">{SOURCE.label}</div>
        <div className="tn-sd-stat">
          <b>{summary.posts.length}</b> posts in the last 7 days from {outletsRead} of {summary.outlets.length} outlets,
          read {read ? `${read} ago` : "just now"}
        </div>
      </header>

      <div className="tn-wn-bar">
        <label className="tn-wn-search">
          <span>Search posts</span>
          <input
            type="search"
            value={filter.query ?? ""}
            onChange={(e) => { setFilter({ ...filter, query: e.target.value }); setLimit(PAGE_ROWS); }}
          />
        </label>
        <Filters summary={summary} filter={filter} onChange={(next) => { setFilter(next); setLimit(PAGE_ROWS); }} counts />
      </div>
      <PendingNote summary={summary} />
      {hiddenLine && <p className="tn-wn-foot">{hiddenLine}</p>}

      <div className="tn-sd-panels tn-wn-panels">
        <section className="tn-sd-panel" aria-label="Posts per outlet">
          <h3>Posts per outlet</h3>
          <OutletTable summary={summary} />
        </section>
        <section className="tn-sd-panel tn-sd-mappanel" aria-label="Posts that name a place">
          <h3>Posts that name a place</h3>
          {points.length > 0 ? (
            <InsetMap points={points} height={260} selectedId={open ? warNewsFeatureId(open) : undefined} onSelect={selectFromMap} />
          ) : (
            <p className="tn-w-empty">No post in this list names a town the gazetteer could place.</p>
          )}
          <p className="tn-wn-foot">
            {points.length} of {view.shown.length} posts on the map. A post is placed only at a town or a named
            site it names; opinion posts never are.
          </p>
        </section>
      </div>

      {view.shown.length === 0 ? (
        <p className="tn-w-empty">No posts match these filters.</p>
      ) : (
        <table className="tn-sd-table tn-wn-table">
          <caption className="tn-wn-visually-hidden">War news posts, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Side</th>
              <th scope="col">Post</th>
              <th scope="col">Place</th>
              <th scope="col" className="tn-wn-num">Age</th>
            </tr>
          </thead>
          <tbody>
            {view.shown.slice(0, limit).map((post) => {
              const isOpen = open === post.id;
              return (
                <Fragment key={post.id}>
                  <tr id={`wnrow-${post.id}`} className={`tn-sd-row${isOpen ? " is-selected" : ""}`}>
                    <td><SideBadge side={post.side} /></td>
                    <td>
                      <a className="tn-wn-title" href={post.url} target="_blank" rel="noreferrer">{post.title}</a>
                      <span className="tn-wn-by">
                        {warNewsByline(post)}
                        <UncheckedFlag post={post} />
                      </span>
                      {(post.summary || post.original) && (
                        <button type="button" className="tn-wn-more" aria-expanded={isOpen} onClick={() => toggle(post)}>
                          {isOpen ? "Hide text" : post.translated ? "Text and original" : "Text"}
                        </button>
                      )}
                    </td>
                    <td className="tn-wn-place">
                      {post.place ? post.place.name : <span className="tn-wn-muted">{post.checked ? "None named" : "Unknown"}</span>}
                    </td>
                    <td className="tn-wn-num" title={post.publishedAt}>{warNewsAge(post.publishedAt, now)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="tn-sd-drill">
                      <td colSpan={4}>
                        {post.summary && <p className="tn-wn-text">{post.summary}</p>}
                        {post.translated && post.original && (
                          <p className="tn-wn-text tn-wn-original" lang={post.lang}>
                            <span className="tn-wn-muted">Original, in {warNewsLanguage(post.lang)}: </span>
                            {post.original}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {view.shown.length > limit && (
        <button type="button" className="tn-wn-showmore" onClick={() => setLimit((n) => n + PAGE_ROWS)}>
          Show {Math.min(PAGE_ROWS, view.shown.length - limit)} more of {view.shown.length - limit}
        </button>
      )}

      <footer className="tn-sd-foot">
        <span className="tn-sd-attr">
          {SOURCE.attribution}. Side is the outlet's own origin and stance, not a judgement of the post. Translations
          are machine-made; the original is kept.
        </span>
      </footer>
    </div>
  );
}

export const Card: ComponentType<WidgetBodyProps> | undefined = WarNewsCard;
export const defaultHeight = 300;
export const countNoun = "posts";
export const Detail: ComponentType<WidgetDetailProps> | undefined = WarNewsDetail;
