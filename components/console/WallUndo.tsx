"use client";

import { useSyncExternalStore } from "react";
import { UndoNote, type UndoCloseReason } from "@/components/shell/UndoNote";
import {
  clearedStatus,
  dropWallUndo,
  requestNewAreaFocus,
  restoreWallUndo,
  restoredLabel,
  wallUndoStore,
} from "@/lib/console/wallUndo";

/**
 * The Streets half of the undo: it reads the offer `New area` leaves behind and shows
 * the shared note above the area card. Renders nothing when there is no offer.
 *
 * It only READS the offer and never owns it. The card unmounts the moment tiles land,
 * and in development React mounts, unmounts and mounts every component again, so the
 * offer's life is decided by the store's own rule (lib/console/wallUndo.ts), not by
 * this component being on screen.
 */

const NOTE = ".tn-streets-undo";
const DRAW_BUTTON = ".tn-streets-prompt-b";

function focusIsInNote(): boolean {
  const a = document.activeElement;
  return !!a && !!a.closest(NOTE);
}

export function WallUndo() {
  const offer = useSyncExternalStore(wallUndoStore.subscribe, wallUndoStore.get, () => null);
  if (!offer) return null;

  const onUndo = () => {
    const inside = focusIsInNote();
    const n = restoreWallUndo();
    if (n === null) return;
    // The wall's "New area" button is where a keyboard user was before; hand focus
    // back to it once the tiles are back. Asked only after a real restore, so a
    // refused one leaves no request lying around for the next time tiles land.
    if (inside) requestNewAreaFocus();
    window.dispatchEvent(new CustomEvent("tn-toast", { detail: restoredLabel(n) }));
  };

  const onClose = (reason: UndoCloseReason) => {
    const inside = focusIsInNote();
    // Focus is read BEFORE the note goes: removing the element that holds it would
    // drop focus on the page body. The card's own button is the nearest thing left.
    if (reason === "escape" || (reason === "close" && inside)) {
      document.querySelector<HTMLElement>(DRAW_BUTTON)?.focus();
    }
    dropWallUndo();
  };

  return (
    <UndoNote
      key={offer.id}
      message={clearedStatus(offer.count)}
      actionLabel="Click to undo."
      ms={10_000}
      autoFocus={offer.focus}
      className="tn-streets-undo"
      onUndo={onUndo}
      onClose={onClose}
    />
  );
}
