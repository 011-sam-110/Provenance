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
import { NEWS_ATTRIBUTION } from "@/lib/news/sources";

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
 * Rail rows that are a CONSOLE WIDGET and nothing else.
 *
 * The mirror image of EXTRA_MAP_LAYERS above: those are layers with no widget,
 * these are widgets with no layer. World Headlines reads 14 publisher RSS feeds
 * and groups them by story — there is no geometry in any of it, so it draws
 * nothing on the map and carries no toggle.
 *
 * It was reachable only from the shortcuts palette, which means it was reachable
 * only by someone who already knew it existed. The rail is where a reader goes
 * to find out WHAT this app can show them, so a widget missing from it is a
 * widget most people never discover.
 *
 * Group "Intel" puts it beside News coverage, the GDELT layer, under "Conflict &
 * security" — an existing group, so the rail gains a row and not a heading, and
 * the section guard in tests/unit/console-source-sections.test.ts stays quiet.
 */
const WIDGET_ONLY_SOURCES: CatalogSource[] = [
  {
    id: "news",
    kind: "core",
    label: "World Headlines",
    group: "Intel",
    color: "#0e7490",
    attribution: NEWS_ATTRIBUTION,
    // The widget polls on its own schedule; nothing here reads this.
    refreshMs: 0,
    widgetOnly: true,
  },
];

/** The ids this module adds that place a widget but never paint the map. */
export const WIDGET_ONLY_SOURCE_IDS: readonly string[] = WIDGET_ONLY_SOURCES.map((s) => s.id);

/**
 * Layer keys the rail deliberately does not draw, with the reason.
 *
 * Exported so the guard test can assert the set is EXHAUSTIVE rather than just
 * non-empty: every LayerKey has to be a catalog source, an extra row here, or
 * listed as an intentional omission.
 */
export const OMITTED_LAYERS: readonly LayerKey[] = PLANNED_LAYERS;

/** Catalog sources, plus the map layers and the widget-only rows that are not in it. */
export const RAIL_SOURCES: readonly CatalogSource[] = [
  ...SOURCE_CATALOG,
  ...EXTRA_MAP_LAYERS,
  ...WIDGET_ONLY_SOURCES,
];
