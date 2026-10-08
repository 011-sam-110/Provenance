// lib/shell/ask.ts
// The question reader of the command palette: a typed question in, filters out.
//
//   "fires in Spain last 24h"  ->  layer Wildfires, place Spain, time 24h
//
// RULES ONLY. No model and no network: the same text gives the same filters every
// time, and a test table (tests/unit/ask.test.ts) states the answer for each form.
//
// THE RULE THIS FILE SERVES. A wrong filter that the user cannot see is worse than
// no reader. So the reader does three things:
//   1. It gives each filter the words it came from (`spans`). The palette shows one
//      chip for each filter, and a removed chip removes those words.
//   2. It gives back the words it did not understand (`unknown`). The palette shows
//      them. It does not drop them.
//   3. It does not guess. A time length the map has no window for ("last 48h") is
//      not rounded to a near one, and a bare word that is not a country is not
//      taken for a place.
//
// WHEN IT UNDERSTANDS NOTHING it gives no filter and no unknown word, and the
// palette is then the palette it was before. A place name alone gives nothing (the
// palette already flies to a place), a palette command gives nothing ("add
// earthquakes" adds a widget), and a camera search gives nothing.
//
// Pure: no DOM, no store, no registry import. The layers and the countries come in
// through `AskContext` (lib/shell/askContext.ts builds the real one).

import type { SignalPrecision } from "@/lib/signals/types";
import type { TimeWindowKey } from "@/lib/shell/timeWindow";

/** A range of the typed text: [start, end) in characters. */
export type Span = [start: number, end: number];

/** A time window the map can apply. "all" is no filter, so the reader never gives it. */
export type AskTimeWindow = Exclude<TimeWindowKey, "all">;

export type AskFilter =
  | { kind: "layer"; layerId: string; label: string; spans: Span[] }
  | {
      kind: "place";
      /** The place words as typed, for the lookup and for the chip. */
      text: string;
      /** Set when the words are a country name the reader knows with no lookup. */
      countryIso3?: string;
      spans: Span[];
    }
  | { kind: "time"; window: AskTimeWindow; spans: Span[] }
  | { kind: "precision"; mode: "only" | "without"; level: SignalPrecision; spans: Span[] };

export interface AskResult {
  /** Layers in the order typed, then the place, the time and the precision. */
  filters: AskFilter[];
  /** Words the reader did not understand, in the order typed. */
  unknown: string[];
}

export interface AskLayer {
  id: string;
  label: string;
}

export interface AskCountry {
  iso3: string;
  name: string;
}

/** What the reader knows: phrases for layers and names for countries, both normalised. */
export interface AskContext {
  layers: ReadonlyMap<string, AskLayer>;
  countries: ReadonlyMap<string, AskCountry>;
}

const EMPTY: AskResult = { filters: [], unknown: [] };

// --- words ---------------------------------------------------------------------

interface Token {
  /** Lower case, no accents: the form the reader compares. */
  norm: string;
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}]+(?:['’]\p{L}+)*/gu;

function normaliseWord(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/’/g, "'");
}

function tokenise(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD)) {
    out.push({ norm: normaliseWord(m[0]), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** The form the reader compares: lower case words with one space between them. */
export function normalisePhrase(text: string): string {
  return tokenise(text)
    .map((t) => t.norm)
    .join(" ");
}

/**
 * The phrases a layer answers to, from its registry label. The first one is the
 * label itself with no source note: "Earthquakes (EMSC)" gives "earthquakes".
 */
export function phrasesOfLabel(label: string): string[] {
  const primary = normalisePhrase(label.replace(/\([^)]*\)/g, " "));
  const out = [primary];
  // "Major airports" also answers to "airports".
  if (primary.startsWith("major ")) out.push(primary.slice("major ".length));
  return out.filter(Boolean);
}

/**
 * Everyday words for a layer, each pointing at a layer id of the signal registry.
 * A key is in the compared form (`normalisePhrase`). tests/unit/ask.test.ts fails
 * if an id here is not a map layer, so a renamed or removed layer cannot leave a
 * word that turns on nothing.
 *
 * A word that the palette already uses for a different thing is left out on
 * purpose: "news" is the News board, "planes" and "ships" are core map layers.
 */
export const LAYER_SYNONYMS: Readonly<Record<string, string>> = {
  fire: "wildfires",
  fires: "wildfires",
  wildfire: "wildfires",
  "wild fires": "wildfires",
  bushfire: "wildfires",
  bushfires: "wildfires",
  firms: "fire-active",
  "fire detections": "fire-active",
  quake: "earthquakes",
  quakes: "earthquakes",
  earthquake: "earthquakes",
  tremors: "earthquakes",
  volcano: "volcanoes",
  eruption: "volcanoes",
  eruptions: "volcanoes",
  storm: "severeStorms",
  storms: "severeStorms",
  flood: "floods",
  flooding: "floods",
  disaster: "gdacs",
  disasters: "gdacs",
  cyclone: "tropical-cyclones",
  cyclones: "tropical-cyclones",
  hurricane: "tropical-cyclones",
  hurricanes: "tropical-cyclones",
  typhoon: "tropical-cyclones",
  typhoons: "tropical-cyclones",
  "northern lights": "aurora",
  launch: "launches",
  launches: "launches",
  rockets: "launches",
  cables: "cables",
  "undersea cables": "cables",
  jamming: "gpsJamming",
  nuclear: "nuclear",
  reactors: "nuclear",
  airports: "airports",
  ports: "ports",
  outage: "internet-outages",
  outages: "internet-outages",
  "internet outage": "internet-outages",
  "internet shutdowns": "internet-outages",
  shutdowns: "internet-outages",
  "cloud outage": "cloud-status",
  "cloud outages": "cloud-status",
  conflict: "conflict",
  conflicts: "conflict",
  headlines: "headline-places",
  "air raids": "ukraineAlerts",
  "air raid alerts": "ukraineAlerts",
  protest: "protests",
  protests: "protests",
  demonstrations: "protests",
  pollution: "airquality",
  smog: "airquality",
  crime: "crime",
  crimes: "crime",
  botnet: "cyber-c2",
  botnets: "cyber-c2",
  ransomware: "cyber-ransomware",
  displacement: "displacement",
  refugees: "displacement",
  grid: "grid-load",
  "grid load": "grid-load",
  "military aircraft": "military-air",
  "military planes": "military-air",
  vessels: "ais",
};

/**
 * Short country names that the country table does not hold. Each points at an ISO
 * alpha-3 code; the test fails on a code the table does not know.
 */
export const PLACE_SHORT_NAMES: Readonly<Record<string, string>> = {
  us: "USA",
  america: "USA",
  britain: "GBR",
  "great britain": "GBR",
  uae: "ARE",
  turkiye: "TUR",
};

/** Build what the reader knows from the layers on the map and the country names. */
export function buildAskContext(
  layers: readonly AskLayer[],
  countries: readonly AskCountry[],
  countryAliases: Readonly<Record<string, string>> = {},
): AskContext {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const phrases = new Map<string, AskLayer>();
  // The label of a layer first, in registry order: when two layers share a name
  // the first one answers to it.
  for (const l of layers) {
    for (const p of phrasesOfLabel(l.label)) if (!phrases.has(p)) phrases.set(p, { id: l.id, label: l.label });
  }
  // Then the everyday words. A word for a layer that is not on the map is skipped,
  // so the reader can never turn on a layer that does not exist.
  for (const [phrase, id] of Object.entries(LAYER_SYNONYMS)) {
    const l = byId.get(id);
    if (l && !phrases.has(phrase)) phrases.set(phrase, { id: l.id, label: l.label });
  }

  const byIso3 = new Map(countries.map((c) => [c.iso3, c]));
  const names = new Map<string, AskCountry>();
  for (const c of countries) {
    const key = normalisePhrase(c.name);
    if (key && !names.has(key)) names.set(key, c);
  }
  for (const table of [countryAliases, PLACE_SHORT_NAMES]) {
    for (const [alias, iso3] of Object.entries(table)) {
      const c = byIso3.get(iso3);
      const key = normalisePhrase(alias);
      if (c && key && !names.has(key)) names.set(key, c);
    }
  }
  return { layers: phrases, countries: names };
}

// --- word lists ------------------------------------------------------------------

/**
 * The first word of a palette command. A text that starts with one is a command
 * search ("add earthquakes", "toggle ships", "fly to Spain"), not a question.
 */
const COMMAND_VERBS = new Set(["add", "toggle", "focus", "fly", "dive", "stage", "language", "reset", "save", "copy"]);

/** Words that carry no filter. They are not shown as "not understood". */
const STOP = new Set([
  "show", "me", "the", "a", "an", "all", "any", "of", "on", "map", "and", "with", "for", "please",
  "what", "where", "which", "are", "is", "there", "were", "was", "find", "list", "see", "give", "get",
  "events", "happened", "reported",
]);

const PLACE_PREPOSITIONS = new Set(["in", "near", "around", "across", "inside"]);
/** Words a country name can hold: "Isle of Man", "Bosnia and Herzegovina". */
const NAME_JOINERS = new Set(["of", "and", "the"]);

const TIME_LEADS = new Set(["last", "past", "previous"]);
const TIME_LEAD_INS = new Set(["in", "over", "within", "during"]);
const UNIT_HOURS: Readonly<Record<string, number>> = {
  h: 1, hr: 1, hrs: 1, hour: 1, hours: 1,
  d: 24, day: 24, days: 24,
  w: 168, wk: 168, wks: 168, week: 168, weeks: 168,
};
const COMPACT_TIME = /^(\d+)(h|hr|hrs|d|w|wk)$/;
/** The windows the map has (lib/shell/timeWindow.ts), by their length in hours. */
const WINDOW_OF_HOURS: Readonly<Record<number, AskTimeWindow>> = { 1: "1h", 6: "6h", 24: "24h", 168: "7d" };

const ONLY_MARKS = new Set(["only", "just"]);
const WITHOUT_MARKS = new Set(["no", "without", "hide", "exclude", "excluding", "not"]);
const EXACT_NOUNS = new Set(["point", "points", "place", "places", "location", "locations", "positions", "coordinates"]);
const FIGURE_NOUNS = new Set(["figure", "figures", "total", "totals"]);

// --- the reader ------------------------------------------------------------------

type Mark = "filter" | "stop" | number; // a number is the id of one unknown phrase

/**
 * Read a typed question into filters.
 *
 * Gives `{ filters: [], unknown: [] }` when it understands no layer, no time and no
 * precision: the caller then behaves as if the reader did not exist.
 */
export function parseAsk(text: string, ctx: AskContext): AskResult {
  const tokens = tokenise(text);
  if (tokens.length === 0) return EMPTY;
  if (COMMAND_VERBS.has(tokens[0].norm)) return EMPTY;

  const marks: (Mark | undefined)[] = new Array(tokens.length).fill(undefined);
  let nextGroup = 0;
  const free = (i: number) => i >= 0 && i < tokens.length && marks[i] === undefined;
  const word = (i: number) => (i >= 0 && i < tokens.length ? tokens[i].norm : "");
  const take = (from: number, to: number, mark: Mark) => {
    for (let i = from; i <= to; i++) marks[i] = mark;
  };
  const spanOf = (from: number, to: number): Span => [tokens[from].start, tokens[to].end];
  /** These words were read but give no filter: keep them together as one phrase. */
  const refuse = (from: number, to: number) => take(from, to, nextGroup++);

  // 1. Precision: "exact only", "country-level", "no country figures".
  let precision: Extract<AskFilter, { kind: "precision" }> | undefined;
  /** A precision level at word i: how many words it takes, and if it can stand alone. */
  const levelAt = (i: number): { level: SignalPrecision; len: number; strong: boolean } | null => {
    if (!free(i)) return null;
    const w = word(i);
    const next = free(i + 1) ? word(i + 1) : "";
    if (w === "exact") return { level: "exact", len: EXACT_NOUNS.has(next) ? 2 : 1, strong: true };
    if (w === "country" && (next === "level" || FIGURE_NOUNS.has(next))) {
      const third = next === "level" && free(i + 2) && FIGURE_NOUNS.has(word(i + 2));
      return { level: "country", len: third ? 3 : 2, strong: true };
    }
    if (w === "area" && next === "level") return { level: "area", len: 2, strong: true };
    if (w === "areas" || w === "area") return { level: "area", len: 1, strong: false };
    if (w === "named" && (next === "facility" || next === "facilities")) return { level: "facility", len: 2, strong: true };
    if (w === "facility" || w === "facilities") {
      return next === "level" ? { level: "facility", len: 2, strong: true } : { level: "facility", len: 1, strong: false };
    }
    return null;
  };
  for (let i = 0; i < tokens.length; i++) {
    if (!free(i)) continue;
    let from = i;
    let mode: "only" | "without" | null = null;
    let at = i;
    if (WITHOUT_MARKS.has(word(i)) || ONLY_MARKS.has(word(i))) {
      mode = WITHOUT_MARKS.has(word(i)) ? "without" : "only";
      at = i + 1;
      if (free(at) && (word(at) === "the" || word(at) === "any")) at++;
    }
    const hit = levelAt(at);
    if (!hit) continue;
    let to = at + hit.len - 1;
    if (mode === null && free(to + 1) && ONLY_MARKS.has(word(to + 1))) {
      mode = "only";
      to++;
    }
    // "areas" and "facilities" are common words. They are a precision rule only
    // with a mark beside them: "no areas", "facilities only".
    if (mode === null && !hit.strong) continue;
    if (mode === null) from = at;
    if (precision) {
      refuse(from, to);
    } else {
      precision = { kind: "precision", mode: mode ?? "only", level: hit.level, spans: [spanOf(from, to)] };
      take(from, to, "filter");
    }
    i = to;
  }

  // 2. Time: "last 24h", "past week", "in the last 6 hours", "7d".
  let time: Extract<AskFilter, { kind: "time" }> | undefined;
  for (let i = 0; i < tokens.length; i++) {
    if (!free(i)) continue;
    // "since Monday" is not a fixed length back from now. Say so as one phrase.
    if (word(i) === "since" && free(i + 1)) {
      refuse(i, i + 1);
      i++;
      continue;
    }
    let from = i;
    let to = -1;
    let hours = 0;
    const compactAt = (j: number) => (free(j) ? COMPACT_TIME.exec(word(j)) : null);
    if (TIME_LEADS.has(word(i))) {
      const compact = compactAt(i + 1);
      if (compact) {
        hours = Number(compact[1]) * UNIT_HOURS[compact[2]];
        to = i + 1;
      } else if (free(i + 1) && /^\d+$/.test(word(i + 1)) && free(i + 2) && UNIT_HOURS[word(i + 2)] !== undefined) {
        hours = Number(word(i + 1)) * UNIT_HOURS[word(i + 2)];
        to = i + 2;
      } else if (free(i + 1) && UNIT_HOURS[word(i + 1)] !== undefined && word(i + 1).length > 2) {
        hours = UNIT_HOURS[word(i + 1)]; // "last hour", "past week"
        to = i + 1;
      }
      if (to >= 0) {
        // "in the last 6h": the words before belong to the time, not to a place.
        if (free(from - 1) && word(from - 1) === "the") from--;
        if (free(from - 1) && TIME_LEAD_INS.has(word(from - 1))) from--;
      }
    } else {
      const compact = compactAt(i);
      if (compact) {
        hours = Number(compact[1]) * UNIT_HOURS[compact[2]];
        to = i;
      }
    }
    if (to < 0) continue;
    const window = WINDOW_OF_HOURS[hours];
    if (window && !time) {
      time = { kind: "time", window, spans: [spanOf(from, to)] };
      take(from, to, "filter");
    } else {
      // A length the map has no window for, or a second time. Not rounded, not dropped.
      refuse(TIME_LEADS.has(word(i)) ? i : from, to);
    }
    i = to;
  }

  // 3. Layers: the longest phrase first, so "active fires" is not read as "fires".
  const layers: Extract<AskFilter, { kind: "layer" }>[] = [];
  let longest = 1;
  for (const phrase of ctx.layers.keys()) longest = Math.max(longest, phrase.split(" ").length);
  for (let i = 0; i < tokens.length; i++) {
    for (let len = Math.min(longest, tokens.length - i); len >= 1; len--) {
      let ok = true;
      for (let j = i; j < i + len; j++) if (!free(j)) ok = false;
      if (!ok) continue;
      const hit = ctx.layers.get(tokens.slice(i, i + len).map((t) => t.norm).join(" "));
      if (!hit) continue;
      const span = spanOf(i, i + len - 1);
      const seen = layers.find((l) => l.layerId === hit.id);
      if (seen) seen.spans.push(span);
      else layers.push({ kind: "layer", layerId: hit.id, label: hit.label, spans: [span] });
      take(i, i + len - 1, "filter");
      i += len - 1;
      break;
    }
  }

  // A place alone is not a question for this reader: the palette already flies to
  // places. So with no layer, no time and no precision there is nothing to say.
  if (layers.length === 0 && !time && !precision) return EMPTY;

  // 4. Place: "in Spain", "near London", or a bare country name ("Spain fires").
  let place: Extract<AskFilter, { kind: "place" }> | undefined;
  const phrase = (from: number, to: number) => tokens.slice(from, to + 1).map((t) => t.norm).join(" ");
  for (let i = 0; i < tokens.length && !place; i++) {
    if (!free(i) || !PLACE_PREPOSITIONS.has(word(i))) continue;
    let first = i + 1;
    if (free(first) && word(first) === "the") first++;
    if (!free(first)) continue;
    // "near me" needs the position of the user, and the reader does not have it.
    if (word(first) === "me" || word(first) === "here") {
      refuse(i, first);
      continue;
    }
    // The longest run of free words. If the whole run is a country name it can hold
    // joining words ("Bosnia and Herzegovina"); if not, the run stops at the first one.
    let end = first;
    while (free(end + 1)) end++;
    let last = end;
    while (last > first && !ctx.countries.has(phrase(first, last))) last--;
    if (!ctx.countries.has(phrase(first, last))) {
      last = first;
      while (last < end && !NAME_JOINERS.has(word(last + 1)) && !STOP.has(word(last + 1))) last++;
    }
    const country = ctx.countries.get(phrase(first, last));
    place = {
      kind: "place",
      text: text.slice(tokens[first].start, tokens[last].end),
      ...(country ? { countryIso3: country.iso3 } : {}),
      spans: [spanOf(i, last)],
    };
    take(i, last, "filter");
  }
  for (let i = 0; i < tokens.length && !place; i++) {
    for (let len = Math.min(5, tokens.length - i); len >= 1 && !place; len--) {
      let ok = true;
      for (let j = i; j < i + len; j++) if (!free(j)) ok = false;
      if (!ok) continue;
      const name = phrase(i, i + len - 1);
      // Two letters ("us", "in", "no") are too short to take for a country by themselves.
      const country = name.length >= 3 ? ctx.countries.get(name) : undefined;
      if (!country) continue;
      place = {
        kind: "place",
        text: text.slice(tokens[i].start, tokens[i + len - 1].end),
        countryIso3: country.iso3,
        spans: [spanOf(i, i + len - 1)],
      };
      take(i, i + len - 1, "filter");
    }
  }

  // 5. What is left: words with no meaning for a filter, then the words not understood.
  for (let i = 0; i < tokens.length; i++) {
    if (!free(i)) continue;
    const dangling = PLACE_PREPOSITIONS.has(word(i)) && !free(i + 1);
    if (STOP.has(word(i)) || ONLY_MARKS.has(word(i)) || dangling) marks[i] = "stop";
  }
  const unknown: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const mark = marks[i];
    if (mark === "filter" || mark === "stop") continue;
    let to = i;
    while (to + 1 < tokens.length && marks[to + 1] === mark) to++;
    unknown.push(text.slice(tokens[i].start, tokens[to].end));
    i = to;
  }

  const filters: AskFilter[] = [...layers];
  if (place) filters.push(place);
  if (time) filters.push(time);
  if (precision) filters.push(precision);
  return { filters, unknown };
}

// --- chips -----------------------------------------------------------------------

/**
 * The text with the words of one filter taken out. This is what "remove the chip"
 * means before the filters are applied: the chip is the text, so the text changes.
 */
export function removeSpans(text: string, spans: readonly Span[]): string {
  let out = text;
  for (const [start, end] of [...spans].sort((a, b) => b[0] - a[0])) {
    out = `${out.slice(0, start)} ${out.slice(end)}`;
  }
  return out.replace(/\s+/g, " ").trim();
}

const TIME_LABEL: Readonly<Record<AskTimeWindow, string>> = {
  "1h": "Last hour",
  "6h": "Last 6 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};

const PRECISION_PLURAL: Readonly<Record<SignalPrecision, string>> = {
  exact: "exact points",
  facility: "named facilities",
  area: "areas",
  country: "country figures",
};

/** The words for a time window, for a chip. */
export function timeLabel(window: AskTimeWindow): string {
  return TIME_LABEL[window];
}

/** The words for a precision rule, for a chip: "Exact points only", "No country figures". */
export function precisionLabel(mode: "only" | "without", level: SignalPrecision): string {
  const noun = PRECISION_PLURAL[level];
  return mode === "only" ? `${noun[0].toUpperCase()}${noun.slice(1)} only` : `No ${noun}`;
}

const UPPER_NAMES = new Set(["uk", "us", "usa", "uae", "drc"]);

/** A typed place name made fit to show: "russia" gives "Russia", "uk" gives "UK". */
export function placeLabel(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((w) => {
      if (w !== w.toLowerCase()) return w; // the user typed capitals: keep them
      if (UPPER_NAMES.has(w)) return w.toUpperCase();
      return NAME_JOINERS.has(w) ? w : `${w[0].toUpperCase()}${w.slice(1)}`;
    })
    .join(" ");
}

/** The name of the kind of a filter, shown before its value on a chip. */
export const KIND_LABEL: Readonly<Record<AskFilter["kind"], string>> = {
  layer: "Layer",
  place: "Place",
  time: "Time",
  precision: "Precision",
};

/** What one chip says. */
export function chipLabel(f: AskFilter): string {
  switch (f.kind) {
    case "layer":
      return f.label;
    case "place":
      return placeLabel(f.text);
    case "time":
      return timeLabel(f.window);
    case "precision":
      return precisionLabel(f.mode, f.level);
  }
}
