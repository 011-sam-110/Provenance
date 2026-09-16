"use client";
// The Sources rail's INSPECTOR tab — the pane the tool rail drives.
//
// THIS IS THE OLD RIGHT-EDGE DOSSIER (components/FeedOverlay.tsx) rehomed into the
// left rail, and since 2026-09-16 it is also the home of the map's own controls. Sam
// asked for the search box, the map settings and the areas block to become tools on
// this panel (rendered options C for the edge and D for the pane, in
// ~/Desktop/rail-options/), so this component is now a SWITCH rather than a body:
//
//   the open tool  — Search, Map settings or Draw
//   the object's own view  — the dossier, when nothing is open and something is selected
//   the empty state — when neither
//
// ONE THING AT A TIME, which is what option D means: opening a tool REPLACES the
// object's view rather than covering it, and closing the tool (the same button
// again, its ✕, or Escape) brings the object back. Nothing is hidden behind
// anything, and the panel never splits into two half-width columns.
//
// THE RAIL IS NOT HERE. It belongs to the PANEL, not to this tab: Sam's second pass
// asked for the buttons on both tabs, with a click landing on the Inspector. So it is
// mounted by components/shell/SourceCatalog.tsx, beside whichever tab is showing.
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
  useInspectorRail,
  type OpenTool,
} from "@/lib/console/inspectorRail";
import AreasPanel from "@/components/shell/inspector/AreasPanel";
import SearchTool from "@/components/shell/inspector/tools/SearchTool";
import SettingsTool from "@/components/shell/inspector/tools/SettingsTool";

/** The panel head's title per tool. One table, so the ✕ can name what it closes. */
const TOOL_TITLE: Record<OpenTool, string> = {
  search: "Search",
  settings: "Map settings",
  draw: "Draw an area",
};

export default function InspectorPanel() {
  const { object } = useOverlay();
  const tool = useInspectorRail();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc closes the inspection. Bound only while an object is open, exactly like the
  // dossier's listener was, so a bare pane never swallows Escape from the map.
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

  if (tool) {
    // THE TOOL OWNS THE PANE (option D). The title is rendered HERE rather than by
    // each tool, so the name and the ordering exist once; a tool renders its body and
    // nothing else.
    //
    // THERE IS NO ✕ IN THIS HEAD ANY MORE. Sam: "make Map settings the prominent main
    // title by increasing its font size and weight while removing competing title
    // elements like the secondary x close button." It competed with the title it sat
    // beside, and it was never the only way out — the rail button that opened the tool
    // closes it, and so does Escape, both of which the panel's own tests cover. Two
    // ways out that the user already knows beat three where one is a small glyph with
    // no label.
    return (
      <div className="tn-insp-tool">
        <h2 className="tn-insp-tool-title">{TOOL_TITLE[tool]}</h2>
        {tool === "search" ? <SearchTool /> : tool === "settings" ? <SettingsTool /> : <AreasPanel />}
      </div>
    );
  }

  if (object) {
    return (
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
    );
  }

  return (
    <div className="tn-inspector-empty">
      <p className="tn-rail-foot">Nothing selected.</p>
      <p className="tn-rail-foot">
        Click a country, camera, plane, satellite, webcam or signal on the map to
        inspect it here. The rail beside this panel searches for a place, sets the
        map up, and draws the areas you can give their own sources.
      </p>
    </div>
  );
}
