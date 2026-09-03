"use client";
// The board-wide air-weather store behind the conditions overlay.
//
// WHY THIS IS ITS OWN SHARED STORE AND NOT A PER-WIDGET FETCH. The Streets board can
// hold several camera walls at once, each with its own playlist of streams. If each
// wall polled /api/point-weather for its own coordinates independently, a board with
// four walls holding overlapping cities would fire four requests for the same
// points. This is the fan-out control: every mounted CamslotConditions overlay
// subscribes into ONE module-level Map keyed by coordKey, ref-counted exactly like
// lib/cameras/useCameras.ts (see :40-93 there), so the whole board shares one poll.
//
// WHY EVERY COORDINATE IN THE PLAYLIST, NOT JUST THE CURRENT STREAM. camslot.tsx
// rotates its visible stream on a timer without re-fetching anything (that is the
// whole point of the playlist model — see the three rules atop that file). If this
// store only knew about the CURRENT stream's coordinate, rotating to the next one
// would need a fresh subscription and would flash "…" until it resolved. Subscribing
// every coordinate in the slot up front makes a rotation a pure Map lookup.
//
// FAILURE POLICY. A bad response never blanks a tile that already had a reading —
// `weatherMap` only ever gains entries, never loses one on a failed poll, and
// `failed` is surfaced separately so the caller can say so without hiding the last
// good number. That mirrors useCameras.ts's "keep the last good list" comment.

import { useMemo, useRef, useSyncExternalStore } from "react";
import { coordKey, pointsParam, planBatches, type Coord, type PointWeather } from "@/lib/weather/pointWeather";
import { isHidden, onVisible, shouldRefreshOnVisible } from "@/lib/shell/visibility";

const REFRESH_MS = 600_000;
const DEBOUNCE_MS = 200;

/**
 * Deduplicate a coordinate list by `coordKey`, first occurrence wins, sorted by key.
 *
 * Sorting here — not only in `pointsParam` — is what makes two boards holding the
 * SAME set of places in a DIFFERENT stream order register an identical set of
 * coordinates with the store, so they land in the same request batches.
 */
export function dedupeCoords(coords: Coord[]): Coord[] {
  const seen = new Map<string, Coord>();
  for (const c of coords) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    const key = coordKey(c.lat, c.lon);
    if (!seen.has(key)) seen.set(key, { lat: c.lat, lon: c.lon });
  }
  return Array.from(seen.keys())
    .sort()
    .map((key) => seen.get(key) as Coord);
}

/**
 * Deduped, batched, `/api/point-weather` request URLs for a coordinate list.
 *
 * Pure and exported so the batching and URL shape are node-testable without a
 * fetch mock: same coord set in a different order, or with duplicates (several
 * streams pointed at the same junction), must yield the identical set of URLs.
 */
export function pointWeatherRequestUrls(coords: Coord[]): string[] {
  const unique = dedupeCoords(coords);
  if (unique.length === 0) return [];
  // planBatches, not a local loop: /api/point-weather's own handler chunks the
  // parsed points with the same function, so the client and the server agree on the
  // batch boundary by construction rather than by two copies staying in step.
  return planBatches(unique).map((batch) => `/api/point-weather?points=${pointsParam(batch)}`);
}

// ── shared module state ──────────────────────────────────────────────────
const weatherMap = new Map<string, PointWeather>();
const refCount = new Map<string, number>();
const coordOf = new Map<string, Coord>();
const listeners = new Set<() => void>();

let version = 0;
let lastFailed = false;
let lastOkAt: number | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let visibilityUnsub: (() => void) | null = null;
let activeSubscribers = 0;
let fetchInFlight = false;
let refetchQueued = false;

function bump() {
  version += 1;
  for (const fn of listeners) fn();
}

async function runFetch(): Promise<void> {
  if (fetchInFlight) {
    refetchQueued = true;
    return;
  }
  fetchInFlight = true;
  try {
    const coords = Array.from(coordOf.values());
    if (coords.length === 0) {
      lastFailed = false;
      bump();
      return;
    }
    const urls = pointWeatherRequestUrls(coords);
    let anyFailed = false;
    const batches = await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) {
            anyFailed = true;
            return [] as PointWeather[];
          }
          const json = await res.json();
          if (!json?.ok) anyFailed = true;
          return Array.isArray(json?.points) ? (json.points as PointWeather[]) : [];
        } catch {
          anyFailed = true;
          return [] as PointWeather[];
        }
      }),
    );
    for (const points of batches) {
      for (const pw of points) weatherMap.set(pw.key, pw);
    }
    lastFailed = anyFailed;
    if (!anyFailed) lastOkAt = Date.now();
    bump();
  } finally {
    fetchInFlight = false;
    if (refetchQueued) {
      refetchQueued = false;
      void runFetch();
    }
  }
}

/** Coalesce many near-simultaneous new subscriptions (a whole board mounting) into
 *  one request instead of one per widget. */
function scheduleFetch() {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runFetch();
  }, DEBOUNCE_MS);
}

function ensureRunning() {
  if (refreshTimer === null) {
    refreshTimer = setInterval(() => {
      if (isHidden()) return; // don't poll a tab nobody is looking at
      void runFetch();
    }, REFRESH_MS);
  }
  if (visibilityUnsub === null) {
    visibilityUnsub = onVisible(() => {
      if (shouldRefreshOnVisible(lastOkAt, REFRESH_MS, Date.now())) void runFetch();
    });
  }
}

function maybeStop() {
  if (activeSubscribers > 0) return;
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (visibilityUnsub !== null) {
    visibilityUnsub();
    visibilityUnsub = null;
  }
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** Register a subscription's coordinates; returns the keys it holds, for symmetric
 *  unregistration. Only genuinely new keys (refCount 0 → 1) trigger a fetch — a
 *  second widget subscribing to a place the store already knows about costs nothing
 *  but a refcount bump. */
function registerCoords(coords: Coord[]): string[] {
  const unique = dedupeCoords(coords);
  const keys: string[] = [];
  let sawNew = false;
  for (const c of unique) {
    const key = coordKey(c.lat, c.lon);
    keys.push(key);
    const prev = refCount.get(key) ?? 0;
    refCount.set(key, prev + 1);
    if (prev === 0) {
      coordOf.set(key, c);
      sawNew = true;
    }
  }
  if (sawNew) scheduleFetch();
  return keys;
}

function unregisterCoords(keys: string[]) {
  for (const key of keys) {
    const next = (refCount.get(key) ?? 1) - 1;
    if (next <= 0) {
      refCount.delete(key);
      coordOf.delete(key);
    } else {
      refCount.set(key, next);
    }
  }
}

export interface PointWeatherResult {
  data: Map<string, PointWeather>;
  failed: boolean;
  loading: boolean;
}

const EMPTY_RESULT: PointWeatherResult = { data: new Map(), failed: false, loading: false };

/**
 * Subscribe this component's coordinates into the shared board-wide weather store.
 *
 * Pass EVERY coordinate the caller's playlist can rotate through, not only the one
 * currently on screen — see the file header. Coordinates are deduplicated and
 * ref-counted; the underlying fetch fires at most once per 200ms debounce window
 * and refreshes every ten minutes while the tab is visible.
 */
export function usePointWeather(coords: Coord[]): PointWeatherResult {
  // A stable string identity for "this exact set of places", independent of the
  // caller's array identity (a fresh literal every render is normal React). The
  // subscribe function and the memoized snapshot both key off this rather than
  // `coords` itself, so an unchanged place set does not resubscribe or re-render.
  const key = useMemo(() => dedupeCoords(coords).map((c) => coordKey(c.lat, c.lon)).join(";"), [coords]);

  const subscribe = useMemo(() => {
    const forSub = key ? key.split(";").map((k) => {
      const [lat, lon] = k.split(",").map(Number);
      return { lat, lon };
    }) : [];
    return (cb: () => void) => {
      listeners.add(cb);
      activeSubscribers += 1;
      const keys = registerCoords(forSub);
      ensureRunning();
      return () => {
        listeners.delete(cb);
        activeSubscribers -= 1;
        unregisterCoords(keys);
        maybeStop();
      };
    };
    // key alone fully determines forSub's contents (coordKey-rounded lat/lon pairs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Memoized so getSnapshot returns a referentially stable object between store
  // changes — useSyncExternalStore requires that to avoid an infinite render loop.
  // Held in a ref (not module state) because it is specific to THIS hook call's
  // coordinate set, unlike `weatherMap` itself.
  const cacheRef = useRef<{ version: number; key: string; result: PointWeatherResult } | null>(null);

  const getSnapshot = () => {
    if (!key) return EMPTY_RESULT;
    const cached = cacheRef.current;
    if (cached && cached.version === version && cached.key === key) return cached.result;
    const keys = key.split(";");
    const data = new Map<string, PointWeather>();
    let loading = false;
    for (const k of keys) {
      const pw = weatherMap.get(k);
      if (pw) data.set(k, pw);
      else loading = true;
    }
    const result: PointWeatherResult = { data, failed: lastFailed, loading };
    cacheRef.current = { version, key, result };
    return result;
  };

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_RESULT);
}
