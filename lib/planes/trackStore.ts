// The server's memory of where each plane has been, for the Full flight trail setting. Not
// lib/planes/track.ts, which is the one plane the map is following.
//
// NO NEW REQUEST. The pull (`fetchAircraftOnce` in lib/sources/opensky.ts) hands this every
// plane it heard, about 10,000, BEFORE the spatial cap cuts them to the 3,000 the map serves. The
// served sample moves from pull to pull, and a line fed from it would have holes where a receiver
// could hear the plane. adsb.lol and adsb.fi are asked for nothing extra, and what the layer never
// serves is gone by then: military types are not asked for, and adsb.fi's military rows are dropped
// where they are read. Each pull is taken once, by its instant.
//
// MEMORY ONLY, ON PURPOSE. A restart or a deploy empties it and the lines build up again from
// that moment. Nothing here writes a file, which /privacy states and
// tests/unit/discovery-admin-gate.test.ts enforces. It knows nothing about who asks: planes go
// in, and a read changes nothing but a short-lived copy of its own reply.
//
// ON `globalThis`. Next bundles each route on its own, so module state written by /api/planes
// would be a different copy from the one /api/planes/track reads. Same reason as the
// adsb.lol clock in opensky.ts.
//
// THE CAPS ARE HARD AND WERE MEASURED, by `scripts/track-store-memory.mts`, 2026-10-31. Twelve
// hours of a simulated pull of 10,000 held 21,000 planes, 374,000 points and 23 MB. Filled to
// TRACK_CAPS it holds 70 MB, on a box that had 1,133 MB free of 1,907 MB that day. One pull spends
// 7 to 12 ms here, under 40 ms at worst, against the second or so the pull itself takes.

import type { WorldObject } from "@/lib/world";
import { heardAt, newLine, pointCount, stepLine, toStoredTrack, trimOlderThan, type TrackLine } from "@/lib/planes/trackLine";

export interface TrackCaps {
  /** Planes held at once. Past it, the longest-silent go first. */
  maxPlanes: number;
  /** Points held at once, over all planes. Past it, the longest-silent go first. */
  maxPoints: number;
  /** Points for one plane. Past it, that line's oldest go. 12 h of a pull every 2 minutes is 360. */
  maxPointsPerPlane: number;
  /** A line keeps this far back, newest first. */
  maxAgeMs: number;
  /** A plane unheard for this long is dropped, line and all. */
  unheardMs: number;
}

export const TRACK_CAPS: TrackCaps = {
  maxPlanes: 40_000,
  maxPoints: 1_500_000,
  maxPointsPerPlane: 500,
  maxAgeMs: 12 * 3_600_000,
  // Long enough for a North Atlantic crossing outside receiver range, which comes back as one
  // line with a gap. A longer silence comes back as a new line from when we next hear it.
  unheardMs: 6 * 3_600_000,
};

/**
 * Half the pull's 2 minutes (production's snapshots moved about every 120 s on 2026-10-31, with
 * `revalidate` at 90), and the stale copy the same again, so a cached line is never older than
 * one pull (lib/http/cache.ts states the rule). The body holds absolute times only, so a cached
 * copy says nothing false, and the tab joins its own newer points on after it.
 */
export const TRACK_TTL_MS = 60_000;

export interface TrackStore {
  lines: Map<string, TrackLine>;
  /** The newest snapshot taken, by its `fetchedAt`. */
  fedAt: number;
  /** Replies already built for this snapshot, so a popular plane is one `JSON.stringify` a pull. */
  bodies: Map<string, string>;
}

export function createTrackStore(): TrackStore {
  return { lines: new Map(), fedAt: 0, bodies: new Map() };
}

const STORE = Symbol.for("provenance.planes.trackStore.v1");

/** This process's one store. */
export function flightTracks(): TrackStore {
  const g = globalThis as unknown as Record<symbol, TrackStore | undefined>;
  return (g[STORE] ??= createTrackStore());
}

/** Take one snapshot into the store. False when this snapshot, or a newer one, was already taken. */
export function ingestSnapshot(
  store: TrackStore,
  planes: readonly WorldObject[],
  fetchedAt: number,
  caps: TrackCaps = TRACK_CAPS,
): boolean {
  if (!(fetchedAt > store.fedAt)) return false;
  store.fedAt = fetchedAt;
  store.bodies.clear();
  for (const o of planes) {
    const pt = {
      lat: o.lat,
      lon: o.lon,
      altKm: o.altKm ?? 0,
      t: heardAt(fetchedAt, (o.meta as { posAgeS?: unknown } | undefined)?.posAgeS),
    };
    const line = store.lines.get(o.id);
    if (line) stepLine(line, pt, caps.maxPointsPerPlane);
    else store.lines.set(o.id, newLine(pt));
  }
  pruneStore(store, fetchedAt, caps);
  return true;
}

/** Age the store out, then hold it to its caps. */
export function pruneStore(store: TrackStore, now: number, caps: TrackCaps = TRACK_CAPS): void {
  let total = 0;
  for (const [id, line] of store.lines) {
    if (now - line.lastHeardAt >= caps.unheardMs) {
      store.lines.delete(id);
      continue;
    }
    trimOlderThan(line, now - caps.maxAgeMs);
    total += pointCount(line);
  }
  if (store.lines.size <= caps.maxPlanes && total <= caps.maxPoints) return;
  const silentFirst = [...store.lines.entries()].sort((a, b) => a[1].lastHeardAt - b[1].lastHeardAt);
  for (const [id, line] of silentFirst) {
    if (store.lines.size <= caps.maxPlanes && total <= caps.maxPoints) break;
    total -= pointCount(line);
    store.lines.delete(id);
  }
}

/** What the store holds now. */
export function trackStats(store: TrackStore): { planes: number; points: number } {
  let points = 0;
  for (const line of store.lines.values()) points += pointCount(line);
  return { planes: store.lines.size, points };
}

/** At most this many replies wait for the next snapshot, and each is one plane's line. */
const MAX_BODIES = 64;

/**
 * The body of GET /api/planes/track for a checked id. A plane we hold no line for gets an empty
 * line and no entry in `bodies`, so asking for made-up ids grows nothing.
 *
 * `lib/http/originCache.ts` is not used here: its keys never leave, and this route's key comes
 * from the visitor.
 */
export function trackBody(store: TrackStore, id: string): string {
  const line = store.lines.get(id);
  if (!line) return JSON.stringify(toStoredTrack(id, undefined));
  const held = store.bodies.get(id);
  if (held) return held;
  const body = JSON.stringify(toStoredTrack(id, line));
  if (store.bodies.size < MAX_BODIES) store.bodies.set(id, body);
  return body;
}

/** What one pull cost the store, for the pull's own log line. */
export interface PullNote {
  planes: number;
  points: number;
  ms: number;
}

/**
 * The feed: called once with each pull's whole pool. It can never cost the layer an answer, so a
 * failure here is logged and goes no further.
 */
export function noteAircraftPull(planes: readonly WorldObject[], fetchedAt: number): PullNote | null {
  if (planes.length === 0) return null;
  try {
    const started = performance.now();
    const store = flightTracks();
    if (!ingestSnapshot(store, planes, fetchedAt)) return null;
    return { ...trackStats(store), ms: Math.round(performance.now() - started) };
  } catch (err) {
    console.warn(`plane track store failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
