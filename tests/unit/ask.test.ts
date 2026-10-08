// The question reader of the command palette: a typed question in, filters out.
//
// The table is the contract. Each row is one question and the filters it must give.
// The rows that give NOTHING matter as much as the others: a place name alone, a
// camera search and a palette command must leave the palette as it was before the
// reader existed.

import { describe, it, expect } from "vitest";
import {
  parseAsk,
  removeSpans,
  chipLabel,
  phrasesOfLabel,
  normalisePhrase,
  LAYER_SYNONYMS,
  PLACE_SHORT_NAMES,
  type AskResult,
} from "@/lib/shell/ask";
import { askContext } from "@/lib/shell/askContext";
import { MAP_SIGNALS, DATA_ONLY_SIGNAL_IDS } from "@/lib/signals/registry";
import { TIME_WINDOWS } from "@/lib/shell/timeWindow";

const CTX = askContext();

/** The compact form of a result that a table row states. */
interface Want {
  layers?: string[];
  /** The place words as typed. */
  place?: string;
  /** ISO alpha-3, when the reader knows the place is a country with no lookup. */
  country?: string;
  time?: string;
  /** "only:exact", "without:country" ... */
  precision?: string;
  unknown?: string[];
}

function summarise(r: AskResult): Want {
  const out: Want = {};
  for (const f of r.filters) {
    if (f.kind === "layer") (out.layers ??= []).push(f.layerId);
    else if (f.kind === "place") {
      out.place = f.text;
      if (f.countryIso3) out.country = f.countryIso3;
    } else if (f.kind === "time") out.time = f.window;
    else out.precision = `${f.mode}:${f.level}`;
  }
  if (r.unknown.length) out.unknown = [...r.unknown];
  return out;
}

const NOTHING: Want = {};

const TABLE: [question: string, want: Want][] = [
  // --- the question of the brief, and its parts ---------------------------------
  ["fires in Spain last 24h", { layers: ["wildfires"], place: "Spain", country: "ESP", time: "24h" }],
  ["fires", { layers: ["wildfires"] }],
  ["wildfires", { layers: ["wildfires"] }],
  ["Wildfires in Portugal", { layers: ["wildfires"], place: "Portugal", country: "PRT" }],
  ["last 24h", { time: "24h" }],

  // --- layer synonyms ------------------------------------------------------------
  ["quakes in Japan", { layers: ["earthquakes"], place: "Japan", country: "JPN" }],
  ["earthquakes past week", { layers: ["earthquakes"], time: "7d" }],
  ["earthquake", { layers: ["earthquakes"] }],
  ["outages in Iran", { layers: ["internet-outages"], place: "Iran", country: "IRN" }],
  ["internet outages", { layers: ["internet-outages"] }],
  ["cloud outages", { layers: ["cloud-status"] }],
  ["hurricanes last 7 days", { layers: ["tropical-cyclones"], time: "7d" }],
  ["volcanoes", { layers: ["volcanoes"] }],
  ["eruptions in Iceland", { layers: ["volcanoes"], place: "Iceland", country: "ISL" }],
  ["protests in France last 6 hours", { layers: ["protests"], place: "France", country: "FRA", time: "6h" }],
  ["active fires", { layers: ["fire-active"] }],
  ["air quality in India", { layers: ["airquality"], place: "India", country: "IND" }],
  ["gps jamming", { layers: ["gpsJamming"] }],
  ["ransomware", { layers: ["cyber-ransomware"] }],
  ["rocket launches", { layers: ["launches"] }],
  ["fires and quakes in Chile", { layers: ["wildfires", "earthquakes"], place: "Chile", country: "CHL" }],
  ["show me floods in Brazil", { layers: ["floods"], place: "Brazil", country: "BRA" }],
  ["Floods?", { layers: ["floods"] }],

  // --- time forms ----------------------------------------------------------------
  ["quakes last hour", { layers: ["earthquakes"], time: "1h" }],
  ["quakes in the last 6h", { layers: ["earthquakes"], time: "6h" }],
  ["quakes past 24 hours", { layers: ["earthquakes"], time: "24h" }],
  ["quakes last day", { layers: ["earthquakes"], time: "24h" }],
  ["quakes 7d", { layers: ["earthquakes"], time: "7d" }],
  ["fires last week", { layers: ["wildfires"], time: "7d" }],
  ["fires within the last 7 days", { layers: ["wildfires"], time: "7d" }],
  // The map has four windows. A length it does not have is said, not rounded.
  ["fires last 48h", { layers: ["wildfires"], unknown: ["last 48h"] }],
  ["fires last 3 days", { layers: ["wildfires"], unknown: ["last 3 days"] }],
  // Left out on purpose: these are not a fixed length back from now.
  ["fires today", { layers: ["wildfires"], unknown: ["today"] }],
  ["fires since Monday", { layers: ["wildfires"], unknown: ["since Monday"] }],
  ["fires yesterday", { layers: ["wildfires"], unknown: ["yesterday"] }],

  // --- precision forms -----------------------------------------------------------
  ["fires exact only", { layers: ["wildfires"], precision: "only:exact" }],
  ["exact only", { precision: "only:exact" }],
  ["only exact points", { precision: "only:exact" }],
  ["outages country-level", { layers: ["internet-outages"], precision: "only:country" }],
  ["country level", { precision: "only:country" }],
  ["country figures only", { precision: "only:country" }],
  ["no country figures", { precision: "without:country" }],
  ["conflict in Sudan no country figures", { layers: ["conflict"], place: "Sudan", country: "SDN", precision: "without:country" }],
  ["without country-level figures", { precision: "without:country" }],
  ["area-level", { precision: "only:area" }],
  ["facilities only", { precision: "only:facility" }],
  ["hide areas", { precision: "without:area" }],

  // --- places --------------------------------------------------------------------
  // A country is known with no lookup. Another place keeps its words for the lookup.
  ["protests in Paris", { layers: ["protests"], place: "Paris" }],
  ["crime near London last 24h", { layers: ["crime"], place: "London", time: "24h" }],
  ["quakes in New Zealand", { layers: ["earthquakes"], place: "New Zealand", country: "NZL" }],
  ["fires in the UK", { layers: ["wildfires"], place: "UK", country: "GBR" }],
  ["fires in the US", { layers: ["wildfires"], place: "US", country: "USA" }],
  ["outages in russia", { layers: ["internet-outages"], place: "russia", country: "RUS" }],
  // No "in": a bare country name next to a filter is still the place.
  ["Spain fires", { layers: ["wildfires"], place: "Spain", country: "ESP" }],
  ["fires Spain last 24h", { layers: ["wildfires"], place: "Spain", country: "ESP", time: "24h" }],
  // A bare word that is not a country is NOT guessed to be a place.
  ["fires Madrid", { layers: ["wildfires"], unknown: ["Madrid"] }],
  // One place for each question. The second one is said, not dropped.
  ["fires in Spain and Portugal", { layers: ["wildfires"], place: "Spain", country: "ESP", unknown: ["Portugal"] }],
  // The reader does not know where the user is.
  ["fires near me", { layers: ["wildfires"], unknown: ["near me"] }],
  ["quakes in Bosnia and Herzegovina", { layers: ["earthquakes"], place: "Bosnia and Herzegovina", country: "BIH" }],

  // --- words the reader does not know are said -----------------------------------
  ["fires in Spain last 24h bananas", { layers: ["wildfires"], place: "Spain", country: "ESP", time: "24h", unknown: ["bananas"] }],
  ["big fires", { layers: ["wildfires"], unknown: ["big"] }],

  // --- must NOT parse: the palette stays as it is today --------------------------
  ["Spain", NOTHING],
  ["in Spain", NOTHING],
  ["london", NOTHING],
  ["cameras in London", NOTHING],
  ["m25 camera", NOTHING],
  ["live cams", NOTHING],
  ["asdf qwer", NOTHING],
  ["", NOTHING],
  ["   ", NOTHING],
  ["dark", NOTHING],
  ["streets", NOTHING],
  ["planes", NOTHING],
  // A palette command that holds a layer word is a command, not a question.
  ["add earthquakes", NOTHING],
  ["Toggle Live cams", NOTHING],
  ["fly to Spain", NOTHING],
  ["focus wildfires", NOTHING],
  // The time word alone inside a longer word, or a number alone, is not a time.
  ["24", NOTHING],
];

describe("parseAsk: the question table", () => {
  it("has at least 30 questions", () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(30);
  });

  it.each(TABLE)("%j", (question, want) => {
    expect(summarise(parseAsk(question, CTX))).toEqual(want);
  });

  it("gives no unknown words when it understood no filter", () => {
    const r = parseAsk("cameras in London", CTX);
    expect(r.filters).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  it("gives one filter for each kind at most, except layers", () => {
    const r = parseAsk("fires last 24h last 7 days exact only no country figures", CTX);
    expect(r.filters.filter((f) => f.kind === "time")).toHaveLength(1);
    expect(r.filters.filter((f) => f.kind === "precision")).toHaveLength(1);
    // The second of each is not dropped in silence.
    expect(r.unknown).toEqual(["last 7 days", "no country figures"]);
  });

  it("names one layer one time, and its chip removes each word that named it", () => {
    const text = "fires wildfires fire in Spain";
    const r = parseAsk(text, CTX);
    const layers = r.filters.filter((f) => f.kind === "layer");
    expect(layers).toHaveLength(1);
    expect(removeSpans(text, layers[0].spans)).toBe("in Spain");
  });
});

describe("parseAsk: layers come from the registry", () => {
  const ids = new Set(MAP_SIGNALS.map((s) => s.id));

  it("every synonym points at a layer that is on the map", () => {
    const dead = Object.entries(LAYER_SYNONYMS).filter(([, id]) => !ids.has(id));
    expect(dead).toEqual([]);
  });

  it("no synonym points at a data-only source", () => {
    for (const id of Object.values(LAYER_SYNONYMS)) expect(DATA_ONLY_SIGNAL_IDS).not.toContain(id);
  });

  it("synonym keys are in the form the reader compares", () => {
    for (const key of Object.keys(LAYER_SYNONYMS)) expect(normalisePhrase(key)).toBe(key);
  });

  it("every map layer answers to its own name", () => {
    for (const s of MAP_SIGNALS) {
      const phrase = phrasesOfLabel(s.label)[0];
      const r = parseAsk(phrase, CTX);
      const layer = r.filters.find((f) => f.kind === "layer");
      // Two layers can share a name ("Earthquakes" and "Earthquakes (EMSC)"). The
      // first in the registry answers to it, so the answer has that same name.
      expect(layer, s.label).toBeDefined();
      if (layer?.kind === "layer") expect(phrasesOfLabel(layer.label)[0]).toBe(phrase);
    }
  });

  it("a layer that leaves the registry leaves the reader", () => {
    const fewer = askContext(MAP_SIGNALS.filter((s) => s.id !== "wildfires"));
    expect(parseAsk("wildfires", fewer).filters).toEqual([]);
    // The synonym goes with it: it must not turn on a layer that is not there.
    expect(parseAsk("fires in Spain", fewer).filters).toEqual([]);
  });

  it("strips the source note from a label", () => {
    expect(phrasesOfLabel("Earthquakes (EMSC)")).toContain("earthquakes");
    expect(phrasesOfLabel("Air quality — stations (OpenAQ)")).toContain("air quality stations");
  });
});

describe("parseAsk: places", () => {
  it("every short country name points at a country the reader knows", () => {
    for (const [, iso3] of Object.entries(PLACE_SHORT_NAMES)) {
      expect([...CTX.countries.values()].some((c) => c.iso3 === iso3), iso3).toBe(true);
    }
  });

  it("keeps the place words as typed for the lookup", () => {
    const r = parseAsk("protests in São Paulo last 24h", CTX);
    const place = r.filters.find((f) => f.kind === "place");
    expect(place?.kind === "place" && place.text).toBe("São Paulo");
  });
});

describe("parseAsk: time windows", () => {
  it("gives only windows the map has", () => {
    const keys = new Set(TIME_WINDOWS.filter((w) => w.ms != null).map((w) => w.key));
    for (const [question] of TABLE) {
      for (const f of parseAsk(question, CTX).filters) {
        if (f.kind === "time") expect(keys.has(f.window)).toBe(true);
      }
    }
  });
});

describe("removeSpans: a removed chip removes its words", () => {
  it("removes each filter of the question from the text", () => {
    const text = "fires in Spain last 24h";
    const r = parseAsk(text, CTX);
    const by = (kind: string) => r.filters.find((f) => f.kind === kind)!;
    expect(removeSpans(text, by("time").spans)).toBe("fires in Spain");
    expect(removeSpans(text, by("place").spans)).toBe("fires last 24h");
    expect(removeSpans(text, by("layer").spans)).toBe("in Spain last 24h");
  });

  it("the text without a chip no longer gives that filter", () => {
    const text = "outages in Iran country-level past week";
    for (const f of parseAsk(text, CTX).filters) {
      const rest = parseAsk(removeSpans(text, f.spans), CTX);
      expect(rest.filters.some((g) => g.kind === f.kind), f.kind).toBe(false);
    }
  });
});

describe("chipLabel: what a chip says", () => {
  const label = (q: string, kind: string) => {
    const f = parseAsk(q, CTX).filters.find((x) => x.kind === kind)!;
    return chipLabel(f);
  };
  it("says the layer by its registry name", () => {
    expect(label("fires", "layer")).toBe("Wildfires");
    expect(label("quakes", "layer")).toBe("Earthquakes");
  });
  it("says the window in words", () => {
    expect(label("last 24h", "time")).toBe("Last 24 hours");
    expect(label("past week", "time")).toBe("Last 7 days");
    expect(label("last hour", "time")).toBe("Last hour");
  });
  it("says the precision rule in words", () => {
    expect(label("exact only", "precision")).toBe("Exact points only");
    expect(label("no country figures", "precision")).toBe("No country figures");
    expect(label("country-level", "precision")).toBe("Country figures only");
  });
  it("says the place", () => {
    expect(label("fires in the uk", "place")).toBe("UK");
    expect(label("outages in russia", "place")).toBe("Russia");
  });
});
