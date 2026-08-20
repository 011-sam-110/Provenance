"use client";
// Stage solo: give the whole board to the map, and put it back.
//
// WHY. The OSINT investigator's first sentence was about VOLUME, not colour:
// "veo una sobrecarga cognitiva cabrona en la interfaz". He offered two fixes and
// we had only done one. The colour hierarchy was split into its own alert ramp
// (#127) and that measurably worked — one orange doing seven jobs became two
// hues doing two — but the amount of information competing for attention did not
// change at all: 337 elements in the left column before, 337 after. His other
// suggestion was the blunt one, "o de plano poder colapsar esa barra", and it is
// the one that actually answers the complaint he opened with.
//
// WHY IT IS NOT THE `collapsed` FLAG THAT ALREADY EXISTS. lib/console/reducers
// has setSegmentCollapsed and the store exposes collapseSegment, and nothing has
// ever called either. They are vestigial: segments stopped being a live rail when
// the Terminal moved to a free 12-column grid, so `segments.left.collapsed` now
// governs a CSS variable that lib/console's own comment calls legacy. Reviving a
// dead flag to mean something new would be worse than adding an honest one.
//
// WHY IT IS NOT PART OF ShellLayout. Solo is a VIEW state, not a layout: it must
// not be captured in a `?c=` share link or a board preset, or sending someone
// your board would send them a hidden one, and every preset would need an answer
// to a question its author never asked. It persists on its own key so a reload
// keeps what you were looking at, and nothing else has to know.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

const PERSIST_KEY = "tn.terminal.solo.v1";
const PERSIST_VERSION = 1;

let solo = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, solo);
}

export const soloStore = {
  get: (): boolean => solo,
  set(next: boolean) {
    if (solo === next) return;
    solo = next;
    emit();
  },
  toggle() {
    solo = !solo;
    emit();
  },
  /** Pull the persisted value back in. Client-side, after mount. */
  hydrate() {
    solo = loadPersisted<boolean>(PERSIST_KEY, PERSIST_VERSION) === true;
    emit();
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useStageSolo(): boolean {
  // Server snapshot is always false: solo is a preference read from localStorage,
  // and claiming it during SSR would hydrate a board that does not match the HTML.
  return useSyncExternalStore(soloStore.subscribe, soloStore.get, () => false);
}
