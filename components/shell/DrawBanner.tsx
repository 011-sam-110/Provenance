"use client";
// "You are drawing." A banner over the map for as long as a draw gesture is running.
//
// WHY IT EXISTS, given the rail flyout already narrates the gesture. Two reasons, and
// the second is a bug rather than a preference.
//
//  1. REACH. The flyout's readout is a ~90px line of small text on the right edge of
//     the map, beside the button that armed the tool. The user's attention after
//     pressing it is on the map, where they are about to click. "It is hard to tell
//     if you have clicked and if you are actually drawing" is the report, and a cue
//     living next to the button is a cue nobody is looking at.
//  2. THE FLYOUT CAN CLOSE WHILE THE GESTURE IS STILL LIVE. The stage rail keeps one
//     group open at a time, so opening Search or Cameras mid-draw unmounts
//     DrawFlyout — and with it the only sign the map is still swallowing clicks, and
//     the only Cancel button. Escape still works, and nothing on screen says so.
//     This is mounted from ConsoleShell and keys off the draw store alone, so it
//     cannot be closed by anything except the gesture ending.
//
// A STATUS REGION, NOT A DIALOG. `role="status"` with `aria-live="polite"`: the count
// updates as vertices land and a screen reader should hear them without being
// interrupted mid-word. It must NOT be role="dialog" — ConsoleShell's global keydown
// handler early-returns while any [role="dialog"] is mounted, so a dialog here would
// kill Escape for the whole app exactly while the user needs Escape to cancel.
//
// It renders null when nothing is being drawn, so mounting it always costs one store
// subscription.

import { cancelDraw, formatRadius, MIN_VERTICES, useAoiDraw } from "@/lib/map/aoi";

export default function DrawBanner() {
  const draw = useAoiDraw();
  if (!draw.active) return null;

  const radius = draw.tool === "radius";
  // TWO LINES WITH DIFFERENT JOBS. The lead says what is happening — it does not
  // change, so it is the thing the eye can lock onto. The hint says what to do next
  // and changes as the gesture progresses, which is the part worth re-reading.
  const lead = radius ? "Drawing a radius" : "Drawing an area";
  const hint = radius
    ? draw.center == null
      ? "Click the centre on the map"
      : `${formatRadius(draw.radiusKm ?? 0)} — click again to set the edge`
    : draw.vertices.length === 0
      ? "Click the map to place your first point"
      : draw.vertices.length < MIN_VERTICES
        // Naming the number left, rather than the number placed, because the question
        // at this stage is "when does this become an area", not "how far have I come".
        ? `${draw.vertices.length} placed — ${MIN_VERTICES - draw.vertices.length} more to make an area`
        : `${draw.vertices.length} points — double-click or press Enter to finish`;

  return (
    <div className="tn-drawbanner" role="status" aria-live="polite">
      <span className="tn-drawbanner-pulse" aria-hidden />
      <span className="tn-drawbanner-text">
        <strong>{lead}</strong>
        <span>{hint}</span>
      </span>
      {/* A SECOND Cancel, and the duplication is the point — see (2) above. This one
          cannot be unmounted by opening another rail group, so it is the one that is
          always there. Escape does the same thing and is named on it, because a
          keyboard user should not have to reach for a button. */}
      <button type="button" className="tn-drawbanner-x" onClick={cancelDraw} title="Abandon this drawing (Esc)">
        Cancel
        <kbd>Esc</kbd>
      </button>
    </div>
  );
}
