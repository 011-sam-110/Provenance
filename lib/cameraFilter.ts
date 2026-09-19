"use client";
// Per-OPERATOR camera visibility, layered under the two camera layer toggles. Same
// framework-light external-store pattern as lib/layers.ts and lib/overlay.ts.
// WorldMap reads this to filter which cameras it renders; the rail's camera key
// drives the controls.
//
//   • regions — per-source visibility (missing source defaults to visible)
//
// `liveOnly` USED TO LIVE HERE AND IS GONE. It was a tick under the camera row
// meaning "only cameras with a playable HLS stream" — which is now the `livecams`
// layer toggle itself, one row up in the same rail. Two controls for one question is
// worse than either: with the tick on and `staticcams` on, the still tier would be
// switched on and drawn empty, and nothing on screen would say which control had
// won. The sub-filter is the one that went, because the toggle is the one a reader
// can see. See lib/layers.ts for the tiers and lib/variants/builtins.ts for the one
// board that set the tick.

import { useSyncExternalStore } from "react";

export interface CameraFilterState {
  regions: Record<string, boolean>;
}

let state: CameraFilterState = {
  regions: { tfl: true, caltrans: true, scdot: true, digitraffic: true, castlerock: true, tripcheck: true, drivebc: true, nzta: true, iceland: true, estonia: true, trafficscotland: true },
};
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const cameraFilterStore = {
  toggleRegion(source: string) {
    const current = state.regions[source] ?? true;
    state = { ...state, regions: { ...state.regions, [source]: !current } };
    emit();
  },
  /**
   * Whether a camera passes the operator filter.
   *
   * `live` is still in the signature and is deliberately unused: the tier decision
   * belongs to the layer toggles (WorldMap applies it before calling this), and
   * keeping the argument means a caller that has the flag cannot accidentally pass
   * it somewhere that silently ignores it — there is one filter here, and it is the
   * operator.
   */
  passes(source: string, _live: boolean): boolean {
    return (state.regions[source] ?? true) !== false;
  },
  get(): CameraFilterState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useCameraFilter(): CameraFilterState {
  return useSyncExternalStore(cameraFilterStore.subscribe, cameraFilterStore.get, cameraFilterStore.get);
}
