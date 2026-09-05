"use client";
// THE STAGE RAIL — four icon groups on the right edge of the map, one flyout
// open at a time, expanding leftward into the map.
//
// It replaces five things: the centred search box (.tnx-stage-search), the
// right-hand text stack (.tnx-stage-right → AoiControl + CameraPickControl), and
// MapLibre's zoom/compass cluster, which is deleted in WorldMap.tsx. The ⓘ
// attribution control STAYS — see lib/map/attribution.ts, it is a licence
// obligation for CARTO/OSM (ODbL), OpenTopoMap (CC-BY-SA) and Esri, not styling.
//
// CLICK, NOT HOVER. Asked for and confirmed, and it is also the position this
// codebase has already argued for twice: CameraPickControl existed because the
// arm control "appeared on hover, inside a card"; SourceRow's header says "the ＋
// is a SECOND, ALWAYS-VISIBLE control, not a hover reveal"; and the mobile pass
// hides the resize handles because "there is no hover on touch, so they never
// reveal themselves… dead controls that sit exactly where a thumb starts a
// swipe." A hover-expanding rail would be that mistake a fourth time.
//
// CENTRED, AND CONTENT-HEIGHT, NOT FULL-HEIGHT. It is vertically centred on the
// right edge. A rail that ran the whole edge would put its ends over the clock
// strip (.tnx-stage-foot) and over the attribution ⓘ, which sits at bottom:28px
// right:8px and may not be covered.
//
// ROLE=GROUP, NEVER ROLE=DIALOG. ConsoleShell's global keydown handler early
// returns if any [role="dialog"] is mounted, so a dialog-flavoured flyout would
// kill "/" and Escape app-wide for as long as it was open — including the "/"
// that opened it. These are non-modal panels over a map the user can still pan;
// a focus trap would be a lie about the state of the page.

import { useCallback, useEffect, useRef } from "react";
import { useAoiDraw } from "@/lib/map/aoi";
import { usePicks } from "@/lib/console/widgets/camslot.pick";
import {
  RAIL_GROUPS,
  type RailGroup,
  mapRailStore,
  railEdge,
  railHoldsOpen,
  railStep,
  useMapRail,
} from "@/lib/console/mapRail";
import { CameraBracketGlyph, MapPenGlyph, PinGearGlyph, SearchGlyph } from "./RailIcons";
import SearchFlyout from "./SearchFlyout";
import DrawFlyout from "./DrawFlyout";
import CamerasFlyout from "./CamerasFlyout";
import ViewFlyout from "./ViewFlyout";

/** The id focusStageSearch() looks for to decide whether the rail is on screen. */
export const MAP_RAIL_ID = "map-rail";

// The per-group class names are WRITTEN OUT, not built with `tnx-maprail-btn-${id}`.
// It was the guided tour's unit guard that made this load-bearing — it grepped this
// source for every selector the tour pointed at, and a template literal produces a
// class that exists at runtime and is invisible to a grep, so the guard would have
// gone quiet exactly when a rename broke the tour. The tour is gone and that guard
// with it, but the reason to keep spelling them out survives: tests/e2e/map-rail.spec.ts
// and the CSS both name these strings, and neither can find a class that is assembled.
const GROUPS: {
  id: RailGroup;
  label: string;
  btnClass: string;
  popClass: string;
  glyph: () => React.ReactElement;
  body: () => React.ReactElement;
}[] = [
  {
    id: "search",
    label: "Search for a place",
    btnClass: "tnx-maprail-btn-search",
    popClass: "tnx-maprail-pop-search",
    glyph: SearchGlyph,
    body: SearchFlyout,
  },
  {
    id: "draw",
    // The group holds TWO tools now (a drawn area and a radius), so the button
    // names the outcome they share rather than either gesture. "Restrict results
    // to an area" is still the sentence — a radius IS an area — and keeping the
    // wording is what lets the e2e accessible names stay put.
    label: "Restrict results to an area",
    btnClass: "tnx-maprail-btn-draw",
    popClass: "tnx-maprail-pop-draw",
    glyph: MapPenGlyph,
    body: DrawFlyout,
  },
  {
    id: "cameras",
    label: "Pick cameras for a wall",
    btnClass: "tnx-maprail-btn-cameras",
    popClass: "tnx-maprail-pop-cameras",
    glyph: CameraBracketGlyph,
    body: CamerasFlyout,
  },
  {
    id: "view",
    label: "View settings",
    btnClass: "tnx-maprail-btn-view",
    popClass: "tnx-maprail-pop-view",
    glyph: PinGearGlyph,
    body: ViewFlyout,
  },
];

export default function MapRail() {
  const open = useMapRail();
  const drawing = useAoiDraw();
  const { mode } = usePicks();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Partial<Record<RailGroup, HTMLButtonElement | null>>>({});

  // The map is armed while a ring is being drawn or picking is on. Read through a
  // ref so the listeners below do not have to be torn down and rebuilt on every
  // vertex the user places.
  const armed = railHoldsOpen(drawing.active, mode === "picking");
  const armedRef = useRef(armed);
  armedRef.current = armed;
  const openRef = useRef(open);
  openRef.current = open;

  const close = useCallback((refocus: boolean) => {
    const was = openRef.current;
    mapRailStore.close();
    if (refocus && was) btnRefs.current[was]?.focus();
  }, []);

  // ── Escape ────────────────────────────────────────────────────────────────
  //
  // ORDERING IS THE WHOLE PROBLEM HERE, and it is not visible from either file
  // alone. lib/map/aoi.ts binds Escape on `document` in the BUBBLE phase for the
  // life of a draw. This listener is capture-phase on `window`, so it runs
  // FIRST. If it swallowed Escape unconditionally it would eat the draw's own
  // abandon gesture and the ring could never be cancelled with the key the UI
  // tells you to use.
  //
  // So rung 1 is an explicit stand-down, not an assumption about ordering:
  //
  //   1. a draw is running  → do nothing; let aoi.ts abandon the ring
  //   2. a flyout is open   → close it, refocus its button, stop propagating so
  //                           ConsoleShell does not ALSO leave picking mode or
  //                           clear the selection on the same keypress
  //   3. otherwise          → ConsoleShell's existing ladder, untouched
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drawing.active) return;
      if (!openRef.current) return;
      e.stopPropagation();
      close(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawing.active, close]);

  // ── Outside click ─────────────────────────────────────────────────────────
  //
  // Suppressed while the map is armed. Draw and Cameras exist to make the user
  // click ON the map; closing on that click would take the vertex counter and
  // Cancel with it at the one moment they are needed. No refocus on this path —
  // the user is aiming at the map, and yanking focus back would fight the click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (armedRef.current) return;
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) close(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, close]);

  // A widget expanded onto the stage unmounts this whole tree. Close on the way
  // out so a remount never reopens a group the user last had open ten minutes ago.
  useEffect(() => () => mapRailStore.close(), []);

  const onKeyDown = (e: React.KeyboardEvent, id: RailGroup) => {
    // Arrow keys move focus along the rail; they do NOT open. Click-only means
    // Enter and Space are the open gesture, and they are handled natively.
    let next: RailGroup | null = null;
    if (e.key === "ArrowDown") next = railStep(id, 1);
    else if (e.key === "ArrowUp") next = railStep(id, -1);
    else if (e.key === "Home") next = railEdge("first");
    else if (e.key === "End") next = railEdge("last");
    if (!next) return;
    e.preventDefault();
    btnRefs.current[next]?.focus();
  };

  // Roving tabindex: the rail is ONE tab stop. The open group is the stop, or the
  // first group when nothing is open — the WAI-APG toolbar pattern, and the same
  // arrangement PlacementPicker uses (minus its role="dialog").
  const tabStop: RailGroup = open ?? RAIL_GROUPS[0];

  return (
    <div
      className="tnx-maprail"
      id={MAP_RAIL_ID}
      ref={rootRef}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Map controls"
    >
      {GROUPS.map(({ id, label, btnClass, popClass, glyph: Glyph, body: Body }, i) => {
        const isOpen = open === id;
        return (
          <div className="tnx-maprail-group" key={id}>
            <button
              type="button"
              className={`tnx-maprail-btn ${btnClass}`}
              data-group={id}
              ref={(el) => {
                btnRefs.current[id] = el;
              }}
              aria-expanded={isOpen}
              aria-controls={`maprail-pop-${id}`}
              aria-haspopup="true"
              aria-label={label}
              title={label}
              tabIndex={tabStop === id ? 0 : -1}
              onClick={() => mapRailStore.toggle(id)}
              onKeyDown={(e) => onKeyDown(e, id)}
            >
              <Glyph />
              {/* The hover/focus label. `aria-hidden`, because `aria-label` above
                  already gives a screen reader this exact string and a visible copy
                  would have it announced twice.

                  THIS IS NOT THE HOVER-REVEAL THIS FILE ARGUES AGAINST. That rule
                  is about CONTROLS that only exist on hover — the arm control in a
                  card, the resize handles on touch. A label that names a control
                  which is already visible, already clickable and already has an
                  accessible name adds no dead control: on a phone it simply never
                  appears, and nothing is lost, because the button is still there.

                  It also replaces the native `title` tooltip as the thing you
                  actually see. `title` is kept on the button — it is what a
                  hover-capable user gets if CSS fails, and some assistive tooling
                  reads it — but it takes about a second to appear, renders in OS
                  chrome that ignores the skin, and cannot be positioned, which is
                  why four icons with no words needed something better. */}
              <span className="tnx-maprail-tip" aria-hidden="true">
                {label}
              </span>
            </button>
            {isOpen ? (
              // The flyout is a SIBLING of the button, positioned off its own row,
              // so a panel always emerges from the control that opened it with no
              // measurement and no ResizeObserver. `--tnx-maprail-i` is the row
              // index; the CSS does the rest.
              <div
                className={`tnx-maprail-pop ${popClass}`}
                id={`maprail-pop-${id}`}
                role="group"
                aria-label={label}
                data-group={id}
                style={{ ["--tnx-maprail-i" as string]: String(i) }}
              >
                <Body />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
