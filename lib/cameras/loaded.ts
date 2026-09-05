"use client";
// A snapshot of the cameras the map has loaded, so the palette's "Dive to a live feed"
// command and the console widgets can use them without re-fetching the full
// /api/cameras payload. WorldMap publishes here whenever CamerasFeed lands.
// Reactive: subscribe() lets widgets rerender on updates.
//
// NOT VIEWPORT-SCOPED, despite what this comment used to imply. WorldMap.tsx:1959-1961
// sets the ENTIRE /api/cameras array, and app/api/cameras/route.ts takes no request
// argument, so there is no bbox to scope it to. The two real constraints are that it
// is populated only while the camera layer is on, and that it is a client-side
// snapshot with no freshness guarantee of its own.

export interface LoadedCamera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  available: boolean;
  live: boolean;
  // The two below are ALREADY PRESENT at runtime and were simply undeclared:
  // CamerasFeed passes the raw parsed /api/cameras rows straight through, and those
  // carry twelve fields (measured 2026-08-15: id, name, lat, lon, available, source,
  // country, live, region, refreshSeconds, attribution, license).
  //
  // Optional on purpose. Declaring them required would be a promise about an upstream
  // shape this module does not control; optional means a future API change degrades
  // to a stated fallback (see FALLBACK_REFRESH_SECONDS in camslot.arm.ts) instead of
  // producing a confident wrong number.
  /** Seconds between published frames, per the source adapter. */
  refreshSeconds?: number;
  /** The feed this camera came from, e.g. "tfl" — lets a picker filter to one operator. */
  source?: string;
}

let cams: LoadedCamera[] = [];
const listeners = new Set<() => void>();

export const loadedCamerasStore = {
  set(next: LoadedCamera[]) {
    cams = next;
    for (const fn of listeners) fn();
  },
  get(): LoadedCamera[] {
    return cams;
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
};
