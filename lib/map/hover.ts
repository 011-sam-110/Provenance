// Pointer hover arbitration — the pure decision behind "what is under the cursor,
// and what should the map show because of it?".
//
// WHY THIS EXISTS. MapLibre implements `mouseenter` / `mouseleave` as a DELEGATED
// `mousemove` listener (see _createDelegatedListener in maplibre-gl): every
// pointer move runs `queryRenderedFeatures` for that layer *before* deciding
// whether your handler should fire at all. A layer wired for both enter and leave
// therefore costs TWO queries per pointer move, always, whether or not anything
// is under the cursor.
//
// WorldMap wired 13 layers that way, so one pointer move cost 26 queries. That is
// cheap when the pointer is idle and ruinous during a zoom, because Blink
// re-fires hover events as the map slides under a stationary cursor. Measured on
// production, one wheel-zoom produced 3,653 queries / 10,665 ms of blocked main
// thread — 140 pointer events times 26 — and the map froze in BOTH directions,
// because hit-test cost does not fall as you zoom out the way drawing cost does.
//
// The fix is structural, not a micro-optimisation: ONE unscoped listener, ONE
// query over every hit layer at once, arbitrated here in pure JS. Three
// reductions multiply — 26 queries become 1, a rAF coalesces a burst of pointer
// events into a single test, and nothing runs at all while the camera is moving.
//
// BEHAVIOUR CHANGE, deliberate. The cursor no longer turns into a pointer while
// the map moves underneath a stationary mouse. That is the whole point: those
// results were computed and thrown away. It resolves on the next real pointer
// move, or when the camera settles. Read that as intended, not as a regression.
//
// Pure and unit-tested; WorldMap owns the MapLibre side effects.

import { COUNTRY_HIT_LAYER, PIN_HIT_LAYERS, resolveLineHit } from "./hitTest";

/** The transparent, widened hit target for submarine cables. */
export const SIGNAL_LINE_HIT_LAYER = "signal-line-hit";
/** The visible cable geometry. Being ON it beats the country underneath. */
export const SIGNAL_LINE_DRAWN_LAYER = "signal-line-paths";

/**
 * Every layer the one shared pointer query has to cover. Superset of the click
 * arbiter's layers plus the widened cable target, so hover and click always agree
 * about what is under the cursor.
 */
export const HOVER_QUERY_LAYERS: readonly string[] = [
  ...PIN_HIT_LAYERS,
  COUNTRY_HIT_LAYER,
  SIGNAL_LINE_HIT_LAYER,
];

/** One rendered feature under the cursor, distilled from queryRenderedFeatures. */
export interface HoverFeature {
  /** The style layer id that rendered it (`feature.layer.id`). */
  layer: string;
  /** `properties.signalId` — only signal-layer features carry one. */
  signalId?: string;
  /** `feature.id` — only the country source sets one; used for setFeatureState. */
  featureId?: string | number;
  /** `properties.id` — the cable id the hover filter and the dossier key off. */
  id?: string;
  /** `properties.label` — the cable tip text. */
  label?: string;
}

/** Everything the map must be told after a pointer move. Fully derived. */
export interface HoverState {
  cursor: "" | "pointer";
  /** Country feature id to wash via setFeatureState, or null. */
  country: string | number | null;
  /** Cable to highlight and name at the cursor, or null. */
  line: { id: string; label: string } | null;
}

export const NO_HOVER: HoverState = { cursor: "", country: null, line: null };

const PIN_LAYER_SET = new Set(PIN_HIT_LAYERS);

/**
 * The single arbiter. Delegates the cable decision to resolveLineHit so the
 * cable-vs-pin-vs-country rules are not forked — hitTest.ts stays the one source
 * of truth for them.
 */
export function resolveHover(features: readonly HoverFeature[]): HoverState {
  const lineHits: HoverFeature[] = [];
  let onDrawnLine = false;
  let otherPin = false;
  let overCountry = false;
  let anyPin = false;
  let country: string | number | null = null;

  for (const f of features) {
    if (f.layer === SIGNAL_LINE_HIT_LAYER) {
      lineHits.push(f);
      continue;
    }
    if (f.layer === COUNTRY_HIT_LAYER) {
      overCountry = true;
      // Topmost country wins; the fill is one flat layer so there is normally one.
      if (country === null && f.featureId != null) country = f.featureId;
      continue;
    }
    if (!PIN_LAYER_SET.has(f.layer)) continue; // decoration — never interactive
    anyPin = true;
    if (f.layer === SIGNAL_LINE_DRAWN_LAYER) onDrawnLine = true;
    else otherPin = true;
  }

  const line = resolveLineHit({ lineHits, onDrawnLine, otherPin, overCountry });
  const lineId = line?.id;
  const resolvedLine = lineId ? { id: lineId, label: line?.label ?? "Cable" } : null;

  return {
    cursor: anyPin || resolvedLine ? "pointer" : "",
    country,
    line: resolvedLine,
  };
}

/**
 * The cursor to write on the canvas INLINE, given what the pointer is over and
 * whether a map-wide gesture mode owns the pointer.
 *
 * IT RETURNS "" WHILE A GESTURE OWNS THE POINTER, never "crosshair", and that is
 * the whole design. Camera picking already paints a crosshair, from
 * `.world-map.tn-picking .maplibregl-canvas` in globals.css — a rule React removes
 * along with the class the moment the mode ends or the map unmounts, so it cannot
 * leave a cursor stuck. What it could not beat was `resolveHover`'s inline
 * `pointer`, because an inline style outranks any stylesheet: the crosshair
 * vanished the instant the pointer crossed a pin, which in pick mode is most of the
 * time, since the pins ARE the target. Writing "crosshair" here would win that
 * fight and then own a teardown this function has no way to run on unmount — and a
 * cursor left on crosshair after the mode is over is worse than no crosshair at
 * all. Suppressing the `pointer` is the entire fix.
 *
 * WHY THE PIN'S `pointer` IS THE ONE THAT LOSES. It would otherwise win nearly
 * every frame of a pick, so the mode cue would flicker on and off as the analyst
 * sweeps a dense camera field — which reads as instability, not as "this pin is
 * clickable". That a pin can be clicked is already said by the accent ring around
 * the map and by the pick hint; that the map is in a mode is said by nothing else.
 */
/**
 * Who is deciding the canvas cursor right now.
 *
 * There are three answers and not two, because the crosshair reaches the canvas by
 * two different mechanisms and they need OPPOSITE treatment from this module:
 *
 *   "hover"    Nothing else is running. The hover result decides, as it always did.
 *   "mode"     A mode paints the crosshair from a CLASS — `.world-map.tn-picking` in
 *              globals.css, put there by React for as long as picking is armed.
 *   "gesture"  A live gesture paints it INLINE on the canvas and restores the value
 *              it found in its own teardown: `beginGesture` in lib/map/aoi.ts for
 *              the polygon and radius tools, `startCircleDraw` in
 *              lib/console/widgets/camslot.circle.ts for the circle.
 *
 * A class-painted crosshair is revealed by CLEARING the inline write sitting on top
 * of it. An inline-painted one is DESTROYED by exactly that act — which is why a
 * single "something owns the pointer" boolean is not enough, and why the first
 * version of this fix would have replaced a wrong `pointer` with a wrong arrow.
 */
export type CursorOwner = "hover" | "mode" | "gesture";

/**
 * Which of the three is in charge.
 *
 * A GESTURE OUTRANKS A MODE, and that ordering is load-bearing rather than
 * arbitrary. `startAreaPick` arms picking AND runs a draw, so a camera pick by area
 * is both at once. If the mode won there, the draw's own inline crosshair would be
 * cleared to reveal the class — which looks identical while both are up, and leaves
 * the draw with no crosshair at all the moment picking ends first.
 *
 * `drawing` is one read for all three gestures: the circle publishes into the same
 * `aoiDrawStore` through `setExternalDraw`, so `aoiDrawStore.get().active` covers
 * polygon, radius and circle without this function naming any of them.
 */
export function cursorOwner(s: { drawing: boolean; picking: boolean }): CursorOwner {
  if (s.drawing) return "gesture";
  if (s.picking) return "mode";
  return "hover";
}

/**
 * The cursor to write on the canvas INLINE — or `null` for "write nothing at all".
 *
 * IT NEVER RETURNS "crosshair", under any owner, and that is the design rather than
 * an omission. Both crosshairs already have an owner that can take them away again:
 * the class goes when React removes it with the mode, and the inline value is
 * restored by the gesture's own teardown. Writing one here would outrank both and
 * then own a teardown this function has no way to run — and a cursor left on
 * crosshair after the gesture is over is worse than no crosshair at all. All this
 * has to do is stop the hover's inline `pointer` from winning.
 *
 * WHY THE PIN'S `pointer` IS THE ONE THAT LOSES. It would otherwise win nearly every
 * frame of a pick or a draw, because the pins and the map under them are exactly
 * where those gestures are aimed. The cue would flicker on and off as the analyst
 * sweeps a dense camera field, which reads as instability rather than as "this pin
 * is clickable" — something the accent ring, the pick hint and the draw banner
 * already say in words.
 */
export function canvasCursor(hover: HoverState, owner: CursorOwner): HoverState["cursor"] | null {
  if (owner === "gesture") return null;
  if (owner === "mode") return "";
  return hover.cursor;
}

/** Did anything the map or the DOM cares about actually change? Value equality. */
export function hoverChanged(a: HoverState, b: HoverState): boolean {
  if (a.cursor !== b.cursor) return true;
  if (a.country !== b.country) return true;
  if ((a.line === null) !== (b.line === null)) return true;
  if (a.line && b.line && a.line.id !== b.line.id) return true;
  if (a.line && b.line && a.line.label !== b.line.label) return true;
  return false;
}

/**
 * Should this pointer event be hit-tested at all? Pure, so the suppression policy
 * is testable without a map.
 */
export interface HitTestGate {
  /** map.isMoving() — any camera animation, drag, wheel or inertia. */
  moving: boolean;
  nowMs: number;
  /**
   * Set to nowMs + settleMs on moveend. Inertia and the tile/label work that
   * follows it keep arriving after isMoving() goes false, and a hit-test landing
   * in that window is the expensive one nobody sees.
   */
  movingUntilMs: number;
  /** Optional floor between tests, on top of the caller's rAF coalescing. */
  lastRunMs?: number;
  minGapMs?: number;
}

export const HOVER_SETTLE_MS = 120;

export function shouldHitTest(g: HitTestGate): boolean {
  if (g.moving) return false;
  if (g.nowMs < g.movingUntilMs) return false;
  if (g.minGapMs && g.lastRunMs != null && g.nowMs - g.lastRunMs < g.minGapMs) return false;
  return true;
}
