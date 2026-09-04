import { beforeEach, describe, expect, it, vi } from "vitest";
import { markMapReady, mapReadyAt, onMapReady, resetMapReady } from "@/lib/terminal/mapReady";

/**
 * The one fact the boot overlay needs from the map, and the two ways a naive
 * version of it goes wrong: a subscriber that arrives after the event and never
 * hears anything, and a second `idle` re-opening a question already answered.
 */
describe("mapReady", () => {
  beforeEach(() => resetMapReady());

  it("starts unanswered", () => {
    expect(mapReadyAt()).toBeNull();
  });

  it("notifies a subscriber that was already waiting", () => {
    const seen = vi.fn();
    onMapReady(seen);
    markMapReady(1234);
    expect(seen).toHaveBeenCalledWith(1234);
    expect(mapReadyAt()).toBe(1234);
  });

  it("notifies a LATE subscriber immediately", () => {
    // WorldMap is dynamically imported and BootSequence is not, but the order is
    // not guaranteed either way. A subscriber that arrives second must still get
    // the answer, or the boot silently falls back to its ceiling on the very loads
    // where the map was fastest.
    markMapReady(500);
    const seen = vi.fn();
    onMapReady(seen);
    expect(seen).toHaveBeenCalledWith(500);
  });

  it("keeps the FIRST moment and ignores later ones", () => {
    // MapLibre emits `idle` after every settled pan and basemap swap. Letting a
    // later one through would move an answer the boot may already have acted on.
    const seen = vi.fn();
    onMapReady(seen);
    markMapReady(700);
    markMapReady(9000);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(mapReadyAt()).toBe(700);
  });

  it("stops notifying an unsubscribed listener", () => {
    const seen = vi.fn();
    onMapReady(seen)();
    markMapReady(300);
    expect(seen).not.toHaveBeenCalled();
  });
});
