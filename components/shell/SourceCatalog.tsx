"use client";
// Source Catalog — the left rail, rebuilt as six sections of two-column bullet rows.
//
// WHAT CHANGED AND WHY. The rail used to be a single column of tall rows: each one
// carried a name, an attribution line, a freshness note, a live count, a widget
// toggle and a map toggle, and the 37 signal layers sat behind a collapsed
// "Global signals" section split into SIXTEEN registry groups, nine of which hold
// exactly one source. Finding a layer meant expanding a section and scrolling past
// nine headings that each introduced one line.
//
// Now every source is one line — dot, label, ＋, toggle — in two columns under six
// headings, and the per-row detail moved into a popover on hover, focus or tap.
// The density that buys is the whole point: the list is scannable without opening
// anything.
//
// WHAT THIS FILE NO LONGER DOES. It does not enumerate sources. LAYER_META was a
// hand-written table keyed by LayerKey and it is gone; rows are derived from
// lib/console/sources/railSources.ts (the catalog plus the map layers that are not
// in it) and grouped by lib/console/sources/sections.ts. Adding a signal layer
// still needs no edit here.
//
// Kept, because none of it is a source: the header and its widget counter, the
// search box, MonitorBar, the layer presets, the camera feed/region filters, the
// signal time window, and the coverage / markets / watchlist launchers.

import { useRef, useState } from "react";
import { useLayers, layersStore, LAYER_PRESETS, type LayerKey } from "@/lib/layers";
import { signalsStore, useSignals } from "@/lib/signals/store";
import { useCameraFilter, cameraFilterStore } from "@/lib/cameraFilter";
import { coverageStore } from "@/lib/shell/coverage";
import { marketsStore } from "@/lib/shell/markets";
import { watchlistPanelStore } from "@/lib/shell/watchlist";
import { CAMERA_REGIONS, CAMERA_FEED_META } from "@/lib/icons/svg";
import { useT } from "@/lib/i18n/store";
import MonitorBar from "@/components/shell/MonitorBar";
import TimeWindowControl from "@/components/shell/TimeWindowControl";
import { useShellLayout, shellLayoutStore } from "@/lib/console/store";
import { isSourceWidgetOpen } from "@/lib/widgets/dock";
import "@/lib/console/widgets";
import { getWidgetType } from "@/lib/console/registry";
import { widgetTypeForSource } from "@/lib/console/sourceWidgets";
import { WIDGET_LIMIT_MESSAGE } from "@/lib/console/types";
import { buildSourceSections, type SourceRowModel } from "@/lib/console/sources/sections";
import { RAIL_SOURCES } from "@/lib/console/sources/railSources";
import SourceSection from "@/components/shell/sources/SourceSection";
import { useRailDrag } from "@/components/shell/sources/useRailDrag";

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

// Built once: the mapping is static, and rebuilding it per render would re-derive
// every label collision on every keystroke in the search box.
const SECTIONS = buildSourceSections(RAIL_SOURCES);

export default function SourceCatalog() {
  // Mounts CLOSED, as the "≡ Sources" launcher. In the old shell the rail owned the
  // left edge; in the widget console that edge is a widget column, and a panel
  // opening over it on every page load would hide the seeded widgets on desktop and
  // eat two-thirds of a phone screen. One click opens it — see ConsoleWorkspace.
  const [railOpen, setRailOpen] = useState(false);
  const [query, setQuery] = useState("");
  const t = useT();
  const layers = useLayers();
  const signals = useSignals();
  // The LIVE console layout — the one ConsoleWorkspace draws. Subscribing here is
  // what makes a ＋ light up the instant its widget lands, and go out when the
  // widget is closed from its own ⋯ menu.
  const consoleLayout = useShellLayout();
  const openTypes = new Set(consoleLayout.widgets.map((w) => w.type));

  // Which row the pointer picked up. The drag hook reports WHERE a drop landed;
  // it has no idea what was dragged, so the row is captured on the way down.
  const dragged = useRef<SourceRowModel | null>(null);

  const { onPointerDown } = useRailDrag((segment, index) => {
    const row = dragged.current;
    dragged.current = null;
    if (!row) return;
    const type = widgetTypeForSource(row.id);
    // A source with no widget of its own — the borders layer — is map-only. It can
    // be toggled but there is nothing to place, so a drop is a no-op rather than
    // an empty frame.
    if (!getWidgetType(type)) return;

    // Same two steps and the same toast as PlacementPicker's commit: at the cap
    // the drop must SAY so, or it reads as a broken gesture rather than a full
    // workspace. The wording is derived from MAX_WIDGETS — never retype it.
    const r = shellLayoutStore.add(type, { segment });
    if (!r.ok) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tn-toast", { detail: WIDGET_LIMIT_MESSAGE }));
      }
      return;
    }
    shellLayoutStore.move(r.id, segment, index);
  });

  const onDragHandle = (e: React.PointerEvent, row: SourceRowModel) => {
    dragged.current = row;
    onPointerDown(e);
  };

  const isOn = (id: string): boolean =>
    id in layers ? layers[id as LayerKey] : signals[id] === true;
  const isPlaced = (id: string): boolean => isSourceWidgetOpen(id, openTypes);
  const onToggle = (id: string): void => {
    if (id in layers) layersStore.toggle(id as LayerKey);
    else signalsStore.toggle(id);
  };

  if (!railOpen) {
    return (
      <button type="button" className="tn-rail-fab" onClick={() => setRailOpen(true)} title="Show sources">
        <span className="tn-rail-fab-bars" aria-hidden>≡</span>
        Sources
      </button>
    );
  }

  const q = query.trim().toLowerCase();
  const visible =
    q === ""
      ? SECTIONS
      : SECTIONS.map((s) => ({
          ...s,
          rows: s.rows.filter((r) => r.label.toLowerCase().includes(q)),
        })).filter((s) => s.rows.length > 0);

  return (
    <aside className="tn-rail" aria-label="Sources">
      <div className="tn-rail-header">
        <span className="tn-rail-title">Sources</span>
        <span className="tn-cat-count" title="Widgets on your workspace right now">
          {consoleLayout.widgets.length} ▦
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
          <button
            key={p.id}
            type="button"
            className="tn-preset-btn"
            title={p.hint}
            onClick={() => layersStore.applyPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <TimeWindowControl />

      {visible.length === 0 ? (
        <p className="tn-rail-foot">No source matches “{query.trim()}”.</p>
      ) : (
        visible.map((section) => (
          <div key={section.id}>
            <SourceSection
              section={section}
              isOn={isOn}
              isPlaced={isPlaced}
              onToggle={onToggle}
              onDragHandle={onDragHandle}
            />
            {/* The camera filters belong to the camera rows, so they sit under the
                section that holds them, and only while that layer is actually on. */}
            {section.id === "ground" && layers.cameras ? <CameraFilters /> : null}
          </div>
        ))
      )}

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

      <p className="tn-rail-foot">
        Only sources you can see are fetched. ＋ or drag a source to put it on the left, right or
        bottom rail.
      </p>
    </aside>
  );
}
