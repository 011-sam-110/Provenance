"use client";
// Per-SIGNAL-layer freshness — the trust spine for the opt-in global feeds.
//
// lib/freshness.ts covers the four core layers (cameras/planes/satellites/webcams);
// its own note calls a per-adapter monitor "the documented next step". This is that
// step for the signals registry: each <SignalFeed> records the age + outcome of its
// last fetch here, keyed by the (dynamic) registry source id, and the rail shows an
// honest dot beside every signal layer. The classifier is pure and unit-tested.
//
// The honest "empty" state matters: a feed that fetched successfully but returned
// nothing (NHC cyclones in the quiet season, no active military flights) is NOT
// stale or broken — it's "live · none right now". Saying so is the whole point of
// a no-dead-feeds product.

import { useSyncExternalStore } from "react";

export type SignalFreshState = "unknown" | "live" | "empty" | "lagging" | "stale" | "down";

export interface SignalFreshRecord {
  /** Epoch ms of the last completed fetch (success or failure), or null before the first. */
  lastUpdate: number | null;
  /** Did the last fetch succeed (HTTP ok, no throw)? */
  ok: boolean;
  /** Feature count from the last successful fetch. */
  count: number;
  /** The source's expected cadence; live/lagging/stale thresholds are multiples of it. */
  refreshMs: number;
}

/** Pure age (ms) since the last fetch, or null if never fetched. */
export function signalFreshAgeMs(r: SignalFreshRecord, now: number): number | null {
  return r.lastUpdate == null ? null : Math.max(0, now - r.lastUpdate);
}

/** Pure classifier — unit tested. Empty (fetched-OK-but-zero) is a first-class, honest state. */
export function classifySignalFreshness(r: SignalFreshRecord, now: number): SignalFreshState {
  if (!r.ok) return "down";
  if (r.lastUpdate == null) return "unknown";
  const age = Math.max(0, now - r.lastUpdate);
  if (age >= r.refreshMs * 6) return "stale";
  if (r.count <= 0) return "empty"; // connected, nothing to show right now
  if (age >= r.refreshMs * 2) return "lagging";
  return "live";
}

/**
 * What to record for one /api/signals/<id> response.
 *
 * The route publishes the adapter's own `ok` (lib/signals/outcome.ts), but a 200
 * used to be recorded as success regardless — so a layer answering
 * `{ok:false, degradedReason:"no key", count:0}` classified as "empty" and the rail
 * said "live · none right now" about a feed that never read anything.
 *
 * A failure that still carries rows is deliberately left as it was. Those rows can
 * be fresh (gdacs "partial: VO failed" with 36 current events) or last-good
 * (`degradedWith`), and "unavailable" is the wrong word for both. That case needs
 * its own state, not this function.
 */
export function signalFreshnessFromPayload(d: { ok?: boolean; count: number }): { ok: boolean; count: number } {
  return { ok: d.ok === true || d.count > 0, count: d.count };
}

/** Pure short label for a freshness state, given the age text. */
export function signalFreshLabel(state: SignalFreshState, ageText: string): string {
  switch (state) {
    case "unknown": return "connecting…";
    case "down": return "unavailable";
    case "empty": return "live · none right now";
    case "stale": return `stale · ${ageText} old`;
    case "lagging": return `updated ${ageText} ago`;
    case "live": return `updated ${ageText} ago`;
  }
}

// --- store (keyed by dynamic signal id; mirrors signalCountsStore) ----------

let records: Record<string, { lastUpdate: number; ok: boolean; count: number }> = {};
const listeners = new Set<() => void>();

export const signalFreshnessStore = {
  record(id: string, update: { ok: boolean; count: number }, at: number = Date.now()) {
    records = { ...records, [id]: { lastUpdate: at, ok: update.ok, count: update.count } };
    for (const l of listeners) l();
  },
  clear(id: string) {
    if (!(id in records)) return;
    const next = { ...records };
    delete next[id];
    records = next;
    for (const l of listeners) l();
  },
  get(): Record<string, { lastUpdate: number; ok: boolean; count: number }> {
    return records;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useSignalFreshness(): Record<string, { lastUpdate: number; ok: boolean; count: number }> {
  return useSyncExternalStore(signalFreshnessStore.subscribe, signalFreshnessStore.get, signalFreshnessStore.get);
}
