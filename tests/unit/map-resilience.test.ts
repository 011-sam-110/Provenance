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

// Mirrors the real registry shape: positron is a remote style URL, the other two
// are inline StyleSpecifications.
const STYLES = BASEMAPS as unknown as Record<BasemapKey, { style: string | object }>;

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
  it("knows which real basemaps can fail to load", () => {
    expect(isRemoteStyle("positron", STYLES)).toBe(true);
    expect(isRemoteStyle("satellite", STYLES)).toBe(false);
    expect(isRemoteStyle("topo", STYLES)).toBe(false);
  });

  it("falls back from the remote Light basemap to inline satellite", () => {
    expect(fallbackBasemap("positron", STYLES)).toBe("satellite");
  });

  it("never falls back from an inline basemap (its style cannot fail)", () => {
    expect(fallbackBasemap("satellite", STYLES)).toBeNull();
    expect(fallbackBasemap("topo", STYLES)).toBeNull();
  });

  it("never falls back to another remote style", () => {
    const allRemote = {
      positron: { style: "https://a/style.json" },
      satellite: { style: "https://b/style.json" },
      topo: { style: "https://c/style.json" },
    } as Record<BasemapKey, { style: string | object }>;
    expect(fallbackBasemap("positron", allRemote)).toBeNull();
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
    expect(nextRecoveryStep(1, "positron", STYLES)).toEqual({ action: "retry", delayMs: 600 });
    expect(nextRecoveryStep(2, "positron", STYLES)).toEqual({ action: "retry", delayMs: 1800 });
  });

  it("falls back once the attempts are spent", () => {
    expect(nextRecoveryStep(MAX_STYLE_ATTEMPTS, "positron", STYLES)).toEqual({
      action: "fallback",
      to: "satellite",
    });
  });

  it("gives up rather than looping when there is nothing to fall back to", () => {
    expect(nextRecoveryStep(MAX_STYLE_ATTEMPTS, "satellite", STYLES)).toEqual({ action: "give-up" });
  });
});
