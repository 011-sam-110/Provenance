import { expect, test } from "vitest";
import { matchPlaces, gazetteerSize } from "@/lib/news/headlinePlaces";
import { buildHeadlinePlaceFeatures, MAX_QUOTED_HEADLINES } from "@/lib/signals/headline-places";
import type { NewsItem } from "@/lib/news";

// The headline-places layer pins a place because a HEADLINE NAMED IT, and nothing more.
// Every rule below was written for a specific way that goes wrong, and rule 5 was found
// by running scripts/probe-headline-places.mts against the live feed rather than by
// imagining it. These tests are where each rule stays bought.

const names = (headline: string) => matchPlaces(headline).map((m) => m.entry.name);

/* ── rule 1: word boundaries ─────────────────────────────────────────────────── */

test("a country name inside a longer word is not a match", () => {
  // The whole family of two-continent false positives, in one place.
  expect(names("Nigeria votes")).toEqual(["Nigeria"]);
  expect(names("Romania holds a referendum")).toEqual(["Romania"]);
  expect(names("Indiana passes a law")).toEqual([]);
  expect(names("Somalia floods")).toEqual(["Somalia"]);
});

test("a possessive still names the place", () => {
  // The apostrophe is a boundary, and it should be: the story is about Ukraine.
  expect(names("Ukraine's president speaks")).toEqual(["Ukraine"]);
});

/* ── rule 2: longest first, no overlaps ──────────────────────────────────────── */

test("the longest name wins and takes the span with it", () => {
  expect(names("South Africa recalls its envoy")).toEqual(["South Africa"]);
  // "Niger" is inside "Nigeria" as a SPAN as well as a substring; claiming the longer
  // form has to stop the shorter one, or one word draws two pins.
  expect(names("Nigeria and Niger sign a pact")).toEqual(["Nigeria", "Niger"]);
});

/* ── rule 3: short forms are case-sensitive ──────────────────────────────────── */

test("US is a country and us is a pronoun", () => {
  expect(names("US sanctions bite")).toEqual(["United States"]);
  expect(names("The deal gives us hope")).toEqual([]);
});

test("the feeds disagree about the spelling, so both are matched", () => {
  // The BBC and the Guardian write "US"; NPR writes "U.S.". Dropping either loses a
  // large share of the most-named country in the stream.
  expect(names("U.S. forces withdraw")).toEqual(["United States"]);
  expect(names("UK jails teen")).toEqual(["United Kingdom"]);
  expect(names("UAE brokers talks")).toEqual(["United Arab Emirates"]);
});

/* ── rule 4: demonyms are not places ─────────────────────────────────────────── */

test("a demonym names no place", () => {
  // Pinning Moscow here would be a pin 750 km from the story, on most conflict
  // headlines in the feed.
  expect(names("Russian forces advance")).toEqual([]);
  expect(names("Iranian officials deny it")).toEqual([]);
  expect(names("Chinese exports climb")).toEqual([]);
});

/* ── rule 5: "X state" is a subdivision, not the country ─────────────────────── */

test("a country name followed by state is a subdivision and draws no pin", () => {
  // THE MEASURED REGRESSION. France 24 carried exactly this on 2026-09-19 and the pin
  // landed in the Sahara — Niger State is in Nigeria.
  expect(names("Uproar in Niger state, 37 die in custody")).toEqual([]);
  // The span is still claimed, so no shorter form may pick the words back up either.
  expect(matchPlaces("Uproar in Niger state")).toHaveLength(0);
});

test("the guard needs the whole word, not a prefix of one", () => {
  expect(names("Niger statement on the border")).toEqual(["Niger"]);
});

/* ── ambiguous names are dropped, not guessed ────────────────────────────────── */

test("names that are also people or US states never pin", () => {
  expect(names("Georgia election officials count again")).toEqual([]);
  expect(names("Jordan scores twice")).toEqual([]);
  expect(names("Chad speaks to reporters")).toEqual([]);
  expect(names("Guinea pig shortage")).toEqual([]);
});

test("dropping a bare form does not drop the longer names containing it", () => {
  // "guinea" is dropped; "Equatorial Guinea" and "Papua New Guinea" are not, and the
  // live feed carried the first of those on the day this was written.
  expect(names("Men deported to Equatorial Guinea, lawyers say")).toEqual(["Equatorial Guinea"]);
});

/* ── cities, and the country-drop rule ───────────────────────────────────────── */

test("a city and its own country draw one pin, the more precise one", () => {
  // Two dots for one place, the second of them at a centroid hundreds of km away, is
  // not more information.
  expect(names("Moscow summons an envoy in Russia")).toEqual(["Moscow"]);
});

test("a city and a different country keep both", () => {
  // Dropping either would be choosing which half of the sentence to believe. Note the
  // pairing has to be a city and a country it is NOT in — "Berlin ... Germany" is the
  // case above, not this one, and getting that backwards was the first draft of this
  // test.
  expect(names("Macron in Berlin to press Japan on trade")).toEqual(["Berlin", "Japan"]);
});

/* ── what the pin is called ──────────────────────────────────────────────────── */

test("the pin uses a name a reader recognises, not the ISO long form", () => {
  expect(names("Russia holds a vote")).toEqual(["Russia"]);
  expect(names("Iran extends sanctions")).toEqual(["Iran"]);
  expect(names("Bolivia slashes subsidies")).toEqual(["Bolivia"]);
  // Not "Libyan Arab Jamahiriya", which is a state that stopped existing in 2011.
  expect(names("Libya talks resume")).toEqual(["Libya"]);
});

test("Myanmar is not renamed Burma by the shortening", () => {
  // "burma" is a real alias a feed emits, so it is in the alias table — and it is the
  // RETIRED name. A shortest-alias rule would have picked it; the prefix test refuses
  // it, because "burma" is not a shorter spelling of "myanmar".
  expect(names("Myanmar junta extends emergency")).toEqual(["Myanmar"]);
  expect(names("Burma junta extends emergency")).toEqual(["Myanmar"]);
});

test("a short name that two countries share is never used for either", () => {
  // Cut blindly and both Koreas read "Korea": two pins, one name, opposite sides of a
  // border. The collision guard keeps the full names.
  const north = names("North Korea tests a missile");
  const south = names("South Korea responds");
  expect(north[0]).toContain("Korea");
  expect(south[0]).toContain("Korea");
  expect(north[0]).not.toBe(south[0]);
});

/* ── the gazetteer itself ────────────────────────────────────────────────────── */

test("the gazetteer is the committed tables and nothing else", () => {
  const { countries, cities } = gazetteerSize();
  // Sanity bounds, not pinned counts: this is here to fail loudly if the underlying
  // tables are ever swapped for something much larger, because the layer's stated
  // limitation is that it matches about 250 countries and about 50 cities.
  expect(countries).toBeGreaterThan(200);
  expect(countries).toBeLessThan(300);
  expect(cities).toBeGreaterThan(30);
  expect(cities).toBeLessThan(80);
});

/* ── the features that get published ─────────────────────────────────────────── */

const item = (title: string, source: string, ts: number): NewsItem => ({
  title,
  source,
  url: `https://example.test/${encodeURIComponent(title)}`,
  ts,
});

test("one pin per place, not per story, with the outlets counted", () => {
  const features = buildHeadlinePlaceFeatures([
    item("Japan braces for typhoon", "BBC", 3),
    item("Typhoon nears Japan", "DW", 2),
    item("Japan issues evacuation order", "NPR", 1),
  ]);
  expect(features).toHaveLength(1);
  expect(features[0].title).toBe("Japan");
  expect(features[0].props?.headlines).toBe(3);
  expect(features[0].props?.outlets).toBe("BBC, DW, NPR");
});

test("the pin quotes the headlines it rests on, newest first", () => {
  const features = buildHeadlinePlaceFeatures([
    item("Older story about Kenya", "BBC", 1),
    item("Newer story about Kenya", "DW", 9),
  ]);
  expect(features[0].props?.latest).toBe("Newer story about Kenya");
  expect(features[0].props?.quoted).toEqual(["DW: Newer story about Kenya", "BBC: Older story about Kenya"]);
});

test("the quote list is capped, but the count is not", () => {
  const many = Array.from({ length: MAX_QUOTED_HEADLINES + 4 }, (_, i) =>
    item(`Kenya story ${i}`, `Outlet ${i}`, i),
  );
  const features = buildHeadlinePlaceFeatures(many);
  expect(features[0].props?.headlines).toBe(MAX_QUOTED_HEADLINES + 4);
  expect(features[0].props?.quoted).toHaveLength(MAX_QUOTED_HEADLINES);
});

test("every pin carries the hedge and the text that matched", () => {
  // The hedge rides in the props of every feature, beside the pin, because the lesson
  // from the GDELT layer is that a caveat in an explainer panel is a caveat nobody
  // reads.
  const [feature] = buildHeadlinePlaceFeatures([item("US sanctions bite", "BBC", 1)]);
  expect(feature.props?.nameMatched).toBe("US");
  expect(String(feature.props?.reading)).toContain("not a claim that anything happened here");
  expect(String(feature.props?.pinPrecision)).toContain("centroid");
});

test("the cap drops the thinnest pins, never an arbitrary slice", () => {
  const features = buildHeadlinePlaceFeatures(
    [
      item("Kenya one", "BBC", 1),
      item("Kenya two", "DW", 2),
      item("Peru one", "NPR", 3),
    ],
    1,
  );
  expect(features).toHaveLength(1);
  expect(features[0].title).toBe("Kenya");
});

test("a headline naming nothing placeable produces no pin at all", () => {
  // Roughly half the stream. A story with no matchable name stays in the rail and is
  // simply not claimed to be anywhere.
  expect(buildHeadlinePlaceFeatures([item("Markets rally on rate hopes", "BBC", 1)])).toEqual([]);
});
