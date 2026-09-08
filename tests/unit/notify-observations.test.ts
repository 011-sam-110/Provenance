import { describe, it, expect } from "vitest";
import { obsKey, pruneObservations } from "@/lib/notify/observations";
import { EMPTY_OBSERVATION } from "@/lib/notify/engine";

describe("obsKey", () => {
  it("separates the same source watched by two different areas, which is the whole point of a per-area rule", () => {
    expect(obsKey("area:1", "planes")).not.toBe(obsKey("area:2", "planes"));
  });

  it("is stable for the same pair", () => {
    expect(obsKey("area:1", "planes")).toBe(obsKey("area:1", "planes"));
  });
});

describe("pruneObservations", () => {
  const saved = {
    [obsKey("area:1", "planes")]: EMPTY_OBSERVATION,
    [obsKey("area:gone", "planes")]: EMPTY_OBSERVATION,
  };

  it("keeps an observation whose pair is still armed", () => {
    const live = new Set([obsKey("area:1", "planes")]);
    expect(Object.keys(pruneObservations(saved, live))).toEqual([obsKey("area:1", "planes")]);
  });

  it("drops an observation for a pair nothing watches any more, so the key cannot grow without bound", () => {
    const live = new Set([obsKey("area:1", "planes")]);
    expect(pruneObservations(saved, live)[obsKey("area:gone", "planes")]).toBeUndefined();
  });

  it("returns an empty map for junk rather than throwing", () => {
    expect(pruneObservations("nonsense", new Set())).toEqual({});
    expect(pruneObservations(null, new Set())).toEqual({});
  });

  it("drops an entry whose shape is not an Observation, so a corrupt row cannot reach the engine as `prev`", () => {
    const corrupt = { [obsKey("area:1", "planes")]: { rows: "not an object" } };
    expect(pruneObservations(corrupt, new Set([obsKey("area:1", "planes")]))).toEqual({});
  });
});
