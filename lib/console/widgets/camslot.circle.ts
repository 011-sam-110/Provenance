"use client";

import { ringFromCircle, haversineKm, type CircleSpec } from "@/lib/map/circle";
import type { LatLon } from "@/lib/console/widgets/camslot.arm";

// ── Press, drag, release ─────────────────────────────────────────────────────
//
// WHY THIS IS NOT A MODE OF lib/map/aoi.ts. That module owns a click-per-vertex
// polygon: each click adds a point, a double-click closes the ring, and it takes
// custody of double-click-zoom so that closing gesture does not also zoom. A
// circle is one continuous pointer gesture with no vertices and no closing click.
// Sharing an implementation would mean two state machines in one file, and that
// file belongs to another workstream this week.
//
// What IS shared is the output: an open [lon, lat][] ring, identical in shape to
// what `startDraw`'s onFinish hands back. Everything downstream — camerasInRing,
// aoiScope, withinScope, filterToScopes — consumes either without knowing which
// gesture drew it.
//
// MODULE STATE, not React state. Same constraint the picker documents: the map's
// interaction wiring is a `useCallback(..., [])` invoked once at mount, so
// anything a handler closes over is frozen at mount. State read at EVENT time is
// the only shape that works.

/** The minimum a drag must cover before it counts as a circle rather than a click.
 *  Below this, a user who pressed and released on the same spot would get a ring
 *  containing nothing and no explanation. */
const MIN_RADIUS_KM = 0.05;

/** Preview layer ids. NAMESPACED AWAY FROM aoi.ts, which owns `aoi-areas*`. Two
 *  gestures sharing a layer id means one's teardown removes the other's paint,
 *  and MapLibre drops an invalid layer SILENTLY — the symptom is "the circle does
 *  not draw" with a clean console. */
const CIRCLE_SRC = "tn-circle-src";
const CIRCLE_FILL = "tn-circle-fill";
const CIRCLE_LINE = "tn-circle-line";

export interface CircleDrawState {
  center: LatLon | null;
  radiusKm: number;
}

/** The minimum of MapLibre this module needs. Typed structurally so the unit
 *  tests never have to construct a Map. */
export interface MapLike {
  getCanvas(): HTMLCanvasElement;
  unproject(p: [number, number]): { lat: number; lng: number };
  dragPan: { enable(): void; disable(): void };
  getSource(id: string): { setData(d: unknown): void } | undefined;
  addSource(id: string, spec: unknown): void;
  getLayer(id: string): unknown;
  addLayer(spec: unknown): void;
  removeLayer(id: string): void;
  removeSource(id: string): void;
}

/**
 * The rubber band. Ensures the preview layers exist and pushes the current ring.
 *
 * Called on every pointermove, so it adds the source and layers ONCE and does
 * `setData` thereafter — adding a layer per frame is what makes a drag stutter.
 * Paint values are hard-coded, as every paint value in this codebase is: MapLibre
 * cannot read a CSS custom property.
 */
function paintPreview(map: MapLike, ring: readonly [number, number][]): void {
  const data = {
    type: "FeatureCollection",
    features: ring.length >= 3
      ? [{
          type: "Feature",
          properties: {},
          // A GeoJSON polygon ring must be CLOSED — first coordinate repeated.
          // Our rings are open by contract, so the closure happens here, at the
          // one place that hands geometry to MapLibre, and nowhere else.
          geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
        }]
      : [],
  };

  const existing = map.getSource(CIRCLE_SRC);
  if (existing) { existing.setData(data); return; }

  map.addSource(CIRCLE_SRC, { type: "geojson", data });
  if (!map.getLayer(CIRCLE_FILL)) {
    map.addLayer({
      id: CIRCLE_FILL, type: "fill", source: CIRCLE_SRC,
      paint: { "fill-color": "#ffb020", "fill-opacity": 0.1 },
    });
  }
  if (!map.getLayer(CIRCLE_LINE)) {
    map.addLayer({
      id: CIRCLE_LINE, type: "line", source: CIRCLE_SRC,
      paint: { "line-color": "#ffb020", "line-width": 2, "line-opacity": 0.95 },
    });
  }
}

/** Remove the preview. Layers BEFORE the source — MapLibre refuses to drop a
 *  source that a layer still references, and the refusal is silent. */
function clearPreview(map: MapLike): void {
  for (const id of [CIRCLE_FILL, CIRCLE_LINE]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(CIRCLE_SRC)) map.removeSource(CIRCLE_SRC);
}

let state: CircleDrawState | null = null;
const listeners = new Set<() => void>();
function emit() { for (const fn of listeners) fn(); }

export const circleDrawStore = {
  get(): CircleDrawState | null { return state; },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};

/** Centre plus the point being dragged to, as a circle. Pure, so the arithmetic
 *  is tested without a map. */
export function specFrom(center: LatLon, edge: LatLon): CircleSpec {
  return { lat: center.lat, lon: center.lon, radiusKm: haversineKm(center, edge) };
}

let teardown: (() => void) | null = null;

/**
 * Begin a circle draw. Returns false when the map is not ready.
 *
 * The ring arrives later, through `onFinish`, exactly as `startDraw` does — a
 * gesture cannot return its own result.
 */
export function startCircleDraw(
  map: MapLike,
  opts: { onFinish: (ring: [number, number][]) => void },
): boolean {
  if (!map || teardown) return false;

  const canvas = map.getCanvas();
  if (!canvas) return false;

  // Panning must be off for the duration or the drag that sets the radius also
  // drags the map, and the circle grows from a centre that is moving under it.
  map.dragPan.disable();
  canvas.style.cursor = "crosshair";

  const at = (e: PointerEvent): LatLon => {
    const r = canvas.getBoundingClientRect();
    const p = map.unproject([e.clientX - r.left, e.clientY - r.top]);
    return { lat: p.lat, lon: p.lng };
  };

  let center: LatLon | null = null;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    center = at(e);
    // Publish the centre on the FIRST event, not on release. The draw banner
    // narrates from `center` and `radiusKm`; withholding the centre until the
    // end leaves it stuck on the press prompt for the whole drag, which reads as
    // a dead tool.
    state = { center, radiusKm: 0 };
    emit();
    canvas.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    if (!center) return;
    const spec = specFrom(center, at(e));
    state = { center, radiusKm: spec.radiusKm };
    // Draw the band the user is dragging. Without this the gesture is a number
    // in a panel and the map shows nothing at all.
    paintPreview(map, ringFromCircle(spec));
    emit();
  };

  const onUp = (e: PointerEvent) => {
    if (!center) return;
    const spec = specFrom(center, at(e));
    const done = spec.radiusKm >= MIN_RADIUS_KM ? ringFromCircle(spec) : [];
    stop();
    // Fired AFTER teardown so a handler that starts another gesture is not
    // immediately torn down by this one's cleanup.
    if (done.length >= 3) opts.onFinish(done);
  };

  // Escape only — this gesture never ENDS on a key, and that is deliberate.
  // `aoi.ts` had to add `preventDefault` on Enter because a focused button turns
  // Enter into a click as its default action, so arming a draw from a button and
  // pressing Enter to finish re-armed it on the same keystroke. A gesture that
  // ends on pointerup cannot hit that trap. If a key ever ends this one, it needs
  // the same preventDefault.
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelCircleDraw(); };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey);

  const stop = () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey);
    canvas.style.cursor = "";
    map.dragPan.enable();
    // The preview is the GESTURE's paint, not the board's. The finished area is
    // drawn separately from `layout.watch`, so leaving this behind would put two
    // rings on the map that drift apart the moment a second area is drawn.
    clearPreview(map);
    teardown = null;
    state = null;
    emit();
  };

  teardown = stop;
  state = { center: null, radiusKm: 0 };
  emit();
  return true;
}

/** Abandon a circle in progress. Safe to call when none is running. */
export function cancelCircleDraw(): void {
  teardown?.();
}
