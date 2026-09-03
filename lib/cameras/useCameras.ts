"use client";
// One shared, ref-counted poller for /api/cameras — mirrors useSignalFeed. The first
// subscriber starts a ~60s poll, the last unsubscribe stops it, and the latest list
// stays cached so a re-mounted detail shows data instantly. A fetch error keeps the
// last good list (dormant-safe: we only surface "error" if we never had any data).
//
// The /api/cameras response is enriched (Task 1), so each item is a CameraRow: a
// CameraLite (what coverage() consumes) plus the attribution / licence / refresh /
// sample fields the camera walls and dossier need. Snapshots are still fetched by id
// through /api/proxy + /api/hls, never a raw upstream URL — no URL is carried here.

import { useMemo, useSyncExternalStore } from "react";
import type { CameraLite } from "@/lib/cameras/coverage";
import type { SurfaceReading } from "@/lib/cameras/surface";

export interface CameraRow extends CameraLite {
  country: string;
  road?: string;
  refreshSeconds: number;
  attribution: string;
  license: string;
  lastSampledAt?: string;
  /** A measured road-surface state, where the network publishes one. Read it through
   *  `surfaceValidity` — a present reading is not automatically a usable one. */
  surface?: SurfaceReading;
}

export interface CamerasFeed {
  cameras: CameraRow[];
  status: "loading" | "idle" | "error";
  updatedAt: number | null;
}

interface Entry {
  state: CamerasFeed;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  refCount: number;
}

const EMPTY: CamerasFeed = { cameras: [], status: "loading", updatedAt: null };
const REFRESH_MS = 60_000;

let entry: Entry | null = null;
function ensure(): Entry {
  if (!entry) entry = { state: EMPTY, listeners: new Set(), timer: null, refCount: 0 };
  return entry;
}
function emit(e: Entry) {
  for (const l of e.listeners) l();
}

function load(e: Entry) {
  fetch("/api/cameras")
    .then((r) => r.json())
    .then((d) => {
      const cameras = (d?.cameras as CameraRow[]) ?? [];
      e.state = { cameras, status: "idle", updatedAt: Date.now() };
      emit(e);
    })
    .catch(() => {
      // Keep the last good list; only show "error" if we never had any.
      e.state = {
        cameras: e.state.cameras,
        status: e.state.updatedAt ? "idle" : "error",
        updatedAt: e.state.updatedAt,
      };
      emit(e);
    });
}

/** Subscribe to the shared, enriched /api/cameras feed for the focus view. */
export function useCameras(): CamerasFeed {
  const subscribe = useMemo(
    () => (cb: () => void) => {
      const e = ensure();
      e.listeners.add(cb);
      e.refCount += 1;
      if (e.refCount === 1) {
        if (!e.state.updatedAt) e.state = { ...e.state, status: "loading" };
        load(e);
        e.timer = setInterval(() => load(e), REFRESH_MS);
      }
      return () => {
        e.listeners.delete(cb);
        e.refCount -= 1;
        if (e.refCount === 0 && e.timer) {
          clearInterval(e.timer);
          e.timer = null;
        }
      };
    },
    [],
  );

  const getSnapshot = () => ensure().state;
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
