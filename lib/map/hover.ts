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
