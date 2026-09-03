// Everything the Sources rail lists, which is NOT quite the source catalog.
//
// SOURCE_CATALOG holds the 4 core layers and the signals. It does not hold every
// toggleable MAP LAYER: lib/layers.ts also defines `countries`, the Natural Earth
// borders-and-names reference layer. It is a real toggle that really moves the
// map, it has no adapter and no widget, and so it appears in no catalog.
//
// Rebuilding the rail off SOURCE_CATALOG alone would therefore have deleted a
// working control without anyone noticing — the rail would simply have had one
// fewer row than before. This module is the join, and the test beside it fails if
// a new LayerKey ever appears without being placed.
//
// The two PLANNED_LAYERS (`ships`, `weather`) are deliberately NOT here. They were
// dimmed, toggle-less signposts whose whole text said "live in Global signals" —
// they existed because the old rail hid the real AIS and weather layers inside a
// collapsed section. The new rail shows those rows in their own sections, so a
// signpost pointing at a row three lines further down is noise.

import type { CatalogSource } from "@/lib/sources/catalog";
import { SOURCE_CATALOG } from "@/lib/sources/catalog";
import { PLANNED_LAYERS, type LayerKey } from "@/lib/layers";

/**
 * Map layers that are toggleable but are not catalog sources.
 *
 * The metadata is written out because it exists nowhere else — lib/layers.ts
 * carries the key and the default, not a label or an attribution. Keep it to
 * layers that genuinely have no catalog entry.
 */
const EXTRA_MAP_LAYERS: CatalogSource[] = [
  {
    id: "countries",
    kind: "core",
    label: "Borders & names",
    group: "Reference",
    color: "#94a3b8",
    attribution: "Natural Earth — clickable country borders and names",
    refreshMs: 0,
  },
];

/** The ids this module adds on top of the catalog. */
export const EXTRA_MAP_LAYER_IDS: readonly string[] = EXTRA_MAP_LAYERS.map((l) => l.id);

/**
 * Layer keys the rail deliberately does not draw, with the reason.
 *
 * Exported so the guard test can assert the set is EXHAUSTIVE rather than just
 * non-empty: every LayerKey has to be a catalog source, an extra row here, or
 * listed as an intentional omission.
 */
export const OMITTED_LAYERS: readonly LayerKey[] = PLANNED_LAYERS;

/** Catalog sources plus the map layers that are not in the catalog. */
export const RAIL_SOURCES: readonly CatalogSource[] = [...SOURCE_CATALOG, ...EXTRA_MAP_LAYERS];
