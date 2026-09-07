"use client";

import { useSyncExternalStore } from "react";
import { circleDrawStore } from "@/lib/console/widgets/camslot.circle";
import { cancelCircleDraw } from "@/lib/console/widgets/camslot.circle";
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
        <button type="button" className="tn-streets-prompt-b" onClick={() => startStreetsArea()}>
          Draw an area
        </button>
      )}
    </div>
  );
}
