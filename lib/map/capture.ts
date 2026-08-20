// Capturing the map canvas as a PNG, and the WebGL trap that makes the obvious
// version silently produce a blank image.
//
// THE TRAP. A WebGL drawing buffer is cleared the moment the browser composites
// it, so by the time any ordinary code calls canvas.toDataURL() the pixels are
// already gone and you get a transparent rectangle — no error, no warning, a
// perfectly valid empty PNG. The usual fix is `preserveDrawingBuffer: true` at
// map construction, and it is the wrong one here: it forces the compositor to
// keep a second full-size buffer for the whole session, on a map that is the
// product's centrepiece and is already the heaviest thing on the page, to serve
// an action most sessions never take.
//
// So instead we read the canvas INSIDE a `render` frame, which is the one moment
// the buffer is guaranteed to still hold the pixels, and ask for that frame with
// triggerRepaint(). Cost: nothing until someone exports. Same technique the
// marketing globe uses (components/marketing/HeroGlobe), which needs the flag
// because it screenshots on a timer rather than on demand.
//
// Everything here is browser-only by nature. The testable part — the failure
// classification and the filename — is pure and exported separately.

import type { Map as MapLibreMap } from "maplibre-gl";

/** Why a capture produced nothing. Distinct cases, because the fixes differ. */
export type CaptureFailure =
  | "no-map" // no map instance registered (stage is a widget, or not mounted)
  | "no-canvas" // map exists but has no canvas yet
  | "blank" // we read the buffer and it was empty — the trap, not a crash
  | "timeout" // the render frame never arrived
  | "error"; // toDataURL / toBlob threw (commonly a tainted canvas)

export type CaptureResult =
  | { ok: true; blob: Blob; width: number; height: number }
  | { ok: false; reason: CaptureFailure };

/** How long to wait for the render frame before giving up. */
const RENDER_TIMEOUT_MS = 4000;

/**
 * Pure: does this data URL carry actual pixels?
 *
 * A fully transparent PNG of any size compresses to a very small payload, so a
 * length floor separates "the buffer was cleared" from "we captured something".
 * This is a heuristic and is treated as one: it only ever downgrades a capture
 * to an honest `blank` failure, and never fabricates a success.
 */
export function looksBlank(dataUrl: string): boolean {
  if (!dataUrl.startsWith("data:image/png;base64,")) return true;
  return dataUrl.length < 2048;
}

/** Sortable capture filename, matching lib/export's convention. */
export function captureFilename(at: number): string {
  const stamp = new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:\-]/g, "");
  return `provenance-view-${stamp}.png`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bytes = atob(base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: "image/png" });
}

/**
 * Capture the current map view as a PNG.
 *
 * Resolves with an honest failure rather than rejecting or handing back an empty
 * image: a blank PNG that downloads successfully is worse than a refusal,
 * because the user only finds out when they open it.
 */
export async function captureMapPng(map: MapLibreMap | null): Promise<CaptureResult> {
  if (!map) return { ok: false, reason: "no-map" };

  let canvas: HTMLCanvasElement;
  try {
    canvas = map.getCanvas();
  } catch {
    return { ok: false, reason: "no-canvas" };
  }
  if (!canvas || !canvas.width || !canvas.height) return { ok: false, reason: "no-canvas" };

  return new Promise<CaptureResult>((resolve) => {
    let settled = false;
    const finish = (r: CaptureResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      map.off("render", onRender);
      resolve(r);
    };

    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), RENDER_TIMEOUT_MS);

    // Read synchronously inside the render frame — this is the whole technique.
    const onRender = () => {
      try {
        const url = canvas.toDataURL("image/png");
        if (looksBlank(url)) return finish({ ok: false, reason: "blank" });
        finish({ ok: true, blob: dataUrlToBlob(url), width: canvas.width, height: canvas.height });
      } catch {
        finish({ ok: false, reason: "error" });
      }
    };

    map.on("render", onRender);
    map.triggerRepaint();
  });
}

/** Hand a Blob to the browser as a download. Browser-only, no return value. */
export function downloadBlob(filename: string, blob: Blob): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can cancel the download in
  // some browsers before it has read the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
