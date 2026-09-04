"use client";
// Client glue between the pure deep-link codec (lib/share/url.ts) and the live
// app. Reads the current view from the MapLibre map + the external stores, writes
// it back to the URL (debounced, history.replaceState — NO navigation/reload), and
// reads the initial view on load. WorldMap owns the map handle and drives the
// write/restore; the StatusBar "Share" button calls buildShareUrl()/copyShareLink().

import type { Map as MlMap } from "maplibre-gl";
import { encodeViewState, decodeViewState, type ViewState } from "@/lib/share/url";
import { layersStore, ACTIVE_LAYERS } from "@/lib/layers";
import { mapViewStore } from "@/lib/mapView";
import { overlay } from "@/lib/overlay";

const WRITE_DEBOUNCE_MS = 400;

/**
 * Compose the current view state from the live map + the external stores.
 *
 * The active board is NOT included. It was, as `?v=`, and the server reading it back
 * for a per-board social card is what made `/app` dynamic for every request. The
 * board is now per-browser state, so it is not something a link can carry — see the
 * note at the top of lib/share/url.ts.
 */
export function composeViewState(map: MlMap): ViewState {
  const c = map.getCenter();
  const layerState = layersStore.get();
  return {
    lat: c.lat,
    lon: c.lng,
    zoom: map.getZoom(),
    layers: ACTIVE_LAYERS.filter((k) => layerState[k]),
    basemap: mapViewStore.get().basemap,
    obj: overlay.get().object?.id,
  };
}

/** Parse the view state out of the current location (client only). */
export function readInitialViewState(): ViewState {
  if (typeof window === "undefined") return {};
  return decodeViewState(new URLSearchParams(window.location.search));
}

/** Replace the URL query with the encoded state — no navigation, no history spam. */
export function writeUrl(state: ViewState): void {
  if (typeof window === "undefined") return;
  const qs = encodeViewState(state);
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced URL write from the live map — panning/zooming never spams history. */
export function scheduleUrlWrite(map: MlMap): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeUrl(composeViewState(map));
  }, WRITE_DEBOUNCE_MS);
}

/** Cancel any pending debounced write (call on unmount so it can't touch a removed map). */
export function cancelUrlWrite(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
}

/** Absolute, shareable URL for the current view (reads window.__map if present). */
export function buildShareUrl(): string {
  if (typeof window === "undefined") return "";
  const map = (window as unknown as { __map?: MlMap }).__map;
  if (!map) return window.location.href;
  const qs = encodeViewState(composeViewState(map));
  return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ""}`;
}

/** Copy the current share URL to the clipboard, with a non-secure-context fallback. */
export async function copyShareLink(): Promise<boolean> {
  const url = buildShareUrl();
  if (!url) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    /* fall through to the legacy path (insecure origins / denied permission) */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
