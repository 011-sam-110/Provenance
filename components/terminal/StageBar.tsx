"use client";
// The Terminal's stage chrome — the four pieces of UI that float OVER the map
// inside the stage cell: the 22px top bar (stage readout, projection switch,
// basemap picker, cursor coordinates), the search box, the layer legend, and the
// 24px bottom clock bar.
//
// NOTHING HERE OWNS THE MAP. Every control routes through the store that already
// owns that concern — mapViewStore for the basemap, shellLayoutStore for the
// projection — because WorldMap's own effects sit downstream of those stores with
// a load watchdog, a retry, a fallback basemap and an on-screen failure notice
// wired to them. A switcher that called map.setStyle() directly would issue the
// style swap twice and bypass all of it; the trap is documented at WorldMap.tsx:1194.
//
// THREE EXISTING COMPONENTS ARE RE-SKINNED, NOT REBUILT: StageSwitch (3D/2D),
// MapSearch (geocode → drop a pin → fly) and WorldClock. They are rendered inside
// this bar's frames and restyled by scoped CSS, so there is exactly one geocoder,
// one clock timer and one projection switch in the app. See the CSS block below
// for the overrides each one needs.
//
// ─── CSS THIS COMPONENT NEEDS (integrator owns app/globals.css) ───────────────
// All scoped under .tn-terminal, using the --tnx-* token block.
//
// TOP BAR
// .tnx-stage-bar        position:absolute; top:0; left:0; right:0; height:22px; z-index:6;
//                       display:flex; align-items:stretch; gap:0; font-size:9px;
//                       background:rgba(8,11,15,.88); backdrop-filter:blur(6px);
//                       -webkit-backdrop-filter:blur(6px); pointer-events:auto;
// .tnx-stage-label      display:flex; align-items:center; padding:0 9px; font-weight:700;
//                       letter-spacing:.1em; color:var(--tnx-ink-dim);
//                       border-right:1px solid var(--tnx-line); flex:none; white-space:nowrap;
// .tnx-stage-spacer     flex:1; min-width:0;
// .tnx-stage-cursor     display:flex; align-items:center; padding:0 10px; font-size:9.5px;
//                       color:var(--tnx-ink-faint); border-left:1px solid var(--tnx-line);
//                       flex:none; white-space:nowrap;
// .tnx-basemaps         display:flex; align-items:stretch;
// .tnx-basemap-btn      border:0; background:none; padding:0 10px; cursor:pointer;
//                       font:inherit; font-size:9px; font-weight:700; letter-spacing:.08em;
//                       text-transform:uppercase; color:var(--tnx-ink-faint);
//                       border-right:1px solid var(--tnx-line); white-space:nowrap;
// .tnx-basemap-btn:hover           color:var(--tnx-ink);
// .tnx-basemap-btn[aria-pressed="true"] { background:var(--tnx-accent); color:var(--tnx-bg); }
//
// PROJECTION SWITCH (restyle of components/console/StageSwitch)
// .tnx-stage-proj .tn-stage-switch        display:flex; align-items:stretch; gap:0;
//                                         background:none; border:0; padding:0; border-radius:0;
//                                         box-shadow:none;
// .tnx-stage-proj .tn-stage-switch button same rules as .tnx-basemap-btn above
// .tnx-stage-proj .tn-stage-switch button.is-on { background:var(--tnx-accent); color:var(--tnx-bg); }
// .tnx-stage-proj .tn-stage-focus         display:flex; align-items:center; padding:0 8px;
//                                         color:var(--tnx-accent); font-size:9px;
//
// SEARCH (restyle of components/console/MapSearch)
// .tnx-stage-search     position:absolute; top:30px; left:8px; width:290px; max-width:calc(100% - 16px);
//                       z-index:6; display:flex; align-items:center; gap:6px; padding:0 8px;
//                       background:rgba(8,11,15,.9); border:1px solid var(--tnx-line-strong);
//                       pointer-events:auto;
// .tnx-stage-search-pfx font-size:11px; font-weight:700; color:var(--tnx-accent); flex:none;
//   /* MapSearch's root is position:absolute; top:12px; left:50%; translateX(-50%) — it has to
//      be flattened or it re-centres itself inside this frame instead of filling it. */
// .tnx-stage-search .tn-mapsearch        position:static; transform:none; width:100%;
//                                        max-width:none; flex:1; min-width:0;
// .tnx-stage-search .tn-mapsearch-bar    background:none; border:0; box-shadow:none;
//                                        border-radius:0; padding:4px 0; gap:0;
// .tnx-stage-search .tn-mapsearch-icon   display:none;   /* replaced by the "/" prefix */
// .tnx-stage-search .tn-mapsearch-input  font-size:10.5px; color:var(--tnx-ink);
//                                        font-family:inherit; min-height:0;
// .tnx-stage-search .tn-mapsearch-input::placeholder { color:var(--tnx-ink-ghost); }
// .tnx-stage-search .tn-mapsearch-results{ margin-top:5px; border-radius:0;
//                                        background:rgba(8,11,15,.96);
//                                        border:1px solid var(--tnx-line-strong); box-shadow:none; }
// .tnx-stage-search .tn-mapsearch-item   font-size:10.5px; color:var(--tnx-ink); padding:5px 8px;
// .tnx-stage-search .tn-mapsearch-item:hover { background:var(--tnx-accent-soft); }
// .tnx-stage-search .tn-mapsearch-item-meta,
// .tnx-stage-search .tn-mapsearch-status { font-size:9px; color:var(--tnx-ink-faint); }
//
// LEGEND
// .tnx-stage-legend     position:absolute; top:30px; right:8px; z-index:6; max-width:200px;
//                       padding:5px 7px; font-size:8.5px; letter-spacing:.05em;
//                       background:rgba(8,11,15,.85); border:1px solid var(--tnx-line);
//                       color:var(--tnx-ink-dim); pointer-events:auto;
// .tnx-legend-row       display:flex; align-items:center; gap:6px; line-height:14px;
//                       white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
// .tnx-legend-swatch    width:6px; height:6px; flex:none;   /* background set inline */
// .tnx-legend-more      color:var(--tnx-ink-ghost);
//
// CLOCK BAR (restyle of components/console/WorldClock)
// .tnx-stage-foot       position:absolute; left:0; right:0; bottom:0; height:24px; z-index:6;
//                       display:flex; align-items:center; padding:0 8px;
//                       background:rgba(8,11,15,.88); backdrop-filter:blur(6px);
//                       -webkit-backdrop-filter:blur(6px); pointer-events:none;
//   /* WorldClock's root is an absolutely-positioned rounded glass ribbon; flatten it. */
// .tnx-stage-foot .tn-worldclock   position:static; transform:none; display:flex; padding:0;
//                                  border:0; border-radius:0; background:none; box-shadow:none;
//                                  backdrop-filter:none; -webkit-backdrop-filter:none;
// .tnx-stage-foot .tn-wc-cell      flex-direction:row; align-items:baseline; gap:5px;
//                                  padding:0 9px; min-width:0;
// .tnx-stage-foot .tn-wc-cell + .tn-wc-cell::before { background:var(--tnx-line); }
// .tnx-stage-foot .tn-wc-glyph     display:none;
// .tnx-stage-foot .tn-wc-city      order:-1; font-size:9px; font-weight:400; letter-spacing:.1em;
//                                  color:var(--tnx-ink-faint);
// .tnx-stage-foot .tn-wc-time      font-size:11px; font-weight:700; letter-spacing:0;
//                                  color:var(--tnx-ink); font-variant-numeric:tabular-nums;
// .tnx-stage-foot .tn-wc-cell.is-night .tn-wc-time { color:var(--tnx-ink); }
//   /* London tinted accent. POSITIONAL, and knowingly so: WorldClock renders one cell per
//      entry of its CITIES array and puts no per-city hook in the DOM, so index 2 (LA, NYC,
//      →LDN) is the only handle CSS has. If CITIES ever changes, this tints the wrong city —
//      cosmetic, not a lie, but fix it here (components/console/WorldClock.tsx:14-22). */
// .tnx-stage-foot .tn-wc-cell:nth-child(3) .tn-wc-time { color:var(--tnx-accent); }
// .tnx-stage-foot .tn-worldclock { display:flex; }   /* undo the <900px display:none if the
//                                  Terminal footer should keep the clocks on narrow screens */
//
// ATTRIBUTION — a licensing requirement (Esri / OpenTopoMap / CARTO), and it is
// MapLibre's own AttributionControl (WorldMap.tsx:1322), not text we write, so it
// stays correct when the basemap changes. It shares one bottom-right container with
// the NavigationControl, so both are raised clear of the 24px clock bar:
// .tn-terminal .maplibregl-ctrl-bottom-right { bottom:28px; right:8px; }
// .tn-terminal .maplibregl-ctrl-attrib       { background:rgba(8,11,15,.85); font-size:9px;
//                                              color:var(--tnx-ink-ghost); }
// .tn-terminal .maplibregl-ctrl-attrib a     { color:var(--tnx-ink-faint); }

import { memo, useEffect, useMemo, useRef } from "react";
import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";
import { mapViewStore, useMapView } from "@/lib/mapView";
import { useViewMode } from "@/lib/shell/viewMode";
import { useShellLayout } from "@/lib/console/store";
import { useLayers } from "@/lib/layers";
import { SIGNALS } from "@/lib/signals/registry";
import { useSignals } from "@/lib/signals/store";
import { formatCoord } from "@/lib/terminal/selection";
import {
  CAMERA_OFFLINE_COLOR,
  CAMERA_REGIONS,
  PLANE_META,
  SAT_META,
  WEBCAM_COLOR,
} from "@/lib/icons/svg";
import StageSwitch from "@/components/console/StageSwitch";
import ExportView from "@/components/console/ExportView";
import AoiControl from "@/components/console/AoiControl";
import MapSearch from "@/components/console/MapSearch";
import WorldClock from "@/components/console/WorldClock";

/**
 * The window event WorldMap dispatches on map mousemove, carrying the cursor's
 * geographic position.
 *
 * A window event rather than a store or a prop, and read straight into a DOM node
 * rather than into React state, because it fires at pointer rate. A setState here
 * would re-render this bar — and, through any shared context, the shell around it —
 * on every mouse move across the map.
 */
export const MAP_CURSOR_EVENT = "tn-map-cursor";
export interface MapCursorDetail {
  lat: number;
  lon: number;
}

/** The id on the search frame, so the shell's "/" shortcut can find it. */
export const STAGE_SEARCH_ID = "stage-search";

/**
 * Focus the stage search box. Returns false when it is not on screen — the stage
 * chrome unmounts while a widget is focused onto the stage — so a caller can
 * decide whether to swallow the keystroke or let it type a literal "/".
 *
 * Exported so the shell's keyboard handler does not have to know that the search
 * frame wraps a component whose input it would otherwise have to guess at.
 */
export function focusStageSearch(): boolean {
  const input = document.getElementById(STAGE_SEARCH_ID)?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) return false;
  input.focus();
  input.select();
  return true;
}

/** Shown until the pointer has actually been over the map. Never a fake 0.00N 0.00E. */
const CURSOR_EMPTY = "—";

/**
 * The cursor coordinate readout.
 *
 * memo() is load-bearing, not an optimisation. The text is written imperatively
 * into the node, so any re-render of this component would let React reconcile its
 * text child back to the em dash and blank a readout that is otherwise correct.
 * With no props, memo means it renders exactly once and the DOM write is the only
 * thing that ever touches it afterwards.
 */
const StageCursor = memo(function StageCursor() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const onCursor = (e: Event) => {
      const node = ref.current;
      if (!node) return;
      // The detail is untrusted: any script can dispatch this event name, and the
      // map integrator's shape could drift. formatCoord() already answers "—" for
      // anything that is not a finite pair, so the narrowing is all that is needed.
      const detail = (e as CustomEvent<Partial<MapCursorDetail> | undefined>).detail;
      const next = formatCoord(detail?.lat, detail?.lon);
      if (node.textContent !== next) node.textContent = next;
    };
    window.addEventListener(MAP_CURSOR_EVENT, onCursor);
    return () => window.removeEventListener(MAP_CURSOR_EVENT, onCursor);
  }, []);
  return (
    <span ref={ref} className="tnx-stage-cursor tnx-num">
      {CURSOR_EMPTY}
    </span>
  );
});

interface LegendRow {
  key: string;
  label: string;
  /** A CSS background value — a solid colour, or a hard-stop gradient for a family. */
  swatch: string;
  tip: string;
}

/**
 * A swatch for a class the map paints in MORE than one colour.
 *
 * Hard stops, not a blend: a gradient that fades reads as one hue with an artefact,
 * while three flat bands read as "this class is colour-coded". Every stop is a real
 * colour taken from the same table the map's icons are built from, so the legend
 * cannot claim a colour the map does not use.
 */
function familySwatch(colors: readonly string[]): string {
  const step = 100 / colors.length;
  const stops = colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** How many rows the legend shows before collapsing the rest into a "+N MORE". */
const MAX_LEGEND_ROWS = 9;

/**
 * The legend is DERIVED, not decorative.
 *
 * The obvious build — a fixed list of classes with fixed swatches — would be wrong
 * within a week and misleading immediately: cameras are coloured by region (11
 * feeds), satellites by category, planes by aircraft type, and every signal layer
 * carries its own colour in the registry. A static swatch would assert a colour the
 * map does not paint. So the legend lists the layers that are ON right now, with the
 * colours those layers are actually drawn in.
 */
function useLegendRows(): LegendRow[] {
  const layers = useLayers();
  const signals = useSignals();
  return useMemo(() => {
    const rows: LegendRow[] = [];
    if (layers.cameras) {
      rows.push({
        key: "cameras",
        label: "CAMERAS",
        swatch: familySwatch(CAMERA_REGIONS.slice(0, 4).map((r) => r.color)),
        tip: "Road CCTV. Dot colour encodes the source region — a cyan/green family across 11 feeds.",
      });
      rows.push({
        key: "cameras-offline",
        label: "— OFFLINE",
        swatch: CAMERA_OFFLINE_COLOR,
        tip: "A camera whose feed is not answering renders in muted slate rather than its region colour, so a dead feed reads as dead.",
      });
    }
    if (layers.planes) {
      rows.push({
        key: "planes",
        label: "AIRCRAFT",
        swatch: familySwatch(Object.values(PLANE_META).map((m) => m.color)),
        tip: "Aircraft, coloured by type: airliner, regional, light, helicopter, on-ground.",
      });
    }
    if (layers.satellites) {
      rows.push({
        key: "satellites",
        label: "SATELLITES",
        swatch: familySwatch([
          SAT_META.starlink.color,
          SAT_META.navigation.color,
          SAT_META.weather.color,
          SAT_META["earth-observation"].color,
        ]),
        tip: "Satellites, coloured by category across a violet→blue family; the ISS is picked out in white.",
      });
    }
    if (layers.webcams) {
      rows.push({
        key: "webcams",
        label: "WEBCAMS",
        swatch: WEBCAM_COLOR,
        tip: "Public webcams — a distinct layer from road CCTV, hence its own rose hue.",
      });
    }
    for (const s of SIGNALS) {
      if (signals[s.id] !== true) continue;
      rows.push({
        key: `signal:${s.id}`,
        label: s.label.toUpperCase(),
        swatch: s.color,
        tip: `${s.label} — ${s.group}. ${s.attribution}`,
      });
    }
    return rows;
  }, [layers, signals]);
}

function StageLegend() {
  const rows = useLegendRows();
  const shown = rows.slice(0, MAX_LEGEND_ROWS);
  const hidden = rows.length - shown.length;
  return (
    <div className="tnx-stage-legend">
      {shown.length === 0 ? (
        <div className="tnx-legend-row tnx-legend-more" title="No data layers are switched on, so the stage is showing the basemap and borders only.">
          NO LAYERS ON
        </div>
      ) : (
        shown.map((r) => (
          <div key={r.key} className="tnx-legend-row" title={r.tip}>
            <span className="tnx-legend-swatch" style={{ background: r.swatch }} />
            {r.label}
          </div>
        ))
      )}
      {hidden > 0 && (
        <div className="tnx-legend-row tnx-legend-more" title="More layers are on than fit here — the Source Catalog rail lists every one.">
          +{hidden} MORE
        </div>
      )}
    </div>
  );
}

export default function StageBar() {
  const view = useMapView();
  const mode = useViewMode();
  const { stage, focusedWidgetId } = useShellLayout();

  // The same gate ConsoleWorkspace applies to MapControls/MapSearch/PinNavigator/
  // WorldClock (ConsoleWorkspace.tsx:101). Without it, this chrome floats on top of
  // a widget that has been expanded onto the stage — a search box and a set of
  // basemap buttons painted over a fullscreened chart. Keeping the gate inside the
  // component means the shell can mount <StageBar /> unconditionally.
  //
  // In a Terminal layout that never focuses a widget onto the stage this is inert,
  // which is the correct cost for a guard that cannot then be forgotten.
  if (focusedWidgetId != null || (stage !== "map3d" && stage !== "map2d")) return null;

  return (
    <>
      <div className="tnx-stage-bar">
        {/*
          "GLOBE" or "FLAT" is read from viewMode, not hardcoded from the design.
          viewMode is the thing that actually sets the MapLibre projection (explore →
          globe, console → mercator) and it defaults to console, so a fixed "GLOBE"
          label would be wrong on first paint for every visitor.
        */}
        <span className="tnx-stage-label">STAGE · {mode === "explore" ? "GLOBE" : "FLAT"}</span>

        {/*
          The 3D/2D switch lives here because the Terminal replaces MapControls, and
          MapControls is where it lives today — dropping this bar in without it would
          quietly delete the projection toggle from the product. Reused verbatim so
          the unfocus-then-switch behaviour and the "◱ Focus" indicator come along.
        */}
        <span className="tnx-stage-proj">
          <StageSwitch />
        </span>

        {/*
          One button per BASEMAPS entry — the registry is iterated, never enumerated,
          so a fourth (dark) basemap appears here the moment lib/basemaps.ts grows one,
          with no edit to this file. setBasemap() is the only legal way in; WorldMap's
          effect owns setStyle and re-arms its load watchdog on the way through.
        */}
        <div className="tnx-basemaps" role="group" aria-label="Basemap">
          {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
            <button
              key={k}
              type="button"
              className="tnx-basemap-btn"
              aria-pressed={view.basemap === k}
              onClick={() => mapViewStore.setBasemap(k)}
            >
              {BASEMAPS[k].label}
            </button>
          ))}
        </div>

        {/*
          Export sits with the basemap buttons because the thing it exports IS this
          view: the scope, the moment, and which feeds were answering. It went into
          MapControls first, which was the obvious-looking home and is DEAD CODE —
          the Terminal replaced that cluster with this bar, so the control rendered
          nowhere and the tests still passed. Verified in the running app, not read
          off the component tree.
        */}
        <AoiControl />

        <ExportView />

        <span className="tnx-stage-spacer" />
        <StageCursor />
      </div>

      <div className="tnx-stage-search" id={STAGE_SEARCH_ID}>
        <span className="tnx-stage-search-pfx" aria-hidden>
          /
        </span>
        <MapSearch />
      </div>

      <StageLegend />

      <div className="tnx-stage-foot">
        <WorldClock />
        <span className="tnx-stage-spacer" />
        {/*
          The right-hand slot is deliberately EMPTY. The design puts the attribution
          here, but attribution is a licensing requirement for Esri, OpenTopoMap and
          CARTO and it changes with the basemap — so it stays MapLibre's own
          AttributionControl (added in WorldMap.tsx:1322 and still mounted), raised by
          CSS to sit just above this bar. Re-typing it as static text would be a
          licence notice that goes stale the first time someone switches basemap.
        */}
      </div>
    </>
  );
}
