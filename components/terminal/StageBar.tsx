"use client";
// The Terminal's stage chrome — what still floats OVER the map inside the stage
// cell. It is two things now: the camera tray along the bottom of the stage, and
// the clock pill.
//
// ─── THE STAGE RAIL IS GONE FROM HERE (2026-09-16) ────────────────────────────
// This file used to mount <MapRail/> — the two icon groups on the right edge of the
// map, Search and View settings, with one flyout open at a time. Sam asked for both
// to move onto the Inspector panel's new tool rail, together with "Draw an area",
// which came off the Sources tab. They are all
// components/shell/inspector/InspectorRail.tsx now, and components/console/maprail/
// is deleted rather than left unmounted — an exported component nothing renders
// still greps as live art and still has to be read by whoever comes next, which is
// the argument RailIcons.tsx made for the six glyphs it retired the same way.
//
// focusStageSearch() WENT WITH IT, and it is worth being precise about what that
// means, because the function's contract outlived it. The console's search shortcut
// still returns a boolean and ConsoleShell still preventDefaults only on a truthy
// return (tests/unit/search-shortcut-contract.test.ts holds that across both
// files); what changed is WHERE the box is, so the function is now
// focusInspectorSearch() in InspectorRail.tsx. StageBar no longer has an opinion
// about search at all.
//
// ─── THE CLOCK'S CSS ──────────────────────────────────────────────────────────
// `.tnx-stage-foot` is an invisible positioning row, absolutely placed 10px off the foot of
// the stage and centring what is in it: the pill (components/console/WorldClock.tsx) with its
// gear and picker (ClockPicker.tsx). All of it is styled in ONE block of app/globals.css, the
// one headed "THE MAP CLOCK", under .tn-terminal and the --tnx-* tokens. Read that block, not
// the 24px full-width ribbon this file used to describe: the bar is a 26px pill now, its
// London tint is keyed on `data-zone="Europe/London"` and not on a position, and the label
// shortens as the map narrows.
//
// WHAT THE CLOCK RESERVES, AND FOR WHOM. The pill reserves nothing on the right. It publishes
// `--tnx-stage-foot-clear` (46px on `.tn-cw-stage`, 0 wherever this row is hidden) for things
// that sit above it: the map's bottom-right controls and the Streets prompt card read it with a
// fallback. ATTRIBUTION is a licensing requirement for OpenFreeMap, Esri, OpenTopoMap and CARTO
// and changes with the basemap, so it stays MapLibre's own AttributionControl (WorldMap.tsx),
// lifted clear of this row by the MapLibre chrome block, never typed in here.

import { useShellLayout } from "@/lib/console/store";
import CameraTray from "@/components/console/CameraTray";
import WorldClock from "@/components/console/WorldClock";

export default function StageBar() {
  const { stage, focusedWidgetId } = useShellLayout();

  // The same gate ConsoleWorkspace applies to MapControls/MapSearch/PinNavigator/
  // WorldClock (ConsoleWorkspace.tsx:101). Without it, this chrome floats on top of
  // a widget that has been expanded onto the stage — a tray and a clock strip
  // painted over a fullscreened chart. Keeping the gate inside the component means
  // the shell can mount <StageBar /> unconditionally.
  //
  // In a Terminal layout that never focuses a widget onto the stage this is inert,
  // which is the correct cost for a guard that cannot then be forgotten.
  if (focusedWidgetId != null || (stage !== "map3d" && stage !== "map2d")) return null;

  return (
    <>
      {/* The tray. Bottom of the STAGE, not of the viewport — it is about the map,
          and a bar pinned to the window would sit over whichever widget happened to
          be at the foot of the board. It renders nothing at all when the basket is
          empty and picking is off. */}
      <CameraTray />

      <div className="tnx-stage-foot">
        <WorldClock />
      </div>
    </>
  );
}
