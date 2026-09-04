// One fact, published once: the moment the map finished its first render.
//
// WHY A MODULE AND NOT REACT STATE. The two parties are WorldMap (dynamically
// imported, `ssr: false`, mounted deep inside the stage) and BootSequence (a
// sibling overlay on the shell). They share no ancestor that could usefully hold
// this, and lifting it would put a value that changes once per page load into a
// context that re-renders the console. It is also a fact about the page rather
// than about any component: whoever asks after the fact must get the same answer,
// which is why `onMapReady` fires immediately for a late subscriber instead of
// waiting for an event that has already happened.
//
// DOM-free and dependency-free, so it is asserted in the node vitest environment
// like the rest of lib/terminal.

/** performance.now() at the map's first idle, or null if it has not happened. */
let readyAt: number | null = null;
const listeners = new Set<(atMs: number) => void>();

/** Same clock as `performance.now()`, and safe on the server / in a bare node test. */
function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Called from WorldMap's FIRST `idle` — the map has drawn every tile it needs for
 * the current view, which is the honest "the visitor could use this now".
 *
 * Idempotent by design. MapLibre emits `idle` repeatedly, and the second one is not
 * news; more importantly, letting a later idle overwrite the first would let a pan
 * or a basemap swap re-open a question that was already answered.
 */
export function markMapReady(atMs: number = now()): void {
  if (readyAt !== null) return;
  readyAt = atMs;
  for (const fn of listeners) fn(atMs);
}

/** The recorded moment, or null. */
export function mapReadyAt(): number | null {
  return readyAt;
}

/** Subscribe. Fires immediately if the map is already ready. Returns an unsubscribe. */
export function onMapReady(fn: (atMs: number) => void): () => void {
  if (readyAt !== null) {
    fn(readyAt);
    return () => {};
  }
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Tests only — module state outlives a test file otherwise. */
export function resetMapReady(): void {
  readyAt = null;
  listeners.clear();
}
