// lib/news/headlinePlaces.ts
// Reading place names out of a headline, and being honest that that is all it is.
//
// WHAT THIS CLAIMS, AND WHY THE CLAIM IS SO SMALL. "This headline contains this place
// name." Not that something happened there, not that the story is about there, not that
// the place is where the event was. A headline naming two countries — "US sanctions
// Iran" — names two places and asserts nothing about either as a location, and this
// module reports exactly that and no more.
//
// The weakness is deliberate, and it is the whole reason this layer can ship. Its
// neighbour lib/signals/news-coverage.ts makes the STRONG claim — a language model read
// this place out of the article body as the place the thing happened — and is switched
// off pending a labelled accuracy review, because that claim can be wrong in ways no
// reader can see. This one cannot be wrong in a way a reader cannot see: the pin
// publishes the headline, and the headline either contains the name or it does not. A
// bad match is visible on the card, by anyone, with no access to the article.
//
// That is the GDELT lesson applied at the design stage instead of after it. GDELT put
// "Use of military force · Bristol" on the map from an article about a TikTok
// livestream (CLAUDE.md records it). The geocoding was fine; the CLAIM was wrong. So
// this module makes a claim that the reading and the geocoding cannot come apart on.
//
// NO NETWORK, NO MODEL, NO GEOCODER. Every coordinate comes from a table already
// committed to this repo — the country centroids and the ~50-city list the weather
// layers use. There is nothing here to rate-limit, no budget to pace, and no upstream
// that can be down.
//
// FIVE MATCHING RULES, EACH PAYING FOR A REAL FALSE POSITIVE:
//
//   1. WORD BOUNDARIES. "Niger" must not match inside "Nigeria", "Oman" inside
//      "Romania", "India" inside "Indiana". A bare substring search puts pins on two
//      continents for one word.
//   2. LONGEST FIRST, AND MATCHES MAY NOT OVERLAP. "South Africa" beats "Africa",
//      "Nigeria" beats "Niger", "New York" beats "York". Once a span is claimed no
//      shorter form may take any part of it.
//   3. SHORT FORMS ARE CASE-SENSITIVE. "US" is a country and "us" is a pronoun, and
//      the only thing between them is the case. Same for "UK", "UAE", "DRC". Full
//      names match case-insensitively, because no headline means anything else by
//      "france".
//   4. DEMONYMS ARE NOT PLACES. "Russian forces strike Kyiv" is a story about Kyiv.
//      Matching "Russian" would pin Moscow for an event 750 km away, and it would do
//      it on most conflict headlines in the feed. Only place names match — and because
//      rule 1 requires a boundary, "Iranian" does not match "Iran" for free.
//   5. "X STATE" IS NOT THE COUNTRY X. Measured, not imagined: on the 2026-09-19 pull
//      France 24 carried "Uproar in Niger state, 37 die in custody", which is Niger
//      State in NIGERIA, and the pin landed 1,400 km away in the Sahara. A country name
//      followed by the word "state" is naming a sub-national unit, and no headline
//      calls a country "X state".
//
// The names that are a place AND something else are handled separately: see
// AMBIGUOUS_FORMS, which is a measurement rather than a hunch.

import {
  COUNTRY_CENTROIDS,
  COUNTRY_NAME_ALIASES,
  centroidByIso3,
  centroidByName,
} from "@/lib/signals/country-centroids.data";
import { WORLD_CITIES } from "@/lib/signals/cities.data";

export type PlaceKind = "country" | "city";

export interface GazetteerEntry {
  /** Stable id: "country:FR", "city:Paris,FR". */
  id: string;
  /** What the pin is labelled. For a country, see DISPLAY_NAMES. */
  name: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  /** ISO-3166 alpha-2 of the country this place is in. A country is in itself. */
  iso2: string;
}

export interface PlaceMatch {
  entry: GazetteerEntry;
  /** The exact text that matched, published so the pin is checkable against the headline. */
  matched: string;
  /** Character offset of the match. Used to keep matches from overlapping. */
  at: number;
}

interface Form {
  text: string;
  entry: GazetteerEntry;
  /** True when only an exact-case match counts. Rule 3. */
  exactCase: boolean;
}

/**
 * Abbreviations these feeds actually print, mapped to ISO alpha-3.
 *
 * Every one is CASE-SENSITIVE (rule 3), and every one is here because a world feed
 * writes it, not because it is a plausible abbreviation. "US" and "U.S." are both
 * present because the fourteen feeds do not agree with each other: the BBC and the
 * Guardian write "US", NPR writes "U.S.". Keeping only one would silently lose a large
 * share of the most-named country in the stream.
 *
 * `EU`, `UN` and `NATO` are deliberately absent. They are organisations, not places,
 * and a centroid for one would be an invention rather than a location.
 */
const ACRONYM_FORMS: Readonly<Record<string, string>> = {
  US: "USA",
  "U.S.": "USA",
  USA: "USA",
  UK: "GBR",
  "U.K.": "GBR",
  UAE: "ARE",
  DRC: "COD",
};

/**
 * Names that are a place AND something else, dropped rather than guessed at.
 *
 * A headline gives nothing to disambiguate with — there is no article body here and no
 * model reading one — so the honest options for these are "pin it and be wrong often"
 * or "do not pin it". Since the entire argument for this layer is that a reader can
 * check any pin at a glance, a name that routinely is NOT the place is worse than no
 * pin at all: it teaches the reader the layer cannot be trusted, which spends the
 * credibility of every pin that is right.
 *
 * Keyed lower-case, and revisable against evidence: scripts/probe-headline-places.mjs
 * prints every match beside the headline it came from, so this list is an argument with
 * a live sample rather than with a colleague.
 *
 *   • georgia — the US state, in US political coverage. Unfixable from a headline:
 *     "Georgia election officials" and "Georgia's president" are the same shape.
 *   • jordan — a very common personal and family name, and these feeds carry sport.
 *     The country does appear, so this one costs real signal; it goes anyway, because
 *     a wrong pin is on the map and a missing one is not.
 *   • chad — likewise a first name.
 *   • guinea — "guinea pig", and three Guineas in the gazetteer make even a true match
 *     ambiguous between them.
 *
 * NOT dropped, each for a reason. `turkey`: in world feeds the country dominates so
 * heavily that dropping it would cost far more than it saves. `niger` and `mali`: rule
 * 2 already keeps them out of "Nigeria" and "Somalia", and neither is an English word.
 */
const AMBIGUOUS_FORMS: ReadonlySet<string> = new Set(["georgia", "jordan", "chad", "guinea"]);

/**
 * What the pin is CALLED, which is not always what the dataset calls it.
 *
 * The centroid table follows old-style ISO long forms, and on a live news map some of
 * them are not merely formal but WRONG: it calls LBY "Libyan Arab Jamahiriya", a state
 * that stopped existing in 2011. Printing that beside a headline about Libya today is a
 * factual error, not a style one, so this is a correctness fix wearing a display fix.
 *
 * TWO SOURCES, BOTH ALREADY IN THE REPO, NOTHING INVENTED:
 *   • the dataset name cut at its first comma — "Iran, Islamic Republic of" to "Iran",
 *     "Bolivia, Plurinational State of" to "Bolivia";
 *   • an alias from COUNTRY_NAME_ALIASES that is a PREFIX of the dataset name, ignoring
 *     spaces and case — "russia" for "Russian Federation", "libya" for "Libyan Arab
 *     Jamahiriya", "syria" for "Syrian Arab Republic", "vietnam" for "Viet Nam".
 * The shortest candidate wins.
 *
 * WHY THE PREFIX TEST AND NOT JUST "SHORTEST ALIAS". Because MMR would become "Burma".
 * That is an alias a feed really does emit, so it belongs in the alias table, but it is
 * the retired name and the dataset's own "Myanmar" is right. "burma" is not a prefix of
 * "myanmar", so the test refuses it and the dataset wins — which is the behaviour a
 * shortest-alias rule would have got backwards on the one country where it matters.
 *
 * THE COLLISION GUARD IS THE OTHER HALF. Cut blindly and "Korea, Republic of" and
 * "Korea, Democratic People's Republic of" both become "Korea": two pins, one name,
 * opposite sides of a border — a worse failure than the formal name it was fixing. A
 * short form is used only where it is unique across the whole table, so both Koreas keep
 * their full names, and so do the two Congos.
 *
 * Whatever this settles on, the text the HEADLINE used is published beside the pin as
 * `nameMatched`, so a reader always sees both.
 */
const DISPLAY_NAMES: ReadonlyMap<string, string> = buildDisplayNames();

function buildDisplayNames(): Map<string, string> {
  const squash = (v: string) => v.toLowerCase().replace(/[\s.]/g, "");
  const titleCase = (v: string) =>
    v
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

  // Aliases that read as a shorter spelling of the same name, grouped by country.
  const prefixAliases = new Map<string, string[]>();
  for (const [alias, iso3] of Object.entries(COUNTRY_NAME_ALIASES)) {
    const c = centroidByIso3(iso3);
    if (!c) continue;
    if (alias.toUpperCase() in ACRONYM_FORMS) continue; // "usa" is not a nicer "United States"
    if (!squash(c.name).startsWith(squash(alias))) continue;
    prefixAliases.set(c.iso2, [...(prefixAliases.get(c.iso2) ?? []), titleCase(alias)]);
  }

  const shortOf = (name: string) => name.split(",")[0].trim();
  const shortCounts = new Map<string, number>();
  for (const c of COUNTRY_CENTROIDS) {
    const short = shortOf(c.name);
    shortCounts.set(short, (shortCounts.get(short) ?? 0) + 1);
  }

  const out = new Map<string, string>();
  for (const c of COUNTRY_CENTROIDS) {
    const candidates = [...(prefixAliases.get(c.iso2) ?? [])];
    const short = shortOf(c.name);
    if (shortCounts.get(short) === 1) candidates.push(short);
    candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
    out.set(c.iso2, candidates[0] ?? c.name);
  }
  return out;
}

function countryEntry(iso2: string, name: string, lat: number, lon: number): GazetteerEntry {
  return { id: `country:${iso2}`, name: DISPLAY_NAMES.get(iso2) ?? name, kind: "country", lat, lon, iso2 };
}

/**
 * Every surface form the matcher looks for, longest first.
 *
 * Built once at module load. Sorting here rather than per headline is what makes rule 2
 * cheap: the scan takes the first form that fits an unclaimed span, and because the list
 * is already longest-first, that IS the longest match.
 */
const FORMS: readonly Form[] = buildForms();

function buildForms(): Form[] {
  const forms: Form[] = [];
  const seen = new Set<string>();

  const push = (text: string, entry: GazetteerEntry, exactCase: boolean) => {
    if (!exactCase && AMBIGUOUS_FORMS.has(text.toLowerCase())) return;
    const key = exactCase ? `C:${text}` : `i:${text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    forms.push({ text, entry, exactCase });
  };

  for (const c of COUNTRY_CENTROIDS) {
    push(c.name, countryEntry(c.iso2, c.name, c.lat, c.lon), false);
  }

  // The alias table exists because upstream feeds spell countries differently from this
  // dataset's ISO long forms ("Russia", not "Russian Federation"). A headline is the
  // most aggressive short-form writer of all, so the aliases matter more here than
  // anywhere else they are used.
  for (const [alias, iso3] of Object.entries(COUNTRY_NAME_ALIASES)) {
    const c = centroidByIso3(iso3);
    if (!c) continue;
    push(alias, countryEntry(c.iso2, c.name, c.lat, c.lon), false);
  }

  for (const [form, iso3] of Object.entries(ACRONYM_FORMS)) {
    const c = centroidByIso3(iso3);
    if (!c) continue;
    push(form, countryEntry(c.iso2, c.name, c.lat, c.lon), true);
  }

  // A city says where the story is; its country says where it is filed. Where a headline
  // names both, matchPlaces() keeps only the city — see there for why.
  for (const city of WORLD_CITIES) {
    const home = centroidByName(city.country);
    const iso2 = home?.iso2 ?? "";
    push(
      city.name,
      { id: `city:${city.name},${iso2}`, name: city.name, kind: "city", lat: city.lat, lon: city.lon, iso2 },
      false,
    );
  }

  forms.sort((a, b) => b.text.length - a.text.length || a.text.localeCompare(b.text));
  return forms;
}

/** What the gazetteer holds. For the probe script and the size guard. */
export function gazetteerSize(): { forms: number; countries: number; cities: number } {
  const countries = new Set<string>();
  const cities = new Set<string>();
  for (const f of FORMS) (f.entry.kind === "country" ? countries : cities).add(f.entry.id);
  return { forms: FORMS.length, countries: countries.size, cities: cities.size };
}

/** A character that can be part of a name. Anything else is a boundary. */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/**
 * Where `form` occurs in `text` on word boundaries, honouring its case sensitivity.
 *
 * The boundary check is hand-rolled rather than a `\b` regex because two forms end in a
 * full stop ("U.S."), and `\b` after a "." behaves the opposite way round from after a
 * letter — the regex would demand a word character next and so never match "U.S.
 * forces". Reading the neighbouring characters says what is meant for every form in the
 * table, including those two.
 *
 * A possessive is NOT a boundary problem: "Ukraine's president" ends the name at the
 * apostrophe, which is not a letter or a digit, so it matches — and it should, because
 * that headline is about Ukraine.
 */
function occurrences(text: string, form: Form): number[] {
  const hay = form.exactCase ? text : text.toLowerCase();
  const needle = form.exactCase ? form.text : form.text.toLowerCase();
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return out;
    from = at + 1;
    if (isWordChar(text[at - 1])) continue;
    if (isWordChar(text[at + needle.length])) continue;
    out.push(at);
  }
}

/**
 * What follows a country name when the headline means a sub-national unit of it. Rule 5.
 *
 * Only "state" earns a place here, and only because a real headline paid for it. The
 * temptation is to add province, region and county on the same reasoning, but none of
 * them was observed and a guard written for a case nobody has seen is a guess that looks
 * like evidence. Add one when the probe finds it.
 */
const NAMES_A_SUBDIVISION = /^\s+state\b/i;

/**
 * Every place named in one headline: de-duplicated, non-overlapping, in reading order.
 *
 * THE COUNTRY-DROP RULE. Where a headline names a city and that city's own country —
 * "Blast near Kyiv, Ukraine" — only the city is returned. Pinning both would draw two
 * dots for one place, the second of them hundreds of kilometres away at a centroid that
 * is a label anchor and not a location. The more precise match is the one worth drawing.
 *
 * A city plus a DIFFERENT country keeps both: "Zelensky in Berlin to ask Germany for
 * air defences" is about Berlin and about Germany, and dropping either would be choosing
 * which half of the sentence to believe.
 */
export function matchPlaces(headline: string): PlaceMatch[] {
  const text = (headline ?? "").trim();
  if (!text) return [];

  const claimed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number) => claimed.some(([s, e]) => start < e && end > s);

  const found = new Map<string, PlaceMatch>();
  for (const form of FORMS) {
    for (const at of occurrences(text, form)) {
      const end = at + form.text.length;
      if (overlaps(at, end)) continue;
      // Rule 5. The span is still claimed, so no shorter form may take "Niger" out of
      // "Niger state" either — the words are spoken for, they are simply not a pin.
      claimed.push([at, end]);
      if (form.entry.kind === "country" && NAMES_A_SUBDIVISION.test(text.slice(end))) continue;
      // First sighting keeps its position; a country named twice is still one pin.
      if (!found.has(form.entry.id)) {
        found.set(form.entry.id, { entry: form.entry, matched: text.slice(at, end), at });
      }
    }
  }

  const matches = Array.from(found.values());
  const citiesIn = new Set(matches.filter((m) => m.entry.kind === "city").map((m) => m.entry.iso2));
  return matches
    .filter((m) => !(m.entry.kind === "country" && citiesIn.has(m.entry.iso2)))
    .sort((a, b) => a.at - b.at);
}
