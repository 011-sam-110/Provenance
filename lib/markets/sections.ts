// Per-section isolation for the /api/markets snapshot — pure, kept separate from
// app/api/markets/route.ts because Next's route-handler type checking only
// permits a fixed set of exports from a route.ts file (see lib/markets/fred.ts
// for the same reasoning).
//
// Previously GET() ran Promise.all over all five section builders inside one
// try/catch: a single rejection (a CoinGecko hiccup, a Yahoo 429) discarded every
// section, not just the one that failed — the response served empty/stale rows
// for sections that had nothing wrong with them, breaking the dormant-safe
// contract ("a failure resolves to [] or last-good, never takes down the
// response") for everyone else on the page. route.ts now runs Promise.allSettled
// and folds the outcomes through resolveSection/foldSections below, so each
// section's fate is independent.

import type { MarketSection } from "@/lib/markets";

export const SECTION_SPECS = [
  { key: "crypto", label: "Crypto" },
  { key: "commodities", label: "Commodities" },
  { key: "fx", label: "Currencies" },
  { key: "equities", label: "Equities" },
  { key: "macro", label: "Macro / rates" },
] as const;

/**
 * Pure: turn one section builder's settled outcome into the MarketSection to
 * serve.
 *  - fulfilled → pass the fresh section through untouched (a legitimate
 *    dormant/no-key section is a fulfilled result, not a failure, and is left as
 *    the builder produced it).
 *  - rejected, and a non-empty last-good exists for this key → serve it, but the
 *    `note` DISCLOSES it is a carried-over snapshot from an earlier cycle, not
 *    live data — never presented as fresh.
 *  - rejected, nothing to fall back to → an honestly empty, clearly-labelled
 *    section that says it failed and will retry.
 * Never throws, never fabricates a row.
 */
export function resolveSection(
  outcome: PromiseSettledResult<MarketSection>,
  spec: { key: string; label: string },
  lastGood: MarketSection | undefined,
): MarketSection {
  if (outcome.status === "fulfilled") return outcome.value;
  if (lastGood && lastGood.rows.length > 0) {
    return {
      ...lastGood,
      // `stale`, not `dormant`: the rows are real and worth showing, they are just
      // not current. Setting `dormant` here would hide them entirely; setting
      // neither (the first cut of this) shipped the note in the JSON while every
      // renderer dropped it, so the carried-over rows looked live.
      stale: true,
      note: "This section failed to refresh this cycle — showing its last successful snapshot, not live data.",
    };
  }
  return {
    key: spec.key,
    label: spec.label,
    source: "temporarily unavailable",
    rows: [],
    // Reuses MarketSection's `dormant` flag purely as "show this note instead of
    // rows" — MarketsPanel.tsx renders `note` only when `dormant` is true, and
    // there is no distinct "failed" flag on the type. The wording below always
    // says "failed to refresh", never "add a key", so it can't be misread as the
    // key-gating case.
    dormant: true,
    note: "This section failed to refresh this cycle and no earlier snapshot is available yet. It will retry on the next refresh.",
  };
}

/** Pure: fold every section builder's settled outcome into the final sections
 *  array, in the fixed SECTION_SPECS order the panel expects. */
export function foldSections(
  specs: readonly { key: string; label: string }[],
  results: PromiseSettledResult<MarketSection>[],
  lastGood: Partial<Record<string, MarketSection>>,
): MarketSection[] {
  return specs.map((spec, i) => resolveSection(results[i], spec, lastGood[spec.key]));
}
