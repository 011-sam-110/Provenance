// The console's machine-readable pulse line (`data-testid="stat-line"`), as a pure
// function so a test can hold its words. TerminalHeader renders it, and so does the
// unused StatusBar it replaced; one builder keeps the two from drifting.
//
// TWO RULES, BOTH FROM MEASURED MISTAKES.
//   1. "off" is not "0". An audit read "0 planes · 0 satellites" as two dead feeds while
//      the layers were simply switched off. A layer that is off says so.
//   2. A still is never called live. The video count is `liveCameras`: cameras whose
//      stream played at its last check, plus, during the warm-up after a start, streams
//      not yet checked (`playsNow` in lib/liveness/playcheck.ts). Refreshing pictures
//      (registry stills plus Windy webcams) are counted separately and called stills.
//      The "off" words name the layer toggles as the rail labels them.

export interface StatLineMetrics {
  liveCameras: number;
  stillCameras: number;
  webcams: number;
  planes: number;
  satellites: number;
}

export interface StatLineLayers {
  livecams?: boolean;
  staticcams?: boolean;
  planes?: boolean;
  satellites?: boolean;
}

export function statLine(m: StatLineMetrics, layers: StatLineLayers): string {
  return [
    layers.livecams ? `${m.liveCameras.toLocaleString()} video cams` : "live cams off",
    layers.staticcams ? `${(m.stillCameras + m.webcams).toLocaleString()} still cams` : "static cams off",
    layers.planes ? `${m.planes.toLocaleString()} planes` : "planes off",
    layers.satellites ? `${m.satellites.toLocaleString()} satellites` : "satellites off",
  ].join(" · ");
}
