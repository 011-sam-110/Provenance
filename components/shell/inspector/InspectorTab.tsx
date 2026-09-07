"use client";
// The Inspector index. A LIST, not a detail view — detail opens in the dossier on
// the right, which already exists at 384px and already handles focus, escape and
// mobile. See lib/overlay-content.tsx.
//
// Sources are NOT configured here. Load an area and the Sources tab is pointed at
// it; that is the whole interaction, and duplicating a source list in this column
// would give the user two places to change one thing.

import { aoiLabel, startDraw } from "@/lib/map/aoi";
import { areaSummary, inspectorStore, useInspector } from "@/lib/shell/inspector";
import { aoiScope, scopeStore } from "@/lib/shell/scope";
import { overlay } from "@/lib/overlay";
import type { Map as MapLibreMap } from "maplibre-gl";

declare global {
  interface Window { __map?: MapLibreMap }
}

export default function InspectorTab() {
  const state = useInspector();

  const draw = () => {
    const map = window.__map;
    if (!map) return;
    // onFinish is supplied, so aoi.ts hands us the ring and leaves the scope alone.
    // That contract is what keeps a camera pick from becoming a saved area; do not
    // drop it. See DrawOptions in lib/map/aoi.ts.
    startDraw(map, {
      onFinish: (ring) => {
        const id = inspectorStore.add(ring, aoiLabel(ring));
        if (id) load(id);
      },
    });
  };

  const load = (id: string) => {
    inspectorStore.load(id);
    const area = inspectorStore.get().areas.find((a) => a.id === id);
    if (area) scopeStore.set(aoiScope(area.polygon, area.label));
  };

  return (
    <div className="tn-insp">
      <div className="tn-subhead">
        Areas <span className="tn-insp-count">{state.areas.length}</span>
      </div>

      {state.areas.length === 0 ? (
        <p className="tn-rail-foot">
          No areas yet. Draw one on the map to give it its own sources.
        </p>
      ) : (
        state.areas.map((a) => (
          <button
            key={a.id}
            type="button"
            className="tn-insp-row"
            data-loaded={state.loaded === a.id ? "" : undefined}
            onClick={() =>
              // The bbox CENTRE, not 0,0. FeedOverlay writes the object's lat/lon
              // straight into its GeoJSON export, so a placeholder would hand the
              // user a downloaded file claiming every area sits at Null Island.
              // A position we do have must never be shipped as one we invented.
              overlay.open({
                kind: "area",
                id: a.id,
                label: a.label,
                lat: (a.bbox[1] + a.bbox[3]) / 2,
                lon: (a.bbox[0] + a.bbox[2]) / 2,
              })
            }
          >
            <span className="tn-insp-glyph" aria-hidden>▣</span>
            <span className="tn-insp-main">
              <span className="tn-insp-label">{a.label}</span>
              <span className="tn-insp-sub">{areaSummary(a)}</span>
            </span>
            {state.loaded === a.id ? <span className="tn-insp-pill">LOADED</span> : null}
          </button>
        ))
      )}

      <button type="button" className="tn-insp-draw" onClick={draw}>
        ＋ Draw an area
      </button>

      {/* Labelled and inert, never a control that does nothing. The design is in
          docs/superpowers/specs/2026-09-07-inspector-design.md §12 so it drops in
          without moving anything here. */}
      <div className="tn-insp-soon">
        <div className="tn-insp-soon-head">
          <span>Alert me</span>
          <span className="tn-insp-pill tn-insp-pill-muted">COMING SOON</span>
        </div>
        <p>Tell me when something enters or leaves an area. Not built yet.</p>
      </div>
    </div>
  );
}
