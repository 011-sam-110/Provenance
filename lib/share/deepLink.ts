"use client";
// Client glue between the pure deep-link codec (lib/share/url.ts) and the live
// app. Reads the current view from the MapLibre map + the external stores, writes
// it back to the URL (debounced, history.replaceState — NO navigation/reload), and
// reads the initial view on load. WorldMap owns the map handle and drives the
// write/restore; the StatusBar "Share" button calls buildShareUrl()/copyShareLink().

import type { Map as MlMap } from "maplibre-gl";
import { encodeViewState, decodeViewState, type ViewState } from "@/lib/share/url";
import { layersStore, ACTIVE_LAYERS } from "@/lib/layers";
import { inspectorStore } from "@/lib/shell/inspector";
import { MAP_SIGNALS } from "@/lib/signals/registry";
import { mapViewStore } from "@/lib/mapView";
import { overlay } from "@/lib/overlay";
import { activePresetStore } from "@/lib/console/activePreset";
import { presetById } from "@/lib/console/presets";
import { track } from "@/lib/analytics/track";

const WRITE_DEBOUNCE_MS = 400;

/**
 * Compose the current view state from the live map + the external stores.
 *
 * The VARIANT is NOT included. It was, as `?v=`, and the server reading it back for a
 * per-board social card is what made `/app` dynamic for every request. See the note at
 * the top of lib/share/url.ts.
 *
 * The VIEW is: `preset` names the board the link was copied from (Globe, Streets, News),
 * so it opens that view and its sources land in that view only (lib/console/bootSeed.ts
 * reads it back, after load). Only a built-in board is written; a saved board's id
 * means nothing in another browser.
 *
 * `sig` IS INCLUDED, AND LEAVING IT OUT WAS A BUG. This function is what the URL
 * writer runs on every store change, so a field it omits is a field the address bar
 * loses a moment after load: a `?sig=` link turned its layers on and then rewrote its
 * own URL without them, and a reload of that URL could not bring them back. The value
 * is World's on-set, the shape variantStore.bootstrap applies (it treats `sig` as the
 * authoritative on-set, not a delta). It is World's own set and NOT the union: an
 * area's sources are per-browser, and writing them here would put a ring-scoped layer
 * across the whole globe on the next boot.
 */
export function composeViewState(map: MlMap): ViewState {
  const c = map.getCenter();
  const layerState = layersStore.get();
  const world = inspectorStore.get().world;
  const sig = MAP_SIGNALS.filter((s) => world[s.id] === true).map((s) => s.id);
  const board = activePresetStore.get();
  return {
    ...(board && presetById(board) ? { preset: board } : {}),
    lat: c.lat,
    lon: c.lng,
    zoom: map.getZoom(),
    layers: ACTIVE_LAYERS.filter((k) => layerState[k]),
    basemap: mapViewStore.get().basemap,
    obj: overlay.get().object?.id,
    ...(sig.length ? { sig } : {}),
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
      track({ name: "share_link_copied", what: "view" });
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
    if (ok) track({ name: "share_link_copied", what: "view" });
    return ok;
  } catch {
    return false;
  }
}
