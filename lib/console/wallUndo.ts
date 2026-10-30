"use client";

import { shellLayoutStore } from "@/lib/console/store";
import { activePresetStore } from "@/lib/console/activePreset";
import { cancelCircleDraw } from "@/lib/console/widgets/camslot.circle";
import { sanitizeCamslotConfig, streamKey } from "@/lib/console/widgets/camslot.model";
import type { ShellLayout } from "@/lib/console/types";

/**
 * Undo for "New area" (Leon, 2026-10-29: "I want an undo button instead of double
 * click. I want a popup that says 'X cameras cleared. Click to undo.'").
 *
 * One click on New area clears the wall at once. This module remembers what was on
 * it, long enough to put it back, and forgets the moment the offer stops being true.
 *
 * WHAT MAKES AN OFFER STOP BEING TRUE is one rule, not a list: the offer holds the
 * exact (empty) layout that clearing left behind, and the board it was made on. If
 * the layout the store holds is ever a different object, or the active board is a
 * different board, the offer is gone. That one comparison covers a new area landing
 * its tiles, Reset from the command palette, a board switch, a share link opening
 * and a hand-added tile, without naming any of them. It also means a restore can
 * never overwrite something the user did after the clear.
 *
 * NEVER PERSISTED. The offer lives in this module's memory and a reload drops it.
 * (The restored layout IS saved, because `replace` archives the board like any other
 * edit; only the offer is not.)
 *
 * NEVER DROPPED BY A COMPONENT UNMOUNTING. React StrictMode mounts, unmounts and
 * mounts again in development (see the note at the end of camslot.apply.ts), which
 * would delete an offer that was made a moment before. The surface that shows the
 * offer only reads this store; it never owns it.
 */

// ── Pure rules (unit-tested in the node environment) ─────────────────────────

/** How many different cameras a layout's walls are showing. A camera two tiles
 *  both hold counts once, because the note says how many cameras were cleared, not
 *  how many slots held one. Every config is re-checked first, so junk in a stored
 *  or shared board counts as nothing. Widgets that are not camera walls count 0. */
export function camerasOnBoard(layout: ShellLayout): number {
  const seen = new Set<string>();
  for (const w of layout.widgets) {
    if (w.type !== "camslot") continue;
    for (const s of sanitizeCamslotConfig(w.config).streams) seen.add(streamKey(s));
  }
  return seen.size;
}

/** The note's whole sentence: the count, then Leon's words for the action. */
export function clearedLabel(n: number): string {
  return `${clearedStatus(n)} Click to undo.`;
}

/** The note's spoken line, without the action (the action is its own button). */
export function clearedStatus(n: number): string {
  if (n === 0) return "Board cleared.";
  if (n === 1) return "1 camera cleared.";
  return `${n} cameras cleared.`;
}

/** What the toast says once the board is back. */
export function restoredLabel(n: number): string {
  if (n === 0) return "Board restored.";
  if (n === 1) return "1 camera restored.";
  return `${n} cameras restored.`;
}

export interface Box { top: number; bottom: number; left: number; right: number }

/**
 * How far the area card must rise to stay clear of the Discord note, in px.
 *
 * 0 when there is no note, when the note ends before the card's left edge, or when
 * it is not over the map at all (on a phone it sits below the map). Otherwise the
 * card's bottom has to sit `gap` above the note's top, measured from the stage's
 * bottom edge.
 */
export function noteClearance(stage: Box, note: Box | null, cornerLeft: number, gap = 12): number {
  if (!note) return 0;
  if (note.right <= cornerLeft) return 0;
  if (note.top >= stage.bottom || note.bottom <= stage.top) return 0;
  return Math.ceil(stage.bottom - note.top + gap);
}

// ── The offer ────────────────────────────────────────────────────────────────

export interface WallUndoOffer {
  /** A new number for every offer, so the note remounts (and restarts its clock) when
   *  one offer follows another. */
  id: number;
  /** What was on the board before it was cleared. */
  snapshot: ShellLayout;
  /** The empty layout that clearing left in the store. */
  cleared: ShellLayout;
  /** The board it happened on. */
  board: string | null;
  /** Cameras cleared (distinct). */
  count: number;
  /** True only when the click was a keyboard activation: the note then takes focus. */
  focus: boolean;
}

let offer: WallUndoOffer | null = null;
let offerSeq = 0;
const listeners = new Set<() => void>();
let watching = false;
let newAreaFocus = false;

function emit() {
  for (const l of listeners) l();
}

/** One module-level subscription, made on the first offer and kept: see the note at
 *  the top about why no component owns it. */
function watchStores() {
  if (watching) return;
  watching = true;
  shellLayoutStore.subscribe(() => {
    if (offer && shellLayoutStore.get() !== offer.cleared) dropWallUndo();
  });
  activePresetStore.subscribe(() => {
    if (offer && activePresetStore.get() !== offer.board) dropWallUndo();
  });
}

export const wallUndoStore = {
  get(): WallUndoOffer | null { return offer; },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};

/** Call AFTER `clearMonitorArea()` returned true, with the layout and board read
 *  BEFORE it. */
export function offerWallUndo(snapshot: ShellLayout, board: string | null, opts: { focus: boolean }): void {
  watchStores();
  offerSeq += 1;
  offer = {
    id: offerSeq,
    snapshot,
    cleared: shellLayoutStore.get(),
    board,
    count: camerasOnBoard(snapshot),
    focus: opts.focus,
  };
  emit();
}

export function dropWallUndo(): void {
  if (!offer) return;
  offer = null;
  emit();
}

/**
 * Put the cleared board back. Returns how many cameras came back, or null when
 * there was nothing true to restore (the offer is gone, or the board has changed
 * since the clear), in which case nothing is touched.
 *
 * A circle that is mid-draw is cancelled first: the restored tiles would otherwise
 * land under an armed gesture that holds pointer capture on the map.
 */
export function restoreWallUndo(): number | null {
  const o = offer;
  if (!o) return null;
  if (shellLayoutStore.get() !== o.cleared || activePresetStore.get() !== o.board) {
    dropWallUndo();
    return null;
  }
  cancelCircleDraw();
  shellLayoutStore.replace(o.snapshot);
  dropWallUndo();
  return o.count;
}

// ── Focus hand-off ───────────────────────────────────────────────────────────
// After a keyboard undo the wall mounts again and its New area button is a new
// element; this one-shot flag is how that button knows to take focus.

export function requestNewAreaFocus(): void {
  newAreaFocus = true;
}

export function takeNewAreaFocus(): boolean {
  const v = newAreaFocus;
  newAreaFocus = false;
  return v;
}
