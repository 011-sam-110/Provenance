"use client";
// Camera picking, now inside the stage rail's Cameras group.
//
// Lifted from components/console/CameraPickControl.tsx, which this replaces.
// That file existed because the arm control used to appear ON HOVER, inside a
// card, next to four other glyphs — a control nobody could find. The rail is
// click-only for the same reason: touch has no hover, and a control that only
// exists while a pointer rests on it is a control that does not exist on a phone.
//
// CLEAR PICKS IS NOT HERE. CameraTray already owns SELECTED n, the per-pick
// chips, Send to wall, Clear and Stop picking, and it appears the moment picking
// starts. A second Clear would put two controls for one action on screen at once,
// which is the thing the rail exists to remove.
//
// NEW WALL IS NOT HERE EITHER, AND IT USED TO BE. Removing it was asked for, but
// it had a recorded reason to exist and that reason has to be answered rather than
// deleted with it. It was added after Sam reported a dead end — "after doing this I
// then can't add a camera as there isn't a widget to add it to" — i.e. delete your
// last camera wall and the board had no way back to one.
//
// That dead end is gone, and CHECKED rather than assumed. Two other routes create a
// camera wall today: "Send to wall" offers a NEW wall as a destination whether or
// not one exists (camslot.send.ts, SendTarget = "new"), and `camslot` is in
// POPULAR_WIDGET_IDS (paletteGroups.ts:101), so ⌘K adds an empty one directly.
// Both call the same createCamslot() this button did. A third control for a thing
// two controls already do is the duplication the rail exists to remove — and this
// one cost a chip of strip width on the flyout that had the most buttons.
//
// If both of those routes are ever removed, the dead end comes back and this button
// is the fix. That is the condition to check, not the button to miss.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MIN_VERTICES, cancelDraw, useAoiDraw } from "@/lib/map/aoi";
import { pickStore, usePicks } from "@/lib/console/widgets/camslot.pick";
import { areaPickStore, startAreaPick } from "@/lib/console/widgets/camslot.area";
import { armPicking } from "@/lib/console/widgets/camslot.layers";
import { BoundingBoxGlyph, CameraPlusGlyph } from "./RailIcons";

export default function CamerasFlyout() {
  const { mode, picks } = usePicks();
  const drawing = useAoiDraw();
  // A draw started by "Restrict results to area" is not ours; see DrawFlyout.
  const oursToDraw = useSyncExternalStore(areaPickStore.subscribe, areaPickStore.get, () => false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3500);
    return () => clearTimeout(t);
  }, [note]);

  const onArea = useCallback(() => {
    const r = startAreaPick();
    if (r.kind === "no-map") setNote("No map on the stage to draw on.");
    else if (r.kind === "not-ready") setNote("The map is still loading.");
  }, []);

  // A draw in progress owns the group: the finish gesture (Enter, or a
  // double-click) is invisible, so a user who has placed two points needs to be
  // told why the ring will not close.
  if (drawing.active && oursToDraw) {
    return (
      <>
        <span className="tnx-maprail-live" role="status" aria-live="polite">
          {drawing.vertices.length >= MIN_VERTICES
            ? `${drawing.vertices.length} points — Enter for the cameras inside`
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
    );
  }

  const picking = mode === "picking";

  return (
    <>
      {/* Arming goes through armPicking(), NOT pickStore.setMode — that is what
          switches the camera and webcam pins on. Stopping is a plain setMode: the
          layers stay up, deliberately. See camslot.layers.ts. */}
      <button
        type="button"
        className="tnx-maprail-act tnx-maprail-act-icon"
        aria-pressed={picking}
        onClick={() => (picking ? pickStore.setMode("off") : armPicking())}
        title={
          picking
            ? "Stop picking. What you have already picked stays in the tray."
            : "Click camera pins, or shift-drag a box, to collect them for a wall. Turns the camera and webcam pins on."
        }
      >
        <CameraPlusGlyph />
        <span>{picking ? "Picking cameras" : "Pick cameras"}</span>
      </button>

      <button
        type="button"
        className="tnx-maprail-act tnx-maprail-act-icon"
        onClick={onArea}
        // Honest about the side effects, both of them: this draws a shape, turns
        // picking on, AND brings the pins it will read up.
        title="Draw a shape; every camera inside it is picked, and picking stays on. Turns the camera and webcam pins on."
      >
        <BoundingBoxGlyph />
        <span>By area</span>
      </button>

      {picks.length > 0 ? (
        <span className="tnx-maprail-live" role="status" aria-live="polite">
          {picks.length} picked
        </span>
      ) : null}

      {note ? (
        <span className="tnx-maprail-note" role="status" aria-live="polite">
          {note}
        </span>
      ) : null}
    </>
  );
}
