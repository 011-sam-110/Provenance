// components/console/RailSplitter.tsx
"use client";
import { shellLayoutStore } from "@/lib/console/store";
import { SEGMENT_LABEL } from "@/lib/console/move";
import { RAIL_MIN, RAIL_MAX, RAIL_STEP, RAIL_STEP_COARSE, clampRailSize } from "@/lib/terminal/rails";
import type { SegmentId } from "@/lib/console/types";

// The draggable seam between a rail and the map.
//
// ── THIS IS THE WAI-ARIA WINDOW SPLITTER PATTERN, DELIBERATELY ───────────────
// It replaces two keyboard behaviours that used to live on a widget's grip:
// arrows moved a card by one grid cell, Shift+arrows resized it. Both are gone
// with the grid, and it would be easy to read that as a keyboard regression.
// It is the opposite, for one concrete reason: the old arrow-nudge announced
// NOTHING. A screen reader user pressed an arrow and got silence, then had to
// go and re-read the card to find out whether anything had happened.
//
// `role="separator"` with `aria-valuenow` is announced on every change, so the
// new size is spoken as it happens. That is why the roving grip keeps only the
// two behaviours that are genuinely about the widget (reorder in the rail, send
// to another rail) and hands SIZE to this control, which can describe it.
//
// Home/End jump to the rail's own bounds rather than to 0. Collapsing to nothing
// is a distinct state with a distinct control (Enter/Space), because a size of 0
// and a size of RAIL_MIN look nothing alike and users reach for End expecting
// "as big as it goes", not "gone".

export default function RailSplitter({
  rail,
  size,
  onPointerDown,
  active,
}: {
  rail: SegmentId;
  /** The rail's CURRENT effective size in px — what aria-valuenow reports. */
  size: number;
  onPointerDown: (e: React.PointerEvent) => void;
  active: boolean;
}) {
  const vertical = rail === "left" || rail === "right";

  const setSize = (px: number) => shellLayoutStore.setSegment(rail, clampRailSize(rail, px));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? RAIL_STEP_COARSE : RAIL_STEP;

    // "Bigger" is a different direction for each rail, because each hangs off a
    // different edge: the left rail grows rightwards, the right rail grows
    // leftwards, and the bottom rail grows upwards. Mapping every arrow to
    // "+step" would make the right rail shrink when you press the key pointing
    // away from the map.
    const grow =
      rail === "left" ? { ArrowRight: 1, ArrowLeft: -1 } :
      rail === "right" ? { ArrowLeft: 1, ArrowRight: -1 } :
      { ArrowUp: 1, ArrowDown: -1 };

    const dir = (grow as Record<string, number | undefined>)[e.key];
    if (dir !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      setSize(size + dir * step);
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      setSize(RAIL_MIN[rail]);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      setSize(RAIL_MAX[rail]);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      shellLayoutStore.collapseSegment(rail, !shellLayoutStore.get().segments[rail].collapsed);
    }
  };

  const label = SEGMENT_LABEL[rail];

  return (
    <div
      className={`tn-rail-split tn-rail-split-${rail}${active ? " is-active" : ""}`}
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={`Resize the ${label.toLowerCase()}`}
      aria-valuenow={size}
      aria-valuemin={RAIL_MIN[rail]}
      aria-valuemax={RAIL_MAX[rail]}
      aria-valuetext={`${size} pixels`}
      aria-controls={`tn-rail-${rail}`}
      title={`Drag to resize the ${label.toLowerCase()}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <span className="tn-rail-split-grip" aria-hidden="true" />
    </div>
  );
}
