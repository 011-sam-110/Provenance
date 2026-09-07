"use client";

import { streamKey, type StreamRef } from "@/lib/console/widgets/camslot.model";
import type { LatLon } from "@/lib/console/widgets/camslot.arm";

// ── What the board is actually watching ──────────────────────────────────────
//
// Two different claims, and the map makes both:
//   ASSIGNED — this camera is in one of the tiles.
//   ON AIR   — this is the frame a tile is showing right now.
//
// A wall of nine tiles rotating through thirty cameras is showing nine of them at
// any instant. Marking all thirty identically would overstate what the operator
// can see; marking only nine would lose the set. So both, at two strengths.
//
// MODULE STATE for the same reason the basket is: WorldMap's interaction wiring
// is a `useCallback(..., [])` invoked once at mount, and StageHost unmounts the
// map entirely when a widget is focused. Component state survives neither.
//
// NOT PERSISTED. This is a description of what is on screen this second, not a
// preference — and anything that reached widget config would light the board's
// "customised" dot on a board nobody edited.

export interface WatchingState {
  assigned: Set<string>;
  onAir: Set<string>;
}

const tiles = new Map<string, { assigned: string[]; onAir: string | null }>();
const listeners = new Set<() => void>();

// The snapshot is CACHED and only rebuilt when a tile actually changes.
// `useSyncExternalStore` compares snapshots by identity and re-renders forever if
// `get()` derives a fresh object on every call — the classic trap in this repo.
let snapshot: WatchingState = { assigned: new Set(), onAir: new Set() };

function rebuild() {
  const assigned = new Set<string>();
  const onAir = new Set<string>();
  for (const t of tiles.values()) {
    for (const k of t.assigned) assigned.add(k);
    if (t.onAir) onAir.add(t.onAir);
  }
  snapshot = { assigned, onAir };
  for (const fn of listeners) fn();
}

export const watchingStore = {
  get(): WatchingState { return snapshot; },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

  /** A tile reports what it holds and what it is showing. Called on mount and on
   *  every rotation. */
  setTile(id: string, assigned: readonly StreamRef[], onAir: StreamRef | null) {
    const nextAssigned = assigned.map(streamKey);
    const nextOnAir = onAir ? streamKey(onAir) : null;

    // A REPORT THAT CHANGES NOTHING MUST NOT CHANGE THE SNAPSHOT. Tiles call this
    // on every rotation, and a rotation that lands on the same frame is a no-op —
    // but an unconditional `rebuild()` would still hand out a fresh object, which
    // is precisely what makes `useSyncExternalStore` re-render forever. Nothing
    // subscribes that way today (WorldMap subscribes imperatively), so this is a
    // guard against the next consumer, not a live bug. `dropTile` below already
    // had it, via `if (tiles.delete(id))`; this is the same rule on the other door.
    const prev = tiles.get(id);
    if (
      prev &&
      prev.onAir === nextOnAir &&
      prev.assigned.length === nextAssigned.length &&
      prev.assigned.every((k, i) => k === nextAssigned[i])
    ) return;

    tiles.set(id, { assigned: nextAssigned, onAir: nextOnAir });
    rebuild();
  },

  dropTile(id: string) {
    if (tiles.delete(id)) rebuild();
  },

  /** Tests only. */
  reset() { tiles.clear(); rebuild(); },
};

/**
 * The marks, as GeoJSON. Pure — the position lookup is injected, so this is
 * testable in node and does not import a store into a hot loop.
 *
 * ONE LAYER, DATA-DRIVEN off the `onair` property rather than two layers. The
 * rotation then repaints with a single `setData` instead of adding and removing
 * layers on a timer, which MapLibre does not enjoy and which would fight the
 * basemap style reload.
 */
export function watchingFeatures(
  state: WatchingState,
  locate: (key: string) => LatLon | null,
): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const key of state.assigned) {
    const at = locate(key);
    // A camera we cannot place is DROPPED, never coerced to 0,0 — that would put
    // it in the Gulf of Guinea and claim we are watching it.
    if (!at || !Number.isFinite(at.lat) || !Number.isFinite(at.lon)) continue;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [at.lon, at.lat] },
      properties: { key, onair: state.onAir.has(key) ? 1 : 0 },
    });
  }
  return out;
}
