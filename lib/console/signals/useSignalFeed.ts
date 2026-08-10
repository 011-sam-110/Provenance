"use client";
// One shared, ref-counted poller per signal id. Many widget instances can monitor
// the same source without each opening its own /api/signals/<id> loop: the first
// subscriber starts polling, the last unsubscribe stops it, and the latest
// features stay cached so a re-mounted widget shows data instantly. A thin impure
// shell — the projection logic it feeds lives in lib/console/signals/signalCard.ts.

import { useMemo, useSyncExternalStore } from "react";
import type { SignalFeature } from "@/lib/signals/types";
import type { SignalCoverage } from "@/lib/signals/coverage";
import { isHidden, onVisible, shouldRefreshOnVisible } from "@/lib/shell/visibility";

export interface SignalFeed {
  features: SignalFeature[];
  /** The adapter's truncation record, when it published one. Dropped here for a
   *  release: the cap was measured server-side and then thrown away on parse, so
   *  the UI kept printing a render cap as if it were a count. */
  coverage?: SignalCoverage;
  status: "loading" | "idle" | "error";
  /** Epoch ms of the last SUCCESSFUL load. Unchanged by a failed refresh, so it is
   *  the real answer to "how old is what I'm looking at?". */
  updatedAt: number | null;
  /** Did the most recent attempt succeed? Keeping last-good features on failure is
   *  right, but without this flag the widget cannot tell that it is doing so. */
  ok: boolean;
}

interface Entry {
  state: SignalFeed;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  /** Detaches the visibilitychange listener when the last subscriber leaves. */
  unwatch: (() => void) | null;
  refCount: number;
}

const EMPTY: SignalFeed = { features: [], status: "loading", updatedAt: null, ok: true };
const MIN_REFRESH_MS = 60_000;
const DEFAULT_REFRESH_MS = 5 * 60_000;
const feeds = new Map<string, Entry>();

function ensure(id: string): Entry {
  let e = feeds.get(id);
  if (!e) {
    e = { state: EMPTY, listeners: new Set(), timer: null, unwatch: null, refCount: 0 };
    feeds.set(id, e);
  }
  return e;
}

function emit(e: Entry) {
  for (const l of e.listeners) l();
}

function load(id: string, e: Entry) {
  fetch(`/api/signals/${encodeURIComponent(id)}`)
    .then((r) => {
      // A 5xx from our own route still parses as JSON, so without this an outage
      // counted as a successful refresh and reset the freshness clock.
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((d) => {
      const features = (d?.features as SignalFeature[]) ?? [];
      e.state = {
        features,
        coverage: (d?.coverage as SignalCoverage | undefined) ?? undefined,
        status: "idle",
        updatedAt: Date.now(),
        ok: true,
      };
      emit(e);
    })
    .catch(() => {
      // Keep the last good features; only show "error" if we never had any. Note
      // updatedAt is deliberately NOT advanced — it means "last success", and the
      // freshness chip reads it to age the widget honestly while we serve stale data.
      e.state = {
        features: e.state.features,
        coverage: e.state.coverage,
        status: e.state.updatedAt ? "idle" : "error",
        updatedAt: e.state.updatedAt,
        ok: false,
      };
      emit(e);
    });
}

/** Subscribe to a single signal source's live feature feed. */
export function useSignalFeed(signalId: string, refreshMs = DEFAULT_REFRESH_MS): SignalFeed {
  const subscribe = useMemo(
    () => (cb: () => void) => {
      const e = ensure(signalId);
      const cadence = Math.max(MIN_REFRESH_MS, refreshMs);
      e.listeners.add(cb);
      e.refCount += 1;
      if (e.refCount === 1) {
        if (!e.state.updatedAt) e.state = { ...e.state, status: "loading" };
        load(signalId, e);
        // Skip the tick in a hidden tab, and catch up on return — see lib/shell/visibility.
        e.timer = setInterval(() => {
          if (!isHidden()) load(signalId, e);
        }, cadence);
        e.unwatch = onVisible(() => {
          if (shouldRefreshOnVisible(e.state.updatedAt, cadence, Date.now())) load(signalId, e);
        });
      }
      return () => {
        e.listeners.delete(cb);
        e.refCount -= 1;
        if (e.refCount === 0) {
          if (e.timer) clearInterval(e.timer);
          e.timer = null;
          e.unwatch?.();
          e.unwatch = null;
        }
      };
    },
    [signalId, refreshMs],
  );

  const getSnapshot = useMemo(() => () => ensure(signalId).state, [signalId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
