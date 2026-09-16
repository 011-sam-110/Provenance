"use client";
// THE INSPECTOR RAIL — the tool column on the right edge of the Sources rail's
// INSPECTOR tab. Search and Map settings came off the map's edge (they were the
// stage rail's two groups), Draw an area came off the Sources tab, and they are one
// toolbar here. See lib/console/inspectorRail.ts for the state and the reasons.
//
// IT IS ON THE RIGHT EDGE, NOT THE LEFT. Blender's tool shelf is on the left of its
// viewport because the viewport is what it acts on; this panel's viewport is the
// MAP, which is on the right. Sam chose this edge from rendered options
// (~/Desktop/rail-options/, option C) and the pane body from option D.
//
// CLICK, NOT HOVER, for the fourth time in this codebase's history: SourceRow's
// header, the camera picker's arm control and the rail's own mobile pass all argue
// it, and the argument doesn't change because the rail moved. Same for the hover
// LABEL, which is not the thing that rule forbids — it names a control that is
// already visible, already clickable and already has an accessible name. On a phone
// it never appears and nothing is lost.
//
// ESCAPE IS SEQUENCED, NOT ASSUMED, and the ordering is the load-bearing part.
// lib/map/aoi.ts binds Escape on `document` in the BUBBLE phase for the life of a
// draw, and ConsoleShell's ladder is a bubble-phase window listener that clears the
// map selection. This handler is CAPTURE phase on `window`, so it runs first and:
//
//   1. a draw is running   → do nothing at all; let aoi.ts abandon the ring
//   2. a tool is open      → close it, refocus its button, stop propagating, so one
//                            press does not ALSO close the object behind it or clear
//                            the selection on the map
//   3. otherwise           → stand down completely; the object view's own listener
//                            and then ConsoleShell's ladder run exactly as before
//
// Rung 1 is an explicit stand-down rather than an assumption about phase ordering,
// which is what the retired stage rail did too — and it is not decoration: the rail
// now carries the Draw button itself, so a user who arms a draw and presses Escape
// is one keystroke away from a handler that would otherwise eat the gesture's own
// cancel key.

import { useCallback, useEffect, useRef } from "react";
import { useAoiDraw } from "@/lib/map/aoi";
import { useOverlay } from "@/lib/overlay";
import { useInspector } from "@/lib/shell/inspector";
import { AREA_CAP_MESSAGE, atAreaCap, drawArea } from "@/lib/shell/drawArea";
import { railTabStore } from "@/lib/console/railTab";
import { sourcesRailStore } from "@/lib/console/sourcesRail";
import {
  inspectorRailStore,
  railEdge,
  railSlots,
  railStep,
  useInspectorRail,
  type RailSlot,
} from "@/lib/console/inspectorRail";
import { DrawGlyph, PinGearGlyph, SearchGlyph, ViewGlyph } from "./ToolIcons";
import { INSPECTOR_SEARCH_ID } from "./tools/SearchTool";

/** The id the console's own chrome can look for. */
export const INSPECTOR_RAIL_ID = "inspector-rail";

/**
 * Focus the Inspector rail's search box, opening whatever it takes to get there.
 * Returns false when the console's left rail is not on screen at all.
 *
 * IT IS THE OLD focusStageSearch(), REPOINTED, and the boolean survives for the
 * reason tests/unit/search-shortcut-contract.test.ts spells out: ConsoleShell
 * preventDefaults only on a truthy return, so a key that can do nothing must not
 * eat the character the user typed. What changed is what "nothing" means. The box
 * used to be stage chrome, which unmounts when a widget is expanded onto the stage;
 * it is panel chrome now, so the question is whether the console's rail and its
 * launcher tab are on screen — `getClientRects()` rather than a null check, because
 * the rail is hidden rather than unmounted on the narrow pass, and a preventDefault
 * with nothing to show for it is the dead key this guards.
 *
 * EXPORTED FROM HERE rather than from lib/console/inspectorRail.ts: that module is
 * pure and node-testable, and this function reads the DOM.
 */
export function focusInspectorSearch(): boolean {
  const chrome = document.querySelector(".tn-rail, .tn-rail-fab");
  if (!(chrome instanceof HTMLElement) || chrome.getClientRects().length === 0) return false;

  // The rail may be collapsed, or open on Sources. Both are states the shortcut is
  // allowed to leave: searching for a place is not a Sources-tab action.
  sourcesRailStore.setOpen(true);
  railTabStore.set("inspector");

  // Already open — focus and select, so a second press types over an old query
  // rather than appending to it.
  const input = document.getElementById(INSPECTOR_SEARCH_ID)?.querySelector("input");
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.select();
    return true;
  }

  // Closed. Opening it lets SearchTool focus its own input on mount: React has not
  // rendered the input yet on this tick, so there is nothing to focus here.
  // Returning true before the focus lands is correct — the return value answers
  // "did we act on this keystroke", and we did.
  inspectorRailStore.open("search");
  return true;
}

const LABELS: Record<RailSlot, string> = {
  search: "Search for a place",
  view: "View",
  settings: "Map settings",
  draw: "Draw an area",
};

// WRITTEN OUT, NOT BUILT WITH `tn-insp-rail-btn-${slot}`. The CSS and
// tests/e2e/inspector-rail.spec.ts both name these strings, and neither can find a
// class that is assembled at runtime — the retired stage rail kept the same rule
// for the same reason.
const SLOT_CLASS: Record<RailSlot, string> = {
  search: "tn-insp-rail-btn-search",
  view: "tn-insp-rail-btn-view",
  settings: "tn-insp-rail-btn-settings",
  draw: "tn-insp-rail-btn-draw",
};

const GLYPH: Record<RailSlot, () => React.ReactElement> = {
  search: SearchGlyph,
  view: ViewGlyph,
  settings: PinGearGlyph,
  draw: DrawGlyph,
};

export default function InspectorRail() {
  const open = useInspectorRail();
  const { object } = useOverlay();
  const state = useInspector();
  const drawing = useAoiDraw();

  const slots = railSlots(object != null);
  const capped = atAreaCap(state.areas.length);
  const btnRefs = useRef<Partial<Record<RailSlot, HTMLButtonElement | null>>>({});

  // Read through a ref so the Escape listener below does not have to be torn down
  // and rebuilt every time the rail's state changes.
  const openRef = useRef(open);
  openRef.current = open;

  const closeAndRefocus = useCallback(() => {
    const was = openRef.current;
    inspectorRailStore.close();
    if (was) btnRefs.current[was]?.focus();
  }, []);

  // ── Escape ────────────────────────────────────────────────────────────────
  // Rungs 1 and 2 of the ladder in this file's header. Rung 3 is the absence of a
  // branch: with no tool open this listener returns without touching the event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 1. A draw owns Escape. aoi.ts's bubble-phase listener is the one that
      //    abandons the ring, and it must be allowed to run.
      if (drawing.active) return;
      // 2. Ours to close.
      if (!openRef.current) return;
      e.stopPropagation();
      closeAndRefocus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawing.active, closeAndRefocus]);

  const onKeyDown = (e: React.KeyboardEvent, slot: RailSlot) => {
    // Arrow keys move focus along the rail; they do NOT open. Click-only means Enter
    // and Space are the open gesture, and they are handled natively.
    let next: RailSlot | null = null;
    if (e.key === "ArrowDown") next = railStep(slots, slot, 1);
    else if (e.key === "ArrowUp") next = railStep(slots, slot, -1);
    else if (e.key === "Home") next = railEdge(slots, "first");
    else if (e.key === "End") next = railEdge(slots, "last");
    if (!next) return;
    e.preventDefault();
    btnRefs.current[next]?.focus();
  };

  // Roving tabindex: the rail is ONE tab stop. The open tool is the stop, or the
  // first slot when nothing is open — the WAI-APG toolbar pattern.
  const tabStop: RailSlot = open ?? slots[0];

  return (
    <div
      className="tn-insp-rail"
      id={INSPECTOR_RAIL_ID}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Inspector tools"
    >
      {/* TWO ELEMENTS, AND THE OUTER ONE IS NOT DECORATION. The tinted strip has to
          run the height of the pane, and the buttons have to stay on screen while
          that pane scrolls — and one element cannot do both: `position: sticky` only
          moves an element SHORTER than its containing block, so stretching the
          buttons to the strip's height would pin nothing. See the CSS header. */}
      <div className="tn-insp-rail-col">
        {slots.map((slot) => {
          const isDraw = slot === "draw";
          // The eye IS the view, so it reads as current exactly when no panel is
          // covering the object. A tool is current when it is the open one.
          const active = isDraw ? drawing.active : slot === "view" ? open === null : open === slot;
          const Glyph = GLYPH[slot];
          const label = LABELS[slot];
          return (
            <div className="tn-insp-rail-cell" key={slot}>
              {/* The rule that separates "what the panel shows" from "what acts on
                  the map". Rendered BEFORE draw, and only there. */}
              {isDraw ? <span className="tn-insp-rail-rule" aria-hidden /> : null}
              <button
                type="button"
                className={`tn-insp-rail-btn ${SLOT_CLASS[slot]}`}
                data-slot={slot}
                ref={(el) => {
                  btnRefs.current[slot] = el;
                }}
                aria-pressed={active}
                // Hides this button's hover label while its own panel is open. The
                // panel's head names the tool and sits directly under the label, so
                // the two say the same word on top of each other — and the label is
                // the one that has to go, because it is the transient one.
                //
                // THE EYE HAS NO PANEL, so it is never marked and its label always
                // shows. That asymmetry is the point: `open === slot` can only be
                // true for a tool, while the eye's pressed state is the view itself —
                // and "View" appears nowhere else on screen, so hiding it there would
                // leave the button unlabelled in the state it is in most of the time.
                data-panel={!isDraw && open === slot ? "" : undefined}
                // A REFUSAL IS STATED, NOT SILENT. At the cap, drawArea() toasts; a
                // title says the same thing before the click, and the button stays in
                // the toolbar's focus order rather than becoming a hole the arrow
                // keys stall in — see lib/shell/drawArea.ts for the cap itself.
                aria-disabled={isDraw && capped ? true : undefined}
                aria-label={label}
                title={
                  isDraw && capped
                    ? `Draw an area — ${AREA_CAP_MESSAGE}`
                    : isDraw && drawing.active
                      ? "Drawing an area. Press Escape to cancel."
                      : label
                }
                tabIndex={tabStop === slot ? 0 : -1}
                onClick={() => {
                  if (isDraw) {
                    // ALWAYS CALLED, EVEN WHILE ARMED, and that is deliberate rather
                    // than lazy: startAreaDraw() answers "a drawing is already
                    // running" and drawArea() toasts it. A silent no-op would leave a
                    // second click looking like a dead button, and the gesture
                    // already has two honest ways to stop — Escape, and the Cancel on
                    // the banner over the map.
                    drawArea(state.areas.length);
                    return;
                  }
                  inspectorRailStore.toggle(slot);
                }}
                onKeyDown={(e) => onKeyDown(e, slot)}
              >
                <Glyph />
                {/* The hover/focus label. `aria-hidden`, because `aria-label` above
                    already gives a screen reader this exact string and a visible copy
                    would have it announced twice. It opens to the LEFT — into the
                    pane — because this rail's right edge is the panel's edge. */}
                <span className="tn-insp-rail-tip" aria-hidden="true">
                  {label}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
