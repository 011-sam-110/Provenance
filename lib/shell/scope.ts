"use client";
// The global Scope — the relevance spine. A single persisted store (the lib/shell
// idiom) the feed, the map and (later) the alerts all read: World (firehose) /
// Near-me / Region / AOI. Pure withinScope is unit-tested; the store is a thin
// useSyncExternalStore shell. AOI's bbox is modelled now; the draw interaction is
// P4 — withinScope already handles it so nothing changes when the UI arrives.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { haversineKm } from "@/lib/geo/haversine";

export type ScopeMode = "world" | "near-me" | "region" | "aoi";

export interface Scope {
  mode: ScopeMode;
  /** Centre for near-me / region. */
  center?: { lat: number; lon: number };
  /** Radius (km) for centre-based scopes. */
  radiusKm?: number;
  /** [west, south, east, north] for aoi. The bbox is the CHEAP test and, when a
   *  polygon is present, only its bounding box - see withinScope. */
  bbox?: [number, number, number, number];
  /**
   * A drawn area of interest as a closed ring of [lon, lat] vertices.
   *
   * A rectangle would have been much less work, and it is not what an analyst
   * asked for: "hay analistas que solo quieren dibujar una zona en el mapa y ver
   * alertas exclusivas de esa area". A coastline, a border region or a corridor
   * is not a rectangle, and a bbox around one admits most of what it was drawn to
   * exclude. The ring is stored open (no repeated closing vertex); withinScope
   * closes it.
   */
  polygon?: [number, number][];
  /**
   * A NAMED PLACE as its real shape: every part of it, each part a list of rings
   * (the outer ring first, then its holes), [lon, lat]. A country is more than one
   * ring when it has islands or an enclave, and one `polygon` cannot say that. When
   * present it is the test: a point is inside when it is inside an odd number of
   * the rings (see withinParts). Set only by `placeScope`.
   */
  parts?: ScopeParts;
  /**
   * "place" when the question reader of the command palette set this scope from a
   * place name (lib/shell/askApplied.ts). The chip that removes the filter reads
   * it, and `coerceSavedScope` drops such a scope on reload. Absent for a drawn area.
   */
  origin?: "place";
  /** Human label for the top bar + the feed's honest empty state. */
  label: string;
}

/** The parts of a named place: parts -> rings -> [lon, lat]. A MultiPolygon's coordinates. */
export type ScopeParts = [number, number][][][];

export const WORLD_SCOPE: Scope = { mode: "world", label: "World" };
export const DEFAULT_RADIUS_KM = 250;
const MIN_RADIUS_KM = 10;

/**
 * Pure: is [lon, lat] inside the closed ring? Standard even-odd ray casting.
 *
 * A vertex exactly ON an edge is not specified either way, and that is fine here:
 * the ring is drawn by hand at map resolution, so a boundary tie is already below
 * the precision of the gesture that made it. What is NOT fine is a ring with
 * fewer than three vertices - that is not an area, and the caller must not treat
 * it as one (withinScope guards the length before calling).
 */
export function pointInRing(lon: number, lat: number, ring: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > lat !== yj > lat;
    if (!straddles) continue;
    const x = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (lon < x) inside = !inside;
  }
  return inside;
}

/** Pure: the [west, south, east, north] envelope of a ring. */
export function bboxOfRing(ring: readonly [number, number][]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

/**
 * Pure: is [lon, lat] inside a place made of parts?
 *
 * EVEN-ODD OVER EVERY RING. The parts of one place do not overlap and a hole lies
 * inside its own outer ring, so a point in the place is inside exactly one ring, a
 * point in a hole is inside two, and a point outside is inside none. One count gives
 * the islands and the holes with no special case for either.
 */
export function withinParts(lon: number, lat: number, parts: ScopeParts): boolean {
  let inside = false;
  for (const part of parts) {
    for (const ring of part) {
      if (ring.length >= 3 && pointInRing(lon, lat, ring)) inside = !inside;
    }
  }
  return inside;
}

/** Pure: the [west, south, east, north] envelope of every ring of a place. */
export function bboxOfParts(parts: ScopeParts): [number, number, number, number] {
  return bboxOfRing(parts.flat(2));
}

/**
 * Build the scope for a named place from its parts. Rings with fewer than three
 * finite vertices are dropped; with no ring left the answer is World, because a
 * scope that admits nothing would empty the map and say a place name beside it.
 */
export function placeScope(label: string, parts: ScopeParts): Scope {
  const finite = (ring: [number, number][]) =>
    ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const clean: ScopeParts = [];
  for (const part of parts) {
    const [outer, ...holes] = part.map(finite);
    // A part with no outer ring is no part, and its holes go with it.
    if (!outer || outer.length < 3) continue;
    clean.push([outer, ...holes.filter((ring) => ring.length >= 3)]);
  }
  if (clean.length === 0) return WORLD_SCOPE;
  return { mode: "aoi", origin: "place", label, parts: clean, bbox: bboxOfParts(clean) };
}

/** Pure: is a point inside the scope? Malformed centre/aoi scopes admit
 *  everything — we never silently hide data we cannot test. */
export function withinScope(lat: number, lon: number, scope: Scope): boolean {
  switch (scope.mode) {
    case "near-me":
    case "region":
      if (!scope.center || scope.radiusKm == null) return true;
      return haversineKm(scope.center.lat, scope.center.lon, lat, lon) <= scope.radiusKm;
    case "aoi": {
      // A named place first: its parts are the whole test, behind the same cheap
      // envelope reject the drawn ring uses below.
      if (scope.parts && scope.parts.length > 0) {
        if (scope.bbox) {
          const [w, s, e, n] = scope.bbox;
          if (lon < w || lon > e || lat < s || lat > n) return false;
        }
        return withinParts(lon, lat, scope.parts);
      }
      // Polygon first when one was drawn. The bbox is kept alongside it as a cheap
      // reject: point-in-polygon is O(vertices) and this runs per feature per
      // render across every scoped widget, so the ~99% of the world that is
      // nowhere near the ring should cost four comparisons, not forty.
      if (scope.polygon && scope.polygon.length >= 3) {
        if (scope.bbox) {
          const [w, s, e, n] = scope.bbox;
          if (lon < w || lon > e || lat < s || lat > n) return false;
        }
        return pointInRing(lon, lat, scope.polygon);
      }
      if (!scope.bbox) return true;
      const [w, s, e, n] = scope.bbox;
      return lon >= w && lon <= e && lat >= s && lat <= n;
    }
    case "world":
    default:
      return true;
  }
}

/** Radius (km) covering a geocoder extent [west,south,east,north], floored. */
export function radiusFromBbox(bbox: [number, number, number, number]): number {
  const [w, s, e, n] = bbox;
  const halfDiag = haversineKm(s, w, n, e) / 2;
  return Math.max(MIN_RADIUS_KM, Math.round(halfDiag));
}

/** Pure: a ring we are willing to filter on, or null. Finite pairs, in range, >= 3. */
export function sanitiseRing(value: unknown): [number, number][] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out: [number, number][] = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const [lon, lat] = p;
    if (typeof lon !== "number" || typeof lat !== "number") return null;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    out.push([lon, lat]);
  }
  return out;
}

/** Build an AOI scope from a drawn ring, with its envelope precomputed. */
export function aoiScope(ring: readonly [number, number][], label = "Drawn area"): Scope {
  const clean = sanitiseRing(ring as unknown);
  if (!clean) return WORLD_SCOPE;
  return { mode: "aoi", label, polygon: clean, bbox: bboxOfRing(clean) };
}

/** A persisted near-me OR region rehydrates to World; aoi/world survive; junk → World.
 *
 *  near-me goes because we never auto-geolocate on load. `region` goes for a different
 *  reason: nothing can set one any more. `ScopeControl` was its only writer and it was
 *  orphaned when `ConsoleTopBar` was deleted, so restoring a stored region would open
 *  the console silently filtered to a city the user picked days ago, with no control in
 *  the UI to widen it — the one route back to World is the map rail's Draw ▸ Clear,
 *  which nobody would think to look for. The drawn-area (`aoi`) scope still survives a
 *  reload, because that one IS both settable and clearable from the map rail. */
export function coerceSavedScope(saved: unknown): Scope {
  const s = saved as Scope | null;
  if (!s || typeof s !== "object" || typeof s.mode !== "string") return WORLD_SCOPE;
  if (s.mode === "near-me" || s.mode === "region") return WORLD_SCOPE;
  // A place set by the question reader goes too. The time and precision filters of
  // the same question are not persisted, so a restored place would be one third of
  // a question, and the chip that removes it would be the only sign of it.
  if (s.origin === "place") return WORLD_SCOPE;
  if (s.mode === "aoi") {
    // localStorage is user-writable and this drives what a feed HIDES. A ring that
    // survived as junk would silently filter the console down to nothing with no
    // way to tell why, so a malformed one drops the polygon rather than the scope.
    const ring = sanitiseRing(s.polygon);
    if (!ring) return { ...s, polygon: undefined };
    return { ...s, polygon: ring, bbox: bboxOfRing(ring) };
  }
  if (s.mode === "world") return s;
  return WORLD_SCOPE;
}

const PERSIST_KEY = "tn.scope.v1";
const PERSIST_VERSION = 1;

let state: Scope = WORLD_SCOPE;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  savePersisted(PERSIST_KEY, PERSIST_VERSION, state);
}

export const scopeStore = {
  set(scope: Scope) {
    state = scope;
    emit();
  },
  get(): Scope {
    return state;
  },
  reset() {
    state = WORLD_SCOPE;
    emit();
  },
  hydrate() {
    state = coerceSavedScope(loadPersisted<Scope>(PERSIST_KEY, PERSIST_VERSION));
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useScope(): Scope {
  return useSyncExternalStore(scopeStore.subscribe, scopeStore.get, scopeStore.get);
}
