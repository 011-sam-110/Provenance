"use client";
// One scope filter, shared by every data hook that is not already scoped.
//
// WHY IT LIVES IN A HELPER AND NOT AT THE CALL SITES. Ten widget files already call
// useScope() and filter for themselves. The remaining data-bearing ones funnel
// through four hooks — usePlanes, useCameras, useSatellites, useWebcamDirectory —
// so putting the filter INSIDE those four scopes every widget that reads them, and
// scopes any widget added later by construction. Filtering at each call site would
// be the same work done six times and forgotten on the seventh.
//
// A MISSING POSITION IS DROPPED, NOT KEPT. Under an area, "I do not know where this
// is" cannot honestly answer "is it in the ring". Keeping it would put an item of
// unknown location inside a boundary the user drew precisely to exclude things.
// Under World the question is not asked, so it stays.

import { useScope, withinScope, type Scope } from "@/lib/shell/scope";

/** Pure: keep only the items inside `scope`. Returns the input array untouched for World. */
export function filterToScope<T>(
  items: readonly T[],
  scope: Scope,
  at: (item: T) => { lat: number; lon: number } | null,
): T[] {
  if (scope.mode === "world") return items as T[];
  const out: T[] = [];
  for (const item of items) {
    const p = at(item);
    if (p && withinScope(p.lat, p.lon, scope)) out.push(item);
  }
  return out;
}

/** Hook form: filters to the LIVE scope, which the Inspector drives when an area loads. */
export function useScopeFilter<T>(
  items: readonly T[],
  at: (item: T) => { lat: number; lon: number } | null,
): T[] {
  return filterToScope(items, useScope(), at);
}
