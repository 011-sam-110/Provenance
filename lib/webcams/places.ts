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

/** What the overlay should do about one webcam's position, right now. */
export interface WebcamPlaceState {
  coord: WebcamPlace | null;
  /** True while we are still asking. NOT the same as "there is no position". */
  pending: boolean;
}

/**
 * Decide a webcam's position from the two sources that can supply one.
 *
 * Pure and exported so this decision has a test, because it is a decision about
 * TRUTH rather than about layout, and getting it wrong is not a visual bug. The
 * first version of this feature only ever handed back successful lookups, which
 * made "we have not finished asking" and "we asked, and there is nothing there"
 * the same value — and a Prague tile whose coordinates were one round trip away
 * announced "no data" for them. `pending` exists to keep those apart, and it can
 * only do that if a settled miss is represented explicitly.
 *
 * @param dirLat  latitude from the cached webcam directory, if it carries the row
 * @param dirLon  longitude from the same row
 * @param settled the resolver's map: a coordinate, or an explicit null for an id
 *                that has been asked about and has none. An ABSENT id is unsettled.
 */
export function webcamPlaceState(
  dirLat: number | undefined,
  dirLon: number | undefined,
  settled: Map<string, WebcamPlace | null>,
  id: string,
): WebcamPlaceState {
  // The directory is authoritative when it carries a real pair — no request needed.
  if (typeof dirLat === "number" && Number.isFinite(dirLat) && typeof dirLon === "number" && Number.isFinite(dirLon)) {
    return { coord: { lat: dirLat, lon: dirLon }, pending: false };
  }
  if (settled.has(id)) return { coord: settled.get(id) ?? null, pending: false };
  return { coord: null, pending: true };
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
/** Cached snapshot object returned to useSyncExternalStore. Rebuilt only when the
 *  cache actually changes, so repeated renders with the same ids get a referentially
 *  stable Map and never trip React's "getSnapshot should be cached" warning. */
let snapshot: Map<string, WebcamPlace | null> = new Map();
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

/**
 * A SETTLED entry is always present in the snapshot, even when it settled with no
 * place — as an explicit `null`.
 *
 * That is the whole point of the value type. An id that is simply ABSENT from this
 * map is still being resolved, and the overlay must show "…" for it; an id mapped to
 * `null` has been asked and genuinely has no position, and the overlay must show
 * "no data". Collapsing the two (returning only the successes) made a Prague tile
 * whose coordinates were a few hundred milliseconds away claim, in as many words,
 * that we had no reading for it. A confident wrong answer is the one failure this
 * feature is not allowed to have.
 */
function buildSnapshot(): Map<string, WebcamPlace | null> {
  if (!snapshotDirty) return snapshot;
  const next = new Map<string, WebcamPlace | null>();
  for (const [id, e] of cache) {
    if (e.settled) next.set(id, e.place);
  }
  snapshot = next;
  snapshotDirty = false;
  return snapshot;
}

const EMPTY: Map<string, WebcamPlace | null> = new Map();

/**
 * Resolve webcam ids missing from the cached directory to their coordinates.
 *
 * Returns one entry per SETTLED id: a coordinate, or `null` for an id that has been
 * asked about and has no position. An id that is absent from the returned map has
 * not settled yet — read that as "still resolving", never as "no position".
 *
 * The caller is expected to filter out ids it already has a place for (from
 * `useWebcamDirectory()`), but this guards anyway: an id already present in this
 * module's own cache with a settled entry is never refetched, so passing a
 * redundant id costs nothing beyond a Map lookup.
 */
export function useWebcamPlaces(ids: string[]): Map<string, WebcamPlace | null> {
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
