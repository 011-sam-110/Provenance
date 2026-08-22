"use client";
// A snapshot of the webcams the map has drawn, mirroring lib/cameras/loaded.ts.
//
// WHY THIS EXISTS. Road cameras have been readable outside WorldMap since
// loadedCamerasStore shipped; webcams were not — they lived only in a component
// ref (`webcamsRef`), so anything outside the map that wanted "the webcams on
// screen" could not have them. That was survivable while every webcam gesture was
// a map gesture. Drawing an area to build a camera wall is not: the control that
// starts the draw sits on the stage bar, outside <WorldMap/>, and a picker that
// silently covered road cameras but not webcams would under-report a Soho ring by
// most of what is actually there and never say so.
//
// THE SAME TWO CAVEATS APPLY AS FOR CAMERAS, and they are worse here. This is
// populated only while the Webcams layer is on, so an empty result means "we were
// not looking", not "there is nothing there". And what /api/webcams serves is an
// unranked ~2% sample of Windy's catalogue from fourteen fixed region boxes —
// measured 2026-08-15, it held 0 webcams for Madrid, Paris, Barcelona and
// Amsterdam while Windy's own answer for the Madrid box was 528. So the count in
// here is a floor, never a total, and no caller may print it as one.

export interface LoadedWebcam {
  id: string;
  /** Display title as the feed gave it. */
  label: string;
  lat: number;
  lon: number;
}

let cams: LoadedWebcam[] = [];
const listeners = new Set<() => void>();

export const loadedWebcamsStore = {
  set(next: LoadedWebcam[]) {
    cams = next;
    for (const fn of listeners) fn();
  },
  get(): LoadedWebcam[] {
    return cams;
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
};
