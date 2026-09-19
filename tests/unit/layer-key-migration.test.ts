import { expect, test } from "vitest";
import { coerceState } from "@/lib/shell/inspector";
import { expandLegacyLayers, DEFAULT_STATE, LEGACY_LAYER_ALIASES } from "@/lib/layers";
import { RETIRED_LAYER_KEYS } from "@/lib/layerAliases";

// The camera layers were renamed — `cameras`/`webcams` became `livecams`/`staticcams`
// — and this file covers the three places that can still be holding the old names:
// a saved source context, a saved variant override, and a `?layers=` link someone
// already sent. The link is tested in tests/unit/share-url.test.ts; the other two
// are here.
//
// WHY THIS IS WORTH A TEST RATHER THAN A COMMENT. Every one of these failures is
// SILENT. An unknown key spread over DEFAULT_STATE type-checks, runs, and changes
// nothing — so a returning user's saved toggles quietly revert to the defaults with
// no error anywhere. Nothing else in the suite would go red.

const RING: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

test("the alias table is one-way: nothing maps a live key back to a retired one", () => {
  const live = new Set(Object.keys(DEFAULT_STATE));
  for (const [retired, replacements] of Object.entries(RETIRED_LAYER_KEYS)) {
    expect(live.has(retired), `${retired} is still a live key`).toBe(false);
    for (const r of replacements) expect(live.has(r), `${retired} → ${r} is not a live key`).toBe(true);
  }
  // The typed re-export and the leaf table are the same object, so they cannot drift.
  expect(LEGACY_LAYER_ALIASES).toBe(RETIRED_LAYER_KEYS);
});

test("a saved World context keeps the cameras it was drawing", () => {
  // The set every returning user actually has: the shipped default, saved verbatim.
  const s = coerceState({ world: { cameras: true, webcams: false, planes: true }, areas: [], editing: null });
  expect(s.world).toEqual({ livecams: true, staticcams: true, planes: true });
});

test("cameras switched OFF stay off — the expansion is not a floor", () => {
  const s = coerceState({ world: { cameras: false, webcams: false }, areas: [], editing: null });
  expect(s.world).toEqual({ livecams: false, staticcams: false });
});

test("someone who had only the Windy webcams on gets the still tier, not both", () => {
  const s = coerceState({ world: { cameras: false, webcams: true }, areas: [], editing: null });
  expect(s.world).toEqual({ livecams: false, staticcams: true });
});

test("a saved AREA is migrated too, not just World", () => {
  const s = coerceState({
    world: {},
    areas: [{ id: "a", label: "A", polygon: RING, createdAt: 1, sources: { webcams: true, fires: true } }],
    editing: null,
  });
  expect(s.areas[0].sources).toEqual({ staticcams: true, fires: true });
});

test("a set saved under the new vocabulary is left alone", () => {
  const s = coerceState({ world: { livecams: true, staticcams: false }, areas: [], editing: null });
  expect(s.world).toEqual({ livecams: true, staticcams: false });
});

test("an explicitly saved new key beats anything a retired key would have expanded to", () => {
  // Only reachable from a hand-edited or half-migrated payload, but the rule has to
  // be decidable rather than dependent on key order.
  const s = coerceState({ world: { cameras: true, staticcams: false }, areas: [], editing: null });
  expect(s.world).toEqual({ livecams: true, staticcams: false });
});

test("expandLegacyLayers does the same for a variant override, and drops unknown keys", () => {
  expect(expandLegacyLayers({ cameras: false, planes: true })).toEqual({
    livecams: false,
    staticcams: false,
    planes: true,
  });
  // An unknown key spread over DEFAULT_STATE would ride along in the live state
  // object for the rest of the session.
  expect(expandLegacyLayers({ bogus: true, satellites: false })).toEqual({ satellites: false });
  expect(expandLegacyLayers(null)).toEqual({});
  expect(expandLegacyLayers("nope")).toEqual({});
});
