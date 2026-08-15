"use client";
// Day history — a per-stream ring buffer, in IndexedDB, of frames the user's own
// browser already fetched for a camera-slot playlist. Frames never reach our
// servers, so no operator imagery is re-hosted — the promise app/cameras/page.tsx
// already makes in writing.
//
// WHAT THIS CANNOT BE, and the code below is shaped around admitting it:
//   - lib/shell/visibility.ts stops polling a hidden tab, and Chrome throttles
//     background tabs regardless, so A BACKGROUNDED BOARD RECORDS NOTHING.
//   - With N streams sharing one rotating slot, each is on screen only 1/N of the
//     time, so capture is sparse BY CONSTRUCTION — see buildDayStrip, which returns
//     an explicit gap (ts: null) for any bucket with nothing in it. Never
//     interpolated, never smoothed into a continuous day.
//   - IndexedDB shares the origin's best-effort storage bucket with localStorage,
//     which lib/shell/persist.ts uses for every other saved board. A feature that
//     fills that bucket is a feature that silently breaks board persistence
//     elsewhere (persist.ts swallows QuotaExceededError in a bare catch{}). So this
//     module enforces its OWN hard byte ceiling — measured in bytes stored, because
//     frame size varies ~80x across sources (a TfL frame is ~15 KB, an Estonian one
//     ~596 KB) — and evicts BEFORE writing, never on failure.
//
// PURE FUNCTIONS FIRST (dedupe decision, eviction selection, day-strip bucketing):
// no IndexedDB in the node vitest environment, so the actual decisions this module
// makes are written to be testable without one. The IndexedDB glue below them is
// the untested adapter, same split as lib/shell/persist.ts (envelope logic tested,
// window.localStorage resolution is not).

import { useEffect, useState, useSyncExternalStore } from "react";
import { frameBucket } from "@/lib/cameras/freshness";
import { isHidden } from "@/lib/shell/visibility";
import { streamKey, type StreamRef } from "@/lib/console/widgets/camslot.model";

export interface FrameFingerprint {
  etag: string | null;
  contentLength: number | null;
}

export interface FrameMeta extends FrameFingerprint {
  id: number;
  streamKey: string;
  ts: number;
  bytes: number;
}

export interface StripBucket {
  start: number;
  end: number;
  ts: number | null;
}

/**
 * Well under any plausible per-origin quota (Chrome's is normally hundreds of MB
 * at minimum) — deliberately conservative, because the failure mode of guessing
 * too high is every saved board silently losing its persistence, and the failure
 * mode of guessing too low is a shorter day strip. The second is fine.
 */
export const HISTORY_CEILING_BYTES = 8 * 1024 * 1024;
/** The strip UI divides its window into this many slots. */
export const DEFAULT_STRIP_BUCKETS = 48;

/**
 * Is `next` the same frame as the one already stored last for this stream? Prefers
 * ETag (a strong identity from the origin); falls back to Content-Length when a
 * source's proxy response carries no ETag. Without this, ~84 byte-identical
 * duplicates an hour fill the ring and LRU-evict the genuine morning to make room
 * for repeats of the same frame.
 */
export function isDuplicateFrame(
  prev: FrameFingerprint | undefined,
  next: FrameFingerprint,
): boolean {
  if (!prev) return false;
  if (prev.etag != null && next.etag != null) return prev.etag === next.etag;
  if (prev.contentLength != null && next.contentLength != null) {
    return prev.contentLength === next.contentLength;
  }
  return false;
}

/**
 * Which existing frames (oldest first, across every stream — one shared ring, not
 * one per camera) must be evicted so `usedBytes + incomingBytes` fits under
 * `ceilingBytes`. Eviction happens BEFORE the write it is making room for, per the
 * spec's "evict before writing rather than on failure" requirement — the caller
 * never finds out about a quota problem from a failed write.
 *
 * `blocked: true` means the ceiling cannot admit this frame even after evicting
 * everything (i.e. a single frame bigger than the whole ceiling) — the caller must
 * refuse the write rather than silently wiping the entire buffer for one frame.
 */
export function selectEvictions(
  existing: FrameMeta[],
  usedBytes: number,
  incomingBytes: number,
  ceilingBytes: number,
): { evict: number[]; blocked: boolean } {
  if (incomingBytes > ceilingBytes) return { evict: [], blocked: true };
  if (usedBytes + incomingBytes <= ceilingBytes) return { evict: [], blocked: false };

  const oldestFirst = [...existing].sort((a, b) => a.ts - b.ts);
  const evict: number[] = [];
  let remaining = usedBytes;
  for (const f of oldestFirst) {
    if (remaining + incomingBytes <= ceilingBytes) break;
    evict.push(f.id);
    remaining -= f.bytes;
  }
  return { evict, blocked: remaining + incomingBytes > ceilingBytes };
}

/**
 * Divide [sinceMs, nowMs) into `bucketCount` equal windows and place the LATEST
 * captured frame timestamp falling in each one — a bucket with nothing captured is
 * an explicit gap (`ts: null`), never filled in from a neighbour. This is what
 * keeps the strip honest about a store that is sparse by construction: a gap reads
 * as "no view was captured then", not as a flat line implying continuity.
 */
export function buildDayStrip(
  frameTimestamps: number[],
  sinceMs: number,
  nowMs: number,
  bucketCount: number,
): StripBucket[] {
  const span = Math.max(1, nowMs - sinceMs);
  const count = Math.max(1, Math.floor(bucketCount));
  const width = span / count;

  const buckets: StripBucket[] = Array.from({ length: count }, (_, i) => ({
    start: sinceMs + i * width,
    end: sinceMs + (i + 1) * width,
    ts: null,
  }));

  for (const ts of frameTimestamps) {
    if (ts < sinceMs || ts > nowMs) continue;
    const idx = Math.min(count - 1, Math.floor((ts - sinceMs) / width));
    const b = buckets[idx];
    if (b.ts == null || ts > b.ts) b.ts = ts;
  }
  return buckets;
}

// ── IndexedDB adapter — untested (no IndexedDB in the node vitest environment). ──
// Everything above this line is what decides what happens; everything below it is
// plumbing that carries the decision out. Two object stores, not one: `meta` holds
// the small, indexed rows the strip reads constantly, and `blobs` holds the actual
// frame bytes, so listing a day's worth of history never touches image bytes.

const DB_NAME = "tn.camslot.history";
const DB_VERSION = 1;
const META_STORE = "meta";
const BLOB_STORE = "blobs";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        const meta = db.createObjectStore(META_STORE, { keyPath: "id", autoIncrement: true });
        meta.createIndex("byStream", "streamKey");
        meta.createIndex("byTs", "ts");
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    // Private browsing, a disabled storage permission, an old browser — dormant,
    // not fatal. The wall and the picker never depend on this module existing.
    req.onerror = () => resolve(null);
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
function getDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function readAllMeta(db: IDBDatabase): Promise<FrameMeta[]> {
  return new Promise((resolve) => {
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).getAll();
    req.onsuccess = () => resolve((req.result as FrameMeta[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

export interface HistoryStatus {
  /** True once the ceiling has refused a frame at least once this session. */
  pausedFull: boolean;
  usedBytes: number;
}

let status: HistoryStatus = { pausedFull: false, usedBytes: 0 };
const statusListeners = new Set<() => void>();
function setStatus(next: Partial<HistoryStatus>): void {
  status = { ...status, ...next };
  for (const fn of statusListeners) fn();
}

/** Read-only status store, `useSyncExternalStore`-shaped (matches camslotPrefs). */
export const historyStatusStore = {
  get: (): HistoryStatus => status,
  subscribe: (fn: () => void): (() => void) => {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
  },
};

// In-memory bookkeeping so every capture doesn't re-scan the whole meta store.
// Rebuilt once, lazily, from IndexedDB on first use per session.
let indexPromise: Promise<{ meta: FrameMeta[]; usedBytes: number }> | null = null;
function getIndex(db: IDBDatabase): Promise<{ meta: FrameMeta[]; usedBytes: number }> {
  if (!indexPromise) {
    indexPromise = readAllMeta(db).then((meta) => {
      const usedBytes = meta.reduce((sum, m) => sum + m.bytes, 0);
      setStatus({ usedBytes });
      return { meta, usedBytes };
    });
  }
  return indexPromise;
}

// Last fingerprint seen per stream, so dedupe never needs a DB round trip on the
// common case (this stream's own last capture, still in memory from last tick).
const lastFingerprint = new Map<string, FrameFingerprint>();

/**
 * Record one captured frame for `key` if it is not a duplicate of the last one
 * stored for that stream, evicting the oldest frames first if needed to stay under
 * the byte ceiling. Never throws — a failed capture is silently skipped, the same
 * dormant-safe contract every upstream fetch in this repo follows.
 */
async function recordFrame(key: string, res: Response, ts: number): Promise<void> {
  if (!res.ok) return;
  const etag = res.headers.get("etag");
  const lenHeader = res.headers.get("content-length");
  const contentLength = lenHeader != null && lenHeader !== "" ? Number(lenHeader) : null;
  const fp: FrameFingerprint = {
    etag: etag || null,
    contentLength: contentLength != null && Number.isFinite(contentLength) ? contentLength : null,
  };
  if (isDuplicateFrame(lastFingerprint.get(key), fp)) return;

  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    return;
  }
  const bytes = blob.size;
  if (bytes <= 0) return;

  const db = await getDb();
  if (!db) return;
  const { meta, usedBytes } = await getIndex(db);

  const { evict, blocked } = selectEvictions(meta, usedBytes, bytes, HISTORY_CEILING_BYTES);
  if (blocked) {
    setStatus({ pausedFull: true });
    return;
  }

  await new Promise<void>((resolve) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    const metaStore = tx.objectStore(META_STORE);
    const blobStore = tx.objectStore(BLOB_STORE);
    for (const id of evict) {
      metaStore.delete(id);
      blobStore.delete(id);
    }
    const row: Omit<FrameMeta, "id"> = { streamKey: key, ts, bytes, etag: fp.etag, contentLength: fp.contentLength };
    const addReq = metaStore.add(row);
    addReq.onsuccess = () => {
      blobStore.put({ id: addReq.result as number, blob });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });

  // Keep the in-memory index in step so the next capture doesn't re-read the DB.
  const evictSet = new Set(evict);
  const survivors = meta.filter((m) => !evictSet.has(m.id));
  const evictedBytes = meta.filter((m) => evictSet.has(m.id)).reduce((s, m) => s + m.bytes, 0);
  const nextMeta = [...survivors, { id: -1, streamKey: key, ts, bytes, etag: fp.etag, contentLength: fp.contentLength }];
  const nextUsed = usedBytes - evictedBytes + bytes;
  indexPromise = Promise.resolve({ meta: nextMeta, usedBytes: nextUsed });
  setStatus({ usedBytes: nextUsed, pausedFull: false });

  lastFingerprint.set(key, fp);
}

/**
 * Frame timestamps captured for `key` since `sinceMs` — metadata only, no blob
 * bytes, so this is cheap to call whenever the strip needs to redraw.
 */
export async function getFrameTimestamps(key: string, sinceMs: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(META_STORE, "readonly");
    const idx = tx.objectStore(META_STORE).index("byStream");
    const req = idx.getAll(IDBKeyRange.only(key));
    req.onsuccess = () => {
      const rows = (req.result as FrameMeta[]) ?? [];
      resolve(rows.filter((r) => r.ts >= sinceMs).map((r) => r.ts));
    };
    req.onerror = () => resolve([]);
  });
}

/** The stored frame nearest `ts` for `key`, as an object URL — caller must revoke it. */
export async function getFrameNear(key: string, ts: number): Promise<{ url: string; ts: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows: FrameMeta[] = await new Promise((resolve) => {
    const tx = db.transaction(META_STORE, "readonly");
    const idx = tx.objectStore(META_STORE).index("byStream");
    const req = idx.getAll(IDBKeyRange.only(key));
    req.onsuccess = () => resolve((req.result as FrameMeta[]) ?? []);
    req.onerror = () => resolve([]);
  });
  if (rows.length === 0) return null;
  const nearest = rows.reduce((a, b) => (Math.abs(a.ts - ts) <= Math.abs(b.ts - ts) ? a : b));

  const blob: Blob | null = await new Promise((resolve) => {
    const tx = db.transaction(BLOB_STORE, "readonly");
    const req = tx.objectStore(BLOB_STORE).get(nearest.id);
    req.onsuccess = () => resolve((req.result as { blob: Blob } | undefined)?.blob ?? null);
    req.onerror = () => resolve(null);
  });
  if (!blob) return null;
  return { url: URL.createObjectURL(blob), ts: nearest.ts };
}

/**
 * URL a capture fetch should use for a stream — the exact same URL the widget's
 * own <img> requests, so this shares the CDN entry `frameBucket` was built to
 * create rather than opening a second one. Video refs have no still frame.
 */
export function captureUrl(ref: StreamRef, nowMs: number, refreshSeconds: number): string | null {
  if (ref.k === "cam") return `/api/proxy?id=${encodeURIComponent(ref.id)}&_=${frameBucket(nowMs, refreshSeconds)}`;
  if (ref.k === "webcam") return `/api/webcam-image?id=${encodeURIComponent(ref.id)}`;
  return null;
}

/**
 * Capture frames for one stream while `active`. Ticks on the same refresh-window
 * boundary as the visible <img> (frameBucket), so this piggybacks the browser's own
 * HTTP cache for that URL rather than forcing a second origin fetch — the widget's
 * own image tag has almost always already primed it. Skips entirely while the tab
 * is hidden (visibility.ts) or `active` is false, and does nothing for a YouTube
 * ref — an iframe is opaque, there is no still frame to capture.
 *
 * Call this from wherever a stream is actually being displayed (the wall tile, and
 * the focus view below). It is safe to call it for the same stream from more than
 * one place at once — dedupe means the second caller's fetch just confirms the
 * cache, not a real second request most of the time, and never a second DB write.
 */
export function recordVisibleFrame(ref: StreamRef, refreshSeconds: number, active: boolean): void {
  if (!active || ref.k === "yt" || isHidden()) return;
  const url = captureUrl(ref, Date.now(), refreshSeconds);
  if (!url) return;
  const key = streamKey(ref);
  const ts = Date.now();
  fetch(url, { cache: "force-cache" })
    .then((res) => recordFrame(key, res, ts))
    .catch(() => {});
}

/** Test-only: reset module singletons between tests. */
export function __resetHistoryForTests(): void {
  dbPromise = null;
  indexPromise = null;
  lastFingerprint.clear();
  status = { pausedFull: false, usedBytes: 0 };
}

// ── React hooks — thin glue over the above, kept out of the pure-function tests. ──

/** Subscribes to the shared quota/usage status (the "history paused" banner). */
export function useHistoryStatus(): HistoryStatus {
  return useSyncExternalStore(historyStatusStore.subscribe, historyStatusStore.get, () => ({
    pausedFull: false,
    usedBytes: 0,
  }));
}

/**
 * Captures frames for `ref` on the same cadence its own image tag refreshes, while
 * `active`. See recordVisibleFrame for what "capture" does and why it is safe to
 * call for the same stream from more than one mounted place at once (the wall tile
 * and the focus view can both hold this without double-writing).
 */
export function useHistoryRecorder(ref: StreamRef | undefined, refreshSeconds: number, active: boolean): void {
  const key = ref ? streamKey(ref) : null;
  useEffect(() => {
    if (!ref || !active || ref.k === "yt") return;
    recordVisibleFrame(ref, refreshSeconds, true);
    const t = setInterval(() => recordVisibleFrame(ref, refreshSeconds, true), Math.max(1, refreshSeconds) * 1000);
    return () => clearInterval(t);
    // `key` (not `ref`) is the real dependency — a fresh object of the same stream
    // every parent render must not restart this timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshSeconds, active]);
}

/**
 * The day strip for `ref` over the last `windowMs` (default 24h), polled every
 * `pollMs`. Reads metadata only (getFrameTimestamps), so polling stays cheap
 * however many frames are stored.
 */
export function useDayStrip(
  ref: StreamRef | undefined,
  windowMs: number = 24 * 60 * 60 * 1000,
  bucketCount: number = DEFAULT_STRIP_BUCKETS,
  pollMs: number = 15_000,
): StripBucket[] {
  const [buckets, setBuckets] = useState<StripBucket[]>([]);
  const key = ref ? streamKey(ref) : null;

  useEffect(() => {
    if (!key) {
      setBuckets([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      const now = Date.now();
      getFrameTimestamps(key, now - windowMs).then((tss) => {
        if (!cancelled) setBuckets(buildDayStrip(tss, now - windowMs, now, bucketCount));
      });
    };
    load();
    const t = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [key, windowMs, bucketCount, pollMs]);

  return buckets;
}
