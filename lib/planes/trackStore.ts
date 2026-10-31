// The server's memory of where each plane has been, for the Full flight trail setting. Not
// lib/planes/track.ts, which is the one plane the map is following.
//
// NO NEW REQUEST. `fetchAircraftSnapshot` (lib/sources/opensky.ts) hands this every snapshot
// after the spatial cap and the staleness gate, so nothing reaches it that the planes layer
// would not serve, and adsb.lol and adsb.fi are asked for nothing extra. A snapshot is taken
// once, by its `fetchedAt`, however many requests read it.
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
// THE CAPS ARE HARD AND WERE MEASURED, by `scripts/track-store-memory.mts`. See TRACK_CAPS.

import type { WorldObject } from "@/lib/world";
import { heardAt, newLine, pointCount, stepLine, toStoredTrack, trimOlderThan, type TrackLine } from "@/lib/planes/trackLine";

export interface TrackCaps {
  /** Planes held at once. Past it, the longest-silent go first. */
  maxPlanes: number;
  /** Points held at once, over all planes. Past it, the longest-silent go first. */
  maxPoints: number;
  /** Points for one plane. Past it, that line's oldest go. 12 h of the 90 s pull is 480. */
  maxPointsPerPlane: number;
  /** A line keeps this far back, newest first. */
  maxAgeMs: number;
  /** A plane unheard for this long is dropped, line and all. */
  unheardMs: number;
}

export const TRACK_CAPS: TrackCaps = {
  maxPlanes: 12_000,
  maxPoints: 500_000,
  maxPointsPerPlane: 500,
  maxAgeMs: 12 * 3_600_000,
  // Long enough for a North Atlantic crossing outside receiver range, which comes back as one
  // line with a gap. A longer silence comes back as a new line from when we next hear it.
  unheardMs: 6 * 3_600_000,
};

/**
 * Half the 90 s pull, and the stale copy the same again, so a cached line is never older than
 * one pull (lib/http/cache.ts states the rule). The body holds absolute times only, so a cached
 * copy says nothing false, and the tab joins its own newer points on after it.
 */
export const TRACK_TTL_MS = 45_000;

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

/**
 * The feed: called with each snapshot the planes layer is about to serve. It can never cost the
 * layer an answer, so a failure here is logged and goes no further.
 */
export function noteAircraftSnapshot(snapshot: { planes: readonly WorldObject[]; fetchedAt?: number }): void {
  if (!snapshot.fetchedAt || snapshot.planes.length === 0) return;
  try {
    ingestSnapshot(flightTracks(), snapshot.planes, snapshot.fetchedAt);
  } catch (err) {
    console.warn(`plane track store failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
