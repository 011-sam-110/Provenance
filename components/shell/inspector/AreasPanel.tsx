"use client";
// The areas block — draw one, and see the ones you have drawn.
//
// WAS THE "INSPECTOR" TAB. It is now a block INSIDE the Sources tab, sitting where
// the presets block used to, and the presets have taken its place as the rail's
// second tab. Sam asked for the swap and the reason it holds is traffic: drawing an
// area and then turning sources on for it is one continuous job, and it used to be
// split across two tabs — draw here, switch there, toggle, switch back to see what
// the area now says. Presets are a one-tap act you do occasionally, which is what a
// second tab is for.
//
// SOURCES ARE STILL NOT CONFIGURED HERE. The context switcher above the tabs points
// the rail at an area; the source list below then writes to it. Duplicating a source
// list in this block would give the user two places to change one thing.
//
// A ROW OPENS THE DOSSIER, it does not select. Selecting is the switcher's job now,
// and detail belongs in the dossier on the right, which already exists at 384px and
// already handles focus, escape and mobile. See lib/overlay-content.tsx.

import { aoiLabel, startDraw } from "@/lib/map/aoi";
import { areaSummary, inspectorStore, useInspector } from "@/lib/shell/inspector";
import { overlay } from "@/lib/overlay";
import type { Map as MapLibreMap } from "maplibre-gl";

declare global {
  interface Window { __map?: MapLibreMap }
}

export default function AreasPanel() {
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
        // Point the rail at the new area, because the next thing anyone does after
        // drawing one is turn something on for it. It is only a write target — the
        // map is unchanged by this, so it cannot surprise anyone.
        if (id) inspectorStore.edit(id);
      },
    });
  };

  return (
    <div className="tn-insp">
      <div className="tn-subhead">
        Areas <span className="tn-insp-count">{state.areas.length}</span>
      </div>

      {state.areas.length === 0 ? (
        <p className="tn-rail-foot">
          No areas yet. Draw one on the map to give it its own sources — they show
          inside it, and the globe keeps everything it already had.
        </p>
      ) : (
        state.areas.map((a) => (
          <button
            key={a.id}
            type="button"
            className="tn-insp-row"
            data-editing={state.editing === a.id ? "" : undefined}
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
            {/* "EDITING", NOT "LOADED". The pill used to mean "this is what the map is
                showing", which is no longer a thing an area can be — they all show at
                once. It now means "the toggles below land here", which is the only
                claim this row can still make. */}
            {state.editing === a.id ? <span className="tn-insp-pill">EDITING</span> : null}
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
