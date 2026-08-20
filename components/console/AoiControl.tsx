"use client";
// RESTRICT RESULTS TO AREA: draw a zone, and every scoped widget narrows to it.
//
// The plumbing for this already existed and was UNREACHABLE. lib/shell/scope has
// modelled an `aoi` mode since the shell was built, withinScope handled it, and a
// dozen widgets already filter through it — but the only control that could set a
// scope lived in ConsoleTopBar, which the Terminal does not render. So the
// feature was complete apart from any way to use it.
//
// THE LABEL IS A SENTENCE, NOT A NOUN, and that is the fix for the second half of
// the problem. Reaching the control was step one; "Area" then told a first-time
// reader nothing about what pressing it would do, sitting as it did in a row of
// basemap names where every other word was a thing to LOOK at rather than a thing
// to DO. "Restrict results to area" says which way the filter runs — the feeds
// narrow to the zone, the map does not zoom to it — and it now sits under the
// legend, beside the description of what is currently on screen.
//
// Three states, one button group: idle (draw), drawing (finish / cancel, with a
// live vertex count), and set (clear). The vertex count is shown because the
// finish gesture is invisible otherwise — a user who has placed two points needs
// to know why Enter is not closing the ring.

import { useCallback, useEffect, useState } from "react";
import { useScope } from "@/lib/shell/scope";
import {
  MIN_VERTICES,
  cancelDraw,
  clearAoi,
  startDraw,
  useAoiDraw,
} from "@/lib/map/aoi";
import { getMapInstance } from "@/lib/map/instance";

export default function AoiControl() {
  const scope = useScope();
  const drawing = useAoiDraw();
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3500);
    return () => clearTimeout(t);
  }, [note]);

  const onDraw = useCallback(() => {
    const map = getMapInstance();
    if (!map) return setNote("No map on the stage to draw on.");
    if (!startDraw(map)) setNote("The map is still loading.");
  }, []);

  if (drawing.active) {
    const n = drawing.vertices.length;
    const ready = n >= MIN_VERTICES;
    return (
      <div className="tn-aoi" role="group" aria-label="Drawing an area">
        <span className="tn-aoi-live" role="status" aria-live="polite">
          {ready ? `${n} points - Enter to close` : `${n}/${MIN_VERTICES} points`}
        </span>
        <button type="button" className="tn-aoi-btn" onClick={cancelDraw} title="Abandon this area (Esc)">
          Cancel
        </button>
      </div>
    );
  }

  if (scope.mode === "aoi" && scope.polygon) {
    return (
      <div className="tn-aoi" role="group" aria-label="Area filter">
        <span className="tn-aoi-live">Area · {scope.polygon.length} pts</span>
        <button type="button" className="tn-aoi-btn" onClick={clearAoi} title="Show the whole world again">
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="tn-aoi" role="group" aria-label="Area filter">
      <button
        type="button"
        className="tn-aoi-btn"
        onClick={onDraw}
        title="Draw an area; the feeds narrow to what is inside it"
      >
        Restrict results to area
      </button>
      {note ? (
        <span className="tn-aoi-live" role="status" aria-live="polite">
          {note}
        </span>
      ) : null}
    </div>
  );
}
