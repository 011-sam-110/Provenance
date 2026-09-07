"use client";
// One shared client-side copy of the webcam directory.
//
// WHY THIS EXISTS. A camera slot can be filled from a `?c=` share link, which carries
// ids and nothing else — so without this a restored slot captions itself
// "Webcam 1229966910" instead of "London › South: Parliament Square". The picker
// needs the same rows to search. Fetching per consumer would pull a ~76 KB list once
// per widget on screen; this makes it one fetch for the session.
//
// Deliberately fetch-once: webcam TITLES do not change on the 8-minute cadence the
// IMAGES do, and re-polling 1,597 rows to re-read the same strings is pure waste. A
// miss returns nothing and callers fall back to the id, which is honest — never a
// fabricated name.

import { useSyncExternalStore, useMemo } from "react";
import { filterToScope } from "@/lib/scopeFilter";
import { useScope } from "@/lib/shell/scope";

export interface WebcamRow {
  id: string;
  title: string;
  country?: string;
  region?: string;
  /** Carried so a camera slot can answer "where is this one?" without a second
   *  fetch. /api/webcams has always shipped these - this file simply dropped them,
   *  which is why a slot could name a webcam and not point at it. Optional because
   *  an older cached body, or a row with a malformed position, must not take the
   *  title down with it: a missing position means "we don't know", never 0,0. */
  lat?: number;
  lon?: number;
}

let rows: WebcamRow[] | null = null;
let titleMap: Map<string, string> | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function commit(next: WebcamRow[]) {
  rows = next;
  titleMap = new Map(next.map((w) => [w.id, w.title]));
  emit();
}

function load(): void {
  if (rows || inflight || typeof window === "undefined") return;
  inflight = fetch("/api/webcams", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const raw: unknown[] = Array.isArray(j?.webcams) ? j.webcams : [];
      const next: WebcamRow[] = [];
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const w = item as Record<string, unknown>;
        if (typeof w.id !== "string" || typeof w.title !== "string" || !w.title.trim()) continue;
        next.push({
          id: w.id,
          title: w.title.trim(),
          country: typeof w.country === "string" ? w.country : undefined,
          region: typeof w.region === "string" ? w.region : undefined,
          lat: typeof w.lat === "number" && Number.isFinite(w.lat) ? w.lat : undefined,
          lon: typeof w.lon === "number" && Number.isFinite(w.lon) ? w.lon : undefined,
        });
      }
      commit(next);
    })
    .catch(() => {
      // An upstream failure must not leave every later caller awaiting a promise that
      // already rejected. An empty directory means "we tried".
      commit([]);
    })
    .finally(() => {
      inflight = null;
    });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  load();
  return () => {
    listeners.delete(fn);
  };
};

const EMPTY: WebcamRow[] = [];

/** Every known webcam row, or an empty list until the first load resolves. */
export function useWebcamDirectory(): WebcamRow[] {
  const all = useSyncExternalStore(
    subscribe,
    () => rows ?? EMPTY,
    () => EMPTY,
  );
  const scope = useScope();
  return useMemo(
    () =>
      filterToScope(all, scope, (w) =>
        typeof w.lat === "number" && typeof w.lon === "number"
          ? { lat: w.lat, lon: w.lon }
          : null,
      ),
    [all, scope],
  );
}

/** id → title, or null until the first load resolves. */
export function useWebcamTitles(): Map<string, string> | null {
  return useSyncExternalStore(
    subscribe,
    () => titleMap,
    () => null,
  );
}
