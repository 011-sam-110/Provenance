"use client";
// The Full flight trail switch (Map settings, components/shell/inspector/tools/SettingsTool.tsx)
// and the stored lines a click loads.
//
// THE SWITCH IS KEPT IN THIS BROWSER ONLY. It costs this tab's memory and frame time, so it
// belongs to this screen, and lib/account/syncKeys.ts leaves a setting for one screen on the
// device. tests/unit/account-sync-keys.test.ts pins that. Off is the default, and off means the
// 12-point line. It reads after mount, so the server and the first paint agree.
//
// A CLICK LOADS A LINE ONCE. `request` asks /api/planes/track for a plane the first time and
// then remembers the answer, an empty one included, for as long as the plane stays in the feed.
// A failed fetch is logged and can be asked again: it never touches the line already drawn.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { isTrackId } from "@/lib/planes/trackId";
import type { StoredTrack } from "@/lib/planes/trackLine";
import { MAX_KEPT_LINES } from "@/lib/planes/fullHistory";

export const FULL_TRAIL_KEY = "tn.planes.fullTrail.v1";
const VERSION = 1;

let on = false;
let hydrated = false;
const switchListeners = new Set<() => void>();

export const fullTrailStore = {
  get(): boolean {
    return on;
  },
  set(next: boolean) {
    hydrated = true;
    if (next === on) return;
    on = next;
    savePersisted(FULL_TRAIL_KEY, VERSION, { on });
    for (const l of switchListeners) l();
  },
  subscribe(listener: () => void): () => void {
    switchListeners.add(listener);
    return () => {
      switchListeners.delete(listener);
    };
  },
  /** Read the saved choice. Call client-side after mount; only the first call reads. */
  hydrate() {
    if (hydrated) return;
    hydrated = true;
    const saved = loadPersisted<{ on?: unknown }>(FULL_TRAIL_KEY, VERSION);
    if (saved?.on === true && !on) {
      on = true;
      for (const l of switchListeners) l();
    }
  },
};

export function useFullTrail(): boolean {
  return useSyncExternalStore(fullTrailStore.subscribe, fullTrailStore.get, () => false);
}

export type StoredLineState =
  | { status: "loading" }
  /** `from` is when the joined line starts, once a line was joined to it. */
  | { status: "ready"; track: StoredTrack; from: number | null }
  | { status: "failed" };

/** Pure: a /api/planes/track body, or null when it is not one. */
export function parseStoredTrack(body: unknown, id: string): StoredTrack | null {
  const b = body as Partial<StoredTrack> | null;
  if (!b || b.id !== id || !Array.isArray(b.points) || !Array.isArray(b.breaks)) return null;
  const pointOk = (p: unknown) =>
    Array.isArray(p) && p.length === 4 && p.every((n) => typeof n === "number" && Number.isFinite(n));
  if (!b.points.every(pointOk)) return null;
  const count = b.points.length;
  if (!b.breaks.every((n) => typeof n === "number" && n > 0 && n < count)) return null;
  return {
    id,
    firstHeardAt: typeof b.firstHeardAt === "number" ? b.firstHeardAt : null,
    lastHeardAt: typeof b.lastHeardAt === "number" ? b.lastHeardAt : null,
    trimmed: b.trimmed === true,
    points: b.points,
    breaks: b.breaks,
  };
}

/** In click order, oldest first, so the oldest falls out past MAX_KEPT_LINES. */
const lines = new Map<string, StoredLineState>();
const lineListeners = new Set<() => void>();

function emitLines() {
  for (const l of lineListeners) l();
}

export const storedLineStore = {
  get(id: string): StoredLineState | null {
    return lines.get(id) ?? null;
  },
  /** The ids a click has loaded, for the overall cap to spare. */
  loadedIds(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const [id, s] of lines) if (s.status === "ready") out.add(id);
    return out;
  },
  /** The first ask for a plane's line. Later asks do nothing, unless the last one failed. */
  request(id: string) {
    if (!isTrackId(id)) return;
    const held = lines.get(id);
    if (held && held.status !== "failed") return;
    lines.delete(id);
    lines.set(id, { status: "loading" });
    while (lines.size > MAX_KEPT_LINES) lines.delete(lines.keys().next().value as string);
    emitLines();
    void fetch(`/api/planes/track?id=${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`answered ${res.status}`);
        const track = parseStoredTrack(await res.json(), id);
        if (!track) throw new Error("the body is not a track");
        if (lines.has(id)) lines.set(id, { status: "ready", track, from: null });
      })
      .catch((err) => {
        // NOT SWALLOWED: the catch in WorldMap's `CamerasFeed` says what a bare one cost.
        console.warn(`[planes] the stored line for ${id} did not load, keeping the line drawn:`, err);
        if (lines.has(id)) lines.set(id, { status: "failed" });
      })
      .finally(emitLines);
  },
  /** Say when the joined line starts, for the plane's panel. */
  setFrom(id: string, from: number) {
    const s = lines.get(id);
    if (s?.status !== "ready" || s.from === from) return;
    lines.set(id, { ...s, from });
    emitLines();
  },
  /** Forget the planes that left the feed, so a plane that comes back asks again. */
  retain(present: ReadonlySet<string>) {
    let changed = false;
    for (const id of lines.keys()) {
      if (!present.has(id)) {
        lines.delete(id);
        changed = true;
      }
    }
    if (changed) emitLines();
  },
  clear() {
    if (lines.size === 0) return;
    lines.clear();
    emitLines();
  },
  subscribe(listener: () => void): () => void {
    lineListeners.add(listener);
    return () => {
      lineListeners.delete(listener);
    };
  },
};

export function useStoredLine(id: string): StoredLineState | null {
  const read = () => storedLineStore.get(id);
  return useSyncExternalStore(storedLineStore.subscribe, read, () => null);
}
