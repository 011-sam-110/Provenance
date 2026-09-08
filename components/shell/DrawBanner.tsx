"use client";
// "You are drawing." A banner over the map for as long as a draw gesture is running.
//
// WHY IT EXISTS, and why it is now the ONLY narration of a live draw. Two reasons,
// and the second is a bug rather than a preference.
//
//  1. REACH. Whatever a panel shows about a live draw is a short line of small text
//     on the edge of the map, beside the button that armed the tool. The user's
//     attention after pressing it is on the map, where they are about to click. "It
//     is hard to tell if you have clicked and if you are actually drawing" is the
//     report, and a cue living next to the button is a cue nobody is looking at.
//  2. A PANEL'S NARRATION CAN GO AWAY WHILE THE GESTURE IS STILL LIVE — and a panel
//     was never guaranteed to be there in the first place.
//
//     The stage rail keeps ONE group open at a time (lib/console/mapRail.ts), so
//     opening any other group mid-draw took the draw group's readout with it, and
//     with it the Cancel button that lived in it. Escape still worked, and nothing
//     on screen said so. That flyout has since been removed from the rail entirely,
//     which turns reason 2 from a risk into the whole story.
//
//     A draw starts from several surfaces, none of them the rail: the `draw` key
//     action arms the polygon tool directly (Ctrl+Q by default and rebindable — see
//     lib/shell/keymap.ts), and `AreasPanel`, the Sources rail's context switcher
//     and `camslot.area` each call `startDraw` from their own panel. The narration
//     has to outlive all of them.
//
//     SO THIS IS THE ONE THAT CANNOT BE TAKEN AWAY. It is mounted from ConsoleShell
//     and keys off the draw store alone, which means no rail group, no panel and no
//     board change can close it — only the gesture ending. Deliberately written
//     without naming which rail groups exist, because that list changes and this
//     reasoning does not.
//
// WHAT IT HAS TO MAKE UNMISTAKABLE — four things, and they are why the pill is laid
// out in three zones rather than written as one sentence. How many points you have
// placed (the value block, which is the live number the user is tracking); how you
// plot; how you confirm; how you stop. The old single line of faint text carried the
// last two, `white-space: nowrap` and an ellipsis, so on a narrow map the
// instructions were literally cut off. Nothing here truncates.
//
// A STATUS REGION, NOT A DIALOG. `role="status"` with `aria-live="polite"`: the count
// updates as vertices land and a screen reader should hear them without being
// interrupted mid-word. It must NOT be role="dialog" — ConsoleShell's global keydown
// handler early-returns while any [role="dialog"] is mounted, so a dialog here would
// kill Escape for the whole app exactly while the user needs Escape to cancel.
//
// WHY IT MEASURES THE STAGE. It is `position: fixed`, and it used to be centred on
// the VIEWPORT — so opening the Sources rail, which insets the console by up to
// 602px, left it visibly off-centre over the map that was left. The stage's
// bounding box is the only value with every inset already folded into it; see
// placeBanner in lib/shell/drawBanner.ts for why the rail width variables cannot be
// used instead. Until the first measurement lands, the CSS keeps the old
// viewport-centred position, which is the pre-existing behaviour rather than a new
// failure mode.
//
// It renders null when nothing is being drawn, so mounting it always costs one store
// subscription.

import { useEffect, useState } from "react";
import { cancelDraw, useAoiDraw } from "@/lib/map/aoi";
import { drawBannerModel, placeBanner, type BannerPlacement } from "@/lib/shell/drawBanner";

/** The map stage this banner belongs to (components/console/ConsoleWorkspace.tsx). */
const STAGE_SELECTOR = ".tn-cw-stage";
/** The camera-pick hint, which shares the stage's top edge while picking is armed. */
const ABOVE_SELECTOR = ".tn-arm-hint";

/**
 * Track the stage's box for as long as the gesture runs.
 *
 * A ResizeObserver on the stage covers every way its geometry moves — the Sources
 * rail opening, a rail splitter being DRAGGED (the widths update live, so a
 * subscription that only fired on drag-end would leave the banner lagging the map
 * it sits on), a wall board taking the hero cell, and the window resizing. Reads are
 * coalesced into one rAF, so a drag costs one measurement per frame rather than one
 * per event.
 *
 * It observes nothing at all while `active` is false, which is all but a few seconds
 * of a session.
 */
function useStagePlacement(active: boolean): BannerPlacement | null {
  const [place, setPlace] = useState<BannerPlacement | null>(null);

  useEffect(() => {
    if (!active) {
      setPlace(null);
      return;
    }
    const stage = document.querySelector(STAGE_SELECTOR);
    if (!stage || typeof ResizeObserver === "undefined") return;

    let raf = 0;
    const measure = () => {
      raf = 0;
      const r = stage.getBoundingClientRect();
      const above = document.querySelector(ABOVE_SELECTOR)?.getBoundingClientRect();
      setPlace(
        placeBanner({
          stage: { left: r.left, width: r.width, top: r.top },
          above: above ? { bottom: above.bottom } : null,
          viewport: window.innerWidth,
        }),
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(stage);
    window.addEventListener("resize", schedule);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active]);

  return place;
}

export default function DrawBanner() {
  const draw = useAoiDraw();
  // Called before the early return, so the hook order is stable across a gesture
  // starting and ending.
  const place = useStagePlacement(draw.active);
  if (!draw.active) return null;

  const model = drawBannerModel(draw);

  return (
    <div
      className="tn-drawbanner"
      role="status"
      aria-live="polite"
      style={
        place
          ? { left: `${place.left}px`, top: `${place.top}px`, maxWidth: `${place.maxWidth}px` }
          : undefined
      }
    >
      <span className="tn-drawbanner-pulse" aria-hidden />
      {model.value && (
        <span className="tn-drawbanner-count">
          <strong className="tn-drawbanner-num">{model.value.text}</strong>
          <span className="tn-drawbanner-unit">{model.value.label}</span>
        </span>
      )}
      <span className="tn-drawbanner-text">
        <strong className="tn-drawbanner-lead">{model.lead}</strong>
        <span className="tn-drawbanner-steps">
          {model.steps.map((step) => (
            <span className="tn-drawbanner-step" key={step.text}>
              {step.text}
              {step.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
          ))}
        </span>
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
