"use client";
// THE INSPECTOR RAIL — the tool column on the right edge of the Sources rail. It is
// on BOTH tabs, and a click on any of its buttons lands on the Inspector with that
// tool open. See lib/console/inspectorRail.ts for the state and the reasons.
//
// IT IS ON THE RIGHT EDGE, NOT THE LEFT. Blender's tool shelf is on the left of its
// viewport because the viewport is what it acts on; this panel's viewport is the
// MAP, which is on the right. Sam chose this edge from rendered options
// (~/Desktop/rail-options/, option C) and the pane body from option D — and then, in
// review, asked for the column itself to belong to the PANEL rather than to one tab,
// which is why it is mounted from SourceCatalog and not from InspectorPanel.
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
//   0. a field is being edited → do nothing; Escape belongs to the field
//   1. a draw is running      → do nothing at all; let aoi.ts abandon the ring
//   2. a tool is open         → close it, refocus its button, stop propagating, so one
//                               press does not ALSO close the object behind it or clear
//                               the selection on the map
//   3. otherwise              → stand down completely; the object view's own listener
//                               and then ConsoleShell's ladder run exactly as before
//
// RUNG 0 IS NOT A NICETY, and it is why this is capture phase rather than a plain
// listener. The Draw panel renames an area in an inline field; capture phase means
// this handler sees Escape BEFORE the input's own React handler does, so without the
// stand-down, Escape in a name field would close the whole panel instead of putting
// the old name back. It is keyed on the TARGET rather than on a store flag because
// the target is the thing that actually knows: `data-area-rename` is on the input
// itself, so a second renaming surface works by carrying the same attribute, and the
// search box — which deliberately does NOT carry it, because Escape there is how you
// leave the tool — keeps its behaviour.
//
// Rung 1 is an explicit stand-down rather than an assumption about phase ordering,
// which is what the retired stage rail did too. The gesture is armed from a button
// inside this rail's own Draw panel, so a user who arms one and presses Escape is one
// keystroke away from a handler that would otherwise eat the gesture's own cancel key.

import { useCallback, useEffect, useRef } from "react";
import { useAoiDraw } from "@/lib/map/aoi";
import { useOverlay } from "@/lib/overlay";
import { railTabStore, useRailTab } from "@/lib/console/railTab";
import { sourcesRailStore } from "@/lib/console/sourcesRail";
import {
  inspectorRailStore,
  railEdge,
  railStep,
  railTools,
  useInspectorRail,
  type InspectorTool,
} from "@/lib/console/inspectorRail";
import { AlertGlyph, DrawGlyph, PinGearGlyph, SearchGlyph, ViewGlyph } from "./ToolIcons";
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

const LABELS: Record<InspectorTool, string> = {
  search: "Search for a place",
  view: "View",
  settings: "Map settings",
  draw: "Draw an area",
  alerts: "Notifications",
};

// WRITTEN OUT, NOT BUILT WITH `tn-insp-rail-btn-${slot}`. The CSS and
// tests/e2e/inspector-rail.spec.ts both name these strings, and neither can find a
// class that is assembled at runtime — the retired stage rail kept the same rule
// for the same reason.
const SLOT_CLASS: Record<InspectorTool, string> = {
  search: "tn-insp-rail-btn-search",
  view: "tn-insp-rail-btn-view",
  settings: "tn-insp-rail-btn-settings",
  draw: "tn-insp-rail-btn-draw",
  alerts: "tn-insp-rail-btn-alerts",
};

const GLYPH: Record<InspectorTool, () => React.ReactElement> = {
  search: SearchGlyph,
  view: ViewGlyph,
  settings: PinGearGlyph,
  draw: DrawGlyph,
  alerts: AlertGlyph,
};

/**
 * Which slots start a group, and so get a rule above them.
 *
 * Draw and Alerts are one group — neither is a map control — which is why the rule
 * goes above Draw and NOT between the two. If that ever changes, this set is the only
 * place the rail's grouping is written down.
 */
const RULE_BEFORE = new Set<InspectorTool>(["draw"]);

export default function InspectorRail() {
  const open = useInspectorRail();
  const { object } = useOverlay();
  const { tab } = useRailTab();
  const drawing = useAoiDraw();

  const slots = railTools(object != null);
  const btnRefs = useRef<Partial<Record<InspectorTool, HTMLButtonElement | null>>>({});

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
  // Rungs 0 and 1 stand down; rung 2 is the only branch here; rung 3 is the absence
  // of one. The ladder is written out in this file's header.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 0. A field being edited owns Escape. The attribute is on the input, so this
      //    needs no store and no DOM query — the event target IS the focused field.
      const target = e.target as HTMLElement | null;
      if (target?.dataset?.areaRename !== undefined) return;
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

  const onKeyDown = (e: React.KeyboardEvent, slot: InspectorTool) => {
    // Arrow keys move focus along the rail; they do NOT open. Click-only means Enter
    // and Space are the open gesture, and they are handled natively.
    let next: InspectorTool | null = null;
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
  const tabStop: InspectorTool = open ?? slots[0];

  return (
    <div
      className="tn-insp-rail"
      id={INSPECTOR_RAIL_ID}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Inspector tools"
    >
      {slots.map((slot) => {
        // The eye IS the view, so it reads as current exactly when no panel is
        // covering the object. A tool is current when it is the open one.
        const active = slot === "view" ? open === null : open === slot;
        const Glyph = GLYPH[slot];
        const label = LABELS[slot];
        return (
          <div className="tn-insp-rail-cell" key={slot}>
            {/* The rule that separates "what the map looks like" from "the areas you
                define on it, and what should be said about them". Rendered above a
                slot that starts a group — see RULE_BEFORE. */}
            {RULE_BEFORE.has(slot) ? <span className="tn-insp-rail-rule" aria-hidden /> : null}
            <button
              type="button"
              className={`tn-insp-rail-btn ${SLOT_CLASS[slot]}`}
              data-slot={slot}
              ref={(el) => {
                btnRefs.current[slot] = el;
              }}
              aria-pressed={active}
              // Hides this button's hover label while its own panel is open. The
              // panel's head names the tool and sits directly under the label, so the
              // two say the same word on top of each other — and the label is the one
              // that has to go, because it is the transient one.
              //
              // THE EYE HAS NO PANEL, so it is never marked and its label always
              // shows. That asymmetry is the point: `open === slot` can only be true
              // for a tool, while the eye's pressed state is the view itself — and
              // "View" appears nowhere else on screen, so hiding it there would leave
              // the button unlabelled in the state it is in most of the time.
              data-panel={open === slot ? "" : undefined}
              aria-label={label}
              title={label}
              tabIndex={tabStop === slot ? 0 : -1}
              onClick={() => {
                // EVERY BUTTON LANDS ON THE INSPECTOR, including from the Sources
                // tab — Sam's rule, and the reason the rail is mounted on the panel
                // rather than inside either tab. A tool is a view of the Inspector;
                // switching to it and leaving the viewer on Sources would be a click
                // that appears to do nothing.
                if (tab !== "inspector") railTabStore.set("inspector");
                inspectorRailStore.toggle(slot);
              }}
              onKeyDown={(e) => onKeyDown(e, slot)}
            >
              <Glyph />
              {/* The hover/focus label. `aria-hidden`, because `aria-label` above
                  already gives a screen reader this exact string and a visible copy
                  would have it announced twice. It opens to the LEFT — into the
                  panels — because this rail's right edge is the panel's edge. */}
              <span className="tn-insp-rail-tip" aria-hidden="true">
                {label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
