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

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MIN_VERTICES, cancelDraw, useAoiDraw } from "@/lib/map/aoi";
import { pickStore, usePicks } from "@/lib/console/widgets/camslot.pick";
import { areaPickStore, startAreaPick } from "@/lib/console/widgets/camslot.area";
import { createCamslot } from "@/lib/console/widgets/camslot.create";

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

  const onNewWall = useCallback(() => {
    const r = createCamslot();
    // createCamslot scrolls to and flashes the card it made, so a success needs no
    // note of its own — saying "added" beside a card that has just lit up is noise.
    if (!r.ok) setNote(r.reason ?? "Could not add a camera wall.");
  }, []);

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
      <button
        type="button"
        className="tnx-maprail-act"
        aria-pressed={picking}
        onClick={() => pickStore.setMode(picking ? "off" : "picking")}
        title={
          picking
            ? "Stop picking. What you have already picked stays in the tray."
            : "Click camera pins, or shift-drag a box, to collect them for a wall"
        }
      >
        {picking ? "Picking cameras" : "Pick cameras"}
      </button>

      <button
        type="button"
        className="tnx-maprail-act"
        onClick={onArea}
        // Honest about the side effect: this draws a shape AND turns picking on.
        title="Draw a shape; every camera inside it is picked, and picking stays on"
      >
        By area
      </button>

      {/* The always-available way to get an empty wall, so removing the last one is
          never a dead end. Sam's report: "after doing this I then can't add a
          camera as there isn't a widget to add it to." */}
      <button
        type="button"
        className="tnx-maprail-act"
        onClick={onNewWall}
        title="Add an empty camera wall to this board"
      >
        New wall
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
