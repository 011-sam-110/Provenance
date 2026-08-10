// lib/console/widgets/events.tsx
// Disasters & Events widget.
//
// Integration notes — real projectEventFeed API (differs from task brief template):
//   FeedInput is { source: EventSource; features: SignalFeature[] } per source.
//   projectEventFeed(inputs, scope, windowMs, now, filters) returns ProjectedFeed.
//   Row (NormalizedEvent) → EventLite mapping:
//     r.id              → EventLite.id
//     r.type            → EventLite.type
//     r.severity.tier   → EventLite.tier   (NESTED in severity object, not r.tier)
//     r.title           → EventLite.title
//     r.magnitude?.value → EventLite.magnitude  (NESTED, optional number)
//   Display uses r.place.name for the human location label.
//
// M20 ops upgrade: rows are clickable (fly the globe + open the dossier, via
// lib/events/openEvent); the long feed collapses into region/type clusters with
// counts; persisted signal-to-noise filters trim it (with an honest hidden count);
// and events whose modelled impact radius reaches an operator asset are escalated
// to Direct Operational Threats, pinned to the top. Pure logic: lib/events/{regions,
// filters,assets}.ts; pure view-pref reads: lib/events/opsConfig.ts.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EVENT_SOURCES } from "@/lib/events/sources";
import { useEventFeeds, EVENT_POLL_MS } from "@/lib/widgets/useEventFeeds";
import { projectEventFeed, type FeedInput, type FeedSort } from "@/lib/widgets/eventFeed";
import { useScope } from "@/lib/shell/scope";
import { useTimeWindow, windowMsFor } from "@/lib/shell/timeWindow";
import { useNow } from "@/lib/shell/useNow";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { shellLayoutStore } from "@/lib/console/store";
import { runAlertRule } from "@/lib/console/alerts";
import { eventAlerts, type EventLite } from "@/lib/console/widgets/events.rules";
import type { NormalizedEvent } from "@/lib/events/model";
import type { SignalFeature } from "@/lib/signals/types";
import { groupByRegion, groupByType, type EventGroup } from "@/lib/events/regions";
import { readGroupBy, readCollapsed, isCollapsed, toggleCollapsed, type GroupBy } from "@/lib/events/opsConfig";
import { readFilters, applyEventFilters } from "@/lib/events/filters";
import { useAssets, assessThreats, type Threat } from "@/lib/events/assets";
import { useAlerting, alertingStore, matchAlerts, fireBrowserNotification, postWebhook } from "@/lib/events/alerting";
import { sendTelegramIfEnabled } from "@/lib/shell/telegram";
import { openEvent } from "@/lib/events/openEvent";
import EventsDetail from "@/lib/console/widgets/events.detail";

const GROUP_TABS: { id: GroupBy; label: string }[] = [
  { id: "region", label: "Region" },
  { id: "type", label: "Type" },
  { id: "none", label: "Flat" },
];

function EventRow({
  e,
  feature,
  threat,
  flashed,
  onOpen,
}: {
  e: NormalizedEvent;
  feature?: SignalFeature;
  threat?: Threat;
  flashed: boolean;
  onOpen: (e: NormalizedEvent, f?: SignalFeature) => void;
}) {
  return (
    <li className={threat ? "is-threat" : undefined}>
      <button
        type="button"
        className={`tn-ev-row${flashed ? " is-flash" : ""}`}
        onClick={() => onOpen(e, feature)}
        title={
          threat
            ? `${e.title} — ${e.place.name}\nDirect operational threat: ${Math.round(threat.distanceKm)} km from ${threat.assetName}`
            : `${e.title} — ${e.place.name}\nClick to fly the map here`
        }
      >
        <span className={`tn-w-sev tn-sev-${e.severity.tier}`}>{e.severity.tier}</span>
        <b className="tn-w-kind">{e.type}</b>
        <span className="tn-w-place">{e.place.name}</span>
        {threat && <span className="tn-ev-threat-chip">⚠ {Math.round(threat.distanceKm)}km</span>}
        {e.magnitude && (
          <span className="tn-w-mag">
            {e.magnitude.value}
            {e.magnitude.unit}
          </span>
        )}
      </button>
    </li>
  );
}

function EventsBody({ instanceId, config }: WidgetBodyProps) {
  const scope = useScope();
  const win = useTimeWindow();
  const now = useNow(60_000);
  const { bySource, status, updatedAt, okCount, total } = useEventFeeds();
  const assets = useAssets();

  const inputs: FeedInput[] = useMemo(
    () => EVENT_SOURCES.map((source) => ({ source, features: bySource[source.id] ?? [] })),
    [bySource],
  );

  const sort = ((config.sort as string) ?? "severity") as FeedSort;
  const groupBy = readGroupBy(config);
  const collapsed = readCollapsed(config);
  const filters = useMemo(() => readFilters(config), [config]);

  // Project ALL in-scope/in-window rows (minTier S0) so the filter module owns the
  // tier/type/mag/region trim and the hidden count stays honest.
  const projected = useMemo(
    () =>
      projectEventFeed(inputs, scope, windowMsFor(win), now, {
        types: null,
        minTier: "S0",
        sort: sort === "nearest" && !scope.center ? "severity" : sort,
      }),
    [inputs, scope, win, now, sort],
  );
  const { rows: filtered, hidden } = useMemo(() => applyEventFilters(projected.rows, filters), [projected.rows, filters]);

  const threats = useMemo(() => assessThreats(filtered, assets), [filtered, assets]);
  const threatRows = useMemo(() => filtered.filter((e) => threats.has(e.id)), [filtered, threats]);
  const restRows = useMemo(() => filtered.filter((e) => !threats.has(e.id)), [filtered, threats]);

  // Proactive alerting (feature 5): the docked widget is the always-mounted driver.
  // On the first armed pass we take a SILENT baseline (existing events don't
  // stampede), then only genuinely-new matching events raise a browser Notification
  // and/or POST to the operator's webhook. All dormant-safe. Runs over the full
  // in-scope set (not the display filters) so alerting is independent of the view.
  const alerting = useAlerting();
  useEffect(() => {
    if (!alerting.rule.enabled) return;
    const fired = new Set(alerting.fired);
    const hits = matchAlerts(projected.rows, assets, alerting.rule, fired);
    if (!alerting.seeded) {
      alertingStore.markFired(hits.map((h) => h.eventId)); // silent baseline (may be empty)
      return;
    }
    if (hits.length === 0) return;
    for (const h of hits) {
      if (alerting.notify) fireBrowserNotification(h);
      if (alerting.webhookUrl) void postWebhook(alerting.webhookUrl, h);
      // Optional Telegram channel (configured in Settings; no-op unless enabled).
      sendTelegramIfEnabled(`⚠ ${h.tier} ${h.type}: ${h.title} — ${Math.round(h.distanceKm)} km from ${h.assetName}`);
    }
    alertingStore.markFired(hits.map((h) => h.eventId));
  }, [projected.rows, assets, alerting]);

  const featureIndex = useMemo(() => {
    const m = new Map<string, { feature: SignalFeature; sourceLabel: string }>();
    for (const s of EVENT_SOURCES) for (const f of bySource[s.id] ?? []) m.set(f.id, { feature: f, sourceLabel: s.label });
    return m;
  }, [bySource]);

  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  const onOpen = useCallback((e: NormalizedEvent, f?: SignalFeature) => {
    const hit = featureIndex.get(e.id);
    openEvent(e, f ?? hit?.feature, hit?.sourceLabel);
    setFlashId(e.id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1200);
  }, [featureIndex]);

  const setGroupBy = (g: GroupBy) => shellLayoutStore.configure(instanceId, { evGroupBy: g });
  const onToggleGroup = (key: string) =>
    shellLayoutStore.configure(instanceId, { evCollapsed: toggleCollapsed(collapsed, groupBy, key) });
  const clearFilters = () =>
    shellLayoutStore.configure(instanceId, { evMinTier: "S0", evMinQuakeMag: 0, evTypes: null, evRegions: null });

  const groups: EventGroup[] = useMemo(() => {
    if (groupBy === "region") return groupByRegion(restRows);
    if (groupBy === "type") return groupByType(restRows);
    return [{ key: "all", label: "All events", events: restRows }];
  }, [groupBy, restRows]);

  const lite: EventLite[] = useMemo(
    () =>
      filtered.map((r) => ({
        id: r.id,
        type: r.type,
        tier: r.severity.tier,
        title: r.title,
        magnitude: r.magnitude?.value,
      })),
    [filtered],
  );

  const exportRows = useMemo(
    () =>
      filtered.map((r) => ({
        tier: r.severity.tier,
        type: r.type,
        title: r.title,
        place: r.place.name,
        magnitude: r.magnitude?.value ?? "",
        unit: r.magnitude?.unit ?? "",
        lat: r.geo.lat,
        lon: r.geo.lon,
        threat: threats.has(r.id) ? `${Math.round(threats.get(r.id)!.distanceKm)}km from ${threats.get(r.id)!.assetName}` : "",
      })),
    [filtered, threats],
  );
  const exportGeo = useMemo(
    () =>
      filtered.map((r) => ({
        lat: r.geo.lat,
        lon: r.geo.lon,
        properties: { tier: r.severity.tier, type: r.type, title: r.title, place: r.place.name, magnitude: r.magnitude?.value },
      })),
    [filtered],
  );

  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: runAlertRule(eventAlerts, lite, config),
      count: filtered.length,
      // Was the string "5m" — the configured cadence, not an observation. Events
      // fan out over several upstreams, so a partial outage is the common failure:
      // `ok` is false only when EVERY source failed, and the count is the raw
      // feature total across sources (not the scope/time-filtered row count).
      fresh: {
        lastOk: updatedAt,
        ok: okCount > 0,
        count: Object.values(bySource).reduce((n, f) => n + f.length, 0),
        refreshMs: EVENT_POLL_MS,
        coverage: { ok: okCount, total },
      },
      export: { rows: exportRows, geo: exportGeo, name: "events" },
    });
  }, [lite, filtered.length, report, config, exportRows, exportGeo, updatedAt, okCount, bySource]);

  if (status === "loading" && filtered.length === 0 && hidden === 0) {
    return <p className="tn-w-empty">Loading events…</p>;
  }

  const flat = groupBy === "none";
  const renderRow = (e: NormalizedEvent) => {
    const hit = featureIndex.get(e.id);
    return <EventRow key={e.id} e={e} feature={hit?.feature} threat={threats.get(e.id)} flashed={flashId === e.id} onOpen={onOpen} />;
  };

  return (
    <div className="tn-ev">
      <div className="tn-ev-tabs" role="tablist" aria-label="Group events by">
        {GROUP_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={groupBy === t.id}
            className={`tn-ev-tab${groupBy === t.id ? " is-active" : ""}`}
            onClick={() => setGroupBy(t.id)}
          >
            {t.label}
          </button>
        ))}
        {hidden > 0 && (
          <button className="tn-ev-hidden" onClick={clearFilters} title="Filtered out by your signal-to-noise settings. Click to clear filters.">
            {hidden} hidden ✕
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="tn-w-empty">
          {hidden > 0 ? `All ${hidden} events hidden by filters in ${scope.label}.` : `No events in ${scope.label}.`}
        </p>
      )}

      {threatRows.length > 0 && (
        <section className="tn-ev-group tn-ev-threats">
          <div className="tn-ev-group-h tn-ev-threats-h">
            <span aria-hidden>⚠</span>
            <span className="tn-ev-group-label">Direct Operational Threats</span>
            <span className="tn-ev-group-count">{threatRows.length}</span>
          </div>
          <ul className="tn-w-list">{threatRows.slice(0, 100).map(renderRow)}</ul>
        </section>
      )}

      {restRows.length > 0 && (
        flat ? (
          <ul className="tn-w-list">{groups[0].events.slice(0, 200).map(renderRow)}</ul>
        ) : (
          <div className="tn-ev-groups">
            {groups.map((g) => {
              const open = !isCollapsed(collapsed, groupBy, g.key);
              return (
                <section key={g.key} className="tn-ev-group">
                  <button
                    type="button"
                    className="tn-ev-group-h"
                    aria-expanded={open}
                    onClick={() => onToggleGroup(g.key)}
                  >
                    <span className={`tn-ev-chev${open ? " is-open" : ""}`} aria-hidden>▸</span>
                    <span className="tn-ev-group-label">{g.label}</span>
                    <span className="tn-ev-group-count">{g.events.length}</span>
                  </button>
                  {open && <ul className="tn-w-list">{g.events.slice(0, 200).map(renderRow)}</ul>}
                </section>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

export const EVENTS_WIDGET = {
  id: "events",
  title: "Disasters & Events",
  icon: "🌎",
  category: "Events",
  defaultHeight: 320,
  defaultConfig: { minTier: "S1", sort: "severity", evGroupBy: "region" },
  component: EventsBody,
  detail: EventsDetail,
  // Three sources, named. The old note advertised "floods, outbreaks" and "partner
  // hazard feeds"; EVENT_SOURCES has exactly USGS quakes, GDACS alerts and NHC
  // cyclones, and nothing here has ever carried an outbreak.
  help: {
    what: "Earthquakes, GDACS disaster alerts and active cyclones, tiered by severity and grouped by region — with anything whose modelled impact radius reaches one of your assets escalated to the top.",
    source: "USGS + GDACS + NOAA NHC (keyless)",
  },
  capabilities: { filter: true, sort: true },
};
registerWidget(EVENTS_WIDGET);
