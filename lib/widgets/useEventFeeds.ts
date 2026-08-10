"use client";
// Fetch every EVENT_SOURCES feed through the generic /api/signals/<id> proxy on a
// cadence, accumulating the latest features per source. A thin impure shell (no
// unit test — the logic it feeds lives in lib/widgets/eventFeed.ts). Dormant-safe:
// a failed source keeps its last features; status is "error" only if ALL fail.

import { useEffect, useRef, useState } from "react";
import { isHidden, onVisible, shouldRefreshOnVisible } from "@/lib/shell/visibility";
import type { SignalFeature } from "@/lib/signals/types";
import { EVENT_SOURCES } from "@/lib/events/sources";

export interface RawFeeds {
  bySource: Record<string, SignalFeature[]>;
  status: "idle" | "loading" | "error";
  /** Epoch ms of the last round in which at least one source succeeded. It does NOT
   *  advance on a round where everything failed — that is the whole point of it. */
  updatedAt: number | null;
  /** How many of the EVENT_SOURCES answered in the most recent round, out of how
   *  many were asked. A partial outage is a real state and the UI should be able
   *  to say "7 of 9 sources" rather than pretending nothing is wrong. */
  okCount: number;
  total: number;
}

export const EVENT_POLL_MS = 5 * 60_000;
const POLL_MS = EVENT_POLL_MS;

export function useEventFeeds(): RawFeeds {
  const [bySource, setBySource] = useState<Record<string, SignalFeature[]>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [okCount, setOkCount] = useState(0);
  // The visibility handler outlives a render, so it reads the ref, not the state.
  const lastOkRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      setStatus("loading");
      Promise.all(
        EVENT_SOURCES.map((s) =>
          fetch(`/api/signals/${encodeURIComponent(s.id)}`)
            // A 5xx body still parses as JSON, so without this check an outage
            // counted as a successful refresh and reset the freshness clock.
            .then((r) => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r.json();
            })
            .then((d) => ({ id: s.id, features: (d.features as SignalFeature[]) ?? [], ok: true }))
            .catch(() => ({ id: s.id, features: [] as SignalFeature[], ok: false })),
        ),
      ).then((results) => {
        if (!alive) return;
        setBySource((prev) => {
          const next = { ...prev };
          for (const r of results) if (r.ok) next[r.id] = r.features;
          return next;
        });
        const ok = results.filter((r) => r.ok).length;
        setOkCount(ok);
        setStatus(ok === 0 ? "error" : "idle");
        // Only a round that actually delivered something counts as an update.
        if (ok > 0) {
          lastOkRef.current = Date.now();
          setUpdatedAt(lastOkRef.current);
        }
      });
    };
    load();
    // Nine upstreams on a 5-minute loop is the single biggest background-tab cost
    // in the app. Skip the tick while hidden; catch up on return.
    const t = setInterval(() => {
      if (!isHidden()) load();
    }, POLL_MS);
    const unwatch = onVisible(() => {
      if (shouldRefreshOnVisible(lastOkRef.current, POLL_MS, Date.now())) load();
    });
    return () => {
      unwatch();
      alive = false;
      clearInterval(t);
    };
  }, []);

  return { bySource, status, updatedAt, okCount, total: EVENT_SOURCES.length };
}
