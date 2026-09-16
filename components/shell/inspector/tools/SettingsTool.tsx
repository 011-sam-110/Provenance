"use client";
// The Map settings tool — projection, basemap, terrain, 3D buildings. It was the
// stage rail's View flyout (components/console/maprail/ViewFlyout.tsx): a lateral
// strip of chips over the map, sized for a 40px column. The panel is a column now, so
// every control is a labelled ROW with the reason it exists under it.
//
// THESE CONTROLS USED TO LIVE ON THE STAGE and were deleted wholesale when the
// console was stripped to a bare globe (#153), which routed the basemap and the
// 2D/3D switch into the command palette and nothing else — leaving the map's own
// view settings with no on-screen home. This is that home; it moved off the map's
// edge and into the Inspector on 2026-09-16.
//
// TERRAIN AND 3D BUILDINGS HAVE NEVER HAD ANY OTHER CONTROL. Both live in
// mapViewStore, both are read by WorldMap on every style load, and nothing else in
// the app calls their setters — which is why each row says what it does, instead of
// leaving two bare words beside two switches.
//
// 2D/3D WRITES THE BOARD'S STAGE, NOT viewModeStore, and that is not a detail.
// StageHost sets viewModeStore from the active board's stage in a mount effect, so
// layout.stage is upstream and viewModeStore is downstream. Writing the store
// directly produces a value that is correct until the next mount and then silently
// reverts — lib/shell/viewMode.ts's own header warns about exactly this. It also
// matches the only other caller: CommandPalette's "Stage → 3D map" calls
// shellLayoutStore.stage() and nothing else, and two controls for one concept must
// not use two mechanisms. The switch does not remount the map: StageHost returns
// <WorldMap/> for both stages, so this is a projection change, not a WebGL rebuild.
//
// THE PROJECTION IS A SEGMENTED PAIR NOW, reversing a decision the lateral strip made
// for a reason that no longer exists. That version was ONE button labelled with what
// you would get, and its stated justification was width: "two buttons for two mutually
// exclusive states spend a chip of strip width". A chip of strip width is exactly what
// this panel has, so both states are visible at once and the current one is filled —
// which is the same segmented control the rail's own Sources/Inspector tabs use.

import { BASEMAPS } from "@/lib/basemaps";
import { mapViewStore, useMapView } from "@/lib/mapView";
import { shellLayoutStore, useShellLayout } from "@/lib/console/store";
import { basemapKeys, modeForStage, stageForMode } from "@/lib/console/viewControls";
import ToolSection from "@/components/shell/inspector/ToolSection";

/** One control row: what it is, what it does, and the thing you press. */
function Field({
  label,
  sub,
  control,
}: {
  label: string;
  sub: string;
  control: React.ReactNode;
}) {
  return (
    <div className="tn-insp-field">
      <span className="tn-insp-field-text">
        <span className="tn-insp-field-label">{label}</span>
        <span className="tn-insp-field-sub">{sub}</span>
      </span>
      {control}
    </div>
  );
}

export default function SettingsTool() {
  const view = useMapView();
  const { stage } = useShellLayout();
  const mode = modeForStage(stage);

  return (
    <>
      <ToolSection title="View">
        <Field
          label="Projection"
          sub="The 3D globe, or the flat map"
          control={
            // A RADIOGROUP, not two buttons that look like buttons. `aria-checked` says
            // which one is on rather than leaving a screen reader to infer it from a
            // label that changes under it.
            <span className="tn-insp-seg" role="radiogroup" aria-label="Projection">
              {(["3d", "2d"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  className="tn-insp-seg-btn"
                  onClick={() => shellLayoutStore.stage(stageForMode(m))}
                >
                  {m === "3d" ? "3D" : "2D"}
                </button>
              ))}
            </span>
          }
        />
      </ToolSection>

      <ToolSection title="Basemap">
        {/* Iterated from the registry and never hand-listed: lib/basemaps.ts states
            that its key order is load-bearing. A sixth basemap appears here with no
            edit, and tests/unit/view-controls.test.ts fails if the registry and the
            helper disagree. */}
        <div className="tn-insp-choices" role="radiogroup" aria-label="Basemap">
          {basemapKeys().map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={view.basemap === k}
              tabIndex={view.basemap === k ? 0 : -1}
              className="tn-insp-choice"
              onClick={() => mapViewStore.setBasemap(k)}
            >
              <span className="tn-insp-choice-dot" aria-hidden />
              {BASEMAPS[k].label}
            </button>
          ))}
        </div>
      </ToolSection>

      <ToolSection title="Surface">
        <Field
          label="Terrain"
          sub="Needs zoom 6+, on the flat map"
          control={
            <button
              type="button"
              className="tn-insp-switch"
              role="switch"
              aria-checked={view.terrain}
              aria-label="Terrain"
              // Honest about when it does anything. WorldMap only attaches the DEM above
              // TERRAIN_MIN_ZOOM (6) and only outside the globe regime, so switching this
              // on at world zoom changes nothing you can see. The condition is printed on
              // the row rather than hidden in a `title`, because a tooltip is not where a
              // caveat like that survives contact with a user.
              title="3D terrain. Takes effect once you zoom past about level 6, on the flat map."
              onClick={() => mapViewStore.setTerrain(!view.terrain)}
            >
              <span className="tn-insp-switch-knob" aria-hidden />
            </button>
          }
        />

        <Field
          label="Buildings"
          sub="Raised blocks at street level"
          control={
            <button
              type="button"
              className="tn-insp-switch"
              role="switch"
              aria-checked={view.buildings}
              aria-label="Buildings"
              title="Raise buildings at street level"
              onClick={() => mapViewStore.setBuildings(!view.buildings)}
            >
              <span className="tn-insp-switch-knob" aria-hidden />
            </button>
          }
        />
      </ToolSection>
    </>
  );
}
