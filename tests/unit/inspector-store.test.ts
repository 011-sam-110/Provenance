import { expect, test } from "vitest";
import {
  AREA_CAP,
  ALWAYS_ON_SOURCES,
  activeSet,
  addArea,
  coerceState,
  effectiveSet,
  newArea,
  removeArea,
  renameArea,
  replaceActive,
  writeActive,
  type InspectorArea,
  type InspectorState,
} from "@/lib/shell/inspector";

const RING: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];

function area(id: string, createdAt = 1): InspectorArea {
  return { id, label: id, polygon: RING, bbox: [36, 49.8, 36.5, 50.2], createdAt, sources: {} };
}

function state(partial: Partial<InspectorState> = {}): InspectorState {
  return { world: {}, areas: [], loaded: null, ...partial };
}

test("newArea derives a bbox and keeps the ring open", () => {
  const a = newArea(RING, "Kharkiv corridor", 1788744123456);
  expect(a).not.toBeNull();
  expect(a!.bbox).toEqual([36, 49.8, 36.5, 50.2]);
  expect(a!.polygon).toHaveLength(4);
  expect(a!.label).toBe("Kharkiv corridor");
  expect(a!.sources).toEqual({});
});

test("newArea refuses a ring that is not an area", () => {
  expect(newArea([[0, 0], [1, 1]], "line", 1)).toBeNull();
  expect(newArea([], "empty", 1)).toBeNull();
});

test("addArea puts the newest first and dedupes by id", () => {
  const list = addArea(addArea([], area("a")), area("b"));
  expect(list.map((x) => x.id)).toEqual(["b", "a"]);
  const again = addArea(list, { ...area("a"), label: "renamed" });
  expect(again.map((x) => x.id)).toEqual(["a", "b"]);
  expect(again[0].label).toBe("renamed");
});

test("addArea caps the list, dropping the oldest", () => {
  let list: InspectorArea[] = [];
  for (let i = 0; i < AREA_CAP + 5; i++) list = addArea(list, area(`a${i}`, i));
  expect(list).toHaveLength(AREA_CAP);
  expect(list[0].id).toBe(`a${AREA_CAP + 4}`);
});

test("removeArea and renameArea are pure and by id", () => {
  const list = addArea(addArea([], area("a")), area("b"));
  expect(removeArea(list, "a").map((x) => x.id)).toEqual(["b"]);
  expect(renameArea(list, "b", "Gulf of Aden")[0].label).toBe("Gulf of Aden");
  expect(list[0].label).toBe("b"); // original untouched
});

test("activeSet returns World's set when nothing is loaded", () => {
  const s = state({ world: { cameras: true }, areas: [area("a")], loaded: null });
  expect(activeSet(s)).toEqual({ cameras: true });
});

test("activeSet returns the loaded area's own set", () => {
  const a = { ...area("a"), sources: { planes: true } };
  expect(activeSet(state({ world: { cameras: true }, areas: [a], loaded: "a" }))).toEqual({ planes: true });
});

test("a loaded id that no longer exists falls back to World", () => {
  const s = state({ world: { cameras: true }, areas: [], loaded: "gone" });
  expect(activeSet(s)).toEqual({ cameras: true });
});

test("effectiveSet forces the always-on sources on inside an area", () => {
  const a = { ...area("a"), sources: { planes: true } };
  const eff = effectiveSet(state({ areas: [a], loaded: "a" }));
  for (const id of ALWAYS_ON_SOURCES) expect(eff[id]).toBe(true);
  expect(eff.planes).toBe(true);
});

test("effectiveSet leaves World alone — webcams stays opt-in on the globe", () => {
  const eff = effectiveSet(state({ world: { cameras: true } }));
  expect(eff).toEqual({ cameras: true });
  expect(eff.webcams).toBeUndefined();
});

test("writeActive lands on the loaded area and leaves World untouched", () => {
  const a = area("a");
  const s = state({ world: { cameras: true }, areas: [a], loaded: "a" });
  const next = writeActive(s, "planes", true);
  expect(next.areas[0].sources).toEqual({ planes: true });
  expect(next.world).toEqual({ cameras: true });
});

test("writeActive lands on World when nothing is loaded", () => {
  const next = writeActive(state({ world: {} }), "planes", true);
  expect(next.world).toEqual({ planes: true });
});

test("replaceActive swaps the whole set for the loaded context only", () => {
  const a = { ...area("a"), sources: { planes: true } };
  const s = state({ world: { cameras: true }, areas: [a], loaded: "a" });
  const next = replaceActive(s, { ships: true });
  expect(next.areas[0].sources).toEqual({ ships: true });
  expect(next.world).toEqual({ cameras: true });
});

test("coerceState turns junk into a valid empty state", () => {
  expect(coerceState(null)).toEqual({ world: {}, areas: [], loaded: null });
  expect(coerceState("nonsense")).toEqual({ world: {}, areas: [], loaded: null });
  expect(coerceState({ areas: "no" })).toEqual({ world: {}, areas: [], loaded: null });
});

test("coerceState drops areas whose ring is not an area, and a dangling loaded id", () => {
  const s = coerceState({
    world: { cameras: true, junk: "yes" },
    areas: [
      { id: "good", label: "Good", polygon: RING, createdAt: 1, sources: { planes: true } },
      { id: "bad", label: "Bad", polygon: [[0, 0]], createdAt: 2, sources: {} },
    ],
    loaded: "bad",
  });
  expect(s.areas.map((a) => a.id)).toEqual(["good"]);
  expect(s.world).toEqual({ cameras: true });
  expect(s.loaded).toBeNull();
});

test("coerceState recomputes the bbox rather than trusting the payload", () => {
  const s = coerceState({
    world: {},
    areas: [{ id: "a", label: "A", polygon: RING, bbox: [0, 0, 0, 0], createdAt: 1, sources: {} }],
    loaded: null,
  });
  expect(s.areas[0].bbox).toEqual([36, 49.8, 36.5, 50.2]);
});
