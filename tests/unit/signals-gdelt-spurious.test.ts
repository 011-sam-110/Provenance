import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGdeltExport, selectLayerEvents, GDELT_LAYERS } from "@/lib/signals/gdelt";
import {
  pruneSpuriousEvents,
  explainSpuriousEvents,
  FANOUT_PLACE_LIMIT,
  type SpuriousInput,
} from "@/lib/signals/gdeltSpurious";

/**
 * 100 VERBATIM 61-column rows from three real 15-minute exports. Nothing synthetic:
 *
 *   20260904160000  a Daily Kos DEMOCRATIC PARTY FUNDRAISING POST, coded CAMEO 193
 *                   "fight with small arms and light weapons", fanned across US states
 *   20260902000000  merimbulanewsweekly on Iran striking US allies in the Gulf after
 *                   US strikes on Iran — a REAL multi-location military story
 *   20260902000000  a Breitbart essay on the death of the poet Wendell Berry, coded as
 *                   military force at New York, Kentucky, Canada and China
 *
 * The fundraiser and the essay are what the filter must remove. The Iran story is what
 * it must not, and it is the reason the filter keeps pins instead of deleting articles.
 */
const TSV = readFileSync(join(process.cwd(), "tests/fixtures/gdelt-fanout.export.tsv"), "utf8");

/**
 * Attach the slot each row came from, which is what the adapter does at parse time.
 * Done here by matching the source URL because the fixture holds three articles from
 * two different exports.
 */
function eventsWithSlots(): (ReturnType<typeof parseGdeltExport>[number] & SpuriousInput)[] {
  return parseGdeltExport(TSV).map((e) => ({
    ...e,
    slotStamp: e.sourceUrl.includes("dailykos.com") ? "20260904160000" : "20260902000000",
  }));
}

/** What a reader actually sees: the production selection, then the filter. */
function shipped() {
  const all = eventsWithSlots();
  return Object.values(GDELT_LAYERS).flatMap((meta) =>
    selectLayerEvents(all, meta).map((e) => e as typeof all[number]),
  );
}

test("the fundraising post fans out across states and every pin is removed", () => {
  const rows = shipped().filter((e) => e.sourceUrl.includes("dailykos.com"));
  expect(rows.length).toBeGreaterThan(20);

  const kept = pruneSpuriousEvents(rows);
  expect(kept).toEqual([]);

  // Removed for the right reason, not by accident: every one is a fan-out row whose
  // ActionGeo resolved no finer than a state.
  for (const v of explainSpuriousEvents(rows)) {
    expect(v.keep).toBe(false);
    expect(v.reason).toBe("fan-out-vague-precision");
    expect(v.placesInSlot).toBeGreaterThan(FANOUT_PLACE_LIMIT);
  }
});

test("the poet essay is removed, and it is a four-place group not a big one", () => {
  const rows = shipped().filter((e) => e.sourceUrl.includes("breitbart.com"));
  expect(rows).toHaveLength(4);
  expect(pruneSpuriousEvents(rows)).toEqual([]);

  const places = explainSpuriousEvents(rows)[0].placesInSlot;
  expect(places).toBe(4);
  // Exactly one over the limit. If the threshold ever moves up, this article survives
  // and the test says so rather than a total quietly shifting.
  expect(places).toBe(FANOUT_PLACE_LIMIT + 1);
});

test("the real Iran strike story keeps its city pins and loses only the vague ones", () => {
  const rows = shipped().filter((e) => e.sourceUrl.includes("merimbulanewsweekly"));
  const kept = pruneSpuriousEvents(rows);

  // Settlement name only. GDELT writes the ADM1 for Aqaba with a transliteration mark
  // that does not survive being typed into a test file, and asserting the full
  // ActionGeo_FullName would fail on an invisible character rather than on behaviour.
  const keptPlaces = kept.map((e) => e.place.split(",")[0]).sort();
  expect(keptPlaces).toEqual(["Aqaba", "Bandar Abbas", "Tehran"]);

  // "United States" is the ATTACKER, not a place anything happened, and it goes.
  // "Kuwait" was genuinely struck and is the one real row this filter costs us — a
  // country-precision pin inside a fan-out is indistinguishable from a passing
  // mention, and that trade is the whole reason the rule is gated to fan-outs.
  const dropped = explainSpuriousEvents(rows).filter((v) => !v.keep).map((v) => v.event.place);
  expect(dropped.sort()).toEqual(["Kuwait", "United States"]);
});

test("a story pinned at three or fewer places is never touched", () => {
  const rows = shipped().filter((e) => e.sourceUrl.includes("merimbulanewsweekly")).slice(0, 3);
  const kept = pruneSpuriousEvents(rows);
  expect(kept).toHaveLength(rows.length);
  for (const v of explainSpuriousEvents(rows)) {
    expect(v.reason).toBe("single-story");
  }
});

test("the same story split across slots is not treated as a fan-out", () => {
  // The trap the slot identity exists to close. These are the SAME rows that fan out
  // into one huge group above; spread thinly enough across slots, each slot holds at
  // most three places and none of them is a fan-out any more.
  const rows = shipped()
    .filter((e) => e.sourceUrl.includes("dailykos.com"))
    .map((e, i) => ({ ...e, slotStamp: `20260904${String(10 + (i % 12)).padStart(2, "0")}0000` }));

  for (const v of explainSpuriousEvents(rows)) {
    expect(v.placesInSlot).toBeLessThanOrEqual(FANOUT_PLACE_LIMIT);
  }
  expect(pruneSpuriousEvents(rows)).toHaveLength(rows.length);

  // And the point of the trap: grouped WITHOUT the slot, the identical rows collapse
  // into one group and every last one is deleted. That is the silent batch-size
  // dependence the field exists to remove.
  const noSlot = rows.map((e) => ({ ...e, slotStamp: "SAME" }));
  expect(pruneSpuriousEvents(noSlot)).toHaveLength(0);
});

test("grouping is per article: two fanned-out stories do not merge into one group", () => {
  const both = shipped().filter(
    (e) => e.sourceUrl.includes("breitbart.com") || e.sourceUrl.includes("merimbulanewsweekly"),
  );
  const verdicts = explainSpuriousEvents(both);

  const breitbart = verdicts.filter((v) => v.event.sourceUrl.includes("breitbart.com"));
  const iran = verdicts.filter((v) => v.event.sourceUrl.includes("merimbulanewsweekly"));
  expect(breitbart[0].placesInSlot).toBe(4);
  expect(iran[0].placesInSlot).toBe(5);
  // Merged, they would have counted 9 places between them and the Iran story would
  // have been judged against a group it is not part of.
});

test("a row with no slot identity is kept, and says why", () => {
  const rows = shipped()
    .filter((e) => e.sourceUrl.includes("dailykos.com"))
    .map((e) => ({ ...e, slotStamp: "" }));

  // Under-filtering, never over-filtering: without a slot the group is not trustworthy
  // and the safe direction is the layer's current behaviour.
  expect(pruneSpuriousEvents(rows)).toHaveLength(rows.length);
  for (const v of explainSpuriousEvents(rows)) {
    expect(v.reason).toBe("no-slot-identity");
  }
});

test("surviving rows are returned unchanged and in input order", () => {
  const rows = shipped().filter((e) => e.sourceUrl.includes("merimbulanewsweekly"));
  const kept = pruneSpuriousEvents(rows);
  const order = rows.filter((r) => kept.includes(r));
  expect(kept).toEqual(order);
  for (const k of kept) expect(rows).toContain(k);
});

test("an empty input is an empty output, not a throw", () => {
  expect(pruneSpuriousEvents([])).toEqual([]);
  expect(explainSpuriousEvents([])).toEqual([]);
});
