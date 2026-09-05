import { describe, expect, it } from "vitest";
import {
  MAX_STYLE_ATTEMPTS,
  classifyMapError,
  fallbackBasemap,
  isRemoteStyle,
  nextRecoveryStep,
  retryDelayMs,
} from "@/lib/map/resilience";
import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";

// The REAL registry, not a mirror of it. Two entries are remote style URLs that can
// fail to load (the OpenFreeMap vector style, streets); two are inline
// StyleSpecifications that cannot (dark, satellite, topo).
const STYLES = BASEMAPS as unknown as Record<BasemapKey, { style: string | object }>;
const ALL_KEYS = Object.keys(BASEMAPS) as BasemapKey[];

describe("classifyMapError", () => {
  it("treats a tile-scoped error as cosmetic, never fatal", () => {
    // Raster basemaps 404 tiles constantly (poles, past maxzoom). Recovering on
    // these would thrash the map for every ordinary miss.
    expect(classifyMapError({ error: { status: 404 }, tile: {} })).toBe("tile");
    expect(classifyMapError({ error: { status: 404 }, sourceId: "esri-imagery" })).toBe("tile");
  });

  it("treats a failed style document as fatal", () => {
    expect(classifyMapError({ error: { message: "Failed to fetch" } })).toBe("style");
    expect(classifyMapError({ error: { message: "Unable to parse style" } })).toBe("style");
    expect(classifyMapError({ error: { message: "NetworkError when loading" } })).toBe("style");
  });

  it("prefers the tile classification even when the message mentions the style", () => {
    // sourceId present => the style is alive; only a tile failed.
    expect(classifyMapError({ error: { message: "style tile failed" }, sourceId: "x" })).toBe("tile");
  });

  it("does not act on unknown or empty errors", () => {
    expect(classifyMapError(null)).toBe("other");
    expect(classifyMapError(undefined)).toBe("other");
    expect(classifyMapError({})).toBe("other");
    expect(classifyMapError({ error: { message: "something odd" } })).toBe("other");
  });
});

describe("isRemoteStyle / fallbackBasemap", () => {
  // Every basemap in the registry, classified DELIBERATELY, and the reason this is a
  // table rather than a handful of named assertions.
  //
  // This file used to assert isRemoteStyle for streets/satellite/topo and nothing
  // else. `streets` was then added as a SECOND remote style — a second thing that can
  // fail to load and strand the user — and every test here stayed green, because
  // nothing had ever looked at it. `dark` had been invisible the same way for longer.
  //
  // Checking the table's keys against the registry's is what fixes that: a sixth
  // basemap cannot be added without a decision being recorded here about whether it
  // can fail. That is the assertion that goes red on the next person, and it is the
  // one this file was missing.
  const EXPECTED_REMOTE: Record<BasemapKey, boolean> = {
    streets: true, // OpenFreeMap Liberty — style URL
    satellite: false, // inline Esri World Imagery raster
    topo: false, // inline OpenTopoMap raster
  };

  it("classifies every basemap in the registry, with none left unconsidered", () => {
    expect(Object.keys(EXPECTED_REMOTE).sort()).toEqual([...ALL_KEYS].sort());
    for (const key of ALL_KEYS) {
      expect(isRemoteStyle(key, STYLES), `${key} classified wrongly`).toBe(EXPECTED_REMOTE[key]);
    }
  });

  it("falls back from the remote Light basemap to inline satellite", () => {
    expect(fallbackBasemap("streets", STYLES)).toBe("satellite");
  });

  // A different failure from the one above: not "a new basemap went unnoticed" but
  // "the last inline basemap quietly became a style URL". fallbackBasemap can only
  // recover onto an inline style, so if someone swaps Esri or OpenTopoMap for a hosted
  // style, every remote basemap silently loses its escape route and a flaky CDN leaves
  // the user on a permanent black rectangle — the exact failure resilience.ts exists
  // to prevent. Cheap to assert, and it holds no matter how the registry grows.
  it("gives EVERY remote basemap a fallback, and never onto another remote style", () => {
    const remote = ALL_KEYS.filter((k) => isRemoteStyle(k, STYLES));
    expect(remote.length).toBeGreaterThan(0);
    for (const key of remote) {
      const to = fallbackBasemap(key, STYLES);
      expect(to, `${key} is remote and can fail, but has no fallback`).not.toBeNull();
      expect(isRemoteStyle(to as BasemapKey, STYLES), `${key} falls back to another remote style`).toBe(false);
    }
  });

  it("never falls back from an inline basemap (its style cannot fail)", () => {
    for (const key of ALL_KEYS.filter((k) => !isRemoteStyle(k, STYLES))) {
      expect(fallbackBasemap(key, STYLES), `${key} is inline and should not fall back`).toBeNull();
    }
  });

  it("never falls back to another remote style", () => {
    const allRemote = Object.fromEntries(
      ALL_KEYS.map((k) => [k, { style: `https://example.invalid/${k}.json` }]),
    ) as Record<BasemapKey, { style: string | object }>;
    expect(fallbackBasemap("streets", allRemote)).toBeNull();
    expect(fallbackBasemap("streets", allRemote)).toBeNull();
  });
});

describe("retryDelayMs", () => {
  it("backs off, and stays short enough that the stage never looks dead", () => {
    expect(retryDelayMs(1)).toBe(600);
    expect(retryDelayMs(2)).toBe(1800);
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));
  });

  it("clamps out-of-range attempts instead of returning undefined", () => {
    expect(retryDelayMs(0)).toBe(600);
    expect(retryDelayMs(99)).toBe(1800);
  });
});

describe("nextRecoveryStep", () => {
  it("retries while attempts remain", () => {
    expect(nextRecoveryStep(1, "streets", STYLES)).toEqual({ action: "retry", delayMs: 600 });
    expect(nextRecoveryStep(2, "streets", STYLES)).toEqual({ action: "retry", delayMs: 1800 });
  });

  it("falls back once the attempts are spent", () => {
    expect(nextRecoveryStep(MAX_STYLE_ATTEMPTS, "streets", STYLES)).toEqual({
      action: "fallback",
      to: "satellite",
    });
  });

  it("gives up rather than looping when there is nothing to fall back to", () => {
    expect(nextRecoveryStep(MAX_STYLE_ATTEMPTS, "satellite", STYLES)).toEqual({ action: "give-up" });
  });
});
