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

import { useEffect } from "react";
import { BASEMAPS } from "@/lib/basemaps";
import { mapViewStore, useMapView } from "@/lib/mapView";
import { shellLayoutStore, useShellLayout } from "@/lib/console/store";
import { basemapKeys, modeForStage, stageForMode } from "@/lib/console/viewControls";
import { hudStore, useHudPrefs } from "@/lib/hud/store";
import { HUD_OPACITY_MAX, HUD_OPACITY_MIN, HUD_VARIANTS, VARIANT_LABEL } from "@/lib/hud/model";
import { issOrbitStore, useIssOrbitPrefs } from "@/lib/cinematic/orbitStore";
import { ISS_ORBIT_SPEED_LABEL, ISS_ORBIT_SPEEDS } from "@/lib/cinematic/prefs";
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
  const hud = useHudPrefs();
  const orbit = useIssOrbitPrefs();

  // HUD and ISS-orbit prefs persist through the same versioned envelope as the
  // shell stores; hydrate once on mount so the rows below reflect what the
  // user saved, not the defaults.
  useEffect(() => {
    hudStore.hydrate();
    issOrbitStore.hydrate();
  }, []);

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

      <ToolSection title="HUD">
        {/* The heads-up overlay (components/hud). Prefs live in lib/hud/store.ts —
            the same external-store + persisted-envelope pattern the shell stores
            use — and the overlay itself is demoed on /demo-hud. */}
        <Field
          label="HUD overlay"
          sub="Thin readout over the console map"
          control={
            <button
              type="button"
              className="tn-insp-switch"
              role="switch"
              aria-checked={hud.enabled}
              aria-label="HUD overlay"
              onClick={() => hudStore.setEnabled(!hud.enabled)}
            >
              <span className="tn-insp-switch-knob" aria-hidden />
            </button>
          }
        />

        <Field
          label="Variant"
          sub="Full, compact or minimal readouts"
          control={
            <span className="tn-insp-seg" role="radiogroup" aria-label="HUD variant">
              {HUD_VARIANTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={hud.variant === v}
                  className="tn-insp-seg-btn"
                  onClick={() => hudStore.setVariant(v)}
                >
                  {VARIANT_LABEL[v]}
                </button>
              ))}
            </span>
          }
        />

        <Field
          label="Split-flap animation"
          sub="Digits flip on change, or settle instantly"
          control={
            <button
              type="button"
              className="tn-insp-switch"
              role="switch"
              aria-checked={hud.animate}
              aria-label="Split-flap animation"
              onClick={() => hudStore.setAnimate(!hud.animate)}
            >
              <span className="tn-insp-switch-knob" aria-hidden />
            </button>
          }
        />

        <Field
          label="Opacity"
          sub="40–100% over the map"
          control={
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="range"
                min={HUD_OPACITY_MIN}
                max={HUD_OPACITY_MAX}
                step={1}
                value={hud.opacity}
                aria-label="HUD opacity"
                style={{ accentColor: "var(--tn-accent)", width: 110 }}
                onChange={(e) => hudStore.setOpacity(Number(e.target.value))}
              />
              <span className="tn-num">{hud.opacity}%</span>
            </span>
          }
        />
      </ToolSection>

      <ToolSection title="ISS orbit">
        {/* The console's orbit follow (components/console/IssOrbit). Prefs live
            in lib/cinematic/orbitStore.ts — the same persisted-envelope
            pattern as the HUD — and the camera circles the station until the
            user touches the map, which flips this switch back off: the switch
            never lies about what the camera is doing. */}
        <Field
          label="Follow the ISS"
          sub="Camera circles the station; touching the map hands control back"
          control={
            <button
              type="button"
              className="tn-insp-switch"
              role="switch"
              aria-checked={orbit.enabled}
              aria-label="Follow the ISS"
              onClick={() => issOrbitStore.setEnabled(!orbit.enabled)}
            >
              <span className="tn-insp-switch-knob" aria-hidden />
            </button>
          }
        />

        <Field
          label="Speed"
          sub="How fast the camera circles"
          control={
            <span className="tn-insp-seg" role="radiogroup" aria-label="ISS orbit speed">
              {ISS_ORBIT_SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={orbit.speed === s}
                  className="tn-insp-seg-btn"
                  onClick={() => issOrbitStore.setSpeed(s)}
                >
                  {ISS_ORBIT_SPEED_LABEL[s]}
                </button>
              ))}
            </span>
          }
        />
      </ToolSection>
    </>
  );
}
