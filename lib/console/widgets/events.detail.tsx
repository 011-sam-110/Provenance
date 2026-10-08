// lib/console/widgets/events.detail.tsx
"use client";
// Events focus view — the operations console for the Disasters & Events feed.
// Reuses the SAME feed pipeline as the docked widget (useEventFeeds →
// projectEventFeed) but renders deep: a tier triage header, a recency chart, an
// event/asset map, persisted signal-to-noise FILTERS, an operator ASSET manager
// (add by form or by clicking the map), a pinned Direct Operational Threats board,
// and a region/type clustered feed with per-domain metric lines. Rows fly the
// globe + open the dossier. All heavy logic is pure + unit-tested in
// lib/events/{regions,filters,assets,opsConfig}.ts; this is the shell.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WidgetDetailProps } from "@/lib/console/registry";
import { EVENT_SOURCES } from "@/lib/events/sources";
import { useEventFeeds } from "@/lib/widgets/useEventFeeds";
import { projectEventFeed, type FeedInput } from "@/lib/widgets/eventFeed";
import { useScope } from "@/lib/shell/scope";
import { useTimeWindow, windowMsFor } from "@/lib/shell/timeWindow";
import { useNow } from "@/lib/shell/useNow";
import { shellLayoutStore } from "@/lib/console/store";
import { mapViewStore } from "@/lib/mapView";
import { SEVERITY_COLOR, type SeverityTier, type EventType, type NormalizedEvent } from "@/lib/events/model";
import type { SignalFeature } from "@/lib/signals/types";
import { countBy } from "@/lib/widgets/buckets";
import { eventMetricLine } from "@/lib/widgets/eventMetrics";
import { timeBins } from "@/lib/widgets/buckets";
import { Chart, type ChartPoint } from "@/components/Chart";
import InsetMap from "@/components/InsetMap";
import type { InsetPoint } from "@/lib/map/inset";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";
import ExportExtras from "@/components/console/ExportExtras";
import { groupByRegion, groupByType, regionOf, REGION_LABEL, TYPE_LABEL, type RegionId, type EventGroup } from "@/lib/events/regions";
import { readGroupBy, readCollapsed, isCollapsed, toggleCollapsed, type GroupBy } from "@/lib/events/opsConfig";
import { readFilters, applyEventFilters, toggleAllowSet, isAllowed } from "@/lib/events/filters";
import { useAssets, assessThreats, makeAsset, assetsStore, impactRadiusKm } from "@/lib/events/assets";
import { useAlerting, alertingStore, requestNotifyPermission } from "@/lib/events/alerting";
import { nearbyHubs, HUB_TYPE_LABEL } from "@/lib/events/hubs";
import { openEvent } from "@/lib/events/openEvent";

const TIERS: SeverityTier[] = ["S4", "S3", "S2", "S1", "S0"];
const TIER_CHOICES: SeverityTier[] = ["S0", "S1", "S2", "S3", "S4"];
const GROUP_TABS: { id: GroupBy; label: string }[] = [
  { id: "region", label: "By region" },
  { id: "type", label: "By hazard" },
  { id: "none", label: "Flat" },
];
const ASSET_COLOR = "#2563eb";

export default function EventsDetail({ instanceId, config }: WidgetDetailProps) {
  const scope = useScope();
  const win = useTimeWindow();
  const now = useNow(60_000);
  const { bySource, status, updatedAt } = useEventFeeds();
  const assets = useAssets();

  const inputs: FeedInput[] = useMemo(
    () => EVENT_SOURCES.map((source) => ({ source, features: bySource[source.id] ?? [] })),
    [bySource],
  );
  const groupBy = readGroupBy(config);
  const collapsed = readCollapsed(config);
  const filters = useMemo(() => readFilters(config), [config]);

  const projected = useMemo(
    () => projectEventFeed(inputs, scope, windowMsFor(win), now, { types: null, minTier: "S0", sort: "severity" }),
    [inputs, scope, win, now],
  );
  const { rows: filtered, hidden } = useMemo(() => applyEventFilters(projected.rows, filters), [projected.rows, filters]);

  const threats = useMemo(() => assessThreats(filtered, assets), [filtered, assets]);
  const threatRows = useMemo(() => filtered.filter((e) => threats.has(e.id)), [filtered, threats]);
  const restRows = useMemo(() => filtered.filter((e) => !threats.has(e.id)), [filtered, threats]);

  // Universes for the chip filters = types/regions PRESENT before filtering, so a
  // chip never vanishes the moment you deselect it.
  const typeUniverse = useMemo(() => {
    const seen = new Set<EventType>();
    for (const e of projected.rows) seen.add(e.type);
    return [...seen];
  }, [projected.rows]);
  const regionUniverse = useMemo(() => {
    const seen = new Set<RegionId>();
    for (const e of projected.rows) seen.add(regionOf(e.geo.lat, e.geo.lon));
    return [...seen];
  }, [projected.rows]);

  const featureIndex = useMemo(() => {
    const m = new Map<string, { feature: SignalFeature; sourceLabel: string }>();
    for (const s of EVENT_SOURCES) for (const f of bySource[s.id] ?? []) m.set(f.id, { feature: f, sourceLabel: s.label });
    return m;
  }, [bySource]);

  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  const onOpen = useCallback((e: NormalizedEvent) => {
    const hit = featureIndex.get(e.id);
    openEvent(e, hit?.feature, hit?.sourceLabel);
    setFlashId(e.id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1200);
  }, [featureIndex]);

  // --- Asset manager state (add form + click-to-add) -------------------------
  const [addMode, setAddMode] = useState(false);
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);
  const submitAsset = () => {
    const a = makeAsset(name || "Asset", Number(lat), Number(lon));
    if (!a) { setAddErr("Enter a name and valid lat (−90..90) / lon (−180..180)."); return; }
    assetsStore.add(a);
    setName(""); setLat(""); setLon(""); setAddErr(null);
  };
  const onMapClick = useCallback((clat: number, clon: number) => {
    const a = makeAsset(name.trim() || `POI ${clat.toFixed(2)}, ${clon.toFixed(2)}`, clat, clon);
    if (a) assetsStore.add(a);
  }, [name]);

  // --- Proactive alerting config (feature 5) ---------------------------------
  const alerting = useAlerting();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) { setPerm("unsupported"); return; }
    setPerm(Notification.permission);
  }, []);
  const enableNotify = async () => {
    const ok = await requestNotifyPermission();
    setPerm(typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");
    alertingStore.setNotify(ok);
  };

  const onSelectId = useCallback((id: string) => {
    if (id.startsWith("asset:")) {
      const a = assets.find((x) => `asset:${x.id}` === id);
      if (a) mapViewStore.flyToPoint({ lat: a.lat, lon: a.lon, zoom: 6 });
      return;
    }
    const e = projected.rows.find((r) => r.id === id);
    if (e) onOpen(e);
  }, [projected.rows, onOpen, assets]);

  // --- Config writers --------------------------------------------------------
  const setGroupBy = (g: GroupBy) => shellLayoutStore.configure(instanceId, { evGroupBy: g });
  const onToggleGroup = (key: string) =>
    shellLayoutStore.configure(instanceId, { evCollapsed: toggleCollapsed(collapsed, groupBy, key) });
  const setMinTier = (t: SeverityTier) => shellLayoutStore.configure(instanceId, { evMinTier: t });
  const setMinMag = (m: number) => shellLayoutStore.configure(instanceId, { evMinQuakeMag: m });
  const toggleType = (t: EventType) =>
    shellLayoutStore.configure(instanceId, { evTypes: toggleAllowSet(filters.types, t, typeUniverse) });
  const toggleRegion = (r: RegionId) =>
    shellLayoutStore.configure(instanceId, { evRegions: toggleAllowSet(filters.regions, r, regionUniverse) });
  const clearFilters = () =>
    shellLayoutStore.configure(instanceId, { evMinTier: "S0", evMinQuakeMag: 0, evTypes: null, evRegions: null });

  const tierCounts = useMemo(() => countBy(filtered, (e) => e.severity.tier), [filtered]);
  const groups: EventGroup[] = useMemo(() => {
    if (groupBy === "region") return groupByRegion(restRows);
    if (groupBy === "type") return groupByType(restRows);
    return [{ key: "all", label: "All events", events: restRows }];
  }, [groupBy, restRows]);

  // Logistics exposure (feature 6): severe events with curated hubs in reach.
  const exposure = useMemo(() => {
    const severe = filtered.filter((e) => e.severity.tier === "S3" || e.severity.tier === "S4");
    return severe
      .map((e) => { const radiusKm = impactRadiusKm(e); return { event: e, radiusKm, hubs: nearbyHubs(e, radiusKm).slice(0, 5) }; })
      .filter((x) => x.hubs.length > 0)
      .slice(0, 8);
  }, [filtered]);

  const recency: ChartPoint[] = useMemo(() => {
    const ts = filtered
      .map((e) => (e.occurredAt ? Date.parse(e.occurredAt) : NaN))
      .filter((n) => Number.isFinite(n));
    return timeBins(ts, 60 * 60_000, now, 24 * 60 * 60_000).map((b) => ({ x: b.start, y: b.count }));
  }, [filtered, now]);

  const mapPoints: InsetPoint[] = useMemo(() => {
    const evPts: InsetPoint[] = filtered.map((e) => ({
      lat: e.geo.lat, lon: e.geo.lon, id: e.id, color: threats.has(e.id) ? "#dc2626" : e.color,
      props: { title: e.title, tier: e.severity.tier },
    }));
    const assetPts: InsetPoint[] = assets.map((a) => ({
      lat: a.lat, lon: a.lon, id: `asset:${a.id}`, color: ASSET_COLOR, props: { title: a.name },
    }));
    return [...evPts, ...assetPts];
  }, [filtered, threats, assets]);

  const perSource = useMemo(() => {
    const counts = countBy(filtered, (e) => e.source.id);
    return EVENT_SOURCES.map((s) => ({ id: s.id, label: s.label, attribution: s.attribution, count: counts[s.id] ?? 0 }));
  }, [filtered]);

  const exportRows = useMemo(
    () => filtered.map((e) => ({
      tier: e.severity.tier, type: e.type, title: e.title, place: e.place.name,
      metric: eventMetricLine(e.type, featureIndex.get(e.id)?.feature.props),
      threat: threats.has(e.id) ? `${Math.round(threats.get(e.id)!.distanceKm)}km from ${threats.get(e.id)!.assetName}` : "",
      lat: e.geo.lat, lon: e.geo.lon, occurredAt: e.occurredAt ?? "",
    })),
    [filtered, featureIndex, threats],
  );
  const exportGeo = useMemo(
    () => filtered.map((e) => ({ lat: e.geo.lat, lon: e.geo.lon, properties: { tier: e.severity.tier, type: e.type, title: e.title } })),
    [filtered],
  );

  const renderRow = (e: NormalizedEvent) => {
    const metric = eventMetricLine(e.type, featureIndex.get(e.id)?.feature.props);
    const threat = threats.get(e.id);
    return (
      <li key={e.id} className={threat ? "is-threat" : undefined}>
        <button
          type="button"
          className={`tn-evd-rowbtn${flashId === e.id ? " is-flash" : ""}`}
          onClick={() => onOpen(e)}
          title="Click to fly the map here and open the dossier"
        >
          <span className="tn-w-sev" style={{ background: SEVERITY_COLOR[e.severity.tier] }}>{e.severity.tier}</span>{" "}
          <b>{e.title}</b> <span className="tn-w-place">{e.place.name}</span>
          {threat && <span className="tn-ev-threat-chip">⚠ {Math.round(threat.distanceKm)}km · {threat.assetName}</span>}
          {metric && <span className="tn-evd-metric"> · {metric}</span>}
        </button>
        {e.link && <a className="tn-evd-src" href={e.link} target="_blank" rel="noreferrer"> source ↗</a>}
      </li>
    );
  };

  return (
    <div className="tn-evd">
      <div className="tn-evd-head">
        <div className="tn-evd-stat"><b>{filtered.length}</b> of {projected.total} events{hidden > 0 ? ` · ${hidden} hidden by filters` : ""}</div>
        <div className="tn-evd-scope">{scope.label}{updatedAt ? ` · updated ${Math.round((now - updatedAt) / 60000)}m ago` : ""}</div>
        <div className="tn-evd-tiers">
          {TIERS.map((t) => (
            <span key={t} className="tn-evd-tier" style={{ borderColor: SEVERITY_COLOR[t] }}>
              <i style={{ background: SEVERITY_COLOR[t] }} /> {t} {tierCounts[t] ?? 0}
            </span>
          ))}
        </div>
      </div>

      <div className="tn-evd-panels">
        <div className="tn-evd-panel">
          <h3 className="tn-evd-group-h">Events over the last 24h</h3>
          {recency.some((p) => p.y > 0)
            ? <Chart points={recency} height={140} up={null} />
            : <p className="tn-w-empty">No timestamped events in the window.</p>}
        </div>
        <div className="tn-evd-panel">
          <h3 className="tn-evd-group-h">Locations{addMode ? " · click the map to drop an asset" : " · click a dot to fly"}</h3>
          {mapPoints.length > 0
            ? <InsetMap points={mapPoints} height={220} onSelect={onSelectId} onMapClick={addMode ? onMapClick : undefined} />
            : <p className="tn-w-empty">No mappable events right now.</p>}
        </div>
      </div>

      {/* Signal-to-noise filters + operator assets */}
      <div className="tn-evd-controls">
        <section className="tn-evd-ctl">
          <div className="tn-evd-ctl-h">
            <span>Signal-to-noise filters</span>
            {hidden > 0 && <button className="tn-evd-clear" onClick={clearFilters}>clear · {hidden} hidden</button>}
          </div>
          <div className="tn-evd-ctl-body">
            <label className="tn-evd-field">
              <span>Min severity</span>
              <select value={filters.minTier} onChange={(e) => setMinTier(e.target.value as SeverityTier)}>
                {TIER_CHOICES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="tn-evd-field">
              <span>Min quake M</span>
              <input
                type="number" min={0} max={9} step={0.5} value={filters.minQuakeMag || ""}
                placeholder="0"
                onChange={(e) => setMinMag(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            {typeUniverse.length > 1 && (
              <div className="tn-evd-chips" aria-label="Hazard types">
                {typeUniverse.map((t) => (
                  <button key={t} className={`tn-evd-chip${isAllowed(filters.types, t) ? " is-on" : ""}`} onClick={() => toggleType(t)}>
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
            {regionUniverse.length > 1 && (
              <div className="tn-evd-chips" aria-label="Regions">
                {regionUniverse.map((r) => (
                  <button key={r} className={`tn-evd-chip${isAllowed(filters.regions, r) ? " is-on" : ""}`} onClick={() => toggleRegion(r)}>
                    {REGION_LABEL[r]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="tn-evd-ctl">
          <div className="tn-evd-ctl-h">
            <span>My assets ({assets.length})</span>
            <button className={`tn-evd-clear${addMode ? " is-on" : ""}`} onClick={() => setAddMode((v) => !v)}>
              {addMode ? "click-to-add: ON" : "＋ click map"}
            </button>
          </div>
          <div className="tn-evd-ctl-body">
            <div className="tn-evd-assetform">
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <input placeholder="Lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
              <input placeholder="Lon" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
              <button onClick={submitAsset}>Add</button>
            </div>
            {addErr && <p className="tn-evd-err">{addErr}</p>}
            {assets.length === 0 ? (
              <p className="tn-w-empty">No assets yet. Add sites to flag events that threaten them.</p>
            ) : (
              <ul className="tn-evd-assetlist">
                {assets.map((a) => (
                  <li key={a.id}>
                    <button className="tn-evd-asset-go" onClick={() => mapViewStore.flyToPoint({ lat: a.lat, lon: a.lon, zoom: 6 })} title="Fly to asset">
                      <span className="tn-evd-asset-dot" style={{ background: ASSET_COLOR }} />
                      <span className="tn-evd-asset-name">{a.name}</span>
                      <span className="tn-evd-asset-coord">{a.lat.toFixed(2)}, {a.lon.toFixed(2)}</span>
                    </button>
                    <button className="tn-evd-asset-x" onClick={() => assetsStore.remove(a.id)} aria-label={`Remove ${a.name}`}>✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Proactive alerting (feature 5) */}
      <section className="tn-evd-ctl tn-evd-alerting">
        <div className="tn-evd-ctl-h">
          <span>Proactive alerting</span>
          <label className="tn-evd-armtoggle">
            <input type="checkbox" checked={alerting.rule.enabled} onChange={(e) => alertingStore.setRule({ enabled: e.target.checked })} />
            {alerting.rule.enabled ? "armed" : "off"}
          </label>
        </div>
        <div className="tn-evd-ctl-body">
          <label className="tn-evd-field">
            <span>Min tier</span>
            <select value={alerting.rule.minTier} onChange={(e) => alertingStore.setRule({ minTier: e.target.value as SeverityTier })}>
              {TIER_CHOICES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="tn-evd-field">
            <span>Within (km)</span>
            <input
              type="number" min={1} step={10} value={alerting.rule.radiusKm}
              onChange={(e) => alertingStore.setRule({ radiusKm: Math.max(1, Number(e.target.value) || 1) })}
            />
          </label>
          <button
            className={`tn-evd-chip${alerting.notify && perm === "granted" ? " is-on" : ""}`}
            onClick={enableNotify}
            disabled={perm === "unsupported"}
          >
            {perm === "unsupported" ? "notifications n/a" : alerting.notify && perm === "granted" ? "🔔 notifications on" : "enable notifications"}
          </button>
          <input
            className="tn-evd-webhook"
            placeholder="Webhook / Slack / PagerDuty incoming-webhook URL"
            value={alerting.webhookUrl}
            onChange={(e) => alertingStore.setWebhook(e.target.value)}
          />
        </div>
        <p className="tn-evd-note">
          {assets.length === 0
            ? "Add an asset above to arm proximity alerts."
            : `Fires from this browser while the console is open — new hazards ≥ ${alerting.rule.minTier} within ${alerting.rule.radiusKm} km of an asset.`}
          {perm === "denied" && " Browser notifications are blocked in your settings."}
        </p>
      </section>

      {status === "loading" && filtered.length === 0 && hidden === 0 && <p className="tn-w-empty">Loading events…</p>}
      {filtered.length === 0 && status !== "loading" && (
        <p className="tn-w-empty">
          {hidden > 0 ? `All ${hidden} events hidden by filters in ${scope.label}.` : `No events in ${scope.label}.`}
        </p>
      )}

      {threatRows.length > 0 && (
        <section className="tn-evd-group tn-evd-threatboard">
          <h3 className="tn-evd-group-h tn-evd-threatboard-h">⚠ Direct Operational Threats · {threatRows.length}</h3>
          <ul className="tn-evd-list">{threatRows.map(renderRow)}</ul>
        </section>
      )}

      {/* Logistics exposure (feature 6) — severe events near curated hubs */}
      {exposure.length > 0 && (
        <section className="tn-evd-group tn-evd-exposure">
          <h3 className="tn-evd-group-h">Logistics exposure · severe events near curated hubs</h3>
          <p className="tn-evd-note">
            Great-circle proximity only — hubs within each event&apos;s modelled impact radius (potential disruption, not a confirmed
            closure). Curated reference set of ~50 major ports, airports &amp; manufacturing clusters.
          </p>
          <ul className="tn-evd-exposure-list">
            {exposure.map(({ event, radiusKm, hubs }) => (
              <li key={event.id}>
                <button className="tn-evd-rowbtn" onClick={() => onOpen(event)} title="Click to fly the map here">
                  <span className="tn-w-sev" style={{ background: SEVERITY_COLOR[event.severity.tier] }}>{event.severity.tier}</span>{" "}
                  <b>{event.title}</b>
                  <span className="tn-evd-metric"> · {hubs.length} hub{hubs.length > 1 ? "s" : ""} within {Math.round(radiusKm)} km</span>
                </button>
                <div className="tn-evd-hubs">
                  {hubs.map(({ hub, distanceKm }) => (
                    <span key={hub.name} className="tn-evd-hub">{hub.name} <i>{HUB_TYPE_LABEL[hub.type]}</i> · {Math.round(distanceKm)} km</span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {restRows.length > 0 && (
        <div className="tn-evd-toolbar">
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
          </div>
        </div>
      )}

      {groups.map((g) => {
        const open = groupBy === "none" || !isCollapsed(collapsed, groupBy, g.key);
        return (
          <section key={g.key} className="tn-evd-group">
            {groupBy !== "none" && (
              <button
                type="button"
                className="tn-evd-group-toggle"
                aria-expanded={open}
                onClick={() => onToggleGroup(g.key)}
              >
                <span className={`tn-ev-chev${open ? " is-open" : ""}`} aria-hidden>▸</span>
                <span className="tn-evd-group-h">{g.label}</span>
                <span className="tn-ev-group-count">{g.events.length}</span>
              </button>
            )}
            {open && <ul className="tn-evd-list">{g.events.map(renderRow)}</ul>}
          </section>
        );
      })}

      <footer className="tn-evd-foot">
        <div className="tn-evd-sources">
          {perSource.map((s) => (
            <span key={s.id} className="tn-evd-source">{s.label} · {s.count} <i>({s.attribution})</i></span>
          ))}
        </div>
        <div className="tn-evd-export">
          <button
            disabled={exportRows.length === 0}
            onClick={() => downloadText(`${exportFilename("events", Date.now())}.csv`, "text/csv", toCsv(exportRows))}
          >⬇ CSV</button>
          <button
            disabled={exportGeo.length === 0}
            onClick={() => downloadText(`${exportFilename("events", Date.now())}.geojson`, "application/geo+json", toGeoJson(exportGeo))}
          >⬇ GeoJSON</button>
          <ExportExtras
            name="events"
            kind="events"
            rows={exportRows}
            geo={exportGeo}
            source={perSource.map((s) => (s.label.includes(s.attribution) ? s.label : `${s.label} (${s.attribution})`)).join("; ")}
          />
        </div>
      </footer>
    </div>
  );
}
