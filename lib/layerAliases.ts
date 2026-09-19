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
