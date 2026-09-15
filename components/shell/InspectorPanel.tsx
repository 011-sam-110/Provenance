"use client";
// The Sources rail's INSPECTOR tab — the detail body for the currently open object.
//
// This is the old right-edge dossier (components/FeedOverlay.tsx) rehomed into the
// left rail. overlay.open() points the rail at this tab; this component renders the
// same kind-specific body the dossier did (lib/overlay-content.tsx), plus the close
// and export affordances that used to float on the dossier's right edge. Esc closes
// back to Sources.
//
// role="dialog" WHILE AN OBJECT IS OPEN, and that is load-bearing rather than
// decorative: ConsoleShell's global Escape handler skips its selection-clearing
// branch whenever any [role="dialog"] is in the tree (see its "GUARD 2" note), so a
// dialog here is what keeps Escape from clearing the map selection as a side effect
// of closing the inspector. The empty state carries no dialog role on purpose —
// with nothing open, Escape should do whatever the map wants it to.

import { useEffect, useRef } from "react";
import { overlay, useOverlay } from "@/lib/overlay";
import { OverlayBody } from "@/lib/overlay-content";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";

export default function InspectorPanel() {
  const { object } = useOverlay();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc closes the inspection. Bound only while an object is open, exactly like the
  // dossier's listener was, so a bare rail never swallows Escape from the map.
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

  if (!object) {
    return (
      <div className="tn-inspector-empty">
        <p className="tn-rail-foot">Nothing selected.</p>
        <p className="tn-rail-foot">
          Click a country, camera, plane, satellite, webcam or signal on the map to
          inspect it here.
        </p>
      </div>
    );
  }

  const exportObject = () => {
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
