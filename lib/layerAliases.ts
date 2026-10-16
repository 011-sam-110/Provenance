// Retired layer keys → the keys that replaced them.
//
// WHY THIS IS ITS OWN MODULE AND NOT A CONST IN lib/layers.ts. Two places have to
// read it, and they sit on opposite sides of a deliberate one-way dependency:
// lib/layers.ts is a VIEW onto lib/shell/inspector.ts, so inspector must never
// import layers back (its own header says so — the pair would be circular and
// neither would own the state). A leaf module with no imports of its own can be
// read from both without touching that rule.
//
// It is typed as plain strings here because `LayerKey` lives in lib/layers.ts and
// importing the type alone would be fine, but importing nothing at all is simpler
// and cannot rot into a value import by accident. lib/layers.ts re-exports this
// narrowed to `LayerKey`, which is what the rest of the app reads.

/**
 * `cameras` expands to BOTH tiers because that is what it drew — the whole road
 * registry, live and still together. `webcams` was the Windy layer, which is
 * entirely stills as ingested, so it lands in the still tier alone.
 */
export const RETIRED_LAYER_KEYS: Readonly<Record<string, readonly string[]>> = {
  cameras: ["livecams", "staticcams"],
  webcams: ["staticcams"],
};

/**
 * Retired SIGNAL ids → the ids that replaced them. A separate table from the layer
 * keys above because the two vocabularies are checked against different live lists
 * (DEFAULT_STATE for layers, the signal registry for these).
 *
 * `emsc-quakes` was the EMSC earthquake layer until 2026-10-16. EMSC is now one of
 * the catalogues of the `earthquakes` layer, so a saved toggle, an area, a variant
 * override or a `?sig=` link that held it opens that layer instead of nothing.
 */
export const RETIRED_SIGNAL_IDS: Readonly<Record<string, readonly string[]>> = {
  "emsc-quakes": ["earthquakes"],
};

/** Pure: an id list with retired signal ids replaced, de-duplicated, order kept. */
export function expandRetiredSignalIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    for (const next of RETIRED_SIGNAL_IDS[id] ?? [id]) if (!out.includes(next)) out.push(next);
  }
  return out;
}

/**
 * Pure: an on/off map with retired signal ids replaced. `true` wins when an old id and
 * its replacement disagree only if the replacement was not saved explicitly: a key
 * written under the new vocabulary always wins, the same rule as the layer keys.
 */
export function expandRetiredSignalSet(set: Readonly<Record<string, boolean>>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const expanded: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(set)) {
    const next = RETIRED_SIGNAL_IDS[k];
    if (next) for (const id of next) expanded[id] = (expanded[id] ?? false) || v;
    else out[k] = v;
  }
  return { ...expanded, ...out };
}
