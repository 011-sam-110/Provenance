"use client";
// Live global-pulse counters, lifted into one external store so the top status
// bar, the left rail and the freshness ticker all read a single source of truth
// instead of threading props through WorldMap. WorldMap pushes counts in via
// metricsStore.set(); the chrome subscribes with useMetrics().
//
// set() is shallow-equal guarded so the per-second satellite tick (a new array
// each frame, identical length) never re-renders the chrome.

import { useSyncExternalStore } from "react";

export interface Metrics {
  /** Cameras whose feed is currently reachable. */
  camerasOnline: number;
  /** Cameras in the registry, regardless of health. */
  camerasTotal: number;
  /**
   * The registry split by what a pin actually shows — the two camera LAYERS, where
   * `camerasTotal` is the one FETCH they share. They sum to `camerasTotal`.
   *
   * Counted from the loaded rows, never assumed: `liveCameras` is the subset whose
   * stream /api/hls can play, which on the live registry is a small minority. A rail
   * row showing `camerasTotal` beside a label saying "Live cams" would be the exact
   * overstatement the tier split exists to remove.
   */
  liveCameras: number;
  stillCameras: number;
  planes: number;
  satellites: number;
  /** Windy webcams currently loaded — drawn on the Static cams layer beside `stillCameras`. */
  webcams: number;
}

let state: Metrics = { camerasOnline: 0, camerasTotal: 0, liveCameras: 0, stillCameras: 0, planes: 0, satellites: 0, webcams: 0 };
const listeners = new Set<() => void>();

function shallowEqual(a: Metrics, b: Metrics): boolean {
  return (
    a.camerasOnline === b.camerasOnline &&
    a.camerasTotal === b.camerasTotal &&
    a.liveCameras === b.liveCameras &&
    a.stillCameras === b.stillCameras &&
    a.planes === b.planes &&
    a.satellites === b.satellites &&
    a.webcams === b.webcams
  );
}

export const metricsStore = {
  set(partial: Partial<Metrics>) {
    const next = { ...state, ...partial };
    if (shallowEqual(next, state)) return;
    state = next;
    for (const l of listeners) l();
  },
  get(): Metrics {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useMetrics(): Metrics {
  return useSyncExternalStore(metricsStore.subscribe, metricsStore.get, metricsStore.get);
}
