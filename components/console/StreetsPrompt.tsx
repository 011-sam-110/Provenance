"use client";

import { useEffect, useSyncExternalStore } from "react";
import { cancelCircleDraw, circleDrawStore } from "@/lib/console/widgets/camslot.circle";
import { startStreetsArea } from "@/lib/console/widgets/camslot.apply";

/**
 * What an empty wall says.
 *
 * It is not an empty state in the usual sense — the board is not missing
 * something the user forgot to add. It is the board's first question, and the map
 * behind it is full-bleed precisely so the question has somewhere to be answered.
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

  return (
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
  );
}
