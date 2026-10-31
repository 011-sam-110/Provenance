"use client";
// The body of the panel for the sidebar's Inspector row and its three tools.
//
// THIS IS THE OLD RIGHT-EDGE DOSSIER (components/FeedOverlay.tsx) rehomed into the
// left panel, and since 2026-09-16 it is also the home of the map's own controls (rendered
// options C for the edge and D for the pane, in ~/Desktop/rail-options/), so this component
// is a SWITCH rather than a body:
//
//   the open tool  — Map settings, Areas or Notifications
//   the object's own view  — the dossier, when no tool is open and something is selected
//   the empty state — when neither, which says what to do
//
// ONE THING AT A TIME, which is what option D means: opening a tool REPLACES the
// object's view rather than covering it, and closing the tool (its row again, or Escape)
// brings the object back. Nothing is hidden behind anything, and the panel never splits
// into two half-width columns.
//
// THE TITLE AND THE ✕ ARE NOT HERE. components/shell/SourceCatalog.tsx draws one head for
// all five panels, so two panels cannot grow two different ones. The ✕ was removed from this
// head once, on Sam's ask, because it sat at the title's own weight and competed with it.
// It is back because the HUD v2 plan asks for a clear title and close button on every
// panel's top edge, and it is the quiet kind now: faint, with no box until it is pointed at.
//
// INSPECTOR IS ALWAYS A PLACE YOU CAN OPEN. The old rule was that a control opening an empty
// pane is a dead control, so the eye button waited for a selection. A row that says "Click
// something on the map to inspect it." is not dead: it answers what the row is for.
//
// role="dialog" WHILE AN OBJECT IS OPEN, and that is load-bearing rather than
// decorative: ConsoleShell's global Escape handler skips its selection-clearing
// branch whenever any [role="dialog"] is in the tree (see its "GUARD 2" note), so a
// dialog here is what keeps Escape from clearing the map selection as a side effect
// of closing the inspector. THE TOOL PANES DELIBERATELY DO NOT CARRY ONE — they are
// docked regions of a panel, not dialogs, and the sidebar's capture-phase Escape
// handler is what closes them (see components/shell/ConsoleSidebar.tsx).
// The empty state carries no dialog role on purpose: with nothing open, Escape
// should do whatever the map wants it to.

import { useEffect, useRef } from "react";
import { overlay, useOverlay } from "@/lib/overlay";
import { OverlayBody } from "@/lib/overlay-content";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";
import { saveDataDictionary, saveKml } from "@/lib/export/save";
import { useInspectorRail } from "@/lib/console/inspectorRail";
import AreasPanel from "@/components/shell/inspector/AreasPanel";
import SettingsTool from "@/components/shell/inspector/tools/SettingsTool";
import AlertsTool from "@/components/shell/inspector/tools/AlertsTool";

export default function InspectorPanel({ mapAbsent }: {
  /** Why the map is not on screen, or null. Read by the panels that act on the map. */
  mapAbsent: string | null;
}) {
  const { object } = useOverlay();
  const tool = useInspectorRail();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc closes the inspection. Bound only while an object is open, exactly like the
  // dossier's listener was, so a bare pane never swallows Escape from the map.
  //
  // IT IS THE SECOND RUNG, NOT THE FIRST. The sidebar's handler is capture-phase on
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

  // One record: what the three exports of an inspection hold.
  const exportProps = (o: NonNullable<typeof object>): Record<string, unknown> => ({
    kind: o.kind,
    id: o.id,
    label: o.label,
    lat: o.lat,
    lon: o.lon,
    ...(o.meta ?? {}),
  });
  const hasPlace = !!object && Number.isFinite(object.lat) && Number.isFinite(object.lon);

  const exportObject = () => {
    if (!object) return;
    const props = exportProps(object);
    const base = exportFilename(`dossier-${object.kind}`, Date.now());
    if (hasPlace) {
      downloadText(`${base}.geojson`, "application/geo+json", toGeoJson([{ lat: object.lat, lon: object.lon, properties: props }]));
    } else {
      downloadText(`${base}.csv`, "text/csv", toCsv([props]));
    }
  };

  const exportObjectKml = () => {
    if (!object || !hasPlace) return;
    saveKml(`dossier-${object.kind}`, [{ lat: object.lat, lon: object.lon, properties: exportProps(object) }]);
  };

  // The dictionary describes the file that "Export" gives: the GeoJSON (and the KML)
  // when the object has a place, else the CSV.
  const exportObjectDictionary = () => {
    if (!object) return;
    const props = exportProps(object);
    const meta = object.meta ?? {};
    const credit = [meta.sourceLabel, meta.attribution].filter((v): v is string => typeof v === "string" && v.trim() !== "");
    saveDataDictionary({
      name: `dossier-${object.kind}`,
      kind: "dossier",
      rows: hasPlace ? [] : [props],
      geo: hasPlace ? [{ lat: object.lat, lon: object.lon, properties: props }] : [],
      source: credit.join(": ") || undefined,
    });
  };

  if (tool) {
    // THE TOOL OWNS THE PANE (option D). It renders its body and nothing else.
    return (
      <div className="tn-insp-tool">
        {tool !== "alerts" && mapAbsent ? <p className="tn-panel-note">{mapAbsent}</p> : null}
        {tool === "settings" ? <SettingsTool /> : tool === "alerts" ? <AlertsTool /> : <AreasPanel />}
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
          {hasPlace && (
            <button type="button" className="tn-inspector-export" onClick={exportObjectKml} aria-label="Export this inspection as KML, for Google Earth">
              ⬇ KML
            </button>
          )}
          <button
            type="button"
            className="tn-inspector-export"
            onClick={exportObjectDictionary}
            title="What each field of the export means, the source of the data and the time of the export (plain text)"
          >
            ⬇ Data dictionary
          </button>
          <button
            ref={closeRef}
            type="button"
            className="tn-inspector-close"
            aria-label="Clear this selection"
            title="Clear this selection"
            onClick={() => overlay.close()}
          >
            Clear
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
      {mapAbsent ? <p className="tn-panel-note">{mapAbsent}</p> : null}
      <p className="tn-inspector-empty-lead">Click something on the map to inspect it.</p>
      <p className="tn-rail-foot">
        A country, camera, plane, satellite, webcam or signal. Its details open here.
      </p>
    </div>
  );
}
