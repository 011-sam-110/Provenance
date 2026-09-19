import { expect, test } from "vitest";
import {
  AREA_CAP,
  addArea,
  coerceState,
  editingSet,
  newArea,
  recolourArea,
  removeArea,
  renameArea,
  replaceActive,
  sourceRegions,
  unionSet,
  writeActive,
  type InspectorArea,
  type InspectorState,
} from "@/lib/shell/inspector";
import { DEFAULT_AREA_COLOR } from "@/lib/shell/areaColors";

const RING: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];

function area(id: string, createdAt = 1): InspectorArea {
  return {
    id,
    label: id,
    color: DEFAULT_AREA_COLOR,
    polygon: RING,
    bbox: [36, 49.8, 36.5, 50.2],
    createdAt,
    sources: {},
  };
}

function state(partial: Partial<InspectorState> = {}): InspectorState {
  return { world: {}, areas: [], editing: null, ...partial };
}

test("newArea derives a bbox and keeps the ring open", () => {
  const a = newArea(RING, "Kharkiv corridor", 1788744123456);
  expect(a).not.toBeNull();
  expect(a!.bbox).toEqual([36, 49.8, 36.5, 50.2]);
  expect(a!.polygon).toHaveLength(4);
  expect(a!.label).toBe("Kharkiv corridor");
  expect(a!.sources).toEqual({});
});

test("newArea takes a colour, coerced, and defaults to the one areas already had", () => {
  // The default matters more than it looks: every area saved before the colour feature
  // existed has no colour field, and coerceState sends it here. #0ea5e9 is what the map
  // hardcoded, so those areas keep the colour they were already drawn in.
  expect(newArea(RING, "x", 1)!.color).toBe(DEFAULT_AREA_COLOR);
  expect(newArea(RING, "x", 1, "#22c55e")!.color).toBe("#22c55e");
  // Junk never reaches a pile of paint expressions: MapLibre drops the LAYER over one
  // it cannot parse, which would take every area off the map rather than one.
  expect(newArea(RING, "x", 1, "cornflowerblue")!.color).toBe(DEFAULT_AREA_COLOR);
});

test("recolourArea rewrites one area and coerces what it is given", () => {
  const areas = [area("a"), area("b")];
  const next = recolourArea(areas, "a", "#EF4444");
  expect(next[0].color).toBe("#ef4444");
  // Untouched, and by identity — the other areas must not be re-created by a write
  // that had nothing to say about them.
  expect(next[1]).toBe(areas[1]);
  expect(recolourArea(areas, "nope", "#ef4444")[0].color).toBe(DEFAULT_AREA_COLOR);
  expect(recolourArea(areas, "a", "not-a-colour")[0].color).toBe(DEFAULT_AREA_COLOR);
});

test("coerceState gives a colour to areas saved before there was one", () => {
  // The upgrade path, and the reason `color` being required on the type is safe: an
  // envelope written by an older build has no such field, and it comes back as the
  // colour those areas were already being painted in rather than as undefined.
  const saved = {
    world: {},
    editing: null,
    areas: [
      { id: "area:1", label: "old", polygon: RING, bbox: [0, 0, 0, 0], createdAt: 1, sources: {} },
      { id: "area:2", label: "stored", color: "#A855F7", polygon: RING, bbox: [0, 0, 0, 0], createdAt: 2, sources: {} },
      { id: "area:3", label: "junk", color: "chartreuse", polygon: RING, bbox: [0, 0, 0, 0], createdAt: 3, sources: {} },
    ],
  };
  const coerced = coerceState(saved);
  expect(coerced.areas.map((a) => a.color)).toEqual([
    DEFAULT_AREA_COLOR,
    "#a855f7",
    DEFAULT_AREA_COLOR,
  ]);
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

test("editingSet returns World's set when the rail points at World", () => {
  const s = state({ world: { cameras: true }, areas: [area("a")], editing: null });
  expect(editingSet(s)).toEqual({ cameras: true });
});

test("editingSet returns the edited area's own set", () => {
  const a = { ...area("a"), sources: { planes: true } };
  expect(editingSet(state({ world: { cameras: true }, areas: [a], editing: "a" }))).toEqual({ planes: true });
});

test("an editing id that no longer exists falls back to World", () => {
  const s = state({ world: { cameras: true }, areas: [], editing: "gone" });
  expect(editingSet(s)).toEqual({ cameras: true });
});

// ── The composition rule: World everywhere, each area inside its own ring ────

test("unionSet ORs every area onto World", () => {
  const a = { ...area("a"), sources: { fires: true } };
  const b = { ...area("b"), sources: { quakes: true } };
  expect(unionSet(state({ world: { cameras: true }, areas: [a, b] }))).toEqual({
    cameras: true, fires: true, quakes: true,
  });
});

test("an area cannot switch off a source World has on", () => {
  // The whole point of the additive model. An area declining a source is that area
  // declining it, never a veto for the globe.
  const a = { ...area("a"), sources: { cameras: false } };
  expect(unionSet(state({ world: { cameras: true }, areas: [a] })).cameras).toBe(true);
});

test("an area's set is live whether or not the rail is pointed at it", () => {
  // The bug the model exists to fix: this used to depend on which area was loaded.
  const a = { ...area("a"), sources: { fires: true } };
  const b = { ...area("b"), sources: { quakes: true } };
  for (const editing of [null, "a", "b"]) {
    const u = unionSet(state({ areas: [a, b], editing }));
    expect(u.fires).toBe(true);
    expect(u.quakes).toBe(true);
  }
});

test("sourceRegions is null — everywhere — whenever World has the source on", () => {
  const a = { ...area("a"), sources: { cameras: true } };
  expect(sourceRegions(state({ world: { cameras: true }, areas: [a] }), "cameras")).toBeNull();
});

test("sourceRegions names only the areas that asked for the source", () => {
  const a = { ...area("a"), sources: { fires: true } };
  const b = { ...area("b"), sources: { fires: false } };
  const c = { ...area("c"), sources: { fires: true } };
  const got = sourceRegions(state({ areas: [a, b, c] }), "fires");
  expect(got?.map((x) => x.id)).toEqual(["a", "c"]);
});

test("sourceRegions is empty — nowhere — for a source nothing has on", () => {
  expect(sourceRegions(state({ areas: [area("a")] }), "fires")).toEqual([]);
});

test("writeActive lands on the edited area and leaves World untouched", () => {
  const a = area("a");
  const s = state({ world: { cameras: true }, areas: [a], editing: "a" });
  const next = writeActive(s, "planes", true);
  expect(next.areas[0].sources).toEqual({ planes: true });
  expect(next.world).toEqual({ cameras: true });
});

test("writeActive lands on World when the rail points at World", () => {
  const next = writeActive(state({ world: {} }), "planes", true);
  expect(next.world).toEqual({ planes: true });
});

test("replaceActive swaps the whole set for the edited context only", () => {
  const a = { ...area("a"), sources: { planes: true } };
  const s = state({ world: { cameras: true }, areas: [a], editing: "a" });
  const next = replaceActive(s, { ships: true });
  expect(next.areas[0].sources).toEqual({ ships: true });
  expect(next.world).toEqual({ cameras: true });
});

test("coerceState turns junk into a valid empty state", () => {
  expect(coerceState(null)).toEqual({ world: {}, areas: [], editing: null });
  expect(coerceState("nonsense")).toEqual({ world: {}, areas: [], editing: null });
  expect(coerceState({ areas: "no" })).toEqual({ world: {}, areas: [], editing: null });
});

test("coerceState reads the field's old `loaded` name — a returning user keeps their pen", () => {
  const s = coerceState({
    world: {},
    areas: [{ id: "a", label: "A", polygon: RING, createdAt: 1, sources: {} }],
    loaded: "a",
  });
  expect(s.editing).toBe("a");
});

test("coerceState drops areas whose ring is not an area, and a dangling id", () => {
  const s = coerceState({
    // `planes`, not a camera key: a RETIRED key would be expanded by cleanSet on the
    // way in (see the migration test below), which is a different behaviour from the
    // "keep the booleans, drop everything else" rule this test is about.
    world: { planes: true, junk: "yes" },
    areas: [
      { id: "good", label: "Good", polygon: RING, createdAt: 1, sources: { planes: true } },
      { id: "bad", label: "Bad", polygon: [[0, 0]], createdAt: 2, sources: {} },
    ],
    editing: "bad",
  });
  expect(s.areas.map((a) => a.id)).toEqual(["good"]);
  expect(s.world).toEqual({ planes: true });
  expect(s.editing).toBeNull();
});

test("coerceState recomputes the bbox rather than trusting the payload", () => {
  const s = coerceState({
    world: {},
    areas: [{ id: "a", label: "A", polygon: RING, bbox: [0, 0, 0, 0], createdAt: 1, sources: {} }],
    editing: null,
  });
  expect(s.areas[0].bbox).toEqual([36, 49.8, 36.5, 50.2]);
});
