"use client";
// Shared map-view state (basemap + 3D terrain) plus an imperative fly-to bridge.
//
// WorldMap used to own basemap/terrain as local useState and render its own
// switcher. The calm shell lifts that choice into this store so the thin top bar
// can drive it while WorldMap stays the renderer. `flyTo` is an imperative escape
// hatch: WorldMap registers a callback on mount; the ⌘K palette / rail call
// mapViewStore.flyTo(view) to fly the globe to a region without a prop drill.
//
// Not persisted on purpose — every visit opens on the calm light default basemap
// (persisting it races the async style.load on first paint).

import { useSyncExternalStore } from "react";
import { type BasemapKey, DEFAULT_BASEMAP } from "@/lib/basemaps";

/** A globe camera target (lat/lng + a 0–2 "altitude" the renderer maps to zoom). */
export interface RegionView {
  lat: number;
  lng: number;
  altitude: number;
}

/**
 * A precise point target with an explicit zoom — used by M5 place-search and
 * "near me" to fly to an exact lat/lon, rather than the altitude-tiered RegionView
 * the region presets use. `zoom` defaults to a mid-street level in WorldMap.
 */
export interface PointView {
  lat: number;
  lon: number;
  zoom?: number;
}

/**
 * A cinematic-dive target (SP6). WorldMap turns this into a pitched flyTo via
 * computeDive; `animate=false` (reduced motion) jumps instead. `onArrive` fires
 * when the camera settles, so the dive store can promote diving → landed.
 */
export interface DiveView {
  lat: number;
  lon: number;
}

export interface MapViewState {
  basemap: BasemapKey;
  terrain: boolean;
  /**
   * 3D buildings (the fill-extrusion layer WorldMap raises at street level).
   *
   * It lives HERE and not in lib/layers.ts, which is the question that took the
   * longest to settle. `buildings` looks like a layer toggle, but LayerKey describes
   * DATA FEEDS: each one has an adapter, a fetch, a SOURCE_CATALOG entry, a refresh
   * cadence and a row in the Sources rail. Buildings have none of those. They are a
   * property of how the base map is DRAWN, which is exactly what `terrain` above is,
   * and the two belong together. Putting it in LayerKey would also have given it a
   * slot in presetState(), so a one-tap layer preset would silently reach across and
   * change a basemap property.
   *
   * Consequence worth knowing: this store is deliberately unpersisted, so buildings
   * come back on every visit. That is the same contract `terrain` already has.
   */
  buildings: boolean;
}

/**
 * Both draw-time extras start OFF, and that is the single largest thing this map
 * stopped paying for at rest.
 *
 * They were ON here until 2026-09-05, unpersisted, on every cold load — so every
 * visitor bought relief shading and a building extrusion whether or not they ever
 * descended to a zoom where either could be seen. Measured on one scripted z8
 * zoom-in over London: 4.3 MB of tiles, of which 2.4 MB in 23 requests was
 * Terrarium DEM from `elevation-tiles-prod.s3.amazonaws.com` — S3 direct, no CDN,
 * HTTP/1.1, 410–610 ms TTFB per 60 KB tile from the UK, and the browser will only
 * run six of those at a time. The same gesture on simplifaisoul/osiris, the same
 * MapLibre 5.24 on the same machine, dropped zero frames against our five (worst
 * gap 383 ms). It has no DEM source at all.
 *
 * WHAT DOES THE WORK IS THE DEFAULT, not the absence of the source. WorldMap still
 * declares the DEM source and the hillshade layer on every style load, because an
 * unused source costs nothing: MapLibre marks a SourceCache `used` only when a
 * visible layer inside its zoom range reads from it (or terrain does), and an
 * unused cache issues no requests. Creating it lazily on the toggle would have
 * bought nothing measurable and cost the layer its position — added later it would
 * append above the camera pins instead of sitting under them.
 *
 * The rail toggles (components/console/maprail/ViewFlyout.tsx) are untouched: this
 * is a change to what an untouched map costs, not to what the map can do.
 */
let state: MapViewState = { basemap: DEFAULT_BASEMAP, terrain: false, buildings: false };
let flyToFn: ((view: RegionView) => void) | null = null;
let flyToPointFn: ((view: PointView) => void) | null = null;
let diveToFn: ((view: DiveView, animate: boolean, onArrive: () => void) => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const mapViewStore = {
  setBasemap(basemap: BasemapKey) {
    if (state.basemap === basemap) return;
    state = { ...state, basemap };
    emit();
  },
  setTerrain(on: boolean) {
    if (state.terrain === on) return;
    state = { ...state, terrain: on };
    emit();
  },
  setBuildings(on: boolean) {
    if (state.buildings === on) return;
    state = { ...state, buildings: on };
    emit();
  },
  get(): MapViewState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** WorldMap registers its flyTo here on mount. */
  registerFlyTo(fn: ((view: RegionView) => void) | null) {
    flyToFn = fn;
  },
  flyTo(view: RegionView) {
    flyToFn?.(view);
  },
  /** WorldMap registers its point-flyTo here on mount (M5 search / near-me). */
  registerFlyToPoint(fn: ((view: PointView) => void) | null) {
    flyToPointFn = fn;
  },
  flyToPoint(view: PointView) {
    flyToPointFn?.(view);
  },
  /** WorldMap registers its cinematic-dive handler here on mount (SP6). */
  registerDiveTo(fn: ((view: DiveView, animate: boolean, onArrive: () => void) => void) | null) {
    diveToFn = fn;
  },
  diveTo(view: DiveView, animate: boolean, onArrive: () => void) {
    if (diveToFn) diveToFn(view, animate, onArrive);
    else onArrive(); // no map yet → land immediately so the store never hangs
  },
};

export function useMapView(): MapViewState {
  return useSyncExternalStore(mapViewStore.subscribe, mapViewStore.get, mapViewStore.get);
}
