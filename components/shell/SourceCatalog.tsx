"use client";
// Source Catalog — the redesigned left rail. It is LayerRail's full control set
// (presets, monitor bar, camera region/live filters, global-signal feeds, coverage/
// markets/watchlist entry points) PLUS the "widgetize everything" affordances:
//   • a search box that filters every source by label,
//   • a per-source ▦ toggle that docks/undocks that source as its own widget tile,
//   • a per-group ▦ toggle that docks the group's roll-up widget,
//   • a header counter of how many sources are currently widgeted.
// Map on/off still flips lib/layers / lib/signals (so a hidden source stops
// fetching); the widget toggle writes the active variant's dock layout via
// lib/widgets/dock. Both states are shown side by side so the rail is the one
// place to answer "is this on the map, and is it a widget?".

import { useState } from "react";
import {
  useLayers,
  layersStore,
  LAYER_PRESETS,
  ACTIVE_LAYERS,
  PLANNED_LAYERS,
  type LayerKey,
} from "@/lib/layers";
import { signalsByGroup } from "@/lib/signals/registry";
import { signalsStore, useSignals, useSignalCounts } from "@/lib/signals/store";
import {
  useSignalFreshness,
  classifySignalFreshness,
  signalFreshAgeMs,
  signalFreshLabel,
} from "@/lib/signals/freshness";
import { useMetrics } from "@/lib/metrics";
import { useFreshness, classifyFreshness, freshnessAgeMs, type FreshSourceId } from "@/lib/freshness";
import { useCameraFilter, cameraFilterStore } from "@/lib/cameraFilter";
import { coverageStore } from "@/lib/shell/coverage";
import { marketsStore } from "@/lib/shell/markets";
import { watchlistPanelStore } from "@/lib/shell/watchlist";
import { useNow, formatAge } from "@/lib/shell/useNow";
import { CAMERA_REGIONS, CAMERA_FEED_META } from "@/lib/icons/svg";
import { useT } from "@/lib/i18n/store";
import MonitorBar from "@/components/shell/MonitorBar";
import TimeWindowControl from "@/components/shell/TimeWindowControl";
import { useVariant, useLayout } from "@/lib/variants/store";
import { toggleTileDock } from "@/lib/widgets/dock";
import { sourceKey, rollupKey } from "@/lib/widgets/registry";
import { SOURCE_CATALOG } from "@/lib/sources/catalog";
import { useCapabilityStatus } from "@/lib/sources/useStatus";

interface LayerMeta {
  name: string;
  group: string;
  accent: string;
  source: string;
  fresh?: FreshSourceId;
  planned?: boolean;
}

const LAYER_META: Record<LayerKey, LayerMeta> = {
  cameras: { name: "Cameras", group: "Ground", accent: "#0e7d97", source: "TfL · Caltrans · SCDOT · Digitraffic · 511 · DriveBC", fresh: "cameras" },
  planes: { name: "Planes", group: "Air", accent: "#d97706", source: "adsb.lol — live ADS-B", fresh: "planes" },
  satellites: { name: "Satellites", group: "Space", accent: "#7c3aed", source: "CelesTrak TLE · SGP4 (local)", fresh: "satellites" },
  ships: { name: "Ships", group: "Sea", accent: "#0d9488", source: "AIS vessels", planned: true },
  webcams: { name: "Webcams", group: "Ground", accent: "#ec4899", source: "Windy.com — global webcams", fresh: "webcams" },
  weather: { name: "Weather", group: "Sky", accent: "#0284c7", source: "Radar & events", planned: true },
  countries: { name: "Borders & names", group: "Reference", accent: "#94a3b8", source: "Natural Earth — clickable countries" },
};

function Toggle({ on, accent, onClick, label }: { on: boolean; accent: string; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="tn-toggle"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      style={{ background: on ? accent : "var(--tn-toggle-off)" }}
    >
      <span className="tn-toggle-knob" style={{ left: on ? 18 : 2 }} />
    </button>
  );
}

// ＋ / ▦ — adds or removes this source (or group roll-up) as a dock widget tile.
function WidgetToggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="tn-widget-toggle"
      data-on={on}
      aria-pressed={on}
      title={on ? `Remove the ${label} widget` : `Add ${label} as a widget`}
      aria-label={on ? `Remove the ${label} widget` : `Add ${label} as a widget`}
      onClick={onClick}
    >
      {on ? "▦" : "＋"}
    </button>
  );
}

function FreshNote({ fresh }: { fresh?: FreshSourceId }) {
  const records = useFreshness();
  const now = useNow(1000);
  if (!fresh) return null;
  const rec = records.find((r) => r.id === fresh);
  if (!rec) return null;
  const state = classifyFreshness(rec, now);
  const age = freshnessAgeMs(rec, now);
  const text = rec.local
    ? "live · local"
    : state === "unknown"
      ? "connecting…"
      : `updated ${formatAge(age)} ago`;
  return (
    <span className={`tn-fresh tn-fresh-${state}`}>
      <span className="tn-fresh-dot" aria-hidden />
      {text}
    </span>
  );
}

function CameraFilters() {
  const filter = useCameraFilter();
  const feeds = Object.values(CAMERA_FEED_META);
  return (
    <div className="tn-cam-filters">
      <div className="tn-subhead">Feed</div>
      <div className="tn-feed-row">
        {feeds.map((f) => (
          <span key={f.key} className="tn-feed-chip">
            {f.label}
          </span>
        ))}
        <button
          type="button"
          className="tn-liveonly"
          aria-pressed={filter.liveOnly}
          onClick={() => cameraFilterStore.setLiveOnly(!filter.liveOnly)}
        >
          <span className="tn-liveonly-dot" data-on={filter.liveOnly} />
          Live video only
        </button>
      </div>
      <div className="tn-subhead">Region — click to filter</div>
      <div className="tn-region-grid">
        {CAMERA_REGIONS.map((r) => {
          const on = filter.regions[r.source] ?? true;
          return (
            <button
              key={r.source}
              type="button"
              className="tn-region-chip"
              aria-pressed={on}
              title={`${on ? "Hide" : "Show"} ${r.label}`}
              style={{ opacity: on ? 1 : 0.4 }}
              onClick={() => cameraFilterStore.toggleRegion(r.source)}
            >
              <span className="tn-region-dot" style={{ background: r.color }} />
              <span style={{ textDecoration: on ? "none" : "line-through" }}>{r.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LayerRow({
  layerKey,
  count,
  expandable,
  widgeted,
  activeId,
}: {
  layerKey: LayerKey;
  count: number | null;
  expandable?: boolean;
  widgeted: boolean;
  activeId: string;
}) {
  const layers = useLayers();
  const meta = LAYER_META[layerKey];
  const [open, setOpen] = useState(false);
  const on = layers[layerKey];

  if (meta.planned) {
    return (
      <div className="tn-layer-row tn-layer-planned">
        <span className="tn-layer-dot" style={{ background: meta.accent }} />
        <div className="tn-layer-main">
          <span className="tn-layer-name">{meta.name}</span>
          <span className="tn-layer-source">{meta.source}</span>
        </div>
        <span className="tn-soon">soon</span>
      </div>
    );
  }

  return (
    <div className="tn-layer-row" style={{ opacity: on ? 1 : 0.55 }}>
      <button
        type="button"
        className="tn-layer-head"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="tn-layer-dot" style={{ background: meta.accent, boxShadow: on ? `0 0 7px ${meta.accent}88` : "none" }} />
        <div className="tn-layer-main">
          <span className="tn-layer-name">
            {meta.name}
            {expandable ? <span className="tn-layer-caret" data-open={open}>›</span> : null}
          </span>
          <span className="tn-layer-source">{meta.source}</span>
          <FreshNote fresh={meta.fresh} />
        </div>
      </button>
      <span className="tn-layer-count tn-num">{count == null ? "—" : count.toLocaleString()}</span>
      <WidgetToggle on={widgeted} label={meta.name} onClick={() => toggleTileDock(activeId, sourceKey(layerKey))} />
      <Toggle on={on} accent={meta.accent} label={`Toggle ${meta.name}`} onClick={() => layersStore.toggle(layerKey)} />
      {expandable && open && on ? <CameraFilters /> : null}
    </div>
  );
}

// The clickable-countries reference layer — borders + names + a click target.
// Not a data feed, so it gets a plain toggle (no live count, no widget dock).
function CountriesRow() {
  const layers = useLayers();
  const meta = LAYER_META.countries;
  const on = layers.countries;
  return (
    <div className="tn-layer-row" style={{ opacity: on ? 1 : 0.55 }}>
      <div className="tn-layer-head" style={{ cursor: "default" }}>
        <span
          className="tn-layer-dot"
          style={{ background: meta.accent, boxShadow: on ? `0 0 7px ${meta.accent}88` : "none" }}
        />
        <div className="tn-layer-main">
          <span className="tn-layer-name">{meta.name}</span>
          <span className="tn-layer-source">{meta.source}</span>
        </div>
      </div>
      <Toggle on={on} accent={meta.accent} label={`Toggle ${meta.name}`} onClick={() => layersStore.toggle("countries")} />
    </div>
  );
}

function SignalFreshNote({ id, refreshMs }: { id: string; refreshMs: number }) {
  const records = useSignalFreshness();
  const now = useNow(1000);
  const raw = records[id];
  if (!raw) return null;
  const rec = { ...raw, refreshMs };
  const state = classifySignalFreshness(rec, now);
  const age = signalFreshAgeMs(rec, now);
  const text = signalFreshLabel(state, age == null ? "" : formatAge(age));
  return (
    <span className={`tn-fresh tn-fresh-${state}`}>
      <span className="tn-fresh-dot" aria-hidden />
      {text}
    </span>
  );
}

/**
 * "Locked — needs a key" for a layer this deployment cannot fetch.
 *
 * Without it, a key-gated layer renders zero and is indistinguishable from a dead
 * upstream or a genuinely quiet feed — the visitor concludes the product is
 * broken. The badge is deliberately grey, not red: a locked layer is a
 * configuration fact, not a fault.
 */
function LockedBadge({ id }: { id: string }) {
  const status = useCapabilityStatus(id);
  if (!status || status.state !== "locked") return null;
  const title = [
    `Locked — this deployment has no ${status.missingEnv.join(" + ")}.`,
    status.degrades,
    status.obtain,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className="tn-layer-locked" title={title}>
      🔑 needs a key
    </span>
  );
}

function SignalRow({
  id,
  label,
  color,
  attribution,
  refreshMs,
  widgeted,
  activeId,
}: {
  id: string;
  label: string;
  color: string;
  attribution: string;
  refreshMs: number;
  widgeted: boolean;
  activeId: string;
}) {
  const on = useSignals()[id] === true;
  const count = useSignalCounts()[id];
  const countLabel = count != null ? count.toLocaleString() : on ? "…" : "—";
  return (
    <div className="tn-layer-row" style={{ opacity: on ? 1 : 0.55 }}>
      <div className="tn-layer-head" style={{ cursor: "default" }}>
        <span
          className="tn-layer-dot"
          style={{ background: color, boxShadow: on ? `0 0 7px ${color}88` : "none" }}
        />
        <div className="tn-layer-main">
          <span className="tn-layer-name">
            {label}
            <LockedBadge id={id} />
          </span>
          <span className="tn-layer-source">{attribution}</span>
          {on ? <SignalFreshNote id={id} refreshMs={refreshMs} /> : null}
        </div>
      </div>
      <span className="tn-layer-count tn-num">{countLabel}</span>
      <WidgetToggle on={widgeted} label={label} onClick={() => toggleTileDock(activeId, sourceKey(id))} />
      <Toggle on={on} accent={color} label={`Toggle ${label}`} onClick={() => signalsStore.toggle(id)} />
    </div>
  );
}

function GlobalSignals({
  match,
  forceOpen,
  activeId,
  widgetedIds,
}: {
  match: (label: string) => boolean;
  forceOpen: boolean;
  activeId: string;
  widgetedIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const groups = signalsByGroup();
  const onCount = useSignals();
  const t = useT();
  const isOpen = open || forceOpen;
  const activeCount = SOURCE_CATALOG.filter((s) => s.kind === "signal" && onCount[s.id]).length;
  return (
    <div className="tn-signals">
      <button
        type="button"
        className="tn-signals-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={isOpen}
      >
        <span className="tn-signals-title">
          {t("sectionGlobalSignals")}
          {activeCount > 0 ? <span className="tn-signals-badge">{activeCount}</span> : null}
        </span>
        <span className="tn-layer-caret" data-open={isOpen}>
          ›
        </span>
      </button>
      {isOpen && (
        <div className="tn-signals-body">
          <TimeWindowControl />
          {groups.map((g) => {
            const sources = g.sources.filter((s) => match(s.label));
            if (sources.length === 0) return null;
            return (
              <div key={g.group} className="tn-rail-section">
                <div className="tn-subhead tn-subhead-row">
                  <span>{g.group}</span>
                  <WidgetToggle
                    on={widgetedIds.has(rollupKey(g.group))}
                    label={`${g.group} roll-up`}
                    onClick={() => toggleTileDock(activeId, rollupKey(g.group))}
                  />
                </div>
                {sources.map((s) => (
                  <SignalRow
                    key={s.id}
                    id={s.id}
                    label={s.label}
                    color={s.color}
                    attribution={s.attribution}
                    refreshMs={s.refreshMs}
                    widgeted={widgetedIds.has(sourceKey(s.id))}
                    activeId={activeId}
                  />
                ))}
              </div>
            );
          })}
          <p className="tn-rail-foot">
            Opt-in intelligence layers — hazards, conflict, cyber, maritime, human cost &amp; the
            Country Instability Index. Fetched only while on; most are keyless, a few unlock with a
            free key. Each is attributed and shows its own live freshness.
          </p>
        </div>
      )}
    </div>
  );
}

export default function SourceCatalog() {
  const [railOpen, setRailOpen] = useState(true);
  const [query, setQuery] = useState("");
  const m = useMetrics();
  const t = useT();
  const { activeId } = useVariant();
  const layout = useLayout(activeId);

  const widgetedIds = new Set(layout.filter((p) => p.visible).map((p) => p.panel));
  const widgetCount = layout.filter(
    (p) => p.visible && (p.panel.startsWith("source:") || p.panel.startsWith("rollup:")),
  ).length;

  const q = query.trim().toLowerCase();
  const match = (label: string): boolean => q === "" || label.toLowerCase().includes(q);

  const count = (k: LayerKey): number | null => {
    if (k === "cameras") return m.camerasTotal || null;
    if (k === "planes") return m.planes;
    if (k === "satellites") return m.satellites;
    if (k === "webcams") return m.webcams || null;
    return null;
  };

  if (!railOpen) {
    return (
      <button type="button" className="tn-rail-fab" onClick={() => setRailOpen(true)} title="Show sources">
        <span className="tn-rail-fab-bars" aria-hidden>≡</span>
        Sources
      </button>
    );
  }

  const visibleActive = ACTIVE_LAYERS.filter((k) => match(LAYER_META[k].name));
  const visiblePlanned = q === "" ? PLANNED_LAYERS : PLANNED_LAYERS.filter((k) => match(LAYER_META[k].name));

  return (
    <aside className="tn-rail" aria-label="Sources">
      <div className="tn-rail-header">
        <span className="tn-rail-title">Sources</span>
        <span className="tn-cat-count" title="Sources docked as widgets">
          {widgetCount} ▦
        </span>
        <button type="button" className="tn-rail-collapse" onClick={() => setRailOpen(false)} aria-label="Collapse sources">
          ‹
        </button>
      </div>

      <input
        type="search"
        className="tn-cat-search"
        placeholder="Search sources…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search sources"
      />

      <MonitorBar />

      <div className="tn-presets" role="group" aria-label="Layer presets">
        {LAYER_PRESETS.map((p) => (
          <button key={p.id} type="button" className="tn-preset-btn" onClick={() => layersStore.applyPreset(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="tn-rail-section">
        {visibleActive.map((k) => (
          <LayerRow
            key={k}
            layerKey={k}
            count={count(k)}
            expandable={k === "cameras"}
            widgeted={widgetedIds.has(sourceKey(k))}
            activeId={activeId}
          />
        ))}
      </div>

      {visiblePlanned.length > 0 ? (
        <>
          <div className="tn-rail-divider" />
          <div className="tn-rail-section">
            {visiblePlanned.map((k) => (
              <LayerRow key={k} layerKey={k} count={null} widgeted={false} activeId={activeId} />
            ))}
          </div>
        </>
      ) : null}

      {match(LAYER_META.countries.name) ? (
        <>
          <div className="tn-rail-divider" />
          <div className="tn-rail-section">
            <CountriesRow />
          </div>
        </>
      ) : null}

      <div className="tn-rail-divider" />

      <GlobalSignals match={match} forceOpen={q !== ""} activeId={activeId} widgetedIds={widgetedIds} />

      <div className="tn-rail-divider" />

      <button type="button" className="tn-coverage-open" onClick={() => coverageStore.open()}>
        {t("btnCoverage")}
      </button>

      <button type="button" className="tn-coverage-open" onClick={() => marketsStore.open()}>
        {t("btnMarkets")}
      </button>

      <button type="button" className="tn-coverage-open" onClick={() => watchlistPanelStore.open()}>
        ★ {t("sectionSaved")}
      </button>

      <p className="tn-rail-foot">Only sources you can see are fetched. ▦ docks any source as a live widget.</p>
    </aside>
  );
}
