"use client";
// Coordinates for webcam ids the cached directory does not carry.
//
// WHY THIS EXISTS. `useWebcamDirectory()` serves a fixed ~2% region-bbox sample
// (lib/webcams/titles.ts), so a real webcam like `windy:1606332744` (Madrid), which
// sits on the default Streets board, is absent from it entirely. Without a place
// for it the conditions overlay would have to fall back to the map centre or a
// country centroid — banned outright, because that is not where the camera is. This
// resolves the miss through /api/webcam-place, one id at a time, and shares the
// answer across every slot that asks for the same id.
//
// Shaped like lib/cameras/useCameras.ts: a module-level, ref-counted store behind
// useSyncExternalStore, so several camera walls resolving the same id share one
// fetch and one cached answer rather than each firing its own request.

import { useMemo, useSyncExternalStore } from "react";

export interface WebcamPlace {
  lat: number;
  lon: number;
}

interface Entry {
  place: WebcamPlace | null;
  /** True once a fetch for this id has settled — including a null answer. Guards
   *  against refetching a null result more than once per session. */
  settled: boolean;
  inflight: Promise<void> | null;
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
/** Cached snapshot object returned to useSyncExternalStore. Rebuilt only when the
 *  cache actually changes, so repeated renders with the same ids get a referentially
 *  stable Map and never trip React's "getSnapshot should be cached" warning. */
let snapshot: Map<string, WebcamPlace> = new Map();
let snapshotDirty = true;

function emit() {
  snapshotDirty = true;
  for (const fn of listeners) fn();
}

function entryFor(id: string): Entry {
  let e = cache.get(id);
  if (!e) {
    e = { place: null, settled: false, inflight: null };
    cache.set(id, e);
  }
  return e;
}

function load(id: string): void {
  const e = entryFor(id);
  if (e.settled || e.inflight || typeof window === "undefined") return;
  e.inflight = fetch(`/api/webcam-place?id=${encodeURIComponent(id)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const lat = typeof j?.lat === "number" && Number.isFinite(j.lat) ? j.lat : null;
      const lon = typeof j?.lon === "number" && Number.isFinite(j.lon) ? j.lon : null;
      e.place = lat !== null && lon !== null ? { lat, lon } : null;
      e.settled = true;
      emit();
    })
    .catch(() => {
      // A failed request must not be retried forever, or every re-render of a slot
      // holding a permanently-unreachable id would refire it. Treat it the same as
      // a resolved-but-null answer: settled, so it is asked for at most once more
      // next session, never again this one.
      e.place = null;
      e.settled = true;
      emit();
    })
    .finally(() => {
      e.inflight = null;
    });
}

function buildSnapshot(): Map<string, WebcamPlace> {
  if (!snapshotDirty) return snapshot;
  const next = new Map<string, WebcamPlace>();
  for (const [id, e] of cache) {
    if (e.place) next.set(id, e.place);
  }
  snapshot = next;
  snapshotDirty = false;
  return snapshot;
}

const EMPTY: Map<string, WebcamPlace> = new Map();

/**
 * Resolve webcam ids missing from the cached directory to their coordinates.
 *
 * The caller is expected to filter out ids it already has a place for (from
 * `useWebcamDirectory()`), but this guards anyway: an id already present in this
 * module's own cache with a settled entry is never refetched, so passing a
 * redundant id costs nothing beyond a Map lookup.
 */
export function useWebcamPlaces(ids: string[]): Map<string, WebcamPlace> {
  // A stable identity per distinct id set, so `subscribe` (and therefore the
  // effect useSyncExternalStore runs it in) does not re-run every render just
  // because the caller passed a fresh array literal with the same contents.
  const key = useMemo(() => Array.from(new Set(ids)).sort().join("|"), [ids]);
  const uniqueIds = useMemo(() => key.split("|").filter(Boolean), [key]);

  const subscribe = useMemo(
    () => (cb: () => void) => {
      listeners.add(cb);
      for (const id of uniqueIds) load(id);
      return () => {
        listeners.delete(cb);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  return useSyncExternalStore(
    subscribe,
    () => (uniqueIds.length ? buildSnapshot() : EMPTY),
    () => EMPTY,
  );
}
