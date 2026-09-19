"use client";
// Per-source data freshness — the honest "is what you're seeing actually live?"
// signal that the bottom ticker and the top health badge read.
//
// This is CLIENT-OBSERVED freshness derived from the data hooks WorldMap already
// runs: it records the age of the last successful client update per layer. A
// finer per-adapter monitor (TfL vs Caltrans vs … last-success age) needs a
// server-side /api/status over the source registry — that registry is owned by
// the data layer, so it is intentionally left as the documented next step; here
// each network layer rolls up to one chip. Satellites are flagged `local` (they
// are propagated in-browser every second, so they are always live, not fetched).

import { useSyncExternalStore } from "react";

export type FreshState = "unknown" | "live" | "lagging" | "stale" | "down";
export type FreshSourceId = "cameras" | "planes" | "satellites" | "webcams";

export interface SourceRecord {
  id: FreshSourceId;
  label: string;
  count: number;
  /** Did the last update succeed? */
  ok: boolean;
  /** Epoch ms of the last successful update, or null before the first one. */
  lastUpdate: number | null;
  /** Expected cadence; the live/lagging/stale thresholds are multiples of this. */
  refreshMs: number;
  /** Computed in-browser (no network) → never goes stale on its own. */
  local: boolean;
}

const ORDER: FreshSourceId[] = ["cameras", "planes", "satellites", "webcams"];

function seed(): Record<FreshSourceId, SourceRecord> {
  return {
    // Labelled by WHAT IS FETCHED, not by a rail row: one registry request feeds both
    // the Live cams and the Static cams layers, so a chip called either of those would
    // be claiming a cadence for half a fetch.
    cameras: { id: "cameras", label: "Road cameras", count: 0, ok: true, lastUpdate: null, refreshMs: 300_000, local: false },
    planes: { id: "planes", label: "Planes", count: 0, ok: true, lastUpdate: null, refreshMs: 12_000, local: false },
    satellites: { id: "satellites", label: "Satellites", count: 0, ok: true, lastUpdate: null, refreshMs: 1_000, local: true },
    // Windy free-tier image tokens last ~10 min, so the layer re-pulls on that cadence.
    webcams: { id: "webcams", label: "Windy webcams", count: 0, ok: true, lastUpdate: null, refreshMs: 600_000, local: false },
  };
}

let map = seed();
let snapshot: SourceRecord[] = ORDER.map((id) => map[id]);
const listeners = new Set<() => void>();

function rebuild() {
  snapshot = ORDER.map((id) => map[id]);
}

export const freshnessStore = {
  record(id: FreshSourceId, update: { count: number; ok: boolean }, at: number = Date.now()) {
    map = { ...map, [id]: { ...map[id], count: update.count, ok: update.ok, lastUpdate: at } };
    rebuild();
    for (const l of listeners) l();
  },
  get(): SourceRecord[] {
    return snapshot;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Pure age (ms) since last success, or null if never updated. */
export function freshnessAgeMs(r: SourceRecord, now: number): number | null {
  return r.lastUpdate == null ? null : Math.max(0, now - r.lastUpdate);
}

/** Pure classifier — unit tested. */
export function classifyFreshness(r: SourceRecord, now: number): FreshState {
  if (!r.ok) return "down";
  if (r.local) return "live";
  if (r.lastUpdate == null) return "unknown";
  const age = now - r.lastUpdate;
  if (age < r.refreshMs * 2) return "live";
  if (age < r.refreshMs * 6) return "lagging";
  return "stale";
}

export function useFreshness(): SourceRecord[] {
  return useSyncExternalStore(freshnessStore.subscribe, freshnessStore.get, freshnessStore.get);
}
