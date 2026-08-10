// Map load resilience — the pure decision logic behind WorldMap's recovery from a
// basemap that fails to load.
//
// WHY THIS EXISTS. The map had no `map.on("error")` handler and no retry anywhere.
// The "Light" basemap is a REMOTE style URL (basemaps.cartocdn.com), so a single
// flaky fetch means `style.load` never fires, addAppLayers() never runs, and the
// user is left with a permanent black rectangle and no pins — with nothing on
// screen explaining it. This is the single most-reported failure on both competing
// products in this category, and we had identical exposure.
//
// Everything here is pure and unit-tested; WorldMap owns the MapLibre side effects.

import type { BasemapKey } from "@/lib/basemaps";

/** How long to wait for `style.load` before treating the basemap as failed. */
export const STYLE_LOAD_TIMEOUT_MS = 9000;

/** Style load attempts (the initial try plus retries) before falling back. */
export const MAX_STYLE_ATTEMPTS = 3;

export type MapErrorKind =
  /** The style document itself failed — fatal, nothing renders. Recover. */
  | "style"
  /** A tile/sprite/glyph 404'd or timed out — cosmetic and often transient. Ignore. */
  | "tile"
  /** Anything else — log, don't act. */
  | "other";

interface MapErrorLike {
  error?: { status?: number; message?: string } | null;
  sourceId?: string;
  /** MapLibre attaches the failing tile's id for tile-level errors. */
  tile?: unknown;
}

/**
 * Classify a MapLibre `error` event.
 *
 * MapLibre reports a dead CDN and a single missing tile through the SAME event, so
 * without this a retry loop would thrash on ordinary tile misses (a raster basemap
 * 404s tiles constantly at the poles and past a source's maxzoom). Only a failure
 * to load the style DOCUMENT justifies tearing the map down and retrying.
 */
export function classifyMapError(e: MapErrorLike | null | undefined): MapErrorKind {
  if (!e) return "other";
  // A tile-scoped error carries the tile it belongs to, or a sourceId. Either way
  // the style is alive and the map is usable, so never recover on these.
  if (e.tile != null || e.sourceId) return "tile";

  const msg = (e.error?.message ?? "").toLowerCase();
  if (!msg) return "other";
  // MapLibre surfaces a failed style fetch as a load/parse error naming the style.
  if (msg.includes("style")) return "style";
  // A bare failed fetch with no source/tile context is the style document request.
  if (msg.includes("failed to fetch") || msg.includes("networkerror")) return "style";
  return "other";
}

/**
 * Backoff before re-attempting a style load. Deliberately short — the user is
 * staring at an empty stage, so a slow backoff reads as a broken product.
 * `attempt` is 1-based (the number of attempts already made).
 */
export function retryDelayMs(attempt: number): number {
  const schedule = [600, 1800];
  return schedule[Math.min(Math.max(attempt, 1), schedule.length) - 1];
}

/** True when the basemap's style is fetched over the network (and so can fail). */
export function isRemoteStyle(
  key: BasemapKey,
  styles: Record<BasemapKey, { style: string | object }>,
): boolean {
  return typeof styles[key]?.style === "string";
}

/**
 * The basemap to fall back to when `key` will not load.
 *
 * Only ever falls back to a basemap whose style is INLINE, because a remote style
 * is exactly what just failed — falling back to another URL could fail the same
 * way and strand the user again. Returns null when `key` is already inline (its
 * style cannot fail to load, so there is nothing to fall back from).
 */
export function fallbackBasemap(
  key: BasemapKey,
  styles: Record<BasemapKey, { style: string | object }>,
): BasemapKey | null {
  if (!isRemoteStyle(key, styles)) return null;
  const inline = (Object.keys(styles) as BasemapKey[]).filter(
    (k) => k !== key && !isRemoteStyle(k, styles),
  );
  // Prefer satellite (the product default) when it qualifies.
  if (inline.includes("satellite" as BasemapKey)) return "satellite" as BasemapKey;
  return inline[0] ?? null;
}

export type MapLoadStatus =
  | { kind: "ok" }
  | { kind: "retrying"; attempt: number }
  | { kind: "fallback"; from: BasemapKey; to: BasemapKey }
  | { kind: "lost" };

/**
 * Decide what to do when a style has failed to load.
 * `attempts` = how many load attempts have already been made for this basemap.
 */
export function nextRecoveryStep(
  attempts: number,
  basemap: BasemapKey,
  styles: Record<BasemapKey, { style: string | object }>,
): { action: "retry"; delayMs: number } | { action: "fallback"; to: BasemapKey } | { action: "give-up" } {
  if (attempts < MAX_STYLE_ATTEMPTS) {
    return { action: "retry", delayMs: retryDelayMs(attempts) };
  }
  const to = fallbackBasemap(basemap, styles);
  return to ? { action: "fallback", to } : { action: "give-up" };
}
