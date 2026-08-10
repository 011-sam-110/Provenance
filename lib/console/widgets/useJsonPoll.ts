"use client";
// Minimal JSON polling hook for the handful of one-shot console widgets that read
// a whole-payload endpoint (markets, headlines) rather than a signal feed. Keeps
// the last good payload on a failed refresh; "error" only before the first success.

import { useEffect, useRef, useState } from "react";
import { isHidden, onVisible, shouldRefreshOnVisible } from "@/lib/shell/visibility";

export type PollStatus = "loading" | "idle" | "error";

export interface JsonPoll<T> {
  data: T;
  status: PollStatus;
  /** Epoch ms of the last SUCCESSFUL response, or null if there has never been one.
   *  Keeping last-good data on a failed refresh is the right behaviour, but it means
   *  `data` alone cannot tell you how old what you're looking at is — hence this. */
  lastOk: number | null;
  /** Did the most recent attempt succeed? False while showing last-good data. */
  ok: boolean;
}

export function useJsonPoll<T>(url: string, pollMs: number, initial: T): JsonPoll<T> {
  const [data, setData] = useState<T>(initial);
  const [status, setStatus] = useState<PollStatus>("loading");
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [ok, setOk] = useState(true);
  // A ref as well as state: the visibility handler is created once per url/pollMs
  // and would otherwise close over a stale lastOk forever.
  const lastOkRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(url)
        .then((r) => {
          // A 500 still parses as JSON here; without this an outage looked like a success.
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => {
          if (!alive) return;
          setData(d as T);
          setStatus("idle");
          lastOkRef.current = Date.now();
          setLastOk(lastOkRef.current);
          setOk(true);
        })
        .catch(() => {
          if (!alive) return;
          setOk(false);
          setStatus((s) => (s === "loading" ? "error" : s));
        });
    };
    load();
    // Don't burn quota polling a tab nobody is looking at; catch up on return.
    const t = setInterval(() => {
      if (!isHidden()) load();
    }, pollMs);
    const unwatch = onVisible(() => {
      if (shouldRefreshOnVisible(lastOkRef.current, pollMs, Date.now())) load();
    });
    return () => {
      alive = false;
      clearInterval(t);
      unwatch();
    };
  }, [url, pollMs]);

  return { data, status, lastOk, ok };
}
