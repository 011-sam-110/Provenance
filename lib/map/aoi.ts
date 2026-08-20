"use client";
// Drawing an area of interest on the map, and painting the one that is active.
//
// WHY A POLYGON AND NOT A RECTANGLE. "Hay analistas que solo quieren dibujar una
// zona en el mapa y ver alertas exclusivas de esa area." A drag-rectangle is much
// less work and answers a different question: a coastline, a border region or a
// road corridor is not a rectangle, and a box drawn around one admits most of
// what it was drawn to exclude. lib/shell/scope's withinScope does the real
// point-in-polygon test; the bbox rides along only as a cheap reject.
//
// WHY THIS OWNS ITS OWN LAYERS. WorldMap re-adds every app layer on `style.load`
// because a basemap switch throws the style away. Rather than thread AOI state
// through that 2,000-line component, this module re-asserts its own two layers
// on `styledata` — same guarantee, no edit to the map. The layers sit above
// everything else and are non-interactive, so nothing about clicking the map
// changes when an AOI is showing.

import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import { useSyncExternalStore } from "react";
import { aoiScope, scopeStore, WORLD_SCOPE, type Scope } from "@/lib/shell/scope";

const AOI_SRC = "aoi-scope";
const AOI_FILL = "aoi-scope-fill";
const AOI_LINE = "aoi-scope-line";
const DRAFT_SRC = "aoi-draft";
const DRAFT_LINE = "aoi-draft-line";
const DRAFT_DOTS = "aoi-draft-dots";

/** The minimum vertices that make an area rather than a line. */
export const MIN_VERTICES = 3;

// --- draw state (a store, because the button has to reflect it) --------------

export interface DrawState {
  /** True while the user is placing vertices. */
  active: boolean;
  /** Vertices placed so far, [lon, lat]. */
  vertices: [number, number][];
}

const IDLE: DrawState = { active: false, vertices: [] };
let draw: DrawState = IDLE;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const aoiDrawStore = {
  get: (): DrawState => draw,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useAoiDraw(): DrawState {
  return useSyncExternalStore(aoiDrawStore.subscribe, aoiDrawStore.get, () => IDLE);
}

function setDraw(next: DrawState) {
  draw = next;
  emit();
}

// --- pure -------------------------------------------------------------------

/** Pure: a ring → the GeoJSON a fill layer can draw. Closes the ring. */
export function ringToFeature(ring: readonly [number, number][]): GeoJSON.Feature {
  const closed = ring.length >= MIN_VERTICES ? [...ring, ring[0]] : [...ring];
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [closed as [number, number][]] },
  };
}

/** Pure: the in-progress ring → a LineString plus one point per placed vertex. */
export function draftCollection(ring: readonly [number, number][]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = ring.map((c) => ({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: c as [number, number] },
  }));
  if (ring.length >= 2) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: ring as [number, number][] },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Pure: the label an AOI scope should carry.
 *
 * It names the vertex count rather than inventing a place name. A drawn area has
 * no name, and guessing one ("Southern England") from a centroid would be a claim
 * the product cannot support.
 */
export function aoiLabel(ring: readonly [number, number][]): string {
  return `Drawn area (${ring.length} points)`;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// --- map plumbing -----------------------------------------------------------

/**
 * Add the sources and layers, if the style is ready to take them.
 *
 * The guard is not defensive padding. MapLibre THROWS "Style is not done
 * loading." from addSource, and this module is attached the instant the map is
 * constructed — so without it, the very first call threw inside a React effect
 * and took the whole console down with it: no stage bar, no basemap buttons, no
 * export. Caught by opening the app; nothing in the type system or the suite
 * knows that addSource has a temporal precondition.
 *
 * A loaded style is needed only to CREATE. Once the layers are there they stay
 * usable while the map is busy, and demanding isStyleLoaded() on every call cost
 * two separate bugs: a scope change dropped its repaint (no polygon drawn, while
 * the filter itself worked), and clicking Area moments after a camera move was
 * refused with "the map is still loading" while the draft layers sat ready. So
 * the precondition is stated where it actually applies.
 *
 * Returns false when it could not act, so callers can wait for `styledata`.
 */
function ensureLayers(map: MapLibreMap): boolean {
  const haveAll =
    map.getSource(AOI_SRC) &&
    map.getSource(DRAFT_SRC) &&
    map.getLayer(AOI_FILL) &&
    map.getLayer(AOI_LINE) &&
    map.getLayer(DRAFT_LINE) &&
    map.getLayer(DRAFT_DOTS);
  if (haveAll) return true;
  if (!map.isStyleLoaded()) return false;
  if (!map.getSource(AOI_SRC)) map.addSource(AOI_SRC, { type: "geojson", data: EMPTY });
  if (!map.getSource(DRAFT_SRC)) map.addSource(DRAFT_SRC, { type: "geojson", data: EMPTY });

  if (!map.getLayer(AOI_FILL)) {
    map.addLayer({
      id: AOI_FILL,
      type: "fill",
      source: AOI_SRC,
      // Low enough to read the basemap through: this marks the filter, it does not
      // hide the geography the filter was drawn around.
      paint: { "fill-color": "#0ea5e9", "fill-opacity": 0.1 },
    });
  }
  if (!map.getLayer(AOI_LINE)) {
    map.addLayer({
      id: AOI_LINE,
      type: "line",
      source: AOI_SRC,
      paint: { "line-color": "#0ea5e9", "line-width": 1.5, "line-opacity": 0.9 },
    });
  }
  if (!map.getLayer(DRAFT_LINE)) {
    map.addLayer({
      id: DRAFT_LINE,
      type: "line",
      source: DRAFT_SRC,
      paint: { "line-color": "#0ea5e9", "line-width": 1.5, "line-dasharray": [2, 1.5] },
    });
  }
  if (!map.getLayer(DRAFT_DOTS)) {
    map.addLayer({
      id: DRAFT_DOTS,
      type: "circle",
      source: DRAFT_SRC,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 3.5,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#0ea5e9",
        "circle-stroke-width": 2,
      },
    });
  }
  return true;
}

function setData(map: MapLibreMap, id: string, data: GeoJSON.Feature | GeoJSON.FeatureCollection) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src && typeof src.setData === "function") src.setData(data as never);
}

/**
 * Paint whatever the scope currently says. Safe to call at any time, including
 * before the style exists — it returns false rather than throwing, and the
 * caller retries.
 *
 * See ensureLayers for why "the style is loading" must not block a repaint whose
 * layers already exist — that combination is what left the filter working with
 * nothing drawn on the map.
 */
export function paintScope(map: MapLibreMap, scope: Scope): boolean {
  if (!ensureLayers(map)) return false;
  const ring = scope.mode === "aoi" ? scope.polygon : undefined;
  setData(map, AOI_SRC, ring && ring.length >= MIN_VERTICES ? ringToFeature(ring) : EMPTY);
  return true;
}

/**
 * Attach the AOI painter to a map. Returns a teardown.
 *
 * Two subscriptions, for the two ways the picture can go stale: the scope
 * changing, and the STYLE being replaced by a basemap switch (which silently
 * takes every layer with it).
 */
export function attachAoi(map: MapLibreMap): () => void {
  // Whether the last attempt actually landed. A repaint that could not act must
  // be retried, or a scope set during a style change is lost silently — which is
  // exactly how the polygon went missing while the filter worked.
  let painted = false;
  const repaint = () => {
    painted = paintScope(map, scopeStore.get());
  };
  const onStyle = () => {
    if (!painted || !map.getLayer(AOI_FILL)) repaint();
  };
  repaint(); // no-op if the style is not up yet — onStyle picks it up
  const unsub = scopeStore.subscribe(repaint);
  map.on("styledata", onStyle);
  map.on("load", repaint);
  map.on("idle", onStyle); // last-resort retry once the map has settled
  return () => {
    unsub();
    map.off("styledata", onStyle);
    map.off("load", repaint);
    map.off("idle", onStyle);
  };
}

// --- the draw interaction ---------------------------------------------------

let cancelActive: (() => void) | null = null;

/** True while a draw is in progress anywhere. */
export function isDrawing(): boolean {
  return draw.active;
}

/**
 * Begin drawing. Click to place a vertex, Enter or double-click to finish, Escape
 * to abandon. Finishing with fewer than three vertices abandons instead: two
 * points is a line, and a line as an "area" would filter the console to nothing.
 */
export function startDraw(map: MapLibreMap): boolean {
  if (draw.active) return false;
  if (!ensureLayers(map)) return false; // style not up: nothing to draw on yet
  setDraw({ active: true, vertices: [] });

  const container = map.getCanvasContainer();
  const canvas = map.getCanvas();
  const priorCursor = canvas.style.cursor;
  canvas.style.cursor = "crosshair";
  // Otherwise the double-click that FINISHES the ring also zooms the map.
  const hadDoubleClickZoom = map.doubleClickZoom.isEnabled();
  map.doubleClickZoom.disable();

  const redraw = () => setData(map, DRAFT_SRC, draftCollection(draw.vertices));

  // WHY THE CLICKS ARE TAKEN AT DOCUMENT CAPTURE RATHER THAN FROM map.on("click").
  //
  // The map already binds click handlers to a dozen layers, and they fire on the
  // same physical click as a vertex placement. Measured while testing the first
  // version: drawing a four-point ring over the North Sea also opened a GDACS
  // dossier and rewrote the URL to `&obj=gdacs:1030534:5`, because one of the
  // vertices landed on a disaster marker. Every vertex placed on top of anything
  // was also a selection.
  //
  // Listening on `document` in the CAPTURE phase runs before MapLibre's own
  // handlers on the canvas container, so stopping propagation there means the map
  // never sees the click at all — no dossier, no pin menu, no camera dive. Only
  // `click`/`dblclick` are taken, so drag-panning and the scroll wheel keep
  // working and the analyst can still move around mid-ring.
  const inMap = (t: EventTarget | null) => t instanceof Node && container.contains(t);

  // A pan ends in a click too. Placing a vertex on every drag-release would drop
  // a point every time the user repositioned the map, so movement disqualifies it.
  const DRAG_SLOP_PX = 4;
  let downAt: { x: number; y: number } | null = null;
  const onDown = (e: MouseEvent) => {
    downAt = inMap(e.target) ? { x: e.clientX, y: e.clientY } : null;
  };

  const onClick = (e: MouseEvent) => {
    if (!inMap(e.target)) return;
    e.stopPropagation();
    e.preventDefault();
    const moved =
      downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_SLOP_PX;
    downAt = null;
    if (moved) return; // that was a pan, not a placement
    const rect = canvas.getBoundingClientRect();
    const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    setDraw({ active: true, vertices: [...draw.vertices, [ll.lng, ll.lat]] });
    redraw();
  };

  const finish = () => {
    const ring = draw.vertices;
    teardown();
    if (ring.length < MIN_VERTICES) return; // not an area - abandon, never filter
    scopeStore.set(aoiScope(ring, aoiLabel(ring)));
  };

  const abandon = () => teardown();

  const onDblClick = (e: MouseEvent) => {
    if (!inMap(e.target)) return;
    e.stopPropagation();
    e.preventDefault();
    finish();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") abandon();
    if (e.key === "Enter") finish();
  };

  function teardown() {
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDblClick, true);
    document.removeEventListener("keydown", onKey);
    canvas.style.cursor = priorCursor;
    if (hadDoubleClickZoom) map.doubleClickZoom.enable();
    setData(map, DRAFT_SRC, EMPTY);
    setDraw(IDLE);
    cancelActive = null;
  }

  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("dblclick", onDblClick, true);
  document.addEventListener("keydown", onKey);
  cancelActive = abandon;
  return true;
}

/** Abandon an in-progress draw from outside (the Cancel button). */
export function cancelDraw(): void {
  cancelActive?.();
}

/** Drop the AOI filter and go back to World. */
export function clearAoi(): void {
  scopeStore.set(WORLD_SCOPE);
}
