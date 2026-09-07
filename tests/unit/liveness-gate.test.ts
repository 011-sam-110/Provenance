import { describe, expect, it } from "vitest";
import type { Camera } from "@/lib/types";
import { GRANDFATHERED_SOURCES, emptyLedger, gateCameras, isAdmitted, type LiveLedger } from "@/lib/liveness/ledger";

const cam = (id: string, source: string): Camera => ({
  id,
  source,
  country: "US",
  name: id,
  lat: 34,
  lon: -118,
  mediaType: "video",
  refreshSeconds: 60,
  license: "test",
  attribution: "test",
  available: true,
});

const ledgerWith = (ids: string[]): LiveLedger => ({
  ...emptyLedger(),
  admitted: ids.map((cameraId) => ({
    cameraId,
    feed: "newfeed",
    streamUrl: `https://x.gov/${cameraId}.m3u8`,
    kind: "hls" as const,
    producingMs: 6_000,
    signedAt: "2026-09-08T00:00:00.000Z",
  })),
});

describe("gateCameras", () => {
  it("emits only the admitted camera from a gated source", () => {
    // The failure this exists to prevent: a camera nobody signed reaching the map.
    const cameras = [cam("newfeed:1", "newfeed"), cam("newfeed:2", "newfeed"), cam("newfeed:3", "newfeed")];
    const out = gateCameras(cameras, "newfeed", ledgerWith(["newfeed:2"]), new Set(["newfeed"]));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("newfeed:2");
  });

  it("passes an ungated source through untouched", () => {
    // The mirror, and the worse bug of the two. Every existing camera has no ledger
    // entry, so a gate that applied to everything would empty the map on first deploy.
    const cameras = [cam("scdot:1", "scdot"), cam("scdot:2", "scdot")];
    const out = gateCameras(cameras, "scdot", emptyLedger(), new Set(["newfeed"]));
    expect(out).toEqual(cameras);
  });

  it("emits nothing from a gated source with an empty ledger, rather than everything", () => {
    // Default-DENY. Getting this backwards fails open, which is the direction that
    // silently puts unverified cameras on the map.
    const cameras = [cam("newfeed:1", "newfeed")];
    expect(gateCameras(cameras, "newfeed", emptyLedger(), new Set(["newfeed"]))).toEqual([]);
  });

  it("does not admit a camera by id alone when it came from a different feed", () => {
    // Camera ids are `${source}:${nativeId}`, so a collision needs two feeds to pick
    // the same key. Cheap to rule out, and the failure would be an admission signed
    // for one operator silently authorising another.
    const cameras = [cam("newfeed:1", "newfeed")];
    const ledger: LiveLedger = {
      ...emptyLedger(),
      admitted: [
        {
          cameraId: "newfeed:1",
          feed: "otherfeed",
          streamUrl: "https://x.gov/1.m3u8",
          kind: "hls",
          producingMs: 6_000,
          signedAt: "2026-09-08T00:00:00.000Z",
        },
      ],
    };
    expect(gateCameras(cameras, "newfeed", ledger, new Set(["newfeed"]))).toEqual([]);
  });

  it("keeps every existing feed out of the gated set", () => {
    // If a live feed ever lands in GRANDFATHERED_SOURCES and the gated set at once,
    // the gate would delete cameras that are already on the map.
    for (const key of ["scdot", "caltrans", "castlerock", "tfl", "mup-rs"]) {
      expect(GRANDFATHERED_SOURCES.has(key)).toBe(true);
    }
    expect(GRANDFATHERED_SOURCES.size).toBe(17);
  });
});

describe("isAdmitted", () => {
  it("requires the feed and the id to agree", () => {
    const ledger = ledgerWith(["newfeed:7"]);
    expect(isAdmitted(ledger, "newfeed", "newfeed:7")).toBe(true);
    expect(isAdmitted(ledger, "newfeed", "newfeed:8")).toBe(false);
    expect(isAdmitted(ledger, "elsewhere", "newfeed:7")).toBe(false);
  });
});
