"use client";
// The way back to God's eye view, held for this visit.
//
// The console opened from /eye's Sources link carries `eye=`: the view it was opened
// from (lib/eye/places.ts, `eyeLinkQuery`). ConsoleShell reads it once after mount,
// checks it through `parseEyeReturn`, keeps the result here, and drops `eye=` from the
// address. components/console/EyeReturn.tsx draws the button from this store, so the
// button follows the visitor across boards for as long as the tab lives.
//
// WHY IN MEMORY ONLY. A stored copy would be a new row on /privacy's storage table,
// for a button whose whole job is the next minute. The cost is accepted and stated: a
// reload drops the button. The browser's Back button still returns to /eye, because
// the console was reached by a link.
//
// Same shape as lib/console/sourcesRail.ts: module state, a listener set,
// useSyncExternalStore. Nothing here touches window or document, so importing it on
// the server or under the node vitest environment is inert.

import { useSyncExternalStore } from "react";
import type { EyeReturn } from "@/lib/eye/places";

let current: EyeReturn | null = null;
const listeners = new Set<() => void>();

export const eyeReturnStore = {
  get: (): EyeReturn | null => current,
  set(next: EyeReturn | null): void {
    current = next;
    for (const l of listeners) l();
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useEyeReturn(): EyeReturn | null {
  return useSyncExternalStore(eyeReturnStore.subscribe, eyeReturnStore.get, () => null);
}

/** The plate's words. Plain, sentence case, no em dash. */
export const EYE_RETURN_LABEL = "God's eye view";

export function eyeReturnHint(r: Pick<EyeReturn, "kind" | "placeName">): string {
  if (r.kind === "place" && r.placeName) return `Back to ${r.placeName}`;
  if (r.kind === "camera") return "Back to the camera";
  return "Back to the same spot";
}

/** The accessible name: contains the visible words in order (WCAG label in name). */
export function eyeReturnName(r: Pick<EyeReturn, "kind" | "placeName">): string {
  const hint = eyeReturnHint(r);
  return `${EYE_RETURN_LABEL}: ${hint.charAt(0).toLowerCase()}${hint.slice(1)}`;
}
