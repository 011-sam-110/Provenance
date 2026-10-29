// A PREVIEW of a switched-off source: what the Sources rail shows while you point at a
// row (or a section heading) whose source is off.
//
// The marks are drawn exactly as they would be if the source were on, the rest of the
// map fades (lib/map/sourceHighlight.ts), and the preview goes when the hover ends. The
// source stays off.
//
// THE ONE HARD RULE. A preview writes NOTHING that outlives it or that anything else
// reads: not the layer toggles, not the saved board, not the layout, not the link, not
// the counts and freshness chips in the top bar. This module holds its own cache and
// its own statuses and imports no store (tests/unit/source-preview.test.ts reads this
// file and fails if one appears). WorldMap reads it, draws from it, and still owns the
// map.
//
// WHY THE EXISTING FEEDS ARE NOT MOUNTED FOR IT. <SignalFeed> crops through the rings of
// the areas that asked for the source, and for a source that is on nowhere that list is
// empty, so it would draw nothing. It also writes the counts and freshness stores, and
// so do the camera and webcam feeds. A preview reads the same ROUTES the layer reads,
// through the same validator (readMapSignal), and WorldMap turns the rows into marks
// with the same function the layer uses (lib/map/signalObjects.ts).
//
// COST, as measured on production on 2026-10-29: a signal read is 11 KB gzipped at the
// median (cables, the largest, is 324 KB), 0.18 s warm and 1.0 s cold, and the server
// already caches each source for its cadence. So:
//   - a preview waits for 250 ms of rest before it reads, so a sweep down the list reads
//     nothing; a tap or a keyboard focus reads at once;
//   - one read per source is ever in flight, and a read that is still running when the
//     hover ends finishes into the cache, so the next hover is instant;
//   - the cache holds 5 minutes and the last 12 sources (never one that is wanted now);
//   - a read gives up after 20 s, and a failure is held for 30 s before the next hover
//     asks again.
// Live cams and Static cams read /api/cameras (1.3 MB gzipped, 43,831 cameras), and
// drawing them costs a 123 ms long task, so they preview on desktop only.

import type { LayerState } from "@/lib/layers";
import type { SignalFeature } from "@/lib/signals/types";
import { readMapSignal, type MapSignalRead } from "@/lib/signals/mapFeedPoll";
import { loadWebcamCatalogue } from "@/lib/webcams/tileLoad";

export type PreviewKind = "signal" | "cameras" | "planes" | "satellites" | "countries";

export type PreviewStatus = "idle" | "waiting" | "loading" | "ready" | "empty" | "failed" | "unavailable";

/** One row of /api/cameras, the fields the map reads. */
export interface PreviewCamera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  available: boolean;
  source: string;
  country: string;
  live: boolean;
}

/** One Windy webcam from the harvested catalogue. */
export interface PreviewWebcam {
  id: string;
  title: string;
  lat: number;
  lon: number;
  country?: string;
  region?: string;
  available?: boolean;
  detailUrl?: string;
}

/** Which kind of source a Sources rail id is. */
export function kindOf(id: string): PreviewKind {
  switch (id) {
    case "livecams":
    case "staticcams":
      return "cameras";
    case "planes":
      return "planes";
    case "satellites":
      return "satellites";
    case "countries":
      return "countries";
    default:
      return "signal";
  }
}

/** The console's phone pass: a coarse pointer on a screen no wider than 900 px. */
export function isPhoneClass({ coarsePointer, width }: { coarsePointer: boolean; width: number }): boolean {
  return coarsePointer && width <= 900;
}

/** Cameras do not preview on a phone: 43,831 rows are a half-second stall there. */
export function previewAllowed(id: string, { phone }: { phone: boolean }): boolean {
  return !(phone && kindOf(id) === "cameras");
}

/** A section heading previews every row that has a map layer, on or off. */
export function previewIdsForSection(rows: ReadonlyArray<{ id: string; widgetOnly?: boolean }>): string[] {
  return rows.filter((r) => !r.widgetOnly).map((r) => r.id);
}

/**
 * The layer toggles with the previewed core keys forced on. For drawing and for layer
 * visibility ONLY: the result must never reach the layers store.
 */
export function withPreview(layers: LayerState, keys: readonly string[]): LayerState {
  if (keys.length === 0) return layers;
  const next: Record<string, boolean> = { ...(layers as unknown as Record<string, boolean>) };
  for (const k of keys) if (k in next) next[k] = true;
  return next as unknown as LayerState;
}

export interface WantOptions {
  /** A tap or a keyboard focus: read now, with no 250 ms rest. */
  immediate?: boolean;
  /** The console's phone pass (isPhoneClass). */
  phone?: boolean;
  /** The map already draws this id (its toggle is on in World or an area): never previewed. */
  isDrawn?: (id: string) => boolean;
  /** The rows are already loaded here (the other camera tier is on): no read is needed. */
  have?: (id: string) => boolean;
  /** The map has zoomed past the Windy tier's floor, so Static cams also reads webcams. */
  webcamsArmed?: boolean;
}

export interface SourcePreviewOptions {
  readSignal: (id: string, signal: AbortSignal) => Promise<MapSignalRead>;
  readCameras: (signal: AbortSignal) => Promise<PreviewCamera[]>;
  readWebcams: (signal: AbortSignal) => Promise<PreviewWebcam[]>;
  restMs?: number;
  ttlMs?: number;
  max?: number;
  timeoutMs?: number;
  /** How long a failed read is left alone before the next hover asks again. */
  failHoldMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** The animation frame, injectable so a test can drive it. Defaults to the window's. */
  requestFrame?: (fn: () => void) => unknown;
  cancelFrame?: (handle: unknown) => void;
}

export interface SourcePreview {
  /** Replace the set of ids the pointer is on. [] ends every preview. */
  want(ids: readonly string[], opts?: WantOptions): void;
  status(id: string): PreviewStatus;
  /** What a row shows: the status while the pointer is on it (or its heading), idle otherwise. */
  shown(id: string): PreviewStatus;
  /** The cached rows of a signal id, or "cameras" / "webcams"; undefined when stale or absent. */
  data(id: string): unknown;
  /** Planes and satellites come from WorldMap's own feeds, which report back through here. */
  setStatus(id: string, status: PreviewStatus): void;
  /** The ids being previewed now: wanted, not already drawn. A new array only when it changes. */
  wanted(): readonly string[];
  subscribe(fn: () => void): () => void;
  /**
   * Like subscribe, but called at most ONCE PER ANIMATION FRAME however many changes
   * landed in it. WorldMap draws from this, so several reads that arrive together cost
   * one React update. Only an event schedules a frame, never a clock, so a map at rest
   * runs none.
   */
  subscribeFrame(fn: () => void): () => void;
  /** Ask the frame subscribers to run on the next frame (something they read has changed). */
  poke(): void;
}

interface Entry {
  at: number;
  data: unknown;
  count: number;
}

const keyOf = (id: string): string => (kindOf(id) === "cameras" ? "cameras" : id);

export function createSourcePreview(opts: SourcePreviewOptions): SourcePreview {
  const restMs = opts.restMs ?? 250;
  const ttlMs = opts.ttlMs ?? 300_000;
  const max = opts.max ?? 12;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const failHoldMs = opts.failHoldMs ?? 30_000;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const cache = new Map<string, Entry>(); // insertion order is the LRU order
  const inflight = new Set<string>();
  const failedAt = new Map<string, number>();
  const rest = new Map<string, unknown>();
  const feeds = new Map<string, { status: PreviewStatus; at: number }>();
  const feedTimers = new Map<string, unknown>();
  const haveIds = new Set<string>();
  const unavailable = new Set<string>();
  let wantedList: readonly string[] = [];
  let wantedKeys = new Set<string>();
  const subs = new Set<() => void>();
  const frameSubs = new Set<() => void>();
  const requestFrame =
    opts.requestFrame ??
    ((fn: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16)));
  const cancelFrame =
    opts.cancelFrame ??
    ((h: unknown) =>
      typeof cancelAnimationFrame === "function"
        ? cancelAnimationFrame(h as number)
        : clearTimeout(h as ReturnType<typeof setTimeout>));
  let frame: unknown = null;

  const poke = () => {
    if (frame !== null || frameSubs.size === 0) return;
    frame = requestFrame(() => {
      frame = null;
      for (const fn of [...frameSubs]) fn();
    });
  };

  const notify = () => {
    for (const fn of [...subs]) fn();
    poke();
  };

  const fresh = (key: string): Entry | undefined => {
    const e = cache.get(key);
    return e && now() - e.at < ttlMs ? e : undefined;
  };

  const touch = (key: string, e: Entry) => {
    cache.delete(key);
    cache.set(key, e);
  };

  const store = (key: string, e: Entry) => {
    touch(key, e);
    // Oldest first, but never an entry that is wanted right now: a heading that
    // previews 13 sources must not lose the first while the last is still arriving.
    for (const k of [...cache.keys()]) {
      if (cache.size <= max) break;
      if (!wantedKeys.has(k)) cache.delete(k);
    }
  };

  const failedRecently = (key: string): boolean => {
    const t = failedAt.get(key);
    return t !== undefined && now() - t < failHoldMs;
  };

  const run = (key: string, signal: AbortSignal): Promise<{ data: unknown; count: number } | null> => {
    if (key === "cameras") return opts.readCameras(signal).then((rows) => ({ data: rows, count: rows.length }));
    if (key === "webcams") return opts.readWebcams(signal).then((rows) => ({ data: rows, count: rows.length }));
    return opts.readSignal(key, signal).then((r) => (r.ok ? { data: r.features as SignalFeature[], count: r.features.length } : null));
  };

  const start = (key: string) => {
    if (inflight.has(key)) return;
    inflight.add(key);
    const ctrl = new AbortController();
    let done = false;
    const finish = (r: { data: unknown; count: number } | null) => {
      if (done) return;
      done = true;
      clearTimer(timer);
      inflight.delete(key);
      if (r) {
        failedAt.delete(key);
        store(key, { at: now(), data: r.data, count: r.count });
      } else {
        failedAt.set(key, now());
      }
      notify();
    };
    const timer = setTimer(() => {
      ctrl.abort();
      finish(null); // a read that never answers is a failure
    }, timeoutMs);
    run(key, ctrl.signal).then(finish, () => finish(null));
  };

  const ensureRead = (key: string, immediate: boolean) => {
    const hit = fresh(key);
    if (hit) {
      touch(key, hit);
      return;
    }
    if (inflight.has(key)) return;
    if (failedRecently(key)) return;
    const pending = rest.get(key);
    if (pending !== undefined) {
      if (!immediate) return;
      clearTimer(pending);
      rest.delete(key);
    }
    if (immediate) {
      start(key);
      return;
    }
    rest.set(
      key,
      setTimer(() => {
        rest.delete(key);
        start(key);
        notify();
      }, restMs),
    );
  };

  const startFeed = (id: string, immediate: boolean) => {
    const f = feeds.get(id);
    if (f && f.status === "ready" && now() - f.at < ttlMs) return;
    if (f && f.status === "loading") return;
    if (f && f.status === "failed" && now() - f.at < failHoldMs) return;
    const go = () => {
      rest.delete(id);
      feeds.set(id, { status: "loading", at: now() });
      feedTimers.set(
        id,
        setTimer(() => {
          feedTimers.delete(id);
          if (feeds.get(id)?.status === "loading") {
            feeds.set(id, { status: "failed", at: now() });
            notify();
          }
        }, timeoutMs),
      );
      notify();
    };
    const pending = rest.get(id);
    if (pending !== undefined) {
      if (!immediate) return;
      clearTimer(pending);
      rest.delete(id);
    }
    if (immediate) go();
    else rest.set(id, setTimer(go, restMs));
  };

  const statusOf = (id: string): PreviewStatus => {
    if (unavailable.has(id)) return "unavailable";
    if (haveIds.has(id)) return "ready";
    const kind = kindOf(id);
    if (kind === "countries") return wantedList.includes(id) ? "ready" : "idle";
    if (kind === "planes" || kind === "satellites") {
      const f = feeds.get(id);
      if (f && (f.status !== "ready" || now() - f.at < ttlMs)) return f.status;
      return rest.has(id) ? "waiting" : "idle";
    }
    const key = keyOf(id);
    const hit = fresh(key);
    if (hit) return hit.count > 0 ? "ready" : "empty";
    if (inflight.has(key)) return "loading";
    if (rest.has(key)) return "waiting";
    return failedRecently(key) ? "failed" : "idle";
  };

  return {
    want(ids, o = {}) {
      const isDrawn = o.isDrawn ?? (() => false);
      const phone = o.phone ?? false;
      const immediate = o.immediate ?? false;
      unavailable.clear();
      haveIds.clear();
      const next: string[] = [];
      for (const id of ids) if (!isDrawn(id)) next.push(id);
      const wantsWebcams = !!o.webcamsArmed && next.includes("staticcams") && previewAllowed("staticcams", { phone });
      const keys = new Set<string>(next.map(keyOf));
      if (wantsWebcams) keys.add("webcams");
      // A rest timer for something no longer wanted is cancelled; a read in flight is not.
      for (const [k, h] of [...rest]) {
        if (!keys.has(k)) {
          clearTimer(h);
          rest.delete(k);
        }
      }
      const changed = next.length !== wantedList.length || next.some((id, i) => id !== wantedList[i]);
      if (changed) wantedList = next;
      wantedKeys = keys;
      for (const id of next) {
        const kind = kindOf(id);
        if (!previewAllowed(id, { phone })) {
          unavailable.add(id);
          continue;
        }
        if (kind === "countries") continue;
        if (kind === "planes" || kind === "satellites") {
          startFeed(id, immediate);
          continue;
        }
        if (kind === "cameras" && o.have?.(id)) haveIds.add(id);
        else ensureRead(keyOf(id), immediate);
      }
      if (wantsWebcams) ensureRead("webcams", immediate);
      notify();
    },

    status: statusOf,

    shown(id) {
      return wantedList.includes(id) ? statusOf(id) : "idle";
    },

    data(id) {
      return fresh(keyOf(id))?.data;
    },

    setStatus(id, status) {
      const t = feedTimers.get(id);
      if (t !== undefined) {
        clearTimer(t);
        feedTimers.delete(id);
      }
      feeds.set(id, { status, at: now() });
      notify();
    },

    wanted: () => wantedList,

    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },

    subscribeFrame(fn) {
      frameSubs.add(fn);
      return () => {
        frameSubs.delete(fn);
        if (frameSubs.size === 0 && frame !== null) {
          cancelFrame(frame);
          frame = null;
        }
      };
    },

    poke,
  };
}

/** /api/cameras with `cache: "no-store"`, for the reason WorldMap's CamerasFeed gives. */
async function readCamerasFromRoute(signal: AbortSignal): Promise<PreviewCamera[]> {
  const res = await fetch("/api/cameras", { cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = (await res.json()) as { cameras?: PreviewCamera[] };
  return d.cameras ?? [];
}

/** The harvested Windy catalogue, or the live sample when this deployment has none. */
async function readWebcamsFromCatalogue(signal: AbortSignal): Promise<PreviewWebcam[]> {
  const fetchJson = async (url: string) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  };
  const harvested = await loadWebcamCatalogue({
    fetchJson,
    alive: () => !signal.aborted,
    onProgress: () => {},
  });
  if (harvested) return harvested.webcams as unknown as PreviewWebcam[];
  const d = (await fetchJson("/api/webcams")) as { webcams?: PreviewWebcam[] };
  return d.webcams ?? [];
}

export const sourcePreviewStore: SourcePreview = createSourcePreview({
  readSignal: (id, signal) => readMapSignal(id, (url, init) => fetch(url, { ...init, signal })),
  readCameras: readCamerasFromRoute,
  readWebcams: readWebcamsFromCatalogue,
});
