import { describe, expect, test } from "vitest";
import { SIGNALS } from "@/lib/signals/registry";
import {
  AUDIT_COUNTRIES,
  AUDIT_LAYERS,
  AUDIT_MEASURED_AT,
  AUDIT_TIERS,
  AUDIT_TOTALS,
} from "@/lib/marketing/coverage-audit.data";

/**
 * The landing page's coverage figures are a SNAPSHOT, and a snapshot's danger is that it
 * keeps reading as current long after it stopped being true. These tests are what stops
 * that happening silently.
 *
 * The important one is the first: the audit's layer ids must still be the registry's layer
 * ids. Adding a signal layer is a one-file change elsewhere in this repo, and the page
 * would go on saying "34 layers" with the new one missing from the table and absent from
 * every per-country breakdown. Nothing else in the suite would notice, because nothing
 * else reads both.
 */

describe("the committed coverage audit still describes this repo", () => {
  test("every registered signal layer appears in the audit, and nothing else does", () => {
    const registry = SIGNALS.map((s) => s.id).sort();
    const audited = AUDIT_LAYERS.map((l) => l.id).sort();
    expect(
      audited,
      "The audit no longer matches lib/signals/registry.ts. Re-measure against production:\n" +
        "  node --env-file=.env.local --import ./scripts/ts-alias-hook.mjs \\\n" +
        "    scripts/country-event-breakdown.mts --base=https://provenance-online.vercel.app --out=scratchpad/country-events.json\n" +
        "  node scripts/gen-landing-audit.mjs scratchpad/country-events.json",
    ).toEqual(registry);
  });

  test("the audit's own totals add up", () => {
    expect(AUDIT_TOTALS.layers).toBe(AUDIT_LAYERS.length);
    expect(AUDIT_TOTALS.live + AUDIT_TOTALS.partial + AUDIT_TOTALS.down + AUDIT_TOTALS.locked).toBe(
      AUDIT_TOTALS.layers,
    );
    expect(AUDIT_TOTALS.countriesTouched).toBe(AUDIT_COUNTRIES.length);
  });

  /**
   * THE ONE THAT MATTERS MOST, AND THE BUG IT EXISTS FOR.
   *
   * There are three different "feature totals" available here and they are NOT
   * interchangeable:
   *
   *   served  — what the upstreams returned, including features at sea or in orbit.
   *   placed  — what resolved to a country. Adding the tiers must give exactly this.
   *   summed  — adding up the per-country numbers, which counts a submarine cable once
   *             per country it touches. Bigger than either, and not a feature count.
   *
   * The first draft of this page totalled the per-country numbers and printed the result
   * beside a hero that quoted the placed figure, so the page stated two different totals
   * for the same thing. The tiers must reconcile to `featuresPlaced` or the page is
   * arguing with itself.
   */
  test("the three tiers reconcile exactly to the placed feature total", () => {
    const summed = AUDIT_TIERS.reduce((n, t) => n + t.features, 0);
    expect(summed).toBe(AUDIT_TOTALS.featuresPlaced);
    expect(AUDIT_TOTALS.featuresPlaced + AUDIT_TOTALS.featuresUnplaced).toBe(
      AUDIT_TOTALS.featuresServed,
    );
  });

  test("no layer claims to have placed more features than it served", () => {
    const liars = AUDIT_LAYERS.filter((l) => l.placed > l.features).map((l) => l.id);
    expect(liars).toEqual([]);
  });

  test("a layer reaching countries must have placed something in them", () => {
    const impossible = AUDIT_LAYERS.filter((l) => l.countries > 0 && l.placed === 0).map((l) => l.id);
    expect(impossible).toEqual([]);
  });

  test("the measurement is a real ISO timestamp, because the page prints it", () => {
    expect(Number.isNaN(Date.parse(AUDIT_MEASURED_AT))).toBe(false);
  });

  /**
   * The page names the layers whose per-country figures overlap, in the footnote under the
   * table, rather than hard-coding "cables and GPS jamming" into the copy. If the set ever
   * changes, the footnote follows it — but only if it is non-empty, because a footnote
   * explaining an overlap that no longer exists is its own small lie.
   */
  test("the layers with overlapping per-country counts are line or area layers", () => {
    const spanning = AUDIT_LAYERS.filter((l) => l.spansCountries);
    expect(spanning.length).toBe(AUDIT_TOTALS.spanningLayers.length);
    for (const l of spanning) expect(AUDIT_TOTALS.spanningLayers).toContain(l.label);
  });
});
