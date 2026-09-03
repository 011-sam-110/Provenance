"use client";
// components/console/PlacementPicker.tsx
//
// Answers the one question the picker exists for: "where should this widget
// go?" Reads lib/console/placement's one-request store — null renders nothing,
// a request renders a modal with the three rails as choices. There is no
// remembered default and no way to skip past it: every ＋ asks, every time.
//
// ACCESSIBILITY is the point of this component, not a pass at the end:
//  - Roving tabindex. Only the SELECTED rail is a tab stop; the other two carry
//    tabIndex={-1}. Arrow keys move selection AND focus together (and wrap),
//    Home/End jump to the ends, Enter/Space commits, Escape cancels. This is
//    the WAI-APG radiogroup pattern — compare components/shell/FeedbackPrompt.tsx
//    around its rating radiogroup, where all ten <button role="radio"> are
//    natively tabbable and there are no arrow keys. That is the bug this file
//    exists to not repeat.
//  - Focus capture/restore follows components/console/WidgetFrame.tsx's "?"
//    popover and components/FeedOverlay.tsx's dossier: grab document.activeElement
//    when the question is asked, hand it back when the modal goes away, however
//    it goes away (commit, cancel, or Escape all funnel through the same cleanup).

import { useEffect, useRef, useState } from "react";
import type { SegmentId } from "@/lib/console/types";
import { SEGMENT_LABEL, SEGMENT_ORDER } from "@/lib/console/move";
import { placementStore, usePlacementRequest } from "@/lib/console/placement";
import { shellLayoutStore } from "@/lib/console/store";
import RailGlyph from "@/components/console/RailGlyph";

function cancel() {
  placementStore.cancel();
}

export default function PlacementPicker() {
  const request = usePlacementRequest();
  const [selected, setSelected] = useState<SegmentId>("left");
  const restoreRef = useRef<HTMLElement | null>(null);
  const optionRefs = useRef<Partial<Record<SegmentId, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!request) return;
    setSelected("left");
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    optionRefs.current.left?.focus();
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [request]);

  if (!request) return null;

  const { type, label, config, height } = request;

  function commit(segment: SegmentId) {
    shellLayoutStore.add(type, { segment, config, height });
    placementStore.cancel();
  }

  function moveSelection(dir: 1 | -1) {
    const at = SEGMENT_ORDER.indexOf(selected);
    const next = SEGMENT_ORDER[(at + dir + SEGMENT_ORDER.length) % SEGMENT_ORDER.length];
    setSelected(next);
    optionRefs.current[next]?.focus();
  }

  function jumpSelection(to: "first" | "last") {
    const next = to === "first" ? SEGMENT_ORDER[0] : SEGMENT_ORDER[SEGMENT_ORDER.length - 1];
    setSelected(next);
    optionRefs.current[next]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        moveSelection(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        moveSelection(-1);
        break;
      case "Home":
        e.preventDefault();
        jumpSelection("first");
        break;
      case "End":
        e.preventDefault();
        jumpSelection("last");
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(selected);
        break;
      case "Escape":
        e.preventDefault();
        cancel();
        break;
      default:
        break;
    }
  }

  return (
    <div className="tn-place-back" onClick={cancel}>
      <div
        className="tn-place"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tn-place-h"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="tn-place-h" className="tn-place-h">Where should {label} go?</h2>
        <div className="tn-place-opts" role="radiogroup" aria-labelledby="tn-place-h" onKeyDown={onKeyDown}>
          {SEGMENT_ORDER.map((seg) => {
            const checked = seg === selected;
            return (
              <button
                key={seg}
                ref={(el) => { optionRefs.current[seg] = el; }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                className={`tn-place-opt${checked ? " is-checked" : ""}`}
                onClick={() => commit(seg)}
              >
                <RailGlyph rail={seg} />
                <span className="tn-place-opt-label">{SEGMENT_LABEL[seg]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
