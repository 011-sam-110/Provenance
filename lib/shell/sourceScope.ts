"use client";
// WHERE a source is allowed to appear, now that every drawn area is live at once.
//
// THE PROBLEM THIS SOLVES. lib/scopeFilter.ts crops everything to ONE scope, which
// was right while an area was a whole-console mode: load Kharkiv, the console is
// Kharkiv. Areas are additive now (see lib/shell/inspector.ts), so "the scope" is no
// longer a single answer — Aircraft may be on globally while Fires is on only inside
// two rings, and both have to be true of the same map at the same moment.
//
// So the crop became per-source, and it composes with the old one rather than
// replacing it:
//
//   1. The MAP RAIL's Draw ▸ Area / Radius filter is still a single global crop and
//      still applies to everything. It is a deliberate "show me only here" gesture
//      with its own Clear button, and Sam kept it as a separate tool from saved
//      areas. That is `useScope()`, unchanged.
//   2. Then, if World does not have the source on, it is cropped to the rings of the
//      areas that asked for it.
//
// Both, in that order, and neither is allowed to widen the other.
//
// WHY THIS IS NOT IN scopeFilter.ts. That module is pure and takes a Scope; this one
// has to read the inspector store to know which rings a source id belongs to. Keeping
// the store read out of the pure filter is what lets the ring maths stay testable
// without a store, and it is the same one-way rule inspector.ts states for
// lib/layers.ts: this file imports the store, the store never imports this.

import { useSyncExternalStore } from "react";
import { inspectorStore, sourceRegions, type InspectorState } from "@/lib/shell/inspector";
import { aoiScope, useScope, withinScope, type Scope } from "@/lib/shell/scope";
import { filterToScope } from "@/lib/scopeFilter";

/**
 * The rings a source may appear in. `null` is "anywhere", which is what World having
 * it on means.
 *
 * MEMOISED ON (state, id) BECAUSE OF useSyncExternalStore. The getter below is a
 * snapshot getter, and React compares snapshots by identity — building a fresh array
 * per call is an infinite render loop. The cache is a Map keyed by source id and
 * dropped whole whenever the state object changes, which is the same "state identity
 * is the cache key" rule inspector.ts uses one layer down. It is not an LRU: the key
 * space is the source registry, a few dozen strings, and the map is thrown away on
 * every write.
 */
let cacheState: InspectorState | null = null;
let cache = new Map<string, Scope[] | null>();

export function scopesForSource(state: InspectorState, id: string): Scope[] | null {
  if (state !== cacheState) {
    cacheState = state;
    cache = new Map();
  }
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const areas = sourceRegions(state, id);
  // `aoiScope` re-derives the bbox from the ring rather than reusing the area's own.
  // They agree — coerceState recomputes it on load for exactly this reason — but the
  // derivation is cheap and one owner of that maths is better than two.
  const out = areas === null ? null : areas.map((a) => aoiScope(a.polygon, a.label));
  cache.set(id, out);
  return out;
}

/** Hook form. `null` = this source is not cropped to any ring. */
export function useSourceScopes(id: string): Scope[] | null {
  return useSyncExternalStore(
    inspectorStore.subscribe,
    () => scopesForSource(inspectorStore.get(), id),
    () => null,
  );
}

/**
 * Pure: keep the items inside ANY of `scopes`.
 *
 * UNION, not intersection. Two areas that both want Fires want the fires in either
 * of them; a fire has to be in one ring, not in both, and no ring can exclude a
 * point another ring admitted.
 *
 * `null` returns the input untouched, so the unrestricted case costs nothing and
 * keeps array identity — which matters, because these results feed hooks whose
 * consumers memoise on them.
 *
 * An EMPTY array returns nothing, and that is correct rather than a degenerate case
 * to guard: no World, no area, so nowhere. Callers should not be drawing a source in
 * that state at all, but if one does it draws an empty map rather than a global one.
 */
export function filterToScopes<T>(
  items: readonly T[],
  scopes: readonly Scope[] | null,
  at: (item: T) => { lat: number; lon: number } | null,
): T[] {
  if (scopes === null) return items as T[];
  if (scopes.length === 0) return [];
  const out: T[] = [];
  for (const item of items) {
    const p = at(item);
    // A MISSING POSITION IS DROPPED, the same ruling lib/scopeFilter.ts makes and for
    // the same reason: "I do not know where this is" cannot honestly answer "is it in
    // the ring the user drew to exclude things".
    if (!p) continue;
    for (const s of scopes) {
      if (withinScope(p.lat, p.lon, s)) {
        out.push(item);
        break;
      }
    }
  }
  return out;
}

/**
 * The whole filter for one source, in one call: the global map-rail crop, then this
 * source's own rings.
 *
 * This is what the four core data hooks and WorldMap's SignalFeed call instead of
 * `useScopeFilter`. Passing the source id is the entire difference, and it is
 * required rather than optional on purpose — a hook that silently means "everywhere"
 * when the id is forgotten would show a ring-scoped source across the whole globe
 * and look like it was working.
 */
export function useSourceFilter<T>(
  id: string,
  items: readonly T[],
  at: (item: T) => { lat: number; lon: number } | null,
): T[] {
  const cropped = filterToScope(items, useScope(), at);
  return filterToScopes(cropped, useSourceScopes(id), at);
}
