"use client";
// SCHEDULE focus view — the fit-for-purpose template for forward-looking, time-
// anchored feeds (rocket launches today). Instead of the event template's "last
// 24h" retrospective and a map blob, it answers "what's next and when": a hero
// countdown to the soonest item, then a countdown-ordered AGENDA grouped by day
// (Today / Tomorrow / dated), each row showing the T-minus clock, provider,
// vehicle, site and status — with the launch-site map kept as a secondary panel.
// Driven entirely off each feature's `ts` (scheduled time) + the countdown helpers.
import { Fragment, useMemo, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { useScope, withinScope } from "@/lib/shell/scope";
import { signalsStore } from "@/lib/signals/store";
import { shellLayoutStore } from "@/lib/console/store";
import { openSignalFeature } from "@/lib/widgets/openSignal";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";
import ExportExtras from "@/components/console/ExportExtras";
import { humaniseKey } from "@/lib/text/humanise";
import { freshness } from "@/lib/console/signals/signalDetail";
import { countdown, scheduleHeading, scheduleClock, type Countdown } from "@/lib/console/signals/schedule";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";

const strProp = (f: SignalFeature, key: string): string => {
  const v = f.props?.[key];
  return typeof v === "string" ? v : "";
};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function makeScheduleDetail(source: SignalSource) {
  function ScheduleView(_props: WidgetDetailProps) {
    const scope = useScope();
    const { features, status, updatedAt } = useSignalFeed(source.id, source.refreshMs);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState<string | null>(null);
    const now = Date.now();
    const fresh = freshness(updatedAt, source.refreshMs, now);

    const scoped = useMemo(() => features.filter((f) => withinScope(f.lat, f.lon, scope)), [features, scope]);

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      const rows = q
        ? scoped.filter((f) => [f.title, strProp(f, "provider"), strProp(f, "rocket"), strProp(f, "site")].join(" ").toLowerCase().includes(q))
        : scoped;
      // Soonest first; items with no valid time sink to the bottom.
      const key = (f: SignalFeature) => { const t = Date.parse(f.ts ?? ""); return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY; };
      return [...rows].sort((a, b) => key(a) - key(b));
    }, [scoped, query]);

    const cds = useMemo(() => new Map(filtered.map((f) => [f.id, countdown(f.ts, now)] as const)), [filtered, now]);
    const hero = useMemo(() => filtered.find((f) => { const c = cds.get(f.id); return c && c.ms != null && c.ms > -2 * HOUR; }) ?? null, [filtered, cds]);
    const next24 = useMemo(() => filtered.filter((f) => { const c = cds.get(f.id); return c && c.ms != null && c.ms > -2 * HOUR && c.ms <= DAY; }).length, [filtered, cds]);
    const providers = useMemo(() => new Set(filtered.map((f) => strProp(f, "provider")).filter(Boolean)).size, [filtered]);

    const mapPoints: InsetPoint[] = filtered.map((f) => ({ lat: f.lat, lon: f.lon, id: f.id, color: f.color ?? source.color, props: { title: f.title } }));
    const selectFromMap = (id: string) => {
      setOpen(id);
      if (typeof document !== "undefined") requestAnimationFrame(() => document.getElementById(`schrow-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    };
    const flyTo = (f: SignalFeature) => { signalsStore.set(source.id, true); openSignalFeature(f, source.label, 5); shellLayoutStore.unfocus(); };
    const showOnMap = () => { signalsStore.set(source.id, true); shellLayoutStore.unfocus(); };

    const exportRows = filtered.map((f) => ({ id: f.id, mission: f.title, when: f.ts ?? "", countdown: cds.get(f.id)?.label ?? "", provider: strProp(f, "provider"), rocket: strProp(f, "rocket"), site: strProp(f, "site"), status: strProp(f, "status"), lat: f.lat, lon: f.lon }));
    const exportGeo = filtered.map((f) => ({ lat: f.lat, lon: f.lon, properties: { id: f.id, name: f.title, ...(f.props ?? {}) } }));

    const cd = (f: SignalFeature): Countdown => cds.get(f.id) ?? countdown(f.ts, now);
    // Build the day-grouped agenda: emit a heading row whenever the day bucket changes.
    let lastHeading = "";

    return (
      <div className="tn-sd tn-sch">
        <header className="tn-sd-head">
          <div className="tn-sd-title">{source.label}</div>
          <div className="tn-sd-stat"><b>{filtered.length}</b> upcoming in {scope.label}
            <span className={`tn-sd-fresh is-${fresh.state}`}><i className="tn-sd-fresh-dot" />{fresh.state === "live" ? "live" : fresh.label}</span>
          </div>
        </header>

        {hero && (
          <div className="tn-sch-hero" style={{ borderLeftColor: hero.color ?? source.color }}>
            <div className="tn-sch-hero-cd">
              <span className={`tn-sch-cd is-${cd(hero).state}`}>{cd(hero).label}</span>
              <span className="tn-sch-hero-when">{scheduleHeading(hero.ts, now)} · {scheduleClock(hero.ts) || "time TBD"}</span>
            </div>
            <div className="tn-sch-hero-name">{hero.title}</div>
            <div className="tn-sch-hero-meta">
              {[strProp(hero, "provider"), strProp(hero, "rocket"), strProp(hero, "site")].filter(Boolean).join(" · ")}
              {strProp(hero, "status") && <span className="tn-sch-pill" style={{ background: hero.color ?? source.color }}>{strProp(hero, "status")}</span>}
            </div>
          </div>
        )}

        {scoped.length > 0 && (
          <div className="tn-sd-kpis">
            <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Next up</div><div className="tn-sd-kpi-value" style={{ fontSize: 15 }}>{hero ? cd(hero).label : "—"}</div><div className="tn-sd-kpi-sub">{hero ? scheduleClock(hero.ts) || "time TBD" : "nothing scheduled"}</div></div>
            <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Next 24h</div><div className="tn-sd-kpi-value">{next24}</div><div className="tn-sd-kpi-sub">launches</div></div>
            <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">In view</div><div className="tn-sd-kpi-value">{filtered.length}</div><div className="tn-sd-kpi-sub">of {features.length} listed</div></div>
            <div className="tn-sd-kpi"><div className="tn-sd-kpi-label">Providers</div><div className="tn-sd-kpi-value">{providers}</div><div className="tn-sd-kpi-sub">distinct</div></div>
          </div>
        )}

        {scoped.length > 0 && (
          <div className="tn-sd-filter">
            <input type="text" value={query} placeholder={`Search ${source.label.toLowerCase()}…`} aria-label="Search" onChange={(e) => setQuery(e.target.value)} />
            {query && <button className="tn-sd-filter-clear" onClick={() => setQuery("")}>Clear</button>}
          </div>
        )}

        {status === "loading" && scoped.length === 0 && <p className="tn-w-empty">Loading {source.label}…</p>}
        {status !== "loading" && scoped.length === 0 && <p className="tn-w-empty">Nothing scheduled in {scope.label}.</p>}
        {scoped.length > 0 && filtered.length === 0 && <p className="tn-w-empty">No matches.</p>}

        {filtered.length > 0 && (
          <div className="tn-sch-agenda">
            {filtered.map((f) => {
              const heading = scheduleHeading(f.ts, now);
              const showHeading = heading !== lastHeading;
              lastHeading = heading;
              const isOpen = open === f.id;
              const c = cd(f);
              const meta = [strProp(f, "provider"), strProp(f, "rocket"), strProp(f, "site")].filter(Boolean).join(" · ");
              const shown = new Set(["provider", "rocket", "site", "status", "launchTime"]);
              const entries = Object.entries(f.props ?? {}).filter(([k, v]) => v != null && v !== "" && !shown.has(k));
              return (
                <Fragment key={f.id}>
                  {showHeading && <div className="tn-sch-day">{heading}</div>}
                  <div id={`schrow-${f.id}`} className={`tn-sch-row${isOpen ? " is-open" : ""}`} onClick={() => setOpen(isOpen ? null : f.id)}>
                    <span className="tn-sch-when">
                      <span className={`tn-sch-cd is-${c.state}`}>{c.label}</span>
                      <span className="tn-sch-clock">{scheduleClock(f.ts) || "TBD"}</span>
                    </span>
                    <span className="tn-sch-body">
                      <span className="tn-sch-name">{f.title}</span>
                      {meta && <span className="tn-sch-meta">{meta}</span>}
                    </span>
                    {strProp(f, "status") && <span className="tn-sch-pill" style={{ background: f.color ?? source.color }}>{strProp(f, "status")}</span>}
                  </div>
                  {isOpen && (
                    <div className="tn-sch-drill">
                      {entries.length > 0 && <dl>{entries.map(([k, v]) => (<div key={k} style={{ display: "contents" }}><dt>{humaniseKey(k)}</dt><dd>{String(v)}</dd></div>))}</dl>}
                      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                        <button onClick={(e) => { e.stopPropagation(); flyTo(f); }} style={{ background: "none", border: 0, color: "var(--tn-accent)", cursor: "pointer", padding: 0 }}>Fly to pad ↗</button>
                        {f.link && <a href={f.link} target="_blank" rel="noreferrer" style={{ color: "var(--tn-accent)" }} onClick={(e) => e.stopPropagation()}>Details ↗</a>}
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}

        {filtered.length > 0 && mapPoints.length > 0 && (
          <div className="tn-sd-mappanel">
            <h3>Launch sites <span className="tn-sd-maphint">· click a dot to find its launch</span></h3>
            <InsetMap points={mapPoints} height={200} selectedId={open ?? undefined} onSelect={selectFromMap} />
          </div>
        )}

        <footer className="tn-sd-foot">
          <span className="tn-sd-attr">{source.attribution}</span>
          <span className="tn-sd-actions">
            <button onClick={showOnMap}>🗺 Show on map</button>
            <button disabled={!exportRows.length} onClick={() => downloadText(`${exportFilename(source.id, Date.now())}.csv`, "text/csv", toCsv(exportRows))}>⬇ CSV</button>
            <button disabled={!exportGeo.length} onClick={() => downloadText(`${exportFilename(source.id, Date.now())}.geojson`, "application/geo+json", toGeoJson(exportGeo))}>⬇ GeoJSON</button>
            <ExportExtras name={source.id} kind="schedule" rows={exportRows} geo={exportGeo} source={`${source.label}: ${source.attribution}`} />
          </span>
        </footer>
      </div>
    );
  }
  return ScheduleView;
}
