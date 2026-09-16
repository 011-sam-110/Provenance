"use client";
// The Sources rail's INSPECTOR tab — the tool rail, and the pane it drives.
//
// THIS IS THE OLD RIGHT-EDGE DOSSIER (components/FeedOverlay.tsx) rehomed into the
// left rail, and since 2026-09-16 it is also the home of the map's own controls.
// Sam asked for the search box, the map settings and "Draw an area" to become one
// rail on this panel (rendered options C for the edge and D for the pane, in
// ~/Desktop/rail-options/), so this component is now a LAYOUT rather than a body:
//
//   pane  — ONE of: the open tool, the object's own view, or the empty state
//   rail  — the tool column on the panel's right edge
//
// ONE THING AT A TIME, which is what option D means: opening a tool REPLACES the
// object's view rather than covering it, and closing the tool (the same button
// again, its ✕, or Escape) brings the object back. Nothing is hidden behind
// anything, and the panel never splits into two half-width columns.
//
// role="dialog" WHILE AN OBJECT IS OPEN, and that is load-bearing rather than
// decorative: ConsoleShell's global Escape handler skips its selection-clearing
// branch whenever any [role="dialog"] is in the tree (see its "GUARD 2" note), so a
// dialog here is what keeps Escape from clearing the map selection as a side effect
// of closing the inspector. THE TOOL PANES DELIBERATELY DO NOT CARRY ONE — they are
// docked regions of a panel, not dialogs, and the rail's own capture-phase Escape
// handler is what closes them (see components/shell/inspector/InspectorRail.tsx).
// The empty state carries no dialog role on purpose: with nothing open, Escape
// should do whatever the map wants it to.

import { useEffect, useRef } from "react";
import { overlay, useOverlay } from "@/lib/overlay";
import { OverlayBody } from "@/lib/overlay-content";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";
import {
  inspectorRailStore,
  useInspectorRail,
  type OpenTool,
} from "@/lib/console/inspectorRail";
import InspectorRail from "@/components/shell/inspector/InspectorRail";
import SearchTool from "@/components/shell/inspector/tools/SearchTool";
import SettingsTool from "@/components/shell/inspector/tools/SettingsTool";

/** The panel head's title per tool. One table, so the ✕ can name what it closes. */
const TOOL_TITLE: Record<OpenTool, string> = {
  search: "Search",
  settings: "Map settings",
};

export default function InspectorPanel() {
  const { object } = useOverlay();
  const tool = useInspectorRail();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc closes the inspection. Bound only while an object is open, exactly like the
  // dossier's listener was, so a bare rail never swallows Escape from the map.
  //
  // IT IS THE SECOND RUNG, NOT THE FIRST. The rail's handler is capture-phase on
  // window and stops propagation when a tool is open, so with a tool open this
  // listener never sees the key — one press closes the tool, the next closes the
  // object, and neither does both.
  useEffect(() => {
    if (!object) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") overlay.close();
    };
    window.addEventListener("keydown", onKey);
    // The dialog has to receive focus now that it is open — the same behaviour the
    // dossier had — and the close button is the first action in it.
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [object]);

  const exportObject = () => {
    if (!object) return;
    const props = {
      kind: object.kind,
      id: object.id,
      label: object.label,
      lat: object.lat,
      lon: object.lon,
      ...(object.meta ?? {}),
    };
    const base = exportFilename(`dossier-${object.kind}`, Date.now());
    if (Number.isFinite(object.lat) && Number.isFinite(object.lon)) {
      downloadText(`${base}.geojson`, "application/geo+json", toGeoJson([{ lat: object.lat, lon: object.lon, properties: props }]));
    } else {
      downloadText(`${base}.csv`, "text/csv", toCsv([props]));
    }
  };

  return (
    <div className="tn-insp-shell">
      <div className="tn-insp-pane">
        {tool ? (
          // THE TOOL OWNS THE PANE (option D). Its head is rendered HERE rather than
          // by each tool, so the name, the ordering and the ✕ that closes it exist
          // once; a tool renders its body and nothing else.
          <div className="tn-insp-tool">
            <div className="tn-insp-tool-head">
              <span className="tn-insp-tool-name">{TOOL_TITLE[tool]}</span>
              <button
                type="button"
                className="tn-insp-tool-close"
                aria-label={`Close ${TOOL_TITLE[tool].toLowerCase()}`}
                title="Back to the selected object"
                onClick={() => inspectorRailStore.close()}
              >
                ×
              </button>
            </div>
            {tool === "search" ? <SearchTool /> : <SettingsTool />}
          </div>
        ) : object ? (
          <div className="tn-inspector" role="dialog" aria-label={object.label}>
            <div className="tn-inspector-bar">
              <button type="button" className="tn-inspector-export" onClick={exportObject} aria-label="Export this inspection">
                ⬇ Export
              </button>
              <button
                ref={closeRef}
                type="button"
                className="tn-inspector-close"
                aria-label="Close inspector"
                title="Back to Sources"
                onClick={() => overlay.close()}
              >
                ×
              </button>
            </div>
            <div className="tn-inspector-body">
              <OverlayBody object={object} />
            </div>
          </div>
        ) : (
          <div className="tn-inspector-empty">
            <p className="tn-rail-foot">Nothing selected.</p>
            <p className="tn-rail-foot">
              Click a country, camera, plane, satellite, webcam or signal on the map to
              inspect it here. The rail beside this panel searches for a place, sets the
              map up, and draws the areas you can give their own sources.
            </p>
          </div>
        )}
      </div>
      <InspectorRail />
    </div>
  );
}
