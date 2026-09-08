import { describe, it, expect } from "vitest";
import { coerceRules, rulesStore } from "@/lib/notify/rules";
import { WORLD_AREA_ID } from "@/lib/notify/types";

const AREAS = new Set(["area:1", "area:2"]);
const SOURCES = new Set(["earthquakes", "planes"]);

const good = {
  id: "rule:1",
  areaId: "area:1",
  sourceId: "earthquakes",
  params: { kind: "appears" },
  channels: { browser: true, telegram: false, discord: false },
  enabled: true,
  createdAt: 1,
};

describe("coerceRules", () => {
  it("keeps a well-formed rule", () => {
    expect(coerceRules([good], AREAS, SOURCES)).toHaveLength(1);
  });

  it("DROPS a rule naming an area that no longer exists, rather than retargeting it — a silently retargeted rule watches a place nobody asked about", () => {
    const orphan = { ...good, id: "rule:2", areaId: "area:deleted" };
    expect(coerceRules([orphan], AREAS, SOURCES)).toHaveLength(0);
  });

  it("drops a rule naming a source that is no longer registered", () => {
    const orphan = { ...good, id: "rule:3", sourceId: "food-security" };
    expect(coerceRules([orphan], AREAS, SOURCES)).toHaveLength(0);
  });

  it("keeps a World rule even though `world` is not a drawn area", () => {
    const w = { ...good, id: "rule:4", areaId: WORLD_AREA_ID };
    expect(coerceRules([w], AREAS, SOURCES)).toHaveLength(1);
  });

  it("drops a rule whose params carry a level that is not a number", () => {
    const bad = { ...good, id: "rule:5", params: { kind: "count", dir: "atOrAbove", level: "lots" } };
    expect(coerceRules([bad], AREAS, SOURCES)).toHaveLength(0);
  });

  it("drops a rule whose trigger kind is not one of the nine", () => {
    const bad = { ...good, id: "rule:6", params: { kind: "explodes" } };
    expect(coerceRules([bad], AREAS, SOURCES)).toHaveLength(0);
  });

  it("returns an empty list for junk rather than throwing, so a corrupt key cannot brick the console", () => {
    expect(coerceRules("not an array", AREAS, SOURCES)).toEqual([]);
    expect(coerceRules(null, AREAS, SOURCES)).toEqual([]);
    expect(coerceRules([42, undefined], AREAS, SOURCES)).toEqual([]);
  });

  it("defaults a missing `enabled` to false, so a half-written rule never fires unasked", () => {
    const partial = { ...good, id: "rule:7", enabled: undefined };
    expect(coerceRules([partial], AREAS, SOURCES)[0].enabled).toBe(false);
  });
});

describe("rulesStore snapshot identity", () => {
  it("returns the SAME array reference between writes, because a deriving getSnapshot loops useSyncExternalStore forever", () => {
    rulesStore.hydrate(AREAS, SOURCES);
    expect(rulesStore.forArea("area:1")).toBe(rulesStore.forArea("area:1"));
  });

  it("returns a NEW reference after a write, so subscribers actually re-render", () => {
    rulesStore.hydrate(AREAS, SOURCES);
    const first = rulesStore.forArea("area:1");
    rulesStore.add({ ...good, id: "rule:new" } as never);
    expect(rulesStore.forArea("area:1")).not.toBe(first);
  });
});
