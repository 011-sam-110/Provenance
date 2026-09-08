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
// context switcher, the search box, the areas block, the camera feed/region
// filters, and the coverage / markets / watchlist launchers.
//
// GONE from here on 2026-09-08: the FOUR CORE-LAYER SHORTCUTS — Core / None /
// Cameras / Air + space — which sat between the areas block and the sections. Sam
// asked for them off the rail, and the search box moved down into the slot they
// left. That trade is the point of the change: the search box used to sit under
// the header, two blocks and a divider above the list it filters, and it now sits
// directly on top of it.
//
// WHAT GOES WITH THEM, stated rather than discovered later: that row was the only
// live renderer of `LAYER_PRESETS` and the only caller of `layersStore.applyPreset`
// in the mounted tree, so there is no longer a one-tap way to turn every data layer
// off — the rows are switched one at a time. `lib/layers.ts` keeps both, and
// components/shell/sources/LayerPresetRow.tsx survives on disk, unmounted, so
// putting the row back is one import and one line.
//
// GONE from here on 2026-09-08: the PRESETS TAB, and with it the rail's whole tab
// strip. The boards it listed have two louder homes already — the centre navbar
// pill and ⌘K's Profiles group — so it was a third copy charging every visitor a
// choice on the way in. `PresetBar.tsx` survives on disk, unmounted.
//
// GONE from here on 2026-09-05: TimeWindowControl. It was the only caller of
// timeWindowStore.set, so the window is now fixed at its default -- see
// lib/shell/timeWindow.ts, where hydrate() was made a no-op in the same change so a
// stale persisted "1h" cannot outlive the control that set it.

import { useCallback, useEffect, useRef, useState } from "react";
// THE EDITING PROJECTIONS, NOT THE UNION. `useLayers`/`useSignals` answer "is this
// on anywhere" — World or any drawn area — which is what the MAP needs and is the
// wrong answer for a tick beside a toggle. With the rail pointed at an area, a row
// ticked from the union would claim the area has a source that World has and the
// area does not, and clicking it would appear to do nothing. See lib/layers.ts.
import { useEditingLayers, useLayers, layersStore, type LayerKey } from "@/lib/layers";
import { signalsStore, useEditingSignals } from "@/lib/signals/store";
import { useCameraFilter, cameraFilterStore } from "@/lib/cameraFilter";
import { coverageStore } from "@/lib/shell/coverage";
import SourcesSplitter from "@/components/shell/sources/SourcesSplitter";
import {
  sourcesRailWidthStore,
  useSourcesRailWidth,
  widthFromPointer,
} from "@/lib/shell/sourcesRailWidth";
import { marketsStore } from "@/lib/shell/markets";
import { watchlistPanelStore } from "@/lib/shell/watchlist";
import { CAMERA_REGIONS, CAMERA_FEED_META } from "@/lib/icons/svg";
import { useT } from "@/lib/i18n/store";
import { useShellLayout, shellLayoutStore } from "@/lib/console/store";
import { isSourceWidgetOpen } from "@/lib/widgets/dock";
import "@/lib/console/widgets";
import { getWidgetType } from "@/lib/console/registry";
import { widgetTypeForSource } from "@/lib/console/sourceWidgets";
import { WIDGET_LIMIT_MESSAGE } from "@/lib/console/types";
import { buildSourceSections, type SourceRowModel } from "@/lib/console/sources/sections";
import { RAIL_SOURCES } from "@/lib/console/sources/railSources";
import { shouldHintRail, sourcesRailStore, useSourcesRail } from "@/lib/console/sourcesRail";
import { formatChord, isMac, useKeymap } from "@/lib/shell/keymap";
import SourceSection from "@/components/shell/sources/SourceSection";
import { useRailDrag } from "@/components/shell/sources/useRailDrag";
import ContextSwitcher from "@/components/shell/inspector/ContextSwitcher";
import AreasPanel from "@/components/shell/inspector/AreasPanel";

function CameraFilters() {
  const filter = useCameraFilter();
  const feeds = Object.values(CAMERA_FEED_META);
  return (
    <div className="tn-cam-filters">
      {/* ONE HEADING STYLE IN THIS RAIL. These were `.tn-subhead` — 12px against
          the source sections' 14px small caps — so the rail read as two
          competing tiers of heading with no rule saying which outranked which.
          They are section headings, so they use the section heading. */}
      <h3 className="tn-src-sec-head"><span className="tn-src-sec-name">Feed</span></h3>
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
      <h3 className="tn-src-sec-head"><span className="tn-src-sec-name">Region — click to filter</span></h3>
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

/**
 * The rail's close mark.
 *
 * INLINE SVG, and drawn here rather than imported. components/console/RailGlyph.tsx
 * is this repo's precedent for chrome-only art as real JSX, and its reasoning
 * applies unchanged: lib/icons/svg.ts is the registry for marks that name a feature
 * ON THE MAP and is rasterised into a MapLibre sprite, which an ✕ on a panel header
 * has no business being in.
 *
 * A "✕" text character was the obvious cheaper option and is the thing being
 * replaced. It renders at whatever weight the first font in the stack happens to
 * carry it at — the rail's mono stack does not — so it arrived thin, small and
 * vertically off-centre next to a 16px uppercase title. Two strokes at the same 1.9
 * weight the stage-rail glyphs use cannot drift.
 */
function CloseGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      aria-hidden
      focusable="false"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
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
  // OPEN STATE LIVES IN A STORE, not here. The keymap's Sources chord opens this rail from
  // ConsoleShell's global keydown handler, which is nowhere near this tree — see
  // lib/console/sourcesRail.ts. The mount-closed rule below is unchanged; the store
  // starts closed for exactly the reasons stated here.
  const rail = useSourcesRail();
  // THE TOOLTIP NAMES THE USER'S OWN KEY, not a hardcoded one. This said "(⌘K)"
  // while ⌘K opened the command palette, which was simply wrong; it is right today
  // by coincidence and would be wrong again the moment anyone rebinds Sources in
  // Settings. Reading the keymap is the only version that cannot go stale.
  const keymap = useKeymap();
  const railOpen = rail.open;
  const setRailOpen = (v: boolean) => sourcesRailStore.setOpen(v);
  // No hydrate effect: the hint is scoped to one launch and nothing about it is
  // persisted, so the server render and the first client pass already agree.
  const [query, setQuery] = useState("");

  // ── RAIL WIDTH ─────────────────────────────────────────────────────────────
  // The width is PUBLISHED AS A CSS VARIABLE rather than applied as an inline
  // `width` on the aside, because two rules need it and only one of them is this
  // element: `.tn-terminal .tn-cw-shell > .tn-rail` sizes the rail, and
  // `.tn-terminal .tn-cw-shell:has(> .tn-rail)` pads the workspace by the same
  // amount so the grid REFLOWS beside the rail instead of being covered by it.
  // Setting the variable moves both together; an inline width would move the rail
  // and leave the console's padding at the old figure, which is a rail that
  // overlaps the first widget column.
  //
  // It goes on the document element, not on the aside: `:has()` reads the rail's
  // width to pad an ANCESTOR, so a variable declared on the rail itself is out of
  // scope for the rule that needs it.
  const railWidth = useSourcesRailWidth();
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--tn-rail-user-w", `${railWidth}px`);
    // Cleared on unmount so the CSS falls back to its own default rather than
    // leaving a stale figure behind on a route that has no rail at all.
    return () => {
      root.style.removeProperty("--tn-rail-user-w");
    };
  }, [railWidth]);

  // Persisted width arrives one frame after mount, for the reason spelled out on
  // useSourcesRailWidth's server snapshot: localStorage cannot be read during SSR,
  // so reading it in render would make the first client pass disagree with the
  // server's HTML. Every other persisted shell store hydrates the same way from
  // ConsoleShell; this one hydrates here because it is the only consumer.
  useEffect(() => {
    sourcesRailWidthStore.hydrate();
  }, []);

  const [dragging, setDragging] = useState(false);
  const onSplitterDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    // Measured against the WORKSPACE band, not the viewport. The rail is absolutely
    // positioned inside `.tn-cw-shell`, so its left edge is that element's left edge
    // — which is not 0 once anything sits outside it. Falling back to the viewport
    // when the shell cannot be found keeps a drag usable rather than dead.
    const shell = el.closest(".tn-cw-shell");
    const boxLeft = shell ? shell.getBoundingClientRect().left : 0;

    // Pointer capture rather than window listeners: this element is never
    // reordered or re-parented mid-gesture (the constraint that ruled capture out
    // for the row drag in useRailDrag.ts does not apply here), so the pointer keeps
    // talking to the splitter once it leaves the 9px handle — which it does
    // immediately, because dragging it is the point.
    el.setPointerCapture(pointerId);
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      sourcesRailWidthStore.set(widthFromPointer(ev.clientX, boxLeft));
    };
    const stop = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      setDragging(false);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    e.preventDefault();
  }, []);
  const t = useT();
  const layers = useEditingLayers();
  const signals = useEditingSignals();
  // The LIVE console layout — the one ConsoleWorkspace draws. Subscribing here is
  // what makes a ＋ light up the instant its widget lands, and go out when the
  // widget is closed from its own ⋯ menu.
  // The UNION, for the handful of things below that are about what the MAP is
  // drawing rather than about what a toggle would write.
  const mapLayers = useLayers();
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
      <button
        type="button"
        className="tn-rail-fab"
        onClick={() => setRailOpen(true)}
        title={`Show sources${keymap.sources[0] ? ` (${formatChord(keymap.sources[0], isMac())})` : ""}`}
        // THE HINT. On every fresh launch this tab jumps a few times and then stops,
        // because in review nobody found it — it is a thin tab on an edge that is
        // otherwise a widget column. It is an attribute rather than a class so the
        // CSS reads as a state and one grep finds both halves, and it ends for the
        // rest of the visit the first time the rail is opened by ANY route.
        // `shouldHintRail` is the whole rule and is unit-tested; see
        // lib/console/sourcesRail.ts for why the scope is a launch and not a browser.
        data-hint={shouldHintRail(rail) ? "" : undefined}
      >
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
    // A FRAGMENT, so the aside stays a DIRECT child of `.tn-cw-shell`. Wrapping the
    // pair in a positioning div would break `.tn-terminal .tn-cw-shell > .tn-rail`
    // and the `:has(> .tn-rail)` padding rule at the same time — the rail would lose
    // its width and the console would lose the gap it sits in. See SourcesSplitter
    // for why the handle cannot simply live inside the rail.
    <>
    <aside className="tn-rail" aria-label="Sources">
      <div className="tn-rail-header">
        <h2 className="tn-rail-title">Sources</h2>
        <span className="tn-cat-count" title="Widgets on your workspace right now">
          {consoleLayout.widgets.length} ▦
        </span>
        <button
          type="button"
          className="tn-rail-collapse"
          onClick={() => setRailOpen(false)}
          aria-label="Close sources"
          title="Close sources"
        >
          <CloseGlyph />
        </button>
      </div>

      {/* ── THERE IS NO TAB STRIP ANY MORE ─────────────────────────────────────
          This rail was two tabs, Sources and Presets, and the second one is gone.
          Sam: "lets also get rid of the presets button, as the presets are already
          at the top." They are: components/shell/PresetPill.tsx is the centre
          navbar control, it lists every builtin AND every custom saved board, and
          ⌘K carries the same seven under Profiles plus "Save layout as preset…".
          A whole tab spent on a third copy cost every visitor a choice before they
          could reach the thing the rail is for.

          The tab's second tier — the four core-layer shortcuts — outlived it by
          three days as LayerPresetRow and is now off the rail too, at Sam's ask.
          Both files are left on disk and unmounted rather than deleted; restoring
          a tab is cheap, un-deleting a component is not.

          The context switcher is now the FIRST control in the rail, which is where
          it belongs on its own merits: it says where everything below writes. */}
      <ContextSwitcher />

      {/* Drawing an area and then turning sources on for it is one job, so the
          areas block sits in the same scroll as the sources it configures. It used
          to be a tab of its own and the round trip — draw here, switch there,
          toggle, switch back to see what the area now says — was the reason it
          moved. */}
      <AreasPanel />

      <div className="tn-rail-divider" />

      {/* THE SEARCH BOX SITS HERE, directly above the list it filters, and not
          under the header where it used to be. It moved into the slot the four
          core-layer shortcuts vacated: from the header it was separated from its
          own results by the context switcher and the whole areas block, so typing
          in it changed something a scroll away. */}
      <input
        type="search"
        className="tn-cat-search"
        placeholder="Search sources…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search sources"
      />

      {visible.length === 0 ? (
        <p className="tn-rail-foot">No source matches “{query.trim()}”.</p>
      ) : (
        visible.map((section) => (
          <SourceSection
            key={section.id}
            section={section}
            isOn={isOn}
            isPlaced={isPlaced}
            onToggle={onToggle}
            onDragHandle={onDragHandle}
          />
        ))
      )}

      {/* AFTER the six sections, not inside them. These filters belong to the
          Cameras row, so the obvious place was under the section holding it —
          but seen in the browser that injects ~220px of feed and region chips
          between Ground and Air & space and breaks the run of six headings the
          rail exists to give you. They are a refinement of one source rather
          than a source, so they read better as a trailing panel. Shown only
          while the layer they filter is actually on. */}
      {/* THE UNION, not the edited context. cameraFilterStore is GLOBAL — one feed
          and region filter for the whole console, not a per-context setting — so
          these belong on screen whenever camera pins are being drawn anywhere.
          Gated on the edited context they would vanish while you configured an
          area, taking a global control off the page as a side effect of a choice
          that has nothing to do with it. */}
      {mapLayers.cameras ? (
        <>
          <div className="tn-rail-divider" />
          <CameraFilters />
        </>
      ) : null}

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
        Only sources you can see are fetched. ＋ or drag a source to put it on the left, bottom or
        right rail.
      </p>
    </aside>
    <SourcesSplitter width={railWidth} active={dragging} onPointerDown={onSplitterDown} />
    </>
  );
}
