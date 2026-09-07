import { expect, test } from "vitest";
import { filterToScopes, scopesForSource } from "@/lib/shell/sourceScope";
import { aoiScope } from "@/lib/shell/scope";
import type { InspectorArea, InspectorState } from "@/lib/shell/inspector";

/** A square around Kharkiv, and one around Gaza. Deliberately far apart. */
const KHARKIV: [number, number][] = [
  [36.0, 49.8],
  [36.5, 49.8],
  [36.5, 50.2],
  [36.0, 50.2],
];
const GAZA: [number, number][] = [
  [34.2, 31.2],
  [34.6, 31.2],
  [34.6, 31.6],
  [34.2, 31.6],
];

function area(id: string, ring: [number, number][], sources: Record<string, boolean>): InspectorArea {
  return { id, label: id, polygon: ring, bbox: [0, 0, 0, 0], createdAt: 1, sources };
}

function state(partial: Partial<InspectorState> = {}): InspectorState {
  return { world: {}, areas: [], editing: null, ...partial };
}

const IN_KHARKIV = { lat: 50.0, lon: 36.25 };
const IN_GAZA = { lat: 31.4, lon: 34.4 };
const IN_LONDON = { lat: 51.5, lon: -0.12 };
const at = (p: { lat: number; lon: number }) => p;

test("null scopes means everywhere, and keeps the array identity", () => {
  // Identity matters: these results feed hooks whose consumers memoise on them, and
  // the unrestricted case is the common one.
  const items = [IN_KHARKIV, IN_LONDON];
  expect(filterToScopes(items, null, at)).toBe(items);
});

test("an empty scope list means nowhere, not everywhere", () => {
  // The dangerous default. A source nothing has on must draw nothing; falling back
  // to "everywhere" would put a source the user never asked for across the globe.
  expect(filterToScopes([IN_KHARKIV, IN_LONDON], [], at)).toEqual([]);
});

test("one ring keeps only what is inside it", () => {
  const got = filterToScopes([IN_KHARKIV, IN_GAZA, IN_LONDON], [aoiScope(KHARKIV)], at);
  expect(got).toEqual([IN_KHARKIV]);
});

test("several rings UNION rather than intersect", () => {
  // Two areas that both want fires want the fires in either of them. A point has to
  // be in one ring, not in both.
  const got = filterToScopes(
    [IN_KHARKIV, IN_GAZA, IN_LONDON],
    [aoiScope(KHARKIV), aoiScope(GAZA)],
    at,
  );
  expect(got).toEqual([IN_KHARKIV, IN_GAZA]);
});

test("an item with no position is dropped under a ring", () => {
  // Same ruling lib/scopeFilter.ts makes: "I do not know where this is" cannot
  // honestly answer "is it inside the boundary you drew to exclude things".
  const items = [IN_KHARKIV, { lat: null, lon: null }];
  const got = filterToScopes(items, [aoiScope(KHARKIV)], (p) =>
    typeof p.lat === "number" && typeof p.lon === "number" ? { lat: p.lat, lon: p.lon } : null,
  );
  expect(got).toEqual([IN_KHARKIV]);
});

test("scopesForSource is null whenever World has the source on", () => {
  const s = state({
    world: { fires: true },
    areas: [area("a", KHARKIV, { fires: true })],
  });
  expect(scopesForSource(s, "fires")).toBeNull();
});

test("scopesForSource returns one scope per area that asked for the source", () => {
  const s = state({
    areas: [area("a", KHARKIV, { fires: true }), area("b", GAZA, { fires: true })],
  });
  const got = scopesForSource(s, "fires")!;
  expect(got).toHaveLength(2);
  expect(got.every((x) => x.mode === "aoi")).toBe(true);
});

test("scopesForSource is identity-stable for one state — a fresh array per call loops React", () => {
  // It is read from a useSyncExternalStore snapshot getter, and React compares
  // snapshots by identity. This is the same guard inspector.ts carries one layer down.
  const s = state({ areas: [area("a", KHARKIV, { fires: true })] });
  expect(scopesForSource(s, "fires")).toBe(scopesForSource(s, "fires"));
});

test("scopesForSource re-derives when the state object changes", () => {
  // The mirror of the test above: memoising is only safe because the state object is
  // replaced on every write. A cache that outlived a write would serve the old rings.
  const a = area("a", KHARKIV, { fires: true });
  const before = scopesForSource(state({ areas: [a] }), "fires");
  const after = scopesForSource(state({ areas: [a, area("b", GAZA, { fires: true })] }), "fires");
  expect(before).toHaveLength(1);
  expect(after).toHaveLength(2);
});

test("the bbox is re-derived from the ring rather than trusted", () => {
  // Every `area()` above carries a deliberately wrong [0,0,0,0] bbox. withinScope
  // uses the bbox as a cheap reject BEFORE the point-in-polygon test, so trusting it
  // would filter every real point out and look exactly like an empty upstream.
  const s = state({ areas: [area("a", KHARKIV, { fires: true })] });
  const got = filterToScopes([IN_KHARKIV], scopesForSource(s, "fires"), at);
  expect(got).toEqual([IN_KHARKIV]);
});
