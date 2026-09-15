"use client";
// RETIRED — no longer mounted. The right-edge dossier was rehomed into the Sources
// rail's Inspector tab (components/shell/InspectorPanel.tsx) on 2026-09-15; that
// tab renders the same OverlayBody and carries the close/export/Esc affordances this
// file used to own. Left on disk, unmounted, per the repo's convention for retired
// chrome — restoring it is one import in ConsoleShell, un-deleting is not.
//
// The dossier — TrafficNerd's right-side slide-in detail panel. Subscribes to the
// overlay store; when an object is open it slides in from the right with a shared
// section layout (header → live media/preview → key facts → context), restyled
// calm + light. Non-modal: the globe stays interactive behind it. Closes via the
// × button and the Esc key; focus moves into the panel and restores on close.

import { useEffect, useRef } from "react";
import { overlay, useOverlay } from "@/lib/overlay";
import { OverlayBody } from "@/lib/overlay-content";
import { toCsv, toGeoJson, downloadText, exportFilename } from "@/lib/export";

export function FeedOverlay() {
  const { object } = useOverlay();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!object) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") overlay.close();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [object]);

  if (!object) return null;

  return (
    <aside className="tn-dossier" role="dialog" aria-label={object.label}>
      <button className="tn-dossier-close" aria-label="Close" onClick={() => overlay.close()}>
        ×
      </button>
      <button
        type="button"
        aria-label="Export this dossier"
        title="Download this dossier (GeoJSON / CSV)"
        onClick={() => {
          const props = { kind: object.kind, id: object.id, label: object.label, lat: object.lat, lon: object.lon, ...(object.meta ?? {}) };
          const base = exportFilename(`dossier-${object.kind}`, Date.now());
          if (Number.isFinite(object.lat) && Number.isFinite(object.lon)) {
            downloadText(`${base}.geojson`, "application/geo+json", toGeoJson([{ lat: object.lat, lon: object.lon, properties: props }]));
          } else {
            downloadText(`${base}.csv`, "text/csv", toCsv([props]));
          }
        }}
        style={{ position: "absolute", top: 10, right: 44, font: "inherit", fontSize: 12, background: "transparent", border: "none", cursor: "pointer", color: "var(--tn-accent-strong)" }}
      >
        ⬇ Export
      </button>
      <div className="tn-dossier-body" ref={panelRef} tabIndex={-1}>
        <OverlayBody object={object} />
      </div>
    </aside>
  );
}
