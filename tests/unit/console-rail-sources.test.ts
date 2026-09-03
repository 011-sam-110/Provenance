import { expect, test } from "vitest";
import {
  EXTRA_MAP_LAYER_IDS,
  OMITTED_LAYERS,
  RAIL_SOURCES,
} from "@/lib/console/sources/railSources";
import { buildSourceSections } from "@/lib/console/sources/sections";
import { SOURCE_CATALOG } from "@/lib/sources/catalog";
import { DEFAULT_STATE, type LayerKey } from "@/lib/layers";

const ALL_LAYER_KEYS = Object.keys(DEFAULT_STATE) as LayerKey[];

// THIS IS THE GUARD THE REFACTOR NEEDED AND DID NOT HAVE.
//
// The rail used to be built from LAYER_META, a hand-written table keyed by
// LayerKey. Rebuilding it from SOURCE_CATALOG silently dropped every layer that
// is toggleable but has no adapter — `countries` being the live example. Nothing
// would have failed; the rail would just have had one fewer row.
test("every map layer is either a catalog source, a rail extra, or a stated omission", () => {
  const catalogIds = new Set(SOURCE_CATALOG.map((s) => s.id));
  const extras = new Set(EXTRA_MAP_LAYER_IDS);
  const omitted = new Set<string>(OMITTED_LAYERS);

  const unaccounted = ALL_LAYER_KEYS.filter(
    (k) => !catalogIds.has(k) && !extras.has(k) && !omitted.has(k),
  );
  expect(
    unaccounted,
    `layer keys nothing accounts for: ${unaccounted.join(", ")} — add a row or state the omission`,
  ).toEqual([]);
});

test("the omissions are real layer keys, so the list cannot rot into a no-op", () => {
  for (const k of OMITTED_LAYERS) expect(ALL_LAYER_KEYS).toContain(k);
});

test("an extra map layer is not already in the catalog", () => {
  const catalogIds = new Set(SOURCE_CATALOG.map((s) => s.id));
  for (const id of EXTRA_MAP_LAYER_IDS) expect(catalogIds.has(id)).toBe(false);
});

test("the rail lists the whole catalog plus the extras, with no duplicates", () => {
  expect(RAIL_SOURCES.length).toBe(SOURCE_CATALOG.length + EXTRA_MAP_LAYER_IDS.length);
  expect(new Set(RAIL_SOURCES.map((s) => s.id)).size).toBe(RAIL_SOURCES.length);
});

// The borders row is the one this whole module exists for, so it is named.
test("the borders layer reaches a section rather than vanishing", () => {
  const rows = buildSourceSections(RAIL_SOURCES).flatMap((s) => s.rows);
  const borders = rows.find((r) => r.id === "countries");
  expect(borders, "countries fell out of the rail").toBeDefined();
  expect(borders!.label).toBe("Borders & names");
});

test("no rail source falls through to the Other section", () => {
  const sections = buildSourceSections(RAIL_SOURCES);
  expect(sections.find((s) => s.id === "other")).toBeUndefined();
});
