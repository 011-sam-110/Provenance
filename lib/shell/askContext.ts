// lib/shell/askContext.ts
// What the question reader knows, built from the app's own tables.
//
// lib/shell/ask.ts is pure and imports no data. This file is the one place that
// hands it the real lists: the layers come from MAP_SIGNALS (the layers that are on
// the map, never the data-only sources), and the countries come from the centroid
// table and its alias table. A layer added to the registry is known to the reader
// by its label with no edit here.

import { MAP_SIGNALS } from "@/lib/signals/registry";
import { COUNTRY_CENTROIDS, COUNTRY_NAME_ALIASES } from "@/lib/signals/country-centroids.data";
import { buildAskContext, type AskContext, type AskLayer } from "@/lib/shell/ask";

let cached: AskContext | null = null;

/**
 * The reader's context. With no argument it is built one time from the registry.
 * A test passes its own layer list to prove that a removed layer leaves the reader.
 */
export function askContext(layers?: readonly AskLayer[]): AskContext {
  if (layers) return buildAskContext(layers, COUNTRY_CENTROIDS, COUNTRY_NAME_ALIASES);
  cached ??= buildAskContext(MAP_SIGNALS, COUNTRY_CENTROIDS, COUNTRY_NAME_ALIASES);
  return cached;
}
