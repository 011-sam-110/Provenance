// Which camera streams have had their HLS handshake fail fatally, and when.
//
// THE COST THIS AVOIDS. A camslot tile remounts CameraVideo every time the
// rotation comes back round, with a fresh `failed = false`. Without a memo, a
// camera whose HLS is dead re-runs the whole handshake on every visit — dynamic-
// import hls.js, loadSource, attachMedia, wait for the upstream to time out — and
// only then falls back to the still it was always going to show. Measured on the
// Streets board while building the browser gate: switches that never reached a
// painted frame spent the full timeout every time, and even the successful ones
// averaged ~9s to first paint.
//
// THIS IS NOT THE BENCH, and it deliberately does not do the bench's job.
// `camslot.health` decides whether a stream is rotated through AT ALL, on two
// strikes, and a camera whose video is dead but whose still is fine should stay
// in the rotation showing that still. This decides only whether the VIDEO
// handshake is worth attempting again. Two questions, two pieces of state.
//
// It expires on the bench's clock (RETRY_AFTER_MS, imported rather than retyped)
// so a stream that comes back is picked up. A permanent memo would be the
// invisible-false-negative failure: one bad handshake and the camera never plays
// video again for the life of the tab, with nothing on screen saying why.
//
// Module state, deliberately: it lasts a page session and no longer. It is kept
// out of the component so the rules are testable in the node environment, which
// is the only place this repo can test anything — there is no React testing
// library, so a decision left inside a component is a decision no test can reach.

import { RETRY_AFTER_MS } from "@/lib/console/widgets/camslot.health";

const fatalAt = new Map<string, number>();

/** Record a fatal video failure for this stream. */
export function markVideoFatal(id: string, now: number): void {
  fatalAt.set(id, now);
}

/** Forget one stream — call it when frames actually arrive, rather than waiting
 *  out the window, so a camera that recovers plays again immediately. */
export function clearVideoFatal(id: string): void {
  fatalAt.delete(id);
}

/** Drop everything. Exists for tests; nothing in the app calls it. */
export function resetVideoFatal(): void {
  fatalAt.clear();
}

/**
 * Has this stream's video handshake failed recently enough to skip?
 *
 * Expiry is applied on READ rather than on a timer: there is no scheduler here,
 * and a map of a few dead ids is not worth sweeping. The entry is deleted as it
 * expires so a long session does not accumulate them.
 */
export function videoRecentlyFatal(id: string, now: number): boolean {
  const at = fatalAt.get(id);
  if (at === undefined) return false;
  if (now - at >= RETRY_AFTER_MS) { fatalAt.delete(id); return false; }
  return true;
}
