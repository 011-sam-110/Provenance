"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { cancelCircleDraw, circleDrawStore } from "@/lib/console/widgets/camslot.circle";
import { startStreetsArea } from "@/lib/console/widgets/camslot.apply";
import { WallUndo } from "@/components/console/WallUndo";
import { noteClearance, type Box } from "@/lib/console/wallUndo";

const box = (r: DOMRect): Box => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });

/**
 * What an empty wall says.
 *
 * It is not an empty state in the usual sense — the board is not missing
 * something the user forgot to add. It is the board's first question, and the map
 * behind it is full-bleed precisely so the question has somewhere to be answered.
 *
 * It sits in the map's bottom-left corner (Leon, 2026-10-29), out of the middle where
 * the drag that answers it starts. The corner is a column: the undo note that "New area"
 * leaves behind goes above the card, and the Discord note, which is fixed to the same
 * corner of the window, lifts the whole column while it shows.
 */
export function StreetsPrompt() {
  const draw = useSyncExternalStore(circleDrawStore.subscribe, circleDrawStore.get, () => null);
  const drawing = draw !== null;

  // THE GESTURE MUST NOT OUTLIVE THE PROMPT. This card is the only thing on screen
  // that explains the gesture, and it unmounts the moment the board stops being an
  // empty wall — switch preset, focus a widget, or simply land the first tiles. An
  // armed circle left behind holds pointer capture and `dragPan.disable()`, so the
  // map silently refuses to pan with nothing on screen saying why. Escape would
  // still work, but only for someone who guessed.
  useEffect(() => () => cancelCircleDraw(), []);

  // THE DISCORD NOTE IS FIXED TO THE WINDOW'S BOTTOM-LEFT, over this same corner of the
  // map on a desktop. The card rises 12px clear of it while it shows. The note is read
  // from the DOM and never edited: it is not ours. Nothing polls. The note appears and
  // goes through its wrapper's children, slides in (so it is measured after it settles),
  // and the window or the stage can change size.
  const cornerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const corner = cornerRef.current;
    const stage = corner?.parentElement;
    if (!corner || !stage) return;
    const update = () => {
      const note = document.querySelector<HTMLElement>(".tn-note");
      const px = noteClearance(
        box(stage.getBoundingClientRect()),
        note ? box(note.getBoundingClientRect()) : null,
        corner.getBoundingClientRect().left,
      );
      corner.style.setProperty("--tn-streets-note-clear", px + "px");
    };
    update();
    const live = document.querySelector<HTMLElement>(".tn-note-live");
    const mo = new MutationObserver(update);
    mo.observe(live ?? document.body, { childList: true, subtree: true });
    live?.addEventListener("animationend", update);
    window.addEventListener("resize", update);
    // The Sources pane opening or closing moves the stage's left edge under a note that is
    // already up, and that fires no window resize.
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    return () => {
      mo.disconnect();
      ro.disconnect();
      live?.removeEventListener("animationend", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="tn-streets-corner" ref={cornerRef}>
      <WallUndo />
      <div className="tn-streets-prompt">
        <p className="tn-streets-prompt-t">Draw a circle round the area you want to monitor</p>
        <p className="tn-streets-prompt-s">
          {drawing
            ? draw?.center
              ? `${draw.radiusKm.toFixed(1)} km — release to set it`
              : "Press on the map and drag out from the centre"
            : "Every camera inside it fills the board."}
        </p>
        {drawing ? (
          <button type="button" className="tn-streets-prompt-b" onClick={() => cancelCircleDraw()}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="tn-streets-prompt-b"
            // The result was discarded, which made both of startStreetsArea's failure
            // messages dead strings: pressing this during the boot window, before the
            // map instance is registered, did nothing at all — no cursor, no banner, no
            // word — so the only feedback was to press it again.
            onClick={() => {
              const res = startStreetsArea();
              if (!res.ok && res.message) {
                window.dispatchEvent(new CustomEvent("tn-toast", { detail: res.message }));
              }
            }}
          >
            Draw an area
          </button>
        )}
      </div>
    </div>
  );
}
