"use client";
// How wide the panel beside the sidebar is, and who gets to decide. All five panels share it,
// and it keeps the name of the rail that first had it: `tn.sources.railw` is saved in browsers.
//
// WHY THIS IS NOT `shellLayoutStore.setSegment`. That store and its splitter
// (components/console/RailSplitter.tsx, lib/terminal/useRailSplitter.ts) are typed
// on `SegmentId` — "left" | "right" | "bottom" — which is the WIDGET rail a card
// lives in. Those three ids travel into presets, `layersForLayout`, the move
// helpers, the share payload and the ⌘K rail pickers, so widening the union to
// carry a chrome surface would put "sources" in front of every one of those call
// sites for the sake of one number. The Sources rail is not a place a widget can
// go; it is the panel you pick widgets FROM. So it keeps its own store, and the
// splitter that drives it copies RailSplitter's ARIA and keyboard contract rather
// than its type.
//
// NOT IN THE SHARE URL, and that matches what is already there. `lib/console/share.ts`
// encodes the board — the widgets and the rail each one sits in — and encodes no
// segment size at all, so a `?c=` link has never carried how wide anyone's rails
// were. A pane width is a property of the person reading, not of the workspace
// being shared, and a shared link that reshapes the recipient's chrome would be
// the surprise. It persists locally, exactly like the console rails do.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

const PERSIST_KEY = "tn.sources.railw";
const PERSIST_VERSION = 1;

/**
 * The narrowest the rail may be dragged.
 *
 * Measured rather than picked: the longest row label in the catalogue is
 * "Borders & names", and a row is `label + ＋ + toggle` with an 8px gap and 6px of
 * row padding either side. At 300px of CONTENT the label column still has ~150px,
 * which clears every label in SECTIONS without ellipsis. Below that the labels start
 * truncating and the rail stops being readable, which is a worse failure than
 * simply refusing to go narrower.
 *
 * IT IS 324, 300 OF ROWS AND THE PANES' 24px OF PADDING. It was 372 while the panel held a
 * 48px tool column as well; that column is rows on the sidebar now (2026-10-31), so the
 * floor came down by exactly that much. A saved 372 is inside the bounds and is kept.
 */
export const SOURCES_RAIL_MIN = 324;

/**
 * The widest.
 *
 * Deliberately ABOVE the 602px the rail used to be pinned at, because 602 was
 * chosen as the width at which `.tn-src-rows` folds to TWO columns (562px of
 * content plus 40px of padding and scrollbar — see the container query at
 * `@container (max-width: 561px)`). Capping at the old default would have made the
 * two-column layout unreachable, so the ceiling sits clear of it instead.
 *
 * 680, AND IT WAS 640, because two columns needed 634px of panel while a 48px tool column
 * sat in it. That column left on 2026-10-31 and the fold now needs 586px (562 of content +
 * 24 of padding), so 680 has clearance to spare, and a width someone saved stays reachable.
 *
 * WHAT THIS DOES NOT PROMISE: that the fold is reachable at every viewport. The CSS
 * ceiling is `min(680px, 100vw - 848px)` — the reserve that stops the panel starving
 * the map stage, plus the sidebar's 64px — so at a 1440px window the panel tops out at 592
 * and its 568px of content sits just above the fold. On a narrower window it does not, and
 * that is the stage's floor winning rather than an oversight.
 */
export const SOURCES_RAIL_MAX = 680;

/**
 * The default, and the number this whole change is about.
 *
 * The rail used to be `clamp(316px, calc(100vw - 820px), 602px)` — i.e. as wide as
 * 602px wherever the viewport allowed it. That width exists to buy a second column
 * of sources, and on a typical laptop it does not buy one: at a 1400px viewport the
 * clamp yields ~580px, the section's inline size lands under the 561px fold, and
 * the rail draws ONE column of rows stretched label-left / toggle-right across
 * ~560px. Half the pane is the gap in the middle of every row.
 *
 * 452 is 75% of 602, and it is one column that fits its content instead of one
 * column stretched over two columns' worth of space. Anyone who does want the
 * two-column layout can still drag up to SOURCES_RAIL_MAX and get it.
 */
export const SOURCES_RAIL_DEFAULT = 452;

/** Arrow-key resize step, and the Shift+arrow coarse step. Same values as the
 *  console splitter (lib/terminal/rails.ts) so the two controls do not feel like
 *  different products under the same keyboard. */
export const SOURCES_RAIL_STEP = 16;
export const SOURCES_RAIL_STEP_COARSE = 64;

/**
 * Pure: round and clamp a requested width into [MIN, MAX].
 *
 * NaN and non-numbers fall back to the DEFAULT rather than to the minimum. This
 * differs from `clampRailSize` on purpose: that function's callers are a live drag
 * and a restored layout, where "unknown" most safely means "as small as allowed".
 * Here the only way to reach this with junk is a corrupted localStorage envelope,
 * and answering that with a 300px rail would silently punish someone for a bad
 * write they never made. The infinities keep their meaning — they say "as far as
 * it goes" in a direction, so they clamp to the bound they point at.
 */
export function clampSourcesRailWidth(px: number): number {
  if (typeof px !== "number" || Number.isNaN(px)) return SOURCES_RAIL_DEFAULT;
  if (px === Infinity) return SOURCES_RAIL_MAX;
  if (px === -Infinity) return SOURCES_RAIL_MIN;
  return Math.max(SOURCES_RAIL_MIN, Math.min(SOURCES_RAIL_MAX, Math.round(px)));
}

/**
 * Pure: the width a pointer at `clientX` is asking for.
 *
 * The caller passes the panel's own left edge, which is just right of the sidebar, so the
 * distance from that edge to the pointer IS the width. Kept out of the component so the
 * arithmetic is node-testable — the repo has no jsdom, so anything that reads an
 * element cannot be covered by a unit test.
 */
export function widthFromPointer(clientX: number, boxLeft: number): number {
  return clampSourcesRailWidth(clientX - boxLeft);
}

let state: number = SOURCES_RAIL_DEFAULT;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const sourcesRailWidthStore = {
  set(px: number) {
    state = clampSourcesRailWidth(px);
    emit();
  },
  get(): number {
    return state;
  },
  reset() {
    state = SOURCES_RAIL_DEFAULT;
    emit();
  },
  hydrate() {
    const saved = loadPersisted<number>(PERSIST_KEY, PERSIST_VERSION);
    state = saved === null ? SOURCES_RAIL_DEFAULT : clampSourcesRailWidth(saved);
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useSourcesRailWidth(): number {
  return useSyncExternalStore(
    sourcesRailWidthStore.subscribe,
    sourcesRailWidthStore.get,
    // SERVER SNAPSHOT IS THE DEFAULT, NOT THE PERSISTED VALUE, and it has to be:
    // localStorage does not exist during SSR, so returning anything else would make
    // the first client render disagree with the server's HTML. The persisted width
    // arrives via hydrate() in ConsoleShell's mount effect, one frame later.
    () => SOURCES_RAIL_DEFAULT,
  );
}
