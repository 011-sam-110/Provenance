// Display labels for the Sources rail.
//
// The rail shows one line per source in a two-column grid, so a 36-character
// label like "Humanitarian emergencies (ReliefWeb)" does not fit.
//
// THE RULE IS COLLISION-DRIVEN, NOT MECHANICAL, and that is the whole design.
// The first version simply rewrote every "Foo (BAR)" as "Foo · BAR". It fit the
// grid no better: "Space weather (NOAA Kp/storms)" became a 30-character
// "Space weather · NOAA Kp/storms" when nothing else in the catalog is called
// "Space weather" and plain "Space weather" would have done. A qualifier that
// distinguishes nothing is just a longer label.
//
// So a source gets its qualifier back ONLY when another source would otherwise
// share its name. Today that is exactly one pair — USGS "Earthquakes" and EMSC
// "Earthquakes (EMSC)" — and the second keeps "· EMSC" for that reason alone.
// The provider is never lost either way: the row's popover shows the full
// attribution, which is where a reader looks for provenance.
//
// The em-dash form is the other way round. In "Air quality — stations (OpenAQ)"
// the distinguishing half is "stations", because plain "Air quality" is a
// separate modelled layer; the parenthetical vendor is the redundant part. So
// the em-dash half is kept in the base name rather than treated as a qualifier.

const PAREN = /\s*\(([^)]+)\)\s*$/;
const EMDASH = /\s+—\s+/;

/** The label with its parenthetical removed and any em-dash turned into a middot. */
export function baseLabel(raw: string): string {
  return raw.replace(PAREN, "").replace(EMDASH, " · ");
}

/** The trailing parenthetical, if the label has one. */
export function qualifierOf(raw: string): string | null {
  return raw.match(PAREN)?.[1] ?? null;
}

/**
 * Resolve a whole set of raw labels to display labels at once.
 *
 * Takes the full list because a collision is a property of the SET, not of any
 * one label — you cannot tell whether "Earthquakes" needs qualifying without
 * knowing what else is in the catalog.
 *
 * Returns raw label → display label. A raw label that appears twice in the
 * input maps once; the catalog holds no exact duplicates and
 * tests/unit/console-source-labels.test.ts asserts the output stays unique.
 */
export function resolveLabels(raws: readonly string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const raw of raws) {
    const base = baseLabel(raw);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }

  const out = new Map<string, string>();
  for (const raw of raws) {
    const base = baseLabel(raw);
    const q = qualifierOf(raw);
    // Contested AND able to say something about itself: qualify it. A contested
    // label with no qualifier keeps the plain name, so of a colliding pair one
    // reads "Earthquakes" and the other "Earthquakes · EMSC" rather than both
    // growing a suffix.
    out.set(raw, (counts.get(base) ?? 0) > 1 && q ? `${base} · ${q}` : base);
  }
  return out;
}
