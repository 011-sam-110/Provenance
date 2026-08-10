"use client";
// Shared widget data hook: fetch a signal source's features through the existing
// generic /api/signals/<id> proxy and poll on a cadence — independent of whether
// the matching map LAYER is toggled on. Dormant-safe: any failure leaves the last
// features in place and flips status to "error". Disabled (enabled=false) never
// fetches, mirroring the hidden-layer-doesn't-fetch contract.

import { useEffect, useRef, useState } from "react";
import { isHidden, onVisible, shouldRefreshOnVisible } from "@/lib/shell/visibility";
import type { SignalFeature } from "@/lib/signals/types";

export type FeedStatus = "idle" | "loading" | "error";

export interface SignalFeed {
  features: SignalFeature[];
  status: FeedStatus;
  updatedAt: number | null;
}

const DEFAULT_POLL_MS = 5 * 60_000;

export function useSignalFeatures(id: string, enabled: boolean, pollMs = DEFAULT_POLL_MS): SignalFeed {
  const [features, setFeatures] = useState<SignalFeature[]>([]);
  const [status, setStatus] = useState<FeedStatus>("idle");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // The visibility handler outlives a render, so it reads the ref, not the state.
  const lastOkRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setStatus("loading");
    const load = () => {
      fetch(`/api/signals/${encodeURIComponent(id)}`)
        // A 5xx body still parses as JSON; without this an outage looked like a
        // successful refresh and reset the freshness clock.
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => {
          if (!alive) return;
          setFeatures((d.features as SignalFeature[]) ?? []);
          setStatus("idle");
          lastOkRef.current = Date.now();
          setUpdatedAt(lastOkRef.current);
        })
        .catch(() => {
          if (alive) setStatus("error");
        });
    };
    load();
    // Skip the tick in a hidden tab; catch up on return. See lib/shell/visibility.
    const t = setInterval(() => {
      if (!isHidden()) load();
    }, pollMs);
    const unwatch = onVisible(() => {
      if (shouldRefreshOnVisible(lastOkRef.current, pollMs, Date.now())) load();
    });
    return () => {
      unwatch();
      alive = false;
      clearInterval(t);
    };
  }, [id, enabled, pollMs]);

  return { features, status, updatedAt };
}
