// The person's three network calls, and nothing else makes them. Each is asked rarely, and none of
// them ever carries the pointer's place, which is the privacy win over Google's lookup:
//   - the index, once, on the first hover, focus or press of the person;
//   - the exact points in view, at zoom 9 and closer, at pick-up and after an edge pan settles;
//   - the name of the chosen camera's cell, once per cell, after the ring has settled.

import {
  buildCoverageIndex,
  coverageFeatures,
  type CoverageIndex,
  type CoveragePoints,
  type Spot,
} from "@/lib/eye/coverage";
import { placeName } from "@/lib/console/eyePerson";

/** A failed index may be asked for again, but not on every hover. */
const RETRY_AFTER_MS = 60_000;

let index: CoverageIndex | null = null;
let cells: GeoJSON.FeatureCollection | null = null;
let pending: Promise<CoverageIndex | null> | null = null;
let failedAt = 0;

/** Ask for the index, once. Never rejects: a failure resolves null, and a drop then opens at the ring. */
export function loadCoverage(): Promise<CoverageIndex | null> {
  if (index) return Promise.resolve(index);
  if (pending) return pending;
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(null);
  pending = fetch("/api/eye/coverage")
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((body) => {
      index = buildCoverageIndex(body);
      cells = index ? coverageFeatures(index.cells) : null;
      if (!index) failedAt = Date.now();
      pending = null;
      return index;
    });
  return pending;
}

/** The index if it has answered. */
export function coverageIndexNow(): CoverageIndex | null {
  return index;
}

/** Is the first answer still on its way? */
export function coverageLoading(): boolean {
  return pending != null;
}

/** The whole index as GeoJSON, one object, so the overlay can tell it has it already. */
export function coverageCellsNow(): GeoJSON.FeatureCollection | null {
  return cells;
}

/** Exact points in a box already snapped to the grid. Null on any failure: the cells stay up. */
export async function loadPoints(box: readonly number[]): Promise<CoveragePoints | null> {
  try {
    const res = await fetch(`/api/eye/coverage?bbox=${box.join(",")}`);
    if (!res.ok) return null;
    const body = (await res.json()) as CoveragePoints;
    return body.ok && Array.isArray(body.points) ? body : null;
  } catch {
    return null;
  }
}

const names = new Map<string, Promise<string | null>>();

/** What a place is called, cached per cell for this page's life, with the region as the fallback. */
export function placeNameFor(key: string, spot: Spot, region: string): Promise<string | null> {
  const held = names.get(key);
  if (held) return held;
  const asked = fetchPlaceName(spot).then((results) => placeName(results, region));
  names.set(key, asked);
  return asked;
}

/** The geocoder's answer for a spot. An empty list on any failure. */
export async function fetchPlaceName(spot: Spot): Promise<unknown[]> {
  try {
    const res = await fetch(`/api/geocode?lat=${spot.lat}&lon=${spot.lon}&lang=en`);
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: unknown[] };
    return Array.isArray(body.results) ? body.results : [];
  } catch {
    return [];
  }
}
