"use client";
// The VIEW controls — projection (3D/2D), basemap, and export — as one cluster.
//
// They used to sit on the stage's own 22px top bar, floating over the map beside
// STAGE·FLAT and SOLO. They now live at the right-hand end of the FEED HEALTH row,
// where the strip's hover readout and its five tallies used to be. Extracted into
// their own component for exactly that reason: the cluster is rendered from
// FeedHealthStrip (a shell band) while the rest of the stage chrome is rendered
// from StageBar (inside the stage cell), and the gate below has to travel with the
// controls rather than be re-derived in two places.
//
// NOTHING HERE OWNS THE MAP — the same rule StageBar documents. Every control
// routes through the store that already owns that concern (mapViewStore for the
// basemap, shellLayoutStore for the projection) because WorldMap's effects sit
// downstream of those stores with a load watchdog, a retry, a fallback basemap and
// an on-screen failure notice wired to them. A switcher that called map.setStyle()
// directly would issue the style swap twice and bypass all of it; the trap is
// documented at WorldMap.tsx:1194.
//
// WHY THE GATE IS STILL HERE, IN A BAND THAT IS ALWAYS ON SCREEN. These controls
// act on the map. When a widget is fullscreened onto the stage, or the stage is
// showing something other than a map, there is no map for them to act on — a
// basemap button would repaint a surface nobody can see and "export this view"
// would capture a canvas that is not on screen. So the cluster renders nothing in
// those states and the strip's cells simply take the width back. This is the same
// gate ConsoleWorkspace applies to the rest of the map cluster
// (ConsoleWorkspace.tsx:101) and StageBar applies to itself.

import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";
import { mapViewStore, useMapView } from "@/lib/mapView";
import { useShellLayout } from "@/lib/console/store";
import { soloStore, useStageSolo } from "@/lib/terminal/solo";
import StageSwitch from "@/components/console/StageSwitch";
import ExportView from "@/components/console/ExportView";

export default function StageControls() {
  const view = useMapView();
  const { stage, focusedWidgetId } = useShellLayout();
  const solo = useStageSolo();

  if (focusedWidgetId != null || (stage !== "map3d" && stage !== "map2d")) return null;

  return (
    <div className="tnx-view-controls">
      {/*
        SOLO first, because it is the largest change any control here makes: it
        hides every widget and gives the whole board to the map. It arrived on the
        stage's own 22px bar one release ago and moved here when that bar was
        removed — the band went, the feature did not.
      */}
      <button
        type="button"
        className="tn-solo-btn"
        aria-pressed={solo}
        onClick={() => soloStore.toggle()}
        title={solo ? "Bring the widgets back" : "Hide the widgets and give the board to the map"}
      >
        {solo ? "Board" : "Solo"}
      </button>

      {/*
        The 3D/2D switch. Reused verbatim rather than rebuilt so the
        unfocus-then-switch behaviour and the "◱ Focus" indicator come along —
        there is exactly one projection switch in the app.
      */}
      <span className="tnx-stage-proj">
        <StageSwitch />
      </span>

      {/*
        One button per BASEMAPS entry — the registry is iterated, never enumerated,
        so a fifth basemap appears here the moment lib/basemaps.ts grows one, with
        no edit to this file. setBasemap() is the only legal way in; WorldMap's
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
        Export travels with the basemap buttons because the thing it exports IS
        this view: the scope, the moment, and which feeds were answering.
      */}
      <ExportView />
    </div>
  );
}
