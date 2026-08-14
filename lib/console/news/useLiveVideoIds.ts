"use client";
import { useEffect, useState } from "react";

/**
 * Provider id → the video that provider's channel is broadcasting right now,
 * from /api/youtube-live.
 *
 * Shared module-level state, not per-component: the news widget, its detail
 * view and the satellites panel all want the same answer, and one resolution
 * round costs real API quota. Components mount and unmount as boards change, so
 * a per-component fetch would re-ask constantly for data that changes every ten
 * minutes at most.
 *
 * Failure is silent by design. An empty map means "nothing resolved", and every
 * caller already falls back to its pinned `ref`, so a dead resolver leaves the
 * console exactly as it behaves today instead of blanking the players.
 */
const REFRESH_MS = 10 * 60 * 1000;

let cache: Record<string, string> = {};
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<(v: Record<string, string>) => void>();

async function refresh(): Promise<void> {
  try {
    const res = await fetch("/api/youtube-live", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { resolved?: Record<string, string> };
    cache = json.resolved ?? {};
    fetchedAt = Date.now();
    for (const fn of listeners) fn(cache);
  } catch {
    // Keep whatever we had; callers fall back to their pinned ref.
  }
}

function ensureFresh(): void {
  if (Date.now() - fetchedAt < REFRESH_MS && fetchedAt !== 0) return;
  if (!inflight) {
    inflight = refresh().finally(() => {
      inflight = null;
    });
  }
}

export function useLiveVideoIds(): Record<string, string> {
  const [ids, setIds] = useState<Record<string, string>>(cache);
  useEffect(() => {
    listeners.add(setIds);
    ensureFresh();
    const timer = setInterval(ensureFresh, REFRESH_MS);
    return () => {
      listeners.delete(setIds);
      clearInterval(timer);
    };
  }, []);
  return ids;
}
