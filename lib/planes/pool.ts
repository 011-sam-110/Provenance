// Every aircraft the last good pull heard, before the 3,000 cap (lib/sources/opensky.ts).
//
// WHY IT EXISTS. /api/planes serves a proportional sample of the world, which is right for a
// globe and wrong for a street-level view: a whole city can hold none of the sample. The pull
// has already paid for the rest and used to drop it. The God's eye view's /api/eye/planes
// reads this copy for the box on screen, so it costs no request to adsb.lol.
//
// IN MEMORY ONLY, on globalThis because each route is its own bundle and one process serves
// production (the same reasoning as `adsbLolOkAt`). A saved file would make /privacy's "nothing
// this site serves writes a file" false, and the Data Cache's 2 MB entry limit is why the capped
// set is what it stores. A restart forgets this until the next pull, and the route says so.

import type { WorldObject } from "@/lib/world";

export interface PlanePool {
  objects: readonly WorldObject[];
  /** When these positions were pulled, epoch ms. The same instant as that snapshot's `fetchedAt`. */
  fetchedAt: number;
}

const POOL_KEY = Symbol.for("provenance.planes.pool.v1");
const store = globalThis as unknown as Record<symbol, PlanePool | undefined>;

/** Keep what one good pull heard. The array is held, not copied, and replaced whole by the next. */
export function notePlanePool(objects: readonly WorldObject[], fetchedAt: number): void {
  store[POOL_KEY] = { objects, fetchedAt };
}

export function readPlanePool(): PlanePool | null {
  return store[POOL_KEY] ?? null;
}

/** For tests. */
export function clearPlanePool(): void {
  delete store[POOL_KEY];
}
