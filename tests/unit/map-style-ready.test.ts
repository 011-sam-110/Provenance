import { describe, expect, it } from "vitest";
import { whenStyleReady, type StyleReadyMap } from "@/lib/map/styleReady";

// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
// "The 2D and 3D buttons don't work." They wrote the stage, StageHost wrote
// viewModeStore, WorldMap's subscriber ran with the right value and a live map —
// and `map.setProjection` was never called, so the globe never flattened. The
// whole loss happened inside this one helper.
//
// MEASURED IN A REAL BROWSER, against `next dev` at /app, by spying on
// `map.setProjection` and counting `styledata` events:
//
//   before the click   isStyleLoaded() true   styledata ticks 67
//   at the callback    isStyleLoaded() FALSE  ← the click's own commit queues
//                                               source updates, and Style.loaded()
//                                               is false while ANY source has work
//                                               in flight (it is _loaded AND no
//                                               _updatedSources AND every
//                                               tileManager loaded AND images)
//   after the click    isStyleLoaded() true   styledata ticks 67  ← UNCHANGED
//
// So the guard took its deferred branch, and then waited on `styledata` — an event
// that fires for the style DOCUMENT, not for a source finishing its tiles. It never
// came again. The projection change was dropped, silently and permanently, on every
// toggle. `idle` is the edge that was missing: it is what MapLibre fires when it has
// finished rendering and settled, and this app already trusts it for exactly that
// (`map.once("idle", () => markMapReady())` in WorldMap).
//
// The tests below are written against that trace, not against a theory of it.

/** A map that replays a chosen event sequence. Records its own listeners so a leak
 *  or a double-run is visible rather than inferred. */
function fakeMap(initiallyLoaded: boolean) {
  const listeners: Record<string, Set<() => void>> = { styledata: new Set(), idle: new Set() };
  let loaded = initiallyLoaded;
  return {
    map: {
      isStyleLoaded: () => loaded,
      on: (t: "styledata" | "idle", l: () => void) => listeners[t].add(l),
      off: (t: "styledata" | "idle", l: () => void) => listeners[t].delete(l),
    } satisfies StyleReadyMap,
    setLoaded(v: boolean) {
      loaded = v;
    },
    emit(t: "styledata" | "idle") {
      for (const l of [...listeners[t]]) l();
    },
    count(t: "styledata" | "idle") {
      return listeners[t].size;
    },
  };
}

describe("whenStyleReady", () => {
  it("runs synchronously when the style is already loaded", () => {
    const h = fakeMap(true);
    let ran = 0;
    whenStyleReady(h.map, () => ran++);
    expect(ran).toBe(1);
    // Nothing to clean up, so nothing was registered.
    expect(h.count("styledata") + h.count("idle")).toBe(0);
  });

  it("waits while the style is loading, then runs on the styledata that reports it ready", () => {
    const h = fakeMap(false);
    let ran = 0;
    whenStyleReady(h.map, () => ran++);
    expect(ran).toBe(0);

    h.emit("styledata"); // still loading — styledata fires repeatedly during load
    expect(ran).toBe(0);

    h.setLoaded(true);
    h.emit("styledata");
    expect(ran).toBe(1);
  });

  // ── THE REGRESSION ─────────────────────────────────────────────────────────
  // The measured live sequence. This is the one that was red.
  it("still runs when the style settles WITHOUT another styledata — the toggle case", () => {
    const h = fakeMap(false); // the click's own commit left a source updating
    let ran = 0;
    whenStyleReady(h.map, () => ran++);
    expect(ran).toBe(0);

    // The style document never changes again, so `styledata` never fires. The map
    // finishes its tiles and goes idle. In the browser this is the exact moment the
    // projection was safe to set — and the moment the old guard slept through.
    h.setLoaded(true);
    h.emit("idle");
    expect(ran).toBe(1);
  });

  it("does not run early on an idle that arrives while the style is still loading", () => {
    const h = fakeMap(false);
    let ran = 0;
    whenStyleReady(h.map, () => ran++);
    h.emit("idle");
    expect(ran).toBe(0);
  });

  it("runs exactly once and unregisters both listeners, whichever edge wakes it", () => {
    for (const edge of ["styledata", "idle"] as const) {
      const h = fakeMap(false);
      let ran = 0;
      whenStyleReady(h.map, () => ran++);
      h.setLoaded(true);
      h.emit(edge);
      expect(ran).toBe(1);
      // Both listeners are gone, so a later event cannot fire `fn` a second time —
      // a repeated setProjection would reload every tile manager for nothing.
      expect(h.count("styledata")).toBe(0);
      expect(h.count("idle")).toBe(0);
      h.emit("styledata");
      h.emit("idle");
      expect(ran).toBe(1);
    }
  });
});
