// Can this browser draw the map at all?
//
// MapLibre needs a WebGL context, and with none its Map constructor THROWS. Nothing
// round WorldMap caught that, so a browser with WebGL off (hardware acceleration
// switched off, a locked-down work machine, an old GPU on a blocklist) got Next's
// "Application error: a client-side exception has occurred" on /eye and on /app.
// Measured 2026-10-27 against production with Chromium's --disable-webgl: both
// pages showed that screen and nothing else, while / still drew its globe with the
// 2D painter.
//
// So the two map pages ask first and show components/map/MapFallback.tsx instead of
// mounting the map. The probe is a guess made before the map exists, so
// components/map/MapBoundary.tsx still catches a start failure it did not foresee.
//
// Pure apart from the canvas it is handed, so tests/unit/webgl-probe.test.ts drives
// it with a fake document.

/** The part of `document` the probe uses. */
export interface CanvasMaker {
  createElement(tag: "canvas"): { getContext(kind: string): unknown };
}

/**
 * True when a WebGL 2 or WebGL 1 context can be made. False with no document, when
 * every kind answers null, or when asking throws (some browsers throw instead of
 * answering null when the GPU process has crashed).
 */
export function canUseWebGL(doc: CanvasMaker | undefined = typeof document === "undefined" ? undefined : document): boolean {
  if (!doc) return false;
  try {
    const canvas = doc.createElement("canvas");
    for (const kind of ["webgl2", "webgl", "experimental-webgl"]) {
      if (canvas.getContext(kind)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
