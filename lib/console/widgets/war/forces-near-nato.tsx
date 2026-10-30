"use client";
// lib/console/widgets/war/forces-near-nato.tsx
// The Forces near NATO card and expanded view. The card lists the curated sites by the
// NATO border they face, one line each: our summary, who made the claim and when. The
// expanded view gives each site its quoted claims in full, with the outlet, the analyst,
// the satellite image dates where the article gives them and the link, beside a map.
//
// Everything comes from the layer's summary (lib/signals/forces-near-nato.ts), so the
// card shows what the route serves. Words live in forces-near-nato.view.ts (tested).
// Do not import lib/console/widgets/signals.tsx here (circular import).
import { useEffect, useMemo, useRef, useState } from "react";
import type { WidgetBodyProps, WidgetDetailProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { FORCES_NEAR_NATO_SOURCE, readForcesSummary } from "@/lib/signals/forces-near-nato";
import type { NatoSite } from "@/lib/signals/forces-near-nato.data";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";
import { citedLine, groupSites, longDate, newestDate, shortDate, statLine, unplacedNote, whoMidSentence } from "./forces-near-nato.view";

const SOURCE = FORCES_NEAR_NATO_SOURCE;

function useForces() {
  const feed = useSignalFeed(SOURCE.id, SOURCE.refreshMs);
  const summary = useMemo(() => readForcesSummary(feed.summary), [feed.summary]);
  return { ...feed, summary };
}

/** The state line the card and the expanded view show instead of the list, or null. */
function emptyState(status: "loading" | "idle" | "error", hasSummary: boolean, sites: number): string | null {
  if (hasSummary && sites > 0) return null;
  if (status === "loading") return `Loading ${SOURCE.label}…`;
  if (status === "error") return `${SOURCE.label} unavailable.`;
  return hasSummary ? "No sites are listed yet." : `${SOURCE.label} sent no site list.`;
}

function Swatch({ placed }: { placed: boolean }) {
  return (
    <span
      className={placed ? "tn-fnn-swatch" : "tn-fnn-swatch is-unplaced"}
      style={placed ? { background: SOURCE.color } : { borderColor: SOURCE.color }}
      aria-hidden
    />
  );
}

/** Room for a border group and its first rows; the frame scrolls the rest. */
export const defaultHeight = 300;
/** The expanded view counts sites, not rows. */
export const countNoun = "sites";

export function Card(_props: WidgetBodyProps) {
  const { summary, status, updatedAt, ok, features, sourceAt } = useForces();
  const sites = summary?.sites ?? [];

  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: [],
      count: sites.length,
      fresh: { lastOk: updatedAt, ok, count: features.length, refreshMs: SOURCE.refreshMs, sourceAt },
    });
  }, [report, sites.length, updatedAt, ok, features.length, sourceAt]);

  const empty = emptyState(status, summary !== null, sites.length);
  if (empty) return <p className="tn-w-empty">{empty}</p>;

  const note = unplacedNote(sites);
  return (
    <div className="tn-fnn">
      <p className="tn-w-capnote">Each site is a claim from reporting, with who made it and when.</p>
      {groupSites(sites).map((g) => (
        <section key={g.border} className="tn-fnn-group" aria-label={g.label}>
          <h4 className="tn-fnn-grp">{g.label}</h4>
          <ul className="tn-fnn-list">
            {g.sites.map((s) => {
              const first = s.claims[0];
              const date = newestDate(s);
              return (
                <li key={s.id}>
                  <Swatch placed={s.at !== null} />
                  <span className="tn-fnn-t">
                    <b>{s.name}:</b> {s.summary}
                  </span>
                  {date && (
                    <time className="tn-fnn-a" dateTime={date}>
                      {shortDate(date)}
                    </time>
                  )}
                  {first && <span className="tn-fnn-s">{citedLine(first)}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {note && <p className="tn-fnn-foot">{note}</p>}
    </div>
  );
}

function SiteBlock({ site, selected, onLocate }: { site: NatoSite; selected: boolean; onLocate: (id: string) => void }) {
  const where = [site.unit, site.region].filter(Boolean).join(", ");
  return (
    <article id={`tn-fnn-${site.id}`} className={selected ? "tn-fnn-site is-selected" : "tn-fnn-site"}>
      <header className="tn-fnn-site-head">
        <Swatch placed={site.at !== null} />
        <h4>{site.name}</h4>
        <span className="tn-fnn-where">{where}</span>
      </header>
      {site.distance && <p className="tn-fnn-dist">{site.distance}</p>}
      {site.claims.map((c, i) => (
        <div key={i} className="tn-fnn-claim">
          <blockquote lang={c.lang ?? "en"}>“{c.quote}”</blockquote>
          {c.translation && (
            <p className="tn-fnn-tr">
              <span>Our translation:</span> {c.translation}
            </p>
          )}
          <p className="tn-fnn-by">
            Claimed by {whoMidSentence(c.attributedTo)}.{" "}
            <a href={c.url} target="_blank" rel="noopener noreferrer">
              {c.outlet}, {longDate(c.date)}
            </a>
            {c.imagery && <span className="tn-fnn-img">Satellite images: {c.imagery}</span>}
          </p>
        </div>
      ))}
      <footer className="tn-fnn-site-foot">
        {site.at ? (
          <>
            <span>Placed at the town ({site.at.gazetteer}), not the base.</span>
            <button type="button" onClick={() => onLocate(site.id)} aria-pressed={selected}>
              Show on the map
            </button>
          </>
        ) : (
          <span>Not on the map: the reporting names no town.</span>
        )}
      </footer>
    </article>
  );
}

export function Detail(_props: WidgetDetailProps) {
  const { summary, status, updatedAt, ok, features, sourceAt } = useForces();
  const sites = summary?.sites ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: [],
      count: sites.length,
      fresh: { lastOk: updatedAt, ok, count: features.length, refreshMs: SOURCE.refreshMs, sourceAt },
    });
  }, [report, sites.length, updatedAt, ok, features.length, sourceAt]);

  const points: InsetPoint[] = useMemo(
    () =>
      sites.flatMap((s) =>
        s.at ? [{ lat: s.at.lat, lon: s.at.lon, id: s.id, color: SOURCE.color, props: { title: s.name } }] : [],
      ),
    [sites],
  );

  // A dot on the map selects its site and brings its block into view.
  const fromMap = (id: string) => {
    setSelected(id);
    listRef.current?.querySelector(`#tn-fnn-${CSS.escape(id)}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const empty = emptyState(status, summary !== null, sites.length);
  return (
    <div className="tn-sd tn-fnn-x">
      {/* The frame above already names the layer, so the view opens on its figures. */}
      <header className="tn-sd-head">
        <div className="tn-sd-stat">
          {empty ?? `${statLine(sites)}. The claims are the outlets' and analysts', quoted; none is checked here.`}
        </div>
      </header>
      {!empty && summary && (
        <>
          <div className="tn-fnn-x-body">
            <div className="tn-fnn-x-list" ref={listRef}>
              {groupSites(sites).map((g) => (
                <section key={g.border} className="tn-fnn-x-group" aria-label={g.label}>
                  <h3>{g.label}</h3>
                  {g.sites.map((s) => (
                    <SiteBlock key={s.id} site={s} selected={selected === s.id} onLocate={setSelected} />
                  ))}
                </section>
              ))}
            </div>
            <aside className="tn-fnn-x-map" aria-label="Map of the sites">
              <InsetMap points={points} height={360} selectedId={selected ?? undefined} onSelect={fromMap} />
              <p className="tn-sd-maphint">
                Each dot is a town, not a base: no article gives a base&apos;s own position.
              </p>
            </aside>
          </div>
          {summary.leftOut.length > 0 && (
            <section className="tn-fnn-left">
              <h3>In the articles, not on this layer</h3>
              <ul>
                {summary.leftOut.map((l) => (
                  <li key={l.name}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      {l.name}
                    </a>
                    : {l.why}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <footer className="tn-sd-foot">
        <span className="tn-sd-attr">
          {SOURCE.attribution}. Translations from Russian are ours.
        </span>
      </footer>
    </div>
  );
}
