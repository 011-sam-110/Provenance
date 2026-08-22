"use client";
// PICK CAMERAS FOR A WALL — the map-side entry point to building a camera wall.
//
// It replaces a `⊕` that lived inside one widget's hover-only control bar. That
// button had three problems and this control exists to answer each one:
//
//   1. You had to find it. It appeared on hover, inside a card, next to four other
//      glyphs. Here the control is on the stage bar beside "Restrict results to
//      area", permanently, in words.
//   2. It chose the DESTINATION first, so you had to know which of four identically
//      titled "CAMERA WALL" cards you meant before you had picked anything. Picking
//      chooses the destination last, in the tray, when there is something to place.
//   3. It had no answer for an area. "Draw an area" is now the same gesture as
//      "click a pin" — both fill the same basket.
//
// It sits UNDER AoiControl on purpose. The two are neighbours in a reader's mind
// and opposites in effect: one narrows what the feeds answer with, the other
// gathers cameras out of the map. Putting them together is also what makes the
// difference legible — "Restrict results to area" filters, "Draw an area" collects.

import { useCallback, useEffect, useState } from "react";
import { MIN_VERTICES, cancelDraw, useAoiDraw } from "@/lib/map/aoi";
import { pickStore, usePicks } from "@/lib/console/widgets/camslot.pick";
import { startAreaPick } from "@/lib/console/widgets/camslot.area";
import { createCamslot } from "@/lib/console/widgets/camslot.create";

export default function CameraPickControl() {
  const { mode, picks } = usePicks();
  const drawing = useAoiDraw();
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

  // A draw in progress owns the control: the finish gesture (Enter, or a
  // double-click) is invisible, so a user who has placed two points needs to be
  // told why the ring will not close. Copy deliberately mirrors AoiControl's, since
  // the gesture is literally the same one.
  if (drawing.active) {
    const n = drawing.vertices.length;
    const ready = n >= MIN_VERTICES;
    return (
      <div className="tn-aoi tn-campick" role="group" aria-label="Drawing an area to pick cameras from">
        <span className="tn-aoi-live" role="status" aria-live="polite">
          {ready ? `${n} points - Enter for the cameras inside` : `${n}/${MIN_VERTICES} points`}
        </span>
        <button type="button" className="tn-aoi-btn" onClick={cancelDraw} title="Abandon this area (Esc)">
          Cancel
        </button>
      </div>
    );
  }

  const picking = mode === "picking";

  return (
    <div className="tn-aoi tn-campick" role="group" aria-label="Camera walls">
      <button
        type="button"
        className={picking ? "tn-aoi-btn is-on" : "tn-aoi-btn"}
        aria-pressed={picking}
        onClick={() => pickStore.setMode(picking ? "off" : "picking")}
        title={
          picking
            ? "Stop picking. What you have already picked stays in the tray."
            : "Click camera pins, or shift-drag a box, to collect them for a wall"
        }
      >
        {picking ? "◉ Picking cameras" : "◎ Pick cameras"}
      </button>

      <button
        type="button"
        className="tn-aoi-btn"
        onClick={onArea}
        title="Draw a shape; every camera inside it is picked"
      >
        Draw an area
      </button>

      {/* The always-available way to get an empty wall, so removing the last one is
          never a dead end. Sam's report: "after doing this I then can't add a
          camera as there isn't a widget to add it to." */}
      <button
        type="button"
        className="tn-aoi-btn"
        onClick={onNewWall}
        title="Add an empty camera wall to this board"
      >
        ＋ New wall
      </button>

      {picks.length > 0 && (
        <span className="tn-aoi-live" role="status" aria-live="polite">
          {picks.length} picked
        </span>
      )}

      {note && <span className="tn-aoi-note" role="status">{note}</span>}
    </div>
  );
}
