"use client";
// The Terminal's stage chrome — the three pieces of UI that float OVER the map
// inside the stage cell: the centred search box, the right-hand stack (layer
// legend + the area filter), and the 24px bottom clock bar.
//
// THE 22px TOP BAR IS GONE, and with it three things. Two moved, one was deleted:
//
//   * the projection switch, the basemap picker and Export had already moved to the
//     FEED HEALTH row (components/terminal/StageControls.tsx);
//   * SOLO moved there too rather than dying with the bar. It is the control that
//     hands the whole board to the map, it shipped one release ago, and a band
//     being removed is not a reason to delete a feature — so it now sits with the
//     other stage controls, which is where a reader looking for "make the map
//     bigger" would go next;
//   * STAGE·FLAT and the cursor coordinate readout were DELETED. The label
//     duplicated the 3D/2D switch, which shows the same fact by which segment is
//     lit; the coordinate readout had no second home and is simply gone. Say so
//     out loud rather than implying it moved — WorldMap's `tn-map-cursor` dispatch
//     was removed in the same change, because a window event with no listener is
//     work done every mousemove for nobody.
//
// TWO EXISTING COMPONENTS ARE RE-SKINNED, NOT REBUILT: MapSearch (geocode → drop a
// pin → fly) and WorldClock. They are rendered inside this file's frames and
// restyled by scoped CSS, so there is exactly one geocoder and one clock timer in
// the app. See the CSS block below for the overrides each one needs.
//
// ─── CSS THIS COMPONENT NEEDS (integrator owns app/globals.css) ───────────────
// All scoped under .tn-terminal, using the --tnx-* token block.
//
// SEARCH (restyle of components/console/MapSearch)
// .tnx-stage-search     position:absolute; top:30px; left:50%; transform:translateX(-50%);
//                       width:min(420px, calc(100% - 16px));
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
// RIGHT-HAND STACK — legend, then the area filter under it
// .tnx-stage-right      position:absolute; top:30px; right:8px; z-index:6; width:200px;
//                       display:flex; flex-direction:column; align-items:stretch; gap:6px;
//                       pointer-events:none;   /* children re-enable it */
// .tnx-stage-legend     padding:5px 7px; font-size:8.5px; letter-spacing:.05em;
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
// ATTRIBUTION — a licensing requirement (OpenFreeMap/OpenMapTiles/OSM, Esri,
// OpenTopoMap, CARTO), and it is
// MapLibre's own AttributionControl (WorldMap.tsx:1322), not text we write, so it
// stays correct when the basemap changes. It shares one bottom-right container with
// the NavigationControl, so both are raised clear of the 24px clock bar:
// .tn-terminal .maplibregl-ctrl-bottom-right { bottom:28px; right:8px; }
// .tn-terminal .maplibregl-ctrl-attrib       { background:rgba(8,11,15,.85); font-size:9px;
//                                              color:var(--tnx-ink-ghost); }
// .tn-terminal .maplibregl-ctrl-attrib a     { color:var(--tnx-ink-faint); }

import { useMemo } from "react";
import { useShellLayout } from "@/lib/console/store";
import { useLayers } from "@/lib/layers";
import { SIGNALS } from "@/lib/signals/registry";
import { useSignals } from "@/lib/signals/store";
import {
  CAMERA_OFFLINE_COLOR,
  CAMERA_REGIONS,
  PLANE_META,
  SAT_META,
  WEBCAM_COLOR,
} from "@/lib/icons/svg";
import AoiControl from "@/components/console/AoiControl";
import CameraPickControl from "@/components/console/CameraPickControl";
import CameraTray from "@/components/console/CameraTray";
import MapSearch from "@/components/console/MapSearch";
import WorldClock from "@/components/console/WorldClock";

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
  const { stage, focusedWidgetId } = useShellLayout();

  // The same gate ConsoleWorkspace applies to MapControls/MapSearch/PinNavigator/
  // WorldClock (ConsoleWorkspace.tsx:101). Without it, this chrome floats on top of
  // a widget that has been expanded onto the stage — a search box and a legend
  // painted over a fullscreened chart. Keeping the gate inside the component means
  // the shell can mount <StageBar /> unconditionally.
  //
  // In a Terminal layout that never focuses a widget onto the stage this is inert,
  // which is the correct cost for a guard that cannot then be forgotten.
  if (focusedWidgetId != null || (stage !== "map3d" && stage !== "map2d")) return null;

  return (
    <>
      <div className="tnx-stage-search" id={STAGE_SEARCH_ID}>
        <span className="tnx-stage-search-pfx" aria-hidden>
          /
        </span>
        <MapSearch />
      </div>

      {/*
        The right-hand stack: the key, and directly under it the area filter.
        AREA used to sit on the bar above with the basemaps, on the reasoning that
        everything up there was "a property of the view". It is not the same kind of
        thing — a basemap changes how the world is drawn, while an area changes WHAT
        THE FEEDS ANSWER WITH, which is the same job the legend is describing. Under
        the key is where a reader is already looking to find out what is on screen.
      */}
      <div className="tnx-stage-right">
        <StageLegend />
        <AoiControl />
        <CameraPickControl />
      </div>

      {/* The tray. Bottom of the STAGE, not of the viewport — it is about the map,
          and a bar pinned to the window would sit over whichever widget happened to
          be at the foot of the board. It renders nothing at all when the basket is
          empty and picking is off. */}
      <CameraTray />

      <div className="tnx-stage-foot">
        <WorldClock />
        <span className="tnx-stage-spacer" />
        {/*
          The right-hand slot is deliberately EMPTY. The design puts the attribution
          here, but attribution is a licensing requirement for OpenFreeMap, Esri,
          OpenTopoMap and CARTO and it changes with the basemap — so it stays MapLibre's own
          AttributionControl (added in WorldMap.tsx:1322 and still mounted), raised by
          CSS to sit just above this bar. Re-typing it as static text would be a
          licence notice that goes stale the first time someone switches basemap.
        */}
      </div>
    </>
  );
}
