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
import { haversineKm } from "@/lib/geo/haversine";
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

/**
 * Which gesture is running.
 *
 * BOTH TOOLS END IN THE SAME PLACE: a ring handed to `aoiScope`. A radius is not a
 * second kind of scope — `Scope` already has a `radiusKm` field, and reusing it
 * would have meant a second branch in `withinScope`, a second thing for
 * `coerceSavedScope` to sanitise, and a second thing every scoped widget could get
 * wrong. A circle approximated as a 64-point ring costs one extra pure function
 * and changes nothing downstream. The circle is what the user drew; the ring is
 * how it is stored, drawn and filtered.
 */
export type DrawTool = "polygon" | "radius";

export interface DrawState {
  /** True while the user is placing vertices, or placing a centre and an edge. */
  active: boolean;
  /** Which gesture is running. Meaningless while `active` is false. */
  tool: DrawTool;
  /** Polygon: vertices placed so far, [lon, lat]. Empty for a radius. */
  vertices: [number, number][];
  /** Radius: the centre, once the first click has landed. */
  center?: [number, number];
  /** Radius: the live distance from the centre to the pointer, in km. */
  radiusKm?: number;
}

const IDLE: DrawState = { active: false, tool: "polygon", vertices: [] };
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

/** How many segments approximate a drawn circle. */
export const RADIUS_RING_STEPS = 64;

/**
 * A radius smaller than this is treated as a mis-click and abandoned, exactly as a
 * two-vertex polygon is. Sub-metre is not a gesture anyone makes on purpose, and a
 * ring that tight filters every scoped panel to nothing with no visible cause.
 *
 * NOT `MIN_RADIUS_KM`. lib/shell/scope.ts has a module-private constant of that
 * name meaning something else entirely — the floor a GEOCODER extent is widened to,
 * 10 km — and two constants with one name and a factor of ten thousand between them
 * is the kind of thing that reads as correct in a diff.
 */
export const MIN_DRAWN_RADIUS_KM = 0.001;

const R_EARTH_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/**
 * Pure: a centre and a radius → the ring that approximates that circle.
 *
 * SPHERICAL, NOT `lon + km / (111 * cos(lat))`. The flat approximation is one line
 * and is wrong in the two places this product is most used: it degenerates as
 * cos(lat) → 0, so a circle drawn over northern Norway comes out as a lens tens of
 * kilometres wide in the wrong direction, and any circle large enough to matter is
 * visibly an ellipse. This is the standard destination-point formula, so every
 * vertex is genuinely `radiusKm` from the centre by the same haversine metric
 * `withinScope` uses to filter — which is what makes the drawn ring and the filter
 * agree at the edge instead of merely nearly agreeing.
 *
 * The ring is returned OPEN (no repeated first vertex), matching what `startDraw`
 * stores and what `ringToFeature` expects to close.
 */
export function circleRing(
  center: readonly [number, number],
  radiusKm: number,
  steps: number = RADIUS_RING_STEPS,
): [number, number][] {
  const [lon, lat] = center;
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const δ = radiusKm / R_EARTH_KM;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);

  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ));
    const λ2 =
      λ1 + Math.atan2(Math.sin(θ) * sinδ * cosφ1, cosδ - sinφ1 * Math.sin(φ2));
    // Normalised to [-180, 180]. A ring drawn across the antimeridian still has
    // its own vertices on both sides of it — that is a real limitation shared with
    // the polygon tool and with bboxOfRing, not something wrapping here would fix.
    ring.push([((toDeg(λ2) + 540) % 360) - 180, toDeg(φ2)]);
  }
  return ring;
}

/**
 * Pure: how a drawn radius is written. Metres under a kilometre, one decimal under
 * ten, whole kilometres above — a "0.4 km" ring and a "437 km" ring should not be
 * printed with the same precision, and "0.4 km" hides the difference between 400 m
 * and 449 m at exactly the zoom where that difference is the whole point.
 */
export function formatRadius(radiusKm: number): string {
  if (radiusKm < 1) return `${Math.round(radiusKm * 1000)} m`;
  if (radiusKm < 10) return `${radiusKm.toFixed(1)} km`;
  return `${Math.round(radiusKm)} km`;
}

/**
 * Pure: the label a radius scope carries. Same rule as `aoiLabel` — it states the
 * gesture, never a place name it would have to invent.
 */
export function radiusLabel(radiusKm: number): string {
  return `Drawn radius (${formatRadius(radiusKm)})`;
}

/**
 * Pure: the in-progress radius → the same shapes the polygon draft uses, so it
 * paints through the SAME two draft layers with no third layer and no new paint
 * rules. The centre is the Point (DRAFT_DOTS filters on geometry-type), the ring is
 * the LineString (DRAFT_LINE, dashed). A zero radius is centre-only — there is no
 * circle to draw until the pointer has moved.
 */
export function radiusDraft(
  center: readonly [number, number],
  radiusKm: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: center as [number, number] },
    },
  ];
  if (radiusKm >= MIN_DRAWN_RADIUS_KM) {
    const ring = circleRing(center, radiusKm);
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [...ring, ring[0]] },
    });
  }
  return { type: "FeatureCollection", features };
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

export interface DrawOptions {
  /**
   * What a finished ring is FOR.
   *
   * Omitted, the ring becomes the console's AOI scope — the original and still the
   * default behaviour, which every existing caller relies on.
   *
   * Supplied, the scope is left completely alone and the ring is handed to the
   * caller instead. The camera picker needs this: "make me a wall out of Soho" and
   * "hide everything outside Soho" are different requests, and quietly doing the
   * second while the user asked for the first would filter a dozen unrelated
   * widgets as a side effect of picking some cameras. The drawing, the vertex
   * counter, the click-capture and the double-click-zoom custody are identical for
   * both, which is why this is an option rather than a second implementation.
   *
   * Called only for a ring that reached MIN_VERTICES. An abandoned draw calls
   * nothing.
   */
  onFinish?: (ring: [number, number][]) => void;
}

/** What a gesture wants told to it. See beginGesture. */
interface Gesture {
  /**
   * A real click on the map — not the tail of a pan. `finish` is handed in rather
   * than left for the tool to improvise, so "the second click ends a radius" runs
   * the identical path Enter and double-click run: snapshot, tear down, commit.
   */
  onPlace: (at: [number, number], finish: () => void) => void;
  /** Pointer moved over the map. Only bound when supplied. */
  onMove?: (at: [number, number]) => void;
  /**
   * Enter or double-click. Given the draw state as it was the instant BEFORE
   * teardown, because teardown resets the store and the finished shape only lives
   * there — reading `draw` afterwards would always find IDLE.
   */
  onFinish: (state: DrawState) => void;
}

/**
 * The plumbing both tools need: the crosshair, custody of double-click zoom, the
 * document-capture listeners, and a teardown that cannot be half-done.
 *
 * ONE COPY, because this is the part that was hard to get right and the part where
 * a divergence would be invisible. The polygon tool and the radius tool differ only
 * in what a click MEANS; they agree on every line below, and a second copy of this
 * would be two chances to forget the drag slop or to leave doubleClickZoom disabled.
 *
 * WHY THE CLICKS ARE TAKEN AT DOCUMENT CAPTURE RATHER THAN FROM map.on("click").
 *
 * The map already binds click handlers to a dozen layers, and they fire on the
 * same physical click as a vertex placement. Measured while testing the first
 * version: drawing a four-point ring over the North Sea also opened a GDACS
 * dossier and rewrote the URL to `&obj=gdacs:1030534:5`, because one of the
 * vertices landed on a disaster marker. Every vertex placed on top of anything
 * was also a selection.
 *
 * Listening on `document` in the CAPTURE phase runs before MapLibre's own
 * handlers on the canvas container, so stopping propagation there means the map
 * never sees the click at all — no dossier, no pin menu, no camera dive. Only
 * `click`/`dblclick` are taken, so drag-panning and the scroll wheel keep
 * working and the analyst can still move around mid-gesture.
 *
 * `mousemove` is deliberately NOT in that list even when a tool asks for it: it is
 * bound in the bubble phase and stops nothing, so hover on the map keeps working
 * while a radius is being sized.
 */
function beginGesture(map: MapLibreMap, g: Gesture): boolean {
  const container = map.getCanvasContainer();
  const canvas = map.getCanvas();
  const priorCursor = canvas.style.cursor;
  canvas.style.cursor = "crosshair";
  // Otherwise the double-click that FINISHES the shape also zooms the map.
  const hadDoubleClickZoom = map.doubleClickZoom.isEnabled();
  map.doubleClickZoom.disable();

  const inMap = (t: EventTarget | null) => t instanceof Node && container.contains(t);
  const at = (e: MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    return [ll.lng, ll.lat];
  };

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
    g.onPlace(at(e), finish);
  };

  const onMove = (e: MouseEvent) => {
    if (!inMap(e.target)) return;
    g.onMove!(at(e));
  };

  const finish = () => {
    const state = draw;
    teardown();
    g.onFinish(state);
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
    if (g.onMove) document.removeEventListener("mousemove", onMove);
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
  if (g.onMove) document.addEventListener("mousemove", onMove);
  cancelActive = abandon;
  return true;
}

/**
 * Begin drawing a polygon. Click to place a vertex, Enter or double-click to
 * finish, Escape to abandon. Finishing with fewer than three vertices abandons
 * instead: two points is a line, and a line as an "area" would filter the console
 * to nothing.
 */
export function startDraw(map: MapLibreMap, opts: DrawOptions = {}): boolean {
  if (draw.active) return false;
  if (!ensureLayers(map)) return false; // style not up: nothing to draw on yet
  setDraw({ active: true, tool: "polygon", vertices: [] });

  return beginGesture(map, {
    onPlace: (p) => {
      setDraw({ active: true, tool: "polygon", vertices: [...draw.vertices, p] });
      setData(map, DRAFT_SRC, draftCollection(draw.vertices));
    },
    onFinish: ({ vertices: ring }) => {
      if (ring.length < MIN_VERTICES) return; // not an area - abandon, never filter
      if (opts.onFinish) { opts.onFinish(ring); return; }
      scopeStore.set(aoiScope(ring, aoiLabel(ring)));
    },
  });
}

/**
 * Begin drawing a radius. Click the centre, move to size it, click again (or Enter,
 * or double-click) to set it. Escape abandons.
 *
 * TWO CLICKS, NOT A DRAG. It matches the polygon tool's gesture, so the whole rail
 * has one grammar — click to commit a point — and it inherits the drag-slop guard
 * for free: a drag would have to be told apart from a pan, and a pan is how you
 * reach the place you want to draw around.
 *
 * A radius under MIN_RADIUS_KM abandons rather than filtering, for the same reason
 * a two-vertex polygon does: it is a mis-click, and honouring it would empty every
 * scoped panel with nothing on screen to explain why.
 */
export function startRadius(map: MapLibreMap, opts: DrawOptions = {}): boolean {
  if (draw.active) return false;
  if (!ensureLayers(map)) return false;
  setDraw({ active: true, tool: "radius", vertices: [] });

  const size = (p: [number, number]) => {
    const [clon, clat] = draw.center!;
    setDraw({ ...draw, radiusKm: haversineKm(clat, clon, p[1], p[0]) });
    setData(map, DRAFT_SRC, radiusDraft(draw.center!, draw.radiusKm ?? 0));
  };

  return beginGesture(map, {
    onPlace: (p, finish) => {
      // First click sets the centre. The second sizes it and then ends the gesture
      // through beginGesture's own finish, so a committed radius is committed by
      // one code path whether it was ended by a click, by Enter or by a
      // double-click.
      if (!draw.center) {
        setDraw({ active: true, tool: "radius", vertices: [], center: p, radiusKm: 0 });
        setData(map, DRAFT_SRC, radiusDraft(p, 0));
        return;
      }
      size(p);
      finish();
    },
    onMove: (p) => {
      if (!draw.center) return;
      size(p);
    },
    onFinish: ({ center, radiusKm }) => {
      if (!center || radiusKm == null || radiusKm < MIN_DRAWN_RADIUS_KM) return;
      const ring = circleRing(center, radiusKm);
      if (opts.onFinish) { opts.onFinish(ring); return; }
      scopeStore.set(aoiScope(ring, radiusLabel(radiusKm)));
    },
  });
}

/** Abandon an in-progress draw from outside (the Cancel button). */
export function cancelDraw(): void {
  cancelActive?.();
}

/** Drop the AOI filter and go back to World. */
export function clearAoi(): void {
  scopeStore.set(WORLD_SCOPE);
}
