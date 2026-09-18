// lib/console/widgets/headlines.detail.tsx
"use client";
// Headlines focus view — a cross-source comparison board.
//
// ── What changed, and why it was not a styling problem ────────────────────────
// This view already clustered headlines into stories, and it still looked like a
// chronological list, because it was one: measured against a live pull on
// 2026-09-18, 93% of its "stories" had exactly one source. Story cards over
// single-source stories are a list with rounded corners.
//
// Three things fixed that, none of them in this file. The clusterer was rebuilt to
// score shared INFORMATION rather than shared word-ratio (lib/news/cluster.ts); the
// feed list went from six outlets to fourteen across six regions; and the item cap
// went from 300 to 500, because with fourteen feeds the cap had become the binding
// constraint and was cutting a story's second and third reports before the
// clusterer saw them (both in app/api/news/route.ts, which carries the numbers).
//
// Measured on one 545-headline snapshot, clustering the newest 500: 50 corroborated
// stories, against 19 for the old clusterer over the old six feeds. The live board
// is not that number — it is whatever the feeds are carrying at the time — but the
// ratio is the point, and it is why there is now something for a comparison board
// to compare.
//
// What this file does with that:
//   • CORROBORATED STORIES LEAD. Multi-source stories are their own section, above
//     the single-source reports, which keep a section that says plainly what they
//     are. The old board mixed them and the reader could not tell a story four
//     newsrooms agreed on from one outlet's exclusive.
//   • COMPARISON IS INLINE. A story opens into side-by-side columns, one per
//     outlet, with the words unique to each highlighted (components/news/
//     CompareView.tsx). No model is involved in that highlighting.
//   • WHO CARRIED IT IS PART OF THE STORY. Every multi-source card gets a bar of
//     outlet types, a government-funded count, and — when the pull is wide enough
//     to support the claim — which regions it is missing from.
//   • THE MATCHUP FILTER answers "show me where these two outlets both reported",
//     which the source chips could not: they OR together, and the question is AND.
//
// Everything that worked is still here: boolean search, the region/type facet
// matrix, the interactive hourly timeline, headline-change tracking, the dense
// table, CSV export, and the dormant-safe AI synthesis — now clearly labelled as
// a model's words, sitting under the verifiable comparison rather than in place
// of it.
//
// Every pure transform lives in a unit-tested lib/news/* module; this is the shell.
import { useEffect, useMemo, useRef, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import type { NewsItem } from "@/lib/news";
import { useJsonPoll } from "@/lib/console/widgets/useJsonPoll";
import { shellLayoutStore } from "@/lib/console/store";
import { timeBins } from "@/lib/widgets/buckets";
import { clusterNews, buildWeights, type Cluster } from "@/lib/news/cluster";
import { clusterVelocity, velocityLabel } from "@/lib/news/velocity";
import { filterByQuery } from "@/lib/news/search";
import { sourceMeta } from "@/lib/news/sources";
import { universeFrom } from "@/lib/news/diversity";
import { loadSnapshot, saveSnapshot, diffSnapshots, type Snapshot } from "@/lib/news/snapshot";
import type { SynthesisPayload } from "@/lib/news/synthesis";
import { SourceIcon } from "@/components/news/SourceIcon";
import { HeadlineBars } from "@/components/news/HeadlineBars";
import { StoryCard, type SynthState } from "@/components/news/StoryCard";
import { StoryPreview } from "@/components/news/StoryPreview";
import { toCsv, downloadText, exportFilename } from "@/lib/export";

interface NewsPayload {
  generatedAt: number;
  items: NewsItem[];
}
const EMPTY: NewsPayload = { generatedAt: 0, items: [] };
const HOUR = 3_600_000;

function rel(ts: number, now: number): string {
  if (!ts) return "";
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
const itemText = (it: NewsItem) => `${it.title} ${it.description ?? ""}`;

export default function HeadlinesDetail({ instanceId, config }: WidgetDetailProps) {
  const { data, status } = useJsonPoll<NewsPayload>("/api/news", 120_000, EMPTY);
  const items = useMemo(() => data.items ?? [], [data.items]);
  const now = Date.now();

  // View mode (cards | table) — persisted via the widget config, like markets.
  const view: "cards" | "table" = config.view === "table" ? "table" : "cards";
  const setView = (v: "cards" | "table") => shellLayoutStore.configure(instanceId, { view: v });

  // Search + facet + timeline state (ephemeral).
  const [query, setQuery] = useState("");
  const [srcFilter, setSrcFilter] = useState<Set<string>>(new Set());
  const [regionFilter, setRegionFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [selHour, setSelHour] = useState<number | null>(null);
  // The matchup is a DIFFERENT question from the source chips and therefore a
  // different control: chips OR ("anything from these outlets"), a matchup ANDs
  // ("stories all of these outlets covered").
  const [matchup, setMatchup] = useState<Set<string>>(new Set());
  const [openCompare, setOpenCompare] = useState<string | null>(null);
  const [preview, setPreview] = useState<Cluster | null>(null);

  // ---- Updated / correction tracking: diff current feed vs a persisted snapshot.
  const prevSnapRef = useRef<Snapshot | null | undefined>(undefined);
  const [updatedUrls, setUpdatedUrls] = useState<Set<string>>(new Set());
  const [changes, setChanges] = useState<Record<string, { from: string; to: string }>>({});
  useEffect(() => {
    if (items.length === 0) return;
    if (prevSnapRef.current === undefined) prevSnapRef.current = loadSnapshot();
    const diffs = diffSnapshots(prevSnapRef.current, items);
    if (diffs.length) {
      setUpdatedUrls((prev) => {
        const n = new Set(prev);
        for (const d of diffs) n.add(d.url);
        return n;
      });
      setChanges((prev) => {
        const n = { ...prev };
        for (const d of diffs) n[d.url] = { from: d.from, to: d.to };
        return n;
      });
    }
    saveSnapshot(items);
  }, [items]);

  // ---- Pipeline: search → facet counts → facet filter → timeline → hour → cluster.
  const afterSearch = useMemo(() => filterByQuery(items, query, itemText), [items, query]);

  const facets = useMemo(() => {
    const src = new Map<string, number>();
    const region = new Map<string, number>();
    const type = new Map<string, number>();
    for (const it of afterSearch) {
      const m = sourceMeta(it.source);
      src.set(it.source, (src.get(it.source) ?? 0) + 1);
      region.set(m.region, (region.get(m.region) ?? 0) + 1);
      type.set(m.type, (type.get(m.type) ?? 0) + 1);
    }
    return { src, region, type };
  }, [afterSearch]);

  const afterFacets = useMemo(
    () =>
      afterSearch.filter((it) => {
        const m = sourceMeta(it.source);
        if (srcFilter.size && !srcFilter.has(it.source)) return false;
        if (regionFilter.size && !regionFilter.has(m.region)) return false;
        if (typeFilter.size && !typeFilter.has(m.type)) return false;
        return true;
      }),
    [afterSearch, srcFilter, regionFilter, typeFilter],
  );

  const bins = useMemo(
    () => timeBins(afterFacets.map((it) => it.ts).filter((n) => n > 0), HOUR, now, 24 * HOUR),
    [afterFacets, now],
  );
  const hasVolume = bins.some((b) => b.count > 0);

  const afterHour = useMemo(
    () => (selHour == null ? afterFacets : afterFacets.filter((it) => it.ts >= selHour && it.ts < selHour + HOUR)),
    [afterFacets, selHour],
  );

  // Token weights come from the WHOLE pull, never the filtered slice. Rarity is a
  // property of the feed, not of what the reader has typed into the search box —
  // build them from 12 surviving headlines and every word in them looks unique,
  // so filtering the board would quietly change which stories are judged to be
  // the same story. See ClusterOptions.weights.
  const weights = useMemo(() => buildWeights(items.map((i) => i.title)), [items]);
  const clusters = useMemo(() => clusterNews(afterHour, { weights }), [afterHour, weights]);

  // The comparison set: every outlet present in the pull, and how wide it is.
  const universe = useMemo(() => universeFrom(items), [items]);

  const matched = useMemo(
    () =>
      matchup.size < 2
        ? clusters
        : clusters.filter((c) => {
            const s = new Set(c.sources);
            for (const m of matchup) if (!s.has(m)) return false;
            return true;
          }),
    [clusters, matchup],
  );

  const corroborated = useMemo(() => matched.filter((c) => c.sourceCount > 1), [matched]);
  const single = useMemo(() => matched.filter((c) => c.sourceCount === 1), [matched]);

  // ---- Cross-source AI synthesis (dormant-safe).
  const [synth, setSynth] = useState<Record<string, SynthState>>({});
  const [aiDormant, setAiDormant] = useState(false);
  const synthesize = (c: Cluster) => {
    const cur = synth[c.id];
    if (cur?.loading || cur?.text) return;
    setSynth((s) => ({ ...s, [c.id]: { loading: true } }));
    fetch("/api/news/synthesis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: c.title,
        sources: c.items.map((i) => ({ source: i.source, title: i.title, description: i.description })),
      }),
    })
      .then((r) => r.json())
      .then((d: SynthesisPayload) => {
        if (d.dormant) {
          setAiDormant(true);
          setSynth((s) => ({ ...s, [c.id]: { note: "Cross-source synthesis needs the FREELLMAPI gateway." } }));
        } else if (d.synthesis) {
          setSynth((s) => ({ ...s, [c.id]: { text: d.synthesis! } }));
        } else {
          setSynth((s) => ({ ...s, [c.id]: { note: "Synthesis unavailable for this story right now." } }));
        }
      })
      .catch(() => setSynth((s) => ({ ...s, [c.id]: { note: "Synthesis unavailable." } })));
  };

  const clearFacets = () => {
    setSrcFilter(new Set());
    setRegionFilter(new Set());
    setTypeFilter(new Set());
    setMatchup(new Set());
  };
  // Functional updater, not `new Set(currentValue)`. The previous form read the
  // set out of the render closure, so two toggles landing in one React batch —
  // a fast double click, or a test firing both in a tick — computed from the same
  // stale snapshot and the second silently discarded the first. Building a
  // two-outlet matchup is exactly that motion.
  const toggle = (setter: (f: (s: Set<string>) => Set<string>) => void, v: string) => {
    setter((prev) => {
      const n = new Set(prev);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  };
  const anyFacet = srcFilter.size + regionFilter.size + typeFilter.size + matchup.size > 0;

  // ---- Export: one row per member, tagged with its cluster (size + sources).
  const exportRows = useMemo(
    () =>
      matched.flatMap((c) =>
        c.items.map((it) => ({
          cluster: c.id,
          clusterSize: c.sourceCount,
          clusterSources: c.sources.join(" | "),
          source: it.source,
          title: it.title,
          url: it.url,
          ts: it.ts ? new Date(it.ts).toISOString() : "",
          description: it.description ?? "",
        })),
      ),
    [matched],
  );

  const regionKeys = [...facets.region.keys()].filter((r) => r !== "Other");
  const typeKeys = [...facets.type.keys()];
  const matchupList = [...matchup];

  const cardProps = (c: Cluster) => ({
    c,
    universe,
    now,
    rel,
    compareOpen: openCompare === c.id,
    onToggleCompare: () => setOpenCompare((o) => (o === c.id ? null : c.id)),
    onPreview: () => setPreview(c),
    updated: c.items.some((i) => updatedUrls.has(i.url)),
    change: changes[c.lead.url] ?? c.items.map((i) => changes[i.url]).find(Boolean),
    synth: synth[c.id],
    aiDormant,
    onSynthesize: () => synthesize(c),
    matchup: matchup.size >= 2 ? matchup : undefined,
  });

  return (
    <div className="tn-hd">
      <header className="tn-hd-head">
        <div>
          <div className="tn-hd-h-title">World Headlines</div>
          <div className="tn-hd-h-sub">
            <b>{corroborated.length}</b> corroborated {corroborated.length === 1 ? "story" : "stories"} ·{" "}
            {single.length} single-source · {afterHour.length} headlines from {universe.sources.length} outlets
            across {universe.regions.length} regions · updated{" "}
            {data.generatedAt ? rel(data.generatedAt, now) || "just now" : "—"} ago
          </div>
        </div>
        <div className="tn-hd-viewtoggle" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "cards"} className={view === "cards" ? "is-on" : ""} onClick={() => setView("cards")}>
            ▤ Stories
          </button>
          <button role="tab" aria-selected={view === "table"} className={view === "table" ? "is-on" : ""} onClick={() => setView("table")}>
            ▦ Table
          </button>
        </div>
      </header>

      <div className="tn-hd-bar">
        <input
          className="tn-hd-search"
          placeholder='Search — AND · OR · -exclude · "phrase"'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Boolean headline search"
        />
        <div className="tn-hd-chips">
          {[...facets.src.entries()].map(([s, n]) => {
            const m = sourceMeta(s);
            const inMatch = matchup.has(s);
            return (
              <button
                key={s}
                className={`tn-hd-chip${srcFilter.has(s) ? " is-on" : ""}${inMatch ? " is-match" : ""}`}
                onClick={(e) => {
                  // Shift-click builds the matchup; a plain click filters, as before.
                  // Two behaviours on one chip because they act on the same noun and
                  // a second row of nineteen outlet buttons would bury the board.
                  if (e.shiftKey) toggle(setMatchup, s);
                  else toggle(setSrcFilter, s);
                }}
                title={inMatch ? `In the matchup — shift-click to remove` : `Click to filter · shift-click to add to a matchup`}
              >
                <SourceIcon name={s} domain={m.domain} size={13} />
                {s} <span className="tn-hd-chip-n">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {matchup.size > 0 && (
        <div className="tn-hd-matchup">
          <span className="tn-hd-facet-label">Matchup</span>
          <span className="tn-hd-matchup-names">{matchupList.join(" + ")}</span>
          {matchup.size < 2 ? (
            <span className="tn-hd-hint">shift-click another outlet to compare coverage</span>
          ) : (
            <span className="tn-hd-hint">
              {corroborated.length} {corroborated.length === 1 ? "story" : "stories"} all of them carried
            </span>
          )}
          <button className="tn-hd-clear" onClick={() => setMatchup(new Set())}>
            Clear matchup
          </button>
        </div>
      )}

      {(regionKeys.length > 1 || typeKeys.length > 1) && (
        <div className="tn-hd-facets">
          {regionKeys.length > 1 && (
            <div className="tn-hd-facet-row">
              <span className="tn-hd-facet-label">Region</span>
              {regionKeys.map((r) => (
                <button key={r} className={`tn-hd-fchip${regionFilter.has(r) ? " is-on" : ""}`} onClick={() => toggle(setRegionFilter, r)}>
                  {r} <span className="tn-hd-chip-n">{facets.region.get(r)}</span>
                </button>
              ))}
            </div>
          )}
          {typeKeys.length > 1 && (
            <div className="tn-hd-facet-row">
              <span className="tn-hd-facet-label">Type</span>
              {typeKeys.map((t) => (
                <button key={t} className={`tn-hd-fchip${typeFilter.has(t) ? " is-on" : ""}`} onClick={() => toggle(setTypeFilter, t)}>
                  {t} <span className="tn-hd-chip-n">{facets.type.get(t)}</span>
                </button>
              ))}
            </div>
          )}
          {anyFacet && (
            <button className="tn-hd-clear" onClick={clearFacets}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {hasVolume && (
        <div className="tn-hd-vol">
          <div className="tn-hd-vol-head">
            <span className="tn-hd-group-h">Headlines per hour · last 24h</span>
            {selHour != null ? (
              <button className="tn-hd-reset" onClick={() => setSelHour(null)}>
                ✕ Hour {new Date(selHour).getHours().toString().padStart(2, "0")}:00 — reset
              </button>
            ) : (
              <span className="tn-hd-hint">click a bar to filter</span>
            )}
          </div>
          <HeadlineBars bins={bins} selected={selHour} onSelect={setSelHour} />
        </div>
      )}

      {status === "loading" && items.length === 0 && <p className="tn-w-empty">Loading headlines…</p>}
      {items.length > 0 && matched.length === 0 && <p className="tn-w-empty">No headlines match.</p>}

      {view === "cards" && (
        <>
          {corroborated.length > 0 && (
            <section className="tn-hd-section">
              <h3 className="tn-hd-group-h">
                Reported by more than one outlet · {corroborated.length}
              </h3>
              <div className="tn-hd-cards">
                {corroborated.map((c) => (
                  <StoryCard key={c.id} {...cardProps(c)} />
                ))}
              </div>
            </section>
          )}

          {single.length > 0 && (
            <section className="tn-hd-section">
              <h3 className="tn-hd-group-h">Single-source reports · {single.length}</h3>
              {/* Said once, above the section, rather than on every card. A story
                  appearing here has NOT been contradicted — it simply has nothing
                  in this pull to check it against, which is a fact about our feed
                  list as much as about the story. */}
              <p className="tn-hd-section-note">
                No other outlet in this pull carried these. That is not a judgement on them — most
                newsrooms file plenty that nobody else picks up, and a feed only carries an editor&rsquo;s
                selection of recent items.
              </p>
              <div className="tn-hd-cards">
                {single.map((c) => (
                  <StoryCard key={c.id} {...cardProps(c)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {view === "table" && matched.length > 0 && (
        <table className="tn-hd-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Headline</th>
              <th>Sources</th>
              <th>Velocity</th>
            </tr>
          </thead>
          <tbody>
            {matched.map((c) => {
              const vl = velocityLabel(clusterVelocity(c, now));
              return (
                <tr key={c.id} className="tn-hd-trow">
                  <td className="tn-hd-tcell-time">{rel(c.latestTs, now) || "—"}</td>
                  <td>
                    <a href={c.lead.url} target="_blank" rel="noreferrer" className="tn-hd-tlink">
                      {c.title}
                    </a>
                    {c.items.some((i) => updatedUrls.has(i.url)) && <span className="tn-hd-badge tn-hd-upd">Updated</span>}
                  </td>
                  <td>
                    <span className="tn-hd-tsrc">
                      {c.sources.slice(0, 5).map((s) => (
                        <SourceIcon key={s} name={s} domain={sourceMeta(s).domain} size={14} />
                      ))}
                      {c.sourceCount > 1 && <span className="tn-hd-chip-n">×{c.sourceCount}</span>}
                    </span>
                  </td>
                  <td className="tn-hd-tcell-vel">{vl ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {preview && <StoryPreview cluster={preview} now={now} rel={rel} onClose={() => setPreview(null)} />}

      <footer className="tn-hd-foot">
        <span className="tn-hd-foot-src">
          Keyless feeds · stories grouped by shared-entity similarity · word highlights computed, not generated
        </span>
        {aiDormant && <span className="tn-hd-foot-note">AI synthesis dormant (no gateway)</span>}
        <button
          className="tn-hd-export"
          disabled={exportRows.length === 0}
          onClick={() => downloadText(`${exportFilename("headlines", Date.now())}.csv`, "text/csv", toCsv(exportRows))}
        >
          ⬇ Export CSV
        </button>
      </footer>
    </div>
  );
}
