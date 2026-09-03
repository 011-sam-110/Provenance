import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getHeroView, setHeroView, type HeroView } from "@/lib/marketing/heroView";

/**
 * The plain module-level store that lets the star layer read the hero globe's
 * camera every frame without either side touching React state or a scroll
 * listener (CLAUDE.md, "Shape": components/marketing/* has exactly one scroll
 * subscriber, and nothing else may set React state per frame).
 *
 * Reset between tests because a module-level `let` persists across `it` blocks
 * in the same file — without this, test order would silently matter.
 */
beforeEach(() => {
  setHeroView(null);
});
afterEach(() => {
  setHeroView(null);
});

describe("getHeroView", () => {
  it("is null before anything has ever published a view", () => {
    expect(getHeroView()).toBeNull();
  });

  it("goes back to null once the globe unmounts", () => {
    setHeroView({ lngDeg: 8, latDeg: 8, bearingDeg: 0, pitchDeg: 0 });
    expect(getHeroView()).not.toBeNull();
    setHeroView(null);
    expect(getHeroView()).toBeNull();
  });
});

describe("setHeroView / getHeroView round trip", () => {
  it("returns exactly what was written, for an in-range view", () => {
    const view: HeroView = { lngDeg: 8, latDeg: -8, bearingDeg: 12.5, pitchDeg: 40 };
    setHeroView(view);
    expect(getHeroView()).toEqual(view);
  });
});

describe("longitude normalisation", () => {
  it("wraps 190 to -170", () => {
    setHeroView({ lngDeg: 190, latDeg: 0, bearingDeg: 0, pitchDeg: 0 });
    expect(getHeroView()?.lngDeg).toBeCloseTo(-170, 9);
  });

  it("wraps -190 to 170", () => {
    setHeroView({ lngDeg: -190, latDeg: 0, bearingDeg: 0, pitchDeg: 0 });
    expect(getHeroView()?.lngDeg).toBeCloseTo(170, 9);
  });

  it("wraps the antimeridian, 540, to a single consistent value (-180)", () => {
    setHeroView({ lngDeg: 540, latDeg: 0, bearingDeg: 0, pitchDeg: 0 });
    // Either +180 or -180 describes the same meridian; the store must not
    // waver between them from one write to the next.
    expect(getHeroView()?.lngDeg).toBe(-180);
    setHeroView({ lngDeg: -180, latDeg: 0, bearingDeg: 0, pitchDeg: 0 });
    expect(getHeroView()?.lngDeg).toBe(-180);
  });

  it("wraps a longitude the ambient spin has carried into the thousands", () => {
    // The spin loop adds 0.035 deg/frame forever with no cap of its own; after
    // roughly ten minutes at 60fps that is comfortably past 3600 degrees, i.e.
    // ten full turns plus a remainder.
    setHeroView({ lngDeg: 3600.5, latDeg: 0, bearingDeg: 0, pitchDeg: 0 });
    expect(getHeroView()?.lngDeg).toBeCloseTo(0.5, 9);
  });

  it("leaves an in-range longitude untouched", () => {
    setHeroView({ lngDeg: -170, latDeg: 0, bearingDeg: 0, pitchDeg: 0 });
    expect(getHeroView()?.lngDeg).toBeCloseTo(-170, 9);
  });
});

describe("defensive copying", () => {
  it("is not affected by mutating the object passed to setHeroView", () => {
    const view = { lngDeg: 10, latDeg: 20, bearingDeg: 30, pitchDeg: 40 };
    setHeroView(view);
    view.lngDeg = 999;
    view.latDeg = 999;
    expect(getHeroView()).toEqual({ lngDeg: 10, latDeg: 20, bearingDeg: 30, pitchDeg: 40 });
  });

  it("is not affected by mutating the object returned by getHeroView", () => {
    setHeroView({ lngDeg: 10, latDeg: 20, bearingDeg: 30, pitchDeg: 40 });
    const read = getHeroView() as HeroView;
    // Frozen, so this assignment is a silent no-op or throws depending on
    // strict mode — either way the store must come back unchanged.
    try {
      (read as { lngDeg: number }).lngDeg = 999;
    } catch {
      /* strict-mode assignment to a frozen property throws; that's fine too */
    }
    expect(getHeroView()).toEqual({ lngDeg: 10, latDeg: 20, bearingDeg: 30, pitchDeg: 40 });
  });
});
