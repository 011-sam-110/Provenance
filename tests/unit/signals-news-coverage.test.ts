import { describe, expect, test } from "vitest";
import {
  buildCoverageFeatures,
  describePrecision,
  humanLabel,
  MAX_FEATURES,
  MAX_QUOTE_CHARS,
  NEWS_COVERAGE_SOURCE,
  pinsEnabled,
  trimQuote,
} from "@/lib/signals/news-coverage";
import { placeKey, placeQuery, pickPlace } from "@/lib/news/places";
import type { NewsEvent, ScrapedItem } from "@/lib/news/ingest";
import type { ResolvedPlace } from "@/lib/news/places";
import type { GeocodeResult } from "@/lib/geo/geocode";

/**
 * The pure half of the news-coverage layer: what we ask a geocoder, what we accept
 * back, and what ends up beside a pin.
 *
 * The thing worth testing here is not the arithmetic — it is the HONESTY. This layer
 * publishes a location that a language model inferred and a geocoder guessed at, which
 * is two layers of inference under one confident-looking dot. That is precisely the
 * shape that produced "Use of military force · Bristol" on the GDELT layer. So the
 * assertions below are mostly about what a feature must still be SAYING: which place
 * the article named, which place the geocoder matched, the sentence the place came
 * from, and that none of it is verified.
 */

const EVENT: NewsEvent = {
  isPhysical: true,
  category: "natural_disaster",
  eventDate: "2026-09-15",
  placeName: "Bayeux",
  placeWithin: "Normandy",
  // ISO alpha-2, which is what the scraper's schema check requires and what a real
  // row carries. The first cut of this layer tested with "France" and would have
  // refused every genuine pin.
  placeCountry: "FR",
  placeKind: "city",
  quote: "The flooding reached the centre of Bayeux by Tuesday evening.",
  otherPlaces: ["Paris"],
  keyEntities: ["Prefecture of Calvados"],
};

function item(over: Partial<ScrapedItem> = {}): ScrapedItem {
  return {
    id: "st_1",
    outlet: "reuters",
    title: "Flooding reaches Bayeux town centre",
    description: null,
    url: "https://www.reuters.com/world/europe/flooding-bayeux",
    ts: Date.parse("2026-09-15T18:00:00Z"),
    tsExact: true,
    lastSeenAt: "2026-09-15T19:00:00Z",
    firstSeenAt: "2026-09-15T18:10:00Z",
    itemHash: "h1",
    sections: ["world"],
    formatFlags: [],
    wordCount: 600,
    thumbnail: null,
    textHash: null,
    text: null,
    keywords: [],
    placeHints: [],
    event: EVENT,
    ...over,
  };
}

const BAYEUX: ResolvedPlace = {
  lat: 49.2764,
  lon: -0.7024,
  label: "Bayeux, Calvados, France",
  type: "city",
  countryCode: "FR",
};

function placed(...pairs: Array<[string, ResolvedPlace | null]>): Map<string, ResolvedPlace | null> {
  return new Map(pairs.map(([q, p]) => [placeKey(q), p]));
}

describe("what we ask the geocoder", () => {
  test("carries the containing region, because a bare name is ambiguous", () => {
    expect(placeQuery(EVENT)).toBe("Bayeux, Normandy");
  });

  // A bare "FR" is at best noise in a search string and at worst a match of its own.
  // Measured on 2026-09-16: Photon returns an identical top three with and without it.
  test("does not put an ISO country code in the query, only a country name", () => {
    expect(placeQuery({ ...EVENT, placeCountry: "FR" })).toBe("Bayeux, Normandy");
    expect(placeQuery({ ...EVENT, placeCountry: "France" })).toBe("Bayeux, Normandy, France");
  });

  test("drops a context part that repeats the name rather than asking a worse question", () => {
    expect(placeQuery({ ...EVENT, placeName: "Paris", placeWithin: "Paris", placeCountry: "France" }))
      .toBe("Paris, France");
  });

  // The extractor's own judgement is the first gate. A story ABOUT somewhere is not
  // the same as a story that happened somewhere, and the scraper is the only thing
  // that read the article.
  test("asks nothing when the extractor did not read a physical event", () => {
    expect(placeQuery({ ...EVENT, isPhysical: false })).toBeNull();
  });

  test("asks nothing when there is no place name, and nothing at all when there is no event", () => {
    expect(placeQuery({ ...EVENT, placeName: null })).toBeNull();
    expect(placeQuery(null)).toBeNull();
  });

  test("two spellings of one query share a cache key", () => {
    expect(placeKey("Bayeux,  Normandy, France ")).toBe(placeKey("bayeux,  normandy, france"));
  });
});

describe("what we accept back", () => {
  const results: GeocodeResult[] = [
    { name: "Bayeux, Quebec, Canada", lat: 46.1, lon: -70.9, type: "village", countryCode: "CA" },
    { name: "Bayeux, Calvados, France", lat: 49.2764, lon: -0.7024, type: "city", countryCode: "FR" },
  ];

  // THE ONE HARD GUARD. Photon ranks globally and a name repeats; the article told us
  // a country, so a match in a different one is the wrong place with the right name.
  test("refuses a match in a country the article did not name, even a better-ranked one", () => {
    expect(pickPlace(results, EVENT)).toEqual({
      lat: 49.2764,
      lon: -0.7024,
      label: "Bayeux, Calvados, France",
      type: "city",
      countryCode: "FR",
    });
  });

  // THE BUG THIS PINS. The check used to search the geocoder LABEL for the country,
  // which works only when the sender ships an English country name. A real row carries
  // "FR", which appears in no label, so every genuine pin was refused while a harness
  // that sent "France" passed. Photon labels are localised too ("Normandie"), so there
  // was never a spelling both sides would have agreed on.
  test("matches an ISO code against the code, not against the localised label", () => {
    const localised: GeocodeResult[] = [
      { name: "Bayeux, Normandie", lat: 49.2764, lon: -0.7024, type: "town", countryCode: "FR" },
    ];
    expect(pickPlace(localised, EVENT)?.lat).toBe(49.2764);
  });

  test("a match carrying no country code cannot clear an ISO check", () => {
    expect(pickPlace([{ name: "Bayeux, Normandie", lat: 49.2764, lon: -0.7024 }], EVENT)).toBeNull();
  });

  test("still accepts a country NAME, for a sender that ships one", () => {
    expect(pickPlace(results, { ...EVENT, placeCountry: "France" })?.label).toBe(
      "Bayeux, Calvados, France",
    );
  });

  test("takes the top match when the article named no country to check against", () => {
    expect(pickPlace(results, { ...EVENT, placeCountry: null })?.label).toBe("Bayeux, Quebec, Canada");
  });

  test("refuses everything rather than guessing when no match is in the right country", () => {
    expect(pickPlace([results[0]], EVENT)).toBeNull();
    expect(pickPlace([], EVENT)).toBeNull();
  });
});

describe("what ends up beside a pin", () => {
  test("a story with no resolved place is not pinned at all", () => {
    expect(buildCoverageFeatures([item()], placed(["Bayeux, Normandy", null]))).toEqual([]);
    // Nothing resolved this cycle at all — the budget ran out, say — is the same case.
    expect(buildCoverageFeatures([item()], new Map())).toEqual([]);
  });

  test("outlets covering one place become ONE pin that names them", () => {
    const features = buildCoverageFeatures(
      [
        item(),
        item({ id: "st_2", outlet: "bbc", title: "Bayeux floods", url: "https://www.bbc.co.uk/news/2" }),
        item({ id: "st_3", outlet: "guardian", title: "Normandy floods", url: "https://www.theguardian.com/3" }),
      ],
      placed(["Bayeux, Normandy", BAYEUX]),
    );

    expect(features).toHaveLength(1);
    expect(features[0].props?.stories).toBe(3);
    expect(features[0].props?.outlets).toBe("Reuters, BBC, The Guardian");
  });

  test("the pin's headline and link are the NEWEST story, not the first one handed in", () => {
    const features = buildCoverageFeatures(
      [
        item(),
        item({
          id: "st_2",
          outlet: "bbc",
          title: "Bayeux evacuations begin",
          url: "https://www.bbc.co.uk/news/2",
          ts: Date.parse("2026-09-15T23:00:00Z"),
        }),
      ],
      placed(["Bayeux, Normandy", BAYEUX]),
    );

    expect(features[0].props?.latest).toBe("Bayeux evacuations begin");
    expect(features[0].link).toBe("https://www.bbc.co.uk/news/2");
  });

  // Both halves of the inference are published. Where they disagree, the reader can
  // see the disagreement rather than only the dot it produced.
  test("publishes the place the geocoder matched", () => {
    const [f] = buildCoverageFeatures([item()], placed(["Bayeux, Normandy", BAYEUX]));
    expect(f.props?.resolvedTo).toBe("Bayeux, Calvados, France");
  });

  // placeName ALONE. It is the one place field the scraper verified, by requiring it to
  // appear inside the verbatim quote; placeWithin is unchecked model output, and the
  // scraper contract forbids publishing that.
  test("publishes only the place field that was checked, not the geocoder query", () => {
    const [f] = buildCoverageFeatures([item()], placed(["Bayeux, Normandy", BAYEUX]));
    expect(f.props?.placeAsWritten).toBe("Bayeux");
    expect(JSON.stringify(f.props)).not.toContain("Normandy");
  });

  // Context the model wrote and nothing checked. Carried on the wire for matching,
  // never rendered.
  test("never publishes the other places or the entities the model listed", () => {
    const [f] = buildCoverageFeatures([item()], placed(["Bayeux, Normandy", BAYEUX]));
    const rendered = JSON.stringify(f.props);
    expect(rendered).not.toContain("Paris");
    expect(rendered).not.toContain("Prefecture of Calvados");
  });

  test("publishes the sentence the place was read from, and calls the category a coding", () => {
    const [f] = buildCoverageFeatures([item()], placed(["Bayeux, Normandy", BAYEUX]));
    expect(f.props?.basis).toContain("The flooding reached the centre of Bayeux");
    expect(f.props?.codedAs).toBe("natural disaster");
  });

  // The regression this layer exists to not repeat: a precise pin beside an
  // unattributed assertion. Every feature has to carry the disclaimer itself, not
  // delegate it to a panel the reader has to go and open.
  test("every feature states that neither the location nor the event was verified", () => {
    const [f] = buildCoverageFeatures([item()], placed(["Bayeux, Normandy", BAYEUX]));
    expect(String(f.props?.reading)).toMatch(/not a verified location/);
    expect(String(f.props?.reading)).toMatch(/not a verified incident/);
  });

  // A count of articles is not a severity, and `magnitude` scales the marker radius.
  test("the story count never rides on magnitude", () => {
    const [f] = buildCoverageFeatures([item()], placed(["Bayeux, Normandy", BAYEUX]));
    expect(f.props?.magnitude).toBeUndefined();
    expect(NEWS_COVERAGE_SOURCE.metric).toEqual({ field: "stories", domain: [1, 8] });
  });

  test("a fallback publication time is labelled as first-seen, never presented as one", () => {
    const [f] = buildCoverageFeatures(
      [item({ tsExact: false })],
      placed(["Bayeux, Normandy", BAYEUX]),
    );
    expect(String(f.props?.latestAt)).toContain("first seen");
  });

  test("distinct places stay distinct, and the cap keeps the best-covered ones", () => {
    const rouen: ResolvedPlace = { lat: 49.4432, lon: 1.0999, label: "Rouen, Seine-Maritime, France", type: "city" };
    const rouenEvent: NewsEvent = { ...EVENT, placeName: "Rouen", placeWithin: "Seine-Maritime" };
    const features = buildCoverageFeatures(
      [
        item(),
        item({ id: "st_2", outlet: "bbc", url: "https://www.bbc.co.uk/news/2" }),
        item({ id: "st_3", outlet: "pbs", url: "https://www.pbs.org/3", event: rouenEvent }),
      ],
      placed(["Bayeux, Normandy", BAYEUX], ["Rouen, Seine-Maritime", rouen]),
    );

    expect(features.map((f) => f.props?.stories)).toEqual([2, 1]);
    expect(buildCoverageFeatures([item()], placed(["Bayeux, Normandy", BAYEUX]), 0)).toEqual([]);
    expect(MAX_FEATURES).toBeGreaterThan(0);
  });

  test("stories within about a kilometre share a pin", () => {
    const nudged: ResolvedPlace = { ...BAYEUX, lat: 49.2766, lon: -0.7021, label: "Bayeux, France" };
    const nearby: NewsEvent = { ...EVENT, placeName: "Bayeux centre" };
    const features = buildCoverageFeatures(
      [item(), item({ id: "st_2", outlet: "bbc", url: "https://www.bbc.co.uk/news/2", event: nearby })],
      placed(["Bayeux, Normandy", BAYEUX], ["Bayeux centre, Normandy", nudged]),
    );
    expect(features).toHaveLength(1);
    expect(features[0].props?.stories).toBe(2);
  });
});

describe("precision is reported, not assumed", () => {
  test("says so when the geocoder matched something coarser than the article meant", () => {
    expect(describePrecision("city", "country")).toBe("city (matched as country)");
  });

  test("collapses to one word when the two agree, and admits it when neither said", () => {
    expect(describePrecision("city", "city")).toBe("city");
    expect(describePrecision(null, "village")).toBe("village");
    expect(describePrecision(null, undefined)).toBe("unstated");
  });
});

describe("the registry entry", () => {
  // "Conflict coverage", not "Conflict", was the fix on the GDELT layer. Same rule.
  test("is labelled coverage rather than events", () => {
    expect(NEWS_COVERAGE_SOURCE.label).toBe("News coverage");
    expect(NEWS_COVERAGE_SOURCE.dataOnly).toBeUndefined();
  });

  test("credits the publishers and the geocoder, because both are upstreams", () => {
    expect(NEWS_COVERAGE_SOURCE.attribution).toMatch(/publishers/);
    expect(NEWS_COVERAGE_SOURCE.attribution).toMatch(/OpenStreetMap/);
  });
});

describe("the evidence quote is capped, and cut around the name", () => {
  const long =
    "Officials said late on Monday that after three days of continuous rain across the "
    + "region the river burst its banks in several places overnight, and the flooding "
    + "reached the centre of Bayeux by Tuesday evening, cutting the road to the coast "
    + "and forcing the evacuation of about two hundred households from the low-lying "
    + "streets beside the cathedral before first light on Wednesday morning.";

  test("a short quote is published whole", () => {
    expect(trimQuote("The river burst its banks.", "Bayeux")).toBe("The river burst its banks.");
  });

  // Cutting from the left can remove the very words the pin rests on, leaving evidence
  // with the evidence taken out.
  test("a long quote keeps the place name rather than the opening words", () => {
    const out = trimQuote(long, "Bayeux");
    expect(out).toContain("Bayeux");
    expect(out.replace(/…/g, "").length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
    expect(out.startsWith("…")).toBe(true);
  });

  test("falls back to the opening when the name is not in the quote", () => {
    const out = trimQuote(long, "Rouen");
    expect(out.startsWith("Officials said")).toBe(true);
    expect(out.replace(/…/g, "").length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
  });

  test("the pin publishes the trimmed quote, not the whole paragraph", () => {
    const [f] = buildCoverageFeatures(
      [item({ event: { ...EVENT, quote: long } })],
      placed(["Bayeux, Normandy", BAYEUX]),
    );
    expect(String(f.props?.basis).length).toBeLessThan(long.length);
  });
});

describe("the category is reformatted, never rewritten", () => {
  test("snake_case ids read as words", () => {
    expect(humanLabel("natural_disaster")).toBe("natural disaster");
    expect(humanLabel("crime")).toBe("crime");
  });

  // The taxonomy is the scraper own closed list and the id IS the claim. Mapping ids to
  // friendlier wording here would put this app words behind their coding.
  test("no id is mapped to different wording", () => {
    for (const id of ["disaster", "armed_conflict", "civil_unrest", "accident"]) {
      expect(humanLabel(id)).toBe(id.replace(/_/g, " "));
    }
  });
});

describe("the accuracy gate", () => {
  // Pins are OFF until a labelled sample passes. The two known failure modes are
  // LABEL faults, not geocoding faults, so a correct coordinate does not clear them and
  // the end-to-end probe cannot see them.
  test("publishes nothing without NEWS_COVERAGE_PINS, and says why", async () => {
    const held = process.env.NEWS_COVERAGE_PINS;
    delete process.env.NEWS_COVERAGE_PINS;
    try {
      expect(pinsEnabled()).toBe(false);
      await expect(NEWS_COVERAGE_SOURCE.fetch()).resolves.toEqual([]);
    } finally {
      if (held !== undefined) process.env.NEWS_COVERAGE_PINS = held;
    }
  });

  test("the flag is what turns it on", () => {
    const held = process.env.NEWS_COVERAGE_PINS;
    process.env.NEWS_COVERAGE_PINS = "on";
    try {
      expect(pinsEnabled()).toBe(true);
    } finally {
      if (held === undefined) delete process.env.NEWS_COVERAGE_PINS;
      else process.env.NEWS_COVERAGE_PINS = held;
    }
  });
});
