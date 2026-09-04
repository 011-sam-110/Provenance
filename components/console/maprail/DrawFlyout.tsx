"use client";
// RESTRICT RESULTS TO AREA, now inside the stage rail's Draw group.
//
// Lifted from components/console/AoiControl.tsx, which this replaces. Its header
// is worth carrying forward: the scope plumbing had existed since the shell was
// built and was UNREACHABLE, because the only control that could set a scope
// lived in a top bar the Terminal does not render. The feature was complete apart
// from any way to use it. Do not let it become unreachable again.
//
// THE LABEL IS A SENTENCE, NOT A NOUN. "Area" told a first-time reader nothing
// about which way the filter runs. "Restrict results to area" says it: the feeds
// narrow to the zone, the map does not zoom to it.
//
// Three states, and they are mutually exclusive — idle, drawing, set. CLEAR IS
// RENDERED ONLY WHEN A SCOPE IS SET. A Clear button sitting beside a filter that
// is not set is a control that lies about the state of the app.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useScope } from "@/lib/shell/scope";
import { MIN_VERTICES, cancelDraw, clearAoi, startDraw, useAoiDraw } from "@/lib/map/aoi";
import { getMapInstance } from "@/lib/map/instance";
import { areaPickStore } from "@/lib/console/widgets/camslot.area";

export default function DrawFlyout() {
  const scope = useScope();
  const drawing = useAoiDraw();
  // The camera picker borrows the same draw tool. While it owns the gesture this
  // group stays out of the way rather than narrating someone else's ring.
  //
  // One-group-open already makes two visible counters impossible, but the flag is
  // still needed: open Draw, start a ring, switch to Cameras — without this check
  // Cameras would narrate a gesture the user did not ask for. That is the exact
  // bug camslot.area.ts documents as measured on the live stage bar.
  const theirs = useSyncExternalStore(areaPickStore.subscribe, areaPickStore.get, () => false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3500);
    return () => clearTimeout(t);
  }, [note]);

  const onDraw = useCallback(() => {
    const map = getMapInstance();
    if (!map) return setNote("No map on the stage to draw on.");
    // No options, so the finished ring becomes the scope rather than being handed
    // to a caller — see the onFinish branch in lib/map/aoi.ts.
    if (!startDraw(map)) setNote("The map is still loading.");
  }, []);

  const drawingHere = drawing.active && !theirs;
  const hasScope = scope.mode === "aoi" && scope.polygon != null;

  return (
    <>
      {drawingHere ? (
        <>
          <span className="tnx-maprail-live" role="status" aria-live="polite">
            {drawing.vertices.length >= MIN_VERTICES
              ? `${drawing.vertices.length} points — Enter to close`
              : `${drawing.vertices.length}/${MIN_VERTICES} points`}
          </span>
          <button
            type="button"
            className="tnx-maprail-act"
            onClick={cancelDraw}
            title="Abandon this area (Esc)"
          >
            Cancel
          </button>
        </>
      ) : hasScope ? (
        <>
          <span className="tnx-maprail-live">Area · {scope.polygon!.length} pts</span>
          <button
            type="button"
            className="tnx-maprail-act"
            onClick={clearAoi}
            title="Show the whole world again"
          >
            Clear
          </button>
          <button
            type="button"
            className="tnx-maprail-act"
            onClick={onDraw}
            title="Draw a new area, replacing this one"
          >
            Redraw
          </button>
        </>
      ) : (
        <button
          type="button"
          className="tnx-maprail-act"
          onClick={onDraw}
          title="Draw an area; the feeds narrow to what is inside it"
        >
          Restrict results to area
        </button>
      )}

      {note ? (
        <span className="tnx-maprail-note" role="status" aria-live="polite">
          {note}
        </span>
      ) : null}
    </>
  );
}
