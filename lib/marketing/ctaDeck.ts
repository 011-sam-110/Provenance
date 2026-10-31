// The landing button's list: what it offers, where each offer goes, and in what order
// this visitor sees them. Pure: no DOM, no fetch. Pinned by tests/unit/landing-cta-deck.test.ts.
//
// EVERY DOOR IS MEASURED OR IT IS NOT HERE.
//   - A place is a row of cta-places.data.ts. scripts/gen-eye-cities.mjs read its buildings
//     from the tiles the map draws, a person looked at the frame, and docs/EYE_CITIES.md has
//     the numbers. A city with footprints and no heights is a flat field in 3D: not offered.
//   - A topic names the layers it opens under `needs`. `npx vite-node -c vitest.config.ts
//     scripts/check-cta-deck.mts` asks production for each and fails on an empty one.
//   - A board is a built-in preset, opened with `?preset=` (lib/console/bootSeed.ts).
//
// RELEVANT WITHOUT ASKING ANYONE. The order comes from the browser's own time zone and,
// when that says nothing (UTC), its language. Both are read on the visitor's machine and
// sent nowhere: this page makes no /api call and has no location lookup, and /privacy says
// so. A time zone is coarse on purpose. It tells New York from Chicago, not one street
// from the next.
//
// THIS FILE GOES IN THE LANDING PAGE'S BUNDLE. Do not import the signal registry, the eye
// places or the console's stores here: the test holds the ids against them instead.

import { CTA_PLACES } from "@/lib/marketing/cta-places.data";

export type Continent = "eu" | "na" | "sa" | "as" | "me" | "af" | "oc";

export interface CtaDoor {
  words: string;
  href: string;
  kind: "place" | "board" | "topic";
  /** Regions that see this first. Empty: nobody's in particular. */
  homes: readonly string[];
  /** 3: offered to everyone. 2: offered on its continent. 1: offered at home. */
  fame: 1 | 2 | 3;
  /** Signal layers a topic opens. */
  needs?: readonly string[];
  /**
   * A topic that needs `layers=` to mean anything. The console saves a link's `layers=`
   * over the visitor's own toggles, so a browser with a saved board is not offered these.
   */
  writesLayers?: boolean;
}

/** The phrase the page is served with, for crawlers and for no script at all. */
export const FIRST_WORDS = "See London in 3D";
export const FIRST_HREF = "/eye";

/** A phrase wider than the button is a broken button: tests/e2e/landing-cta.spec.ts measures all of them. */
export const MAX_WORDS = 25;

/** lib/variants/store.ts PERSIST_KEY, held equal by the test. */
export const SAVED_BOARD_KEY = "tn.variant.v1";

/** One signal topic, in the console's own link format (lib/share/url.ts). */
function topic(
  words: string,
  needs: readonly string[],
  lat: number,
  lon: number,
  z: number,
  fame: 1 | 2 | 3,
  homes: readonly string[] = [],
): CtaDoor {
  const sig = needs.join(",");
  return {
    words,
    href: `/app?lat=${lat}&lon=${lon}&z=${z}&sig=${sig}`,
    kind: "topic",
    homes,
    fame,
    needs,
  };
}

const coreTopic = (
  words: string,
  layers: string,
  lat: number,
  lon: number,
  z: number,
  needs?: readonly string[],
): CtaDoor => ({
  words,
  href: `/app?lat=${lat}&lon=${lon}&z=${z}&layers=${layers}${needs ? `&sig=${needs.join(",")}` : ""}`,
  kind: "topic",
  homes: [],
  fame: 3,
  needs,
  writesLayers: true,
});

const board = (words: string, preset: string): CtaDoor => ({
  words,
  href: `/app?preset=${preset}`,
  kind: "board",
  homes: [],
  fame: 3,
});

/**
 * What the war looks like today, and what it will look like. `conflict` (UCDP's verified
 * events) has rows now. The rest come from provenance-1's relay and stay empty until those
 * senders run; they draw nothing while empty and join this link by themselves once they do.
 */
const UKRAINE_WAR = ["conflict", "war-zones", "frontline-changes", "losses-ru", "losses-ua", "war-news", "ukraineAlerts"];

/**
 * Each of these was opened on production as a first visitor and looked at. Rocket launches,
 * military aircraft, volcanoes, satellites and UK crime have real rows and were left out on
 * sight: a handful of small marks on a whole globe is not what this button promises.
 */
export const CTA_TOPICS: readonly CtaDoor[] = [
  topic("See Ukraine war data", UKRAINE_WAR, 48.6, 34.5, 5.2, 3, ["pl", "cee", "ua", "ru"]),
  topic("See today's earthquakes", ["earthquakes"], 15, 150, 1.9, 3, ["jp", "nz", "id", "ph", "tw"]),
  topic("See fires from space", ["fire-active"], 5, 20, 1.9, 3, ["au", "br", "za"]),
  topic("See undersea cables", ["cable-routes", "cables"], 38, -5, 2.6, 3),
  topic("See GPS jamming", ["gpsJamming"], 45, 33, 4.6, 3, ["pl", "cee", "nordic", "il"]),
  topic("See internet outages", ["internet-outages"], 20, 30, 1.9, 3),
  topic("See nuclear power plants", ["nuclear"], 45, 10, 3, 2, ["fr", "gb", "de", "jp"]),
  topic("See the aurora forecast", ["aurora"], 70, -40, 1.9, 3, ["nordic", "ca-west", "ca-east"]),
  topic("See disaster alerts", ["gdacs"], 15, 60, 1.9, 3),
  topic("See conflict worldwide", ["conflict"], 20, 30, 1.9, 3),
  topic("See ships in the Channel", ["ais"], 50.6, 0.6, 7, 1, ["gb", "fr", "nl", "be"]),
  topic("See ships at Gibraltar", ["ais"], 36, -5.6, 9.5, 1, ["es", "ma", "pt"]),
  topic("See ships at Singapore", ["ais"], 1.2, 103.9, 10, 1, ["sg", "my", "id"]),
  coreTopic("See flights worldwide", "planes", 35, -30, 2),
  coreTopic("See Earth right now", "planes", 28, -30, 1.7, ["earthquakes", "ais"]),
  board("See street cameras", "streets"),
  board("See the news on a map", "news"),
];

const placeDoors: readonly CtaDoor[] = CTA_PLACES.map(([id, say, home, fame]) => ({
  words: `See ${say} in 3D`,
  href: `/eye?place=${id}`,
  kind: "place" as const,
  homes: [home],
  fame,
}));

/** London's three framed presets (lib/eye/places.ts), and the phrase the page ships with. */
const LONDON: readonly CtaDoor[] = [
  { words: FIRST_WORDS, href: FIRST_HREF, kind: "place", homes: ["gb"], fame: 3 },
  { words: "See Tower Bridge in 3D", href: "/eye?place=tower-bridge", kind: "place", homes: ["gb"], fame: 3 },
  { words: "See Westminster in 3D", href: "/eye?place=westminster", kind: "place", homes: ["gb"], fame: 2 },
  { words: "See Piccadilly in 3D", href: "/eye?place=piccadilly", kind: "place", homes: ["gb"], fame: 2 },
];

export const CTA_DOORS: readonly CtaDoor[] = [...LONDON, ...placeDoors, ...CTA_TOPICS];

/** A region's continent. An unknown region is nobody's neighbour. */
export const HOME_CONTINENT: Readonly<Record<string, Continent>> = {
  gb: "eu", ie: "eu", fr: "eu", es: "eu", pt: "eu", it: "eu", de: "eu", nl: "eu", be: "eu", ch: "eu", at: "eu",
  nordic: "eu", pl: "eu", cee: "eu", ua: "eu", gr: "eu", tr: "eu", ru: "eu",
  gulf: "me", il: "me", levant: "me", eg: "me",
  za: "af", ke: "af", ng: "af", ma: "af",
  in: "as", pk: "as", bd: "as", lk: "as", sg: "as", my: "as", th: "as", id: "as", vn: "as", ph: "as",
  hk: "as", cn: "as", tw: "as", jp: "as", kr: "as",
  au: "oc", nz: "oc",
  "us-east": "na", "us-central": "na", "us-mountain": "na", "us-west": "na", "ca-east": "na", "ca-west": "na", mx: "na",
  latam: "sa", co: "sa", pe: "sa", cl: "sa", ar: "sa", br: "sa",
};

/** IANA time zones with a region of their own. A zone not here falls to its continent. */
const ZONE_HOME: Readonly<Record<string, string>> = {
  "Europe/London": "gb", "Europe/Belfast": "gb", "Europe/Jersey": "gb", "Europe/Guernsey": "gb", "Europe/Isle_of_Man": "gb",
  "Europe/Dublin": "ie",
  "Europe/Paris": "fr", "Europe/Monaco": "fr",
  "Europe/Madrid": "es", "Atlantic/Canary": "es", "Africa/Ceuta": "es", "Europe/Andorra": "es",
  "Europe/Lisbon": "pt", "Atlantic/Madeira": "pt", "Atlantic/Azores": "pt",
  "Europe/Rome": "it", "Europe/Vatican": "it", "Europe/San_Marino": "it", "Europe/Malta": "it",
  "Europe/Berlin": "de", "Europe/Busingen": "de",
  "Europe/Amsterdam": "nl", "Europe/Brussels": "be", "Europe/Luxembourg": "be",
  "Europe/Zurich": "ch", "Europe/Vaduz": "ch", "Europe/Vienna": "at",
  "Europe/Stockholm": "nordic", "Europe/Oslo": "nordic", "Europe/Copenhagen": "nordic", "Europe/Helsinki": "nordic",
  "Atlantic/Reykjavik": "nordic",
  "Europe/Warsaw": "pl",
  "Europe/Prague": "cee", "Europe/Bratislava": "cee", "Europe/Budapest": "cee", "Europe/Bucharest": "cee",
  "Europe/Sofia": "cee", "Europe/Belgrade": "cee", "Europe/Zagreb": "cee", "Europe/Ljubljana": "cee",
  "Europe/Sarajevo": "cee", "Europe/Skopje": "cee", "Europe/Podgorica": "cee", "Europe/Tirane": "cee",
  "Europe/Vilnius": "cee", "Europe/Riga": "cee", "Europe/Tallinn": "cee", "Europe/Chisinau": "cee",
  "Europe/Kyiv": "ua", "Europe/Kiev": "ua", "Europe/Minsk": "cee",
  "Europe/Athens": "gr", "Asia/Nicosia": "gr", "Europe/Istanbul": "tr", "Asia/Istanbul": "tr",
  "Europe/Moscow": "ru",
  "Asia/Dubai": "gulf", "Asia/Muscat": "gulf", "Asia/Qatar": "gulf", "Asia/Riyadh": "gulf", "Asia/Kuwait": "gulf",
  "Asia/Bahrain": "gulf", "Asia/Jerusalem": "il", "Asia/Tel_Aviv": "il",
  "Asia/Beirut": "levant", "Asia/Amman": "levant", "Asia/Damascus": "levant", "Asia/Baghdad": "levant",
  "Africa/Cairo": "eg",
  "Africa/Johannesburg": "za", "Africa/Nairobi": "ke", "Africa/Lagos": "ng", "Africa/Casablanca": "ma",
  "Asia/Kolkata": "in", "Asia/Calcutta": "in", "Asia/Karachi": "pk", "Asia/Dhaka": "bd", "Asia/Colombo": "lk",
  "Asia/Singapore": "sg", "Asia/Kuala_Lumpur": "my", "Asia/Bangkok": "th", "Asia/Jakarta": "id",
  "Asia/Ho_Chi_Minh": "vn", "Asia/Saigon": "vn", "Asia/Manila": "ph",
  "Asia/Hong_Kong": "hk", "Asia/Macau": "hk", "Asia/Shanghai": "cn", "Asia/Chongqing": "cn", "Asia/Urumqi": "cn",
  "Asia/Taipei": "tw", "Asia/Tokyo": "jp", "Asia/Seoul": "kr",
  "Pacific/Auckland": "nz",
  "America/New_York": "us-east", "America/Detroit": "us-east", "America/Kentucky/Louisville": "us-east",
  "America/Kentucky/Monticello": "us-east", "America/Indiana/Indianapolis": "us-east",
  "America/Chicago": "us-central", "America/Menominee": "us-central", "America/Indiana/Knox": "us-central",
  "America/North_Dakota/Center": "us-central",
  "America/Denver": "us-mountain", "America/Boise": "us-mountain", "America/Phoenix": "us-mountain",
  "America/Los_Angeles": "us-west", "America/Anchorage": "us-west", "Pacific/Honolulu": "us-west",
  "America/Toronto": "ca-east", "America/Montreal": "ca-east", "America/Halifax": "ca-east", "America/St_Johns": "ca-east",
  "America/Winnipeg": "ca-west", "America/Regina": "ca-west", "America/Edmonton": "ca-west", "America/Vancouver": "ca-west",
  "America/Mexico_City": "mx", "America/Monterrey": "mx", "America/Cancun": "mx", "America/Tijuana": "mx",
  "America/Panama": "latam", "America/Costa_Rica": "latam", "America/Guatemala": "latam", "America/Havana": "latam",
  "America/Santo_Domingo": "latam", "America/Puerto_Rico": "latam", "America/Caracas": "latam",
  "America/Bogota": "co", "America/Lima": "pe", "America/Santiago": "cl",
  "America/Argentina/Buenos_Aires": "ar", "America/Buenos_Aires": "ar", "America/Montevideo": "ar",
  "America/Sao_Paulo": "br", "America/Fortaleza": "br", "America/Recife": "br", "America/Manaus": "br", "America/Bahia": "br",
};

/** A language tag's country, for a browser that reports UTC. */
const COUNTRY_HOME: Readonly<Record<string, string>> = {
  GB: "gb", IE: "ie", FR: "fr", ES: "es", PT: "pt", IT: "it", DE: "de", NL: "nl", BE: "be", CH: "ch", AT: "at",
  SE: "nordic", NO: "nordic", DK: "nordic", FI: "nordic", IS: "nordic", PL: "pl", CZ: "cee", SK: "cee", HU: "cee",
  RO: "cee", BG: "cee", RS: "cee", HR: "cee", LT: "cee", LV: "cee", EE: "cee", UA: "ua", GR: "gr", TR: "tr", RU: "ru",
  AE: "gulf", SA: "gulf", QA: "gulf", KW: "gulf", BH: "gulf", OM: "gulf", IL: "il", LB: "levant", JO: "levant", EG: "eg",
  ZA: "za", KE: "ke", NG: "ng", MA: "ma", IN: "in", PK: "pk", BD: "bd", LK: "lk", SG: "sg", MY: "my", TH: "th",
  ID: "id", VN: "vn", PH: "ph", HK: "hk", CN: "cn", TW: "tw", JP: "jp", KR: "kr", AU: "au", NZ: "nz",
  US: "us-east", CA: "ca-east", MX: "mx", PA: "latam", CO: "co", PE: "pe", CL: "cl", AR: "ar", BR: "br",
};

const CONTINENT_OF_ZONE: Readonly<Record<string, Continent>> = {
  Europe: "eu", Africa: "af", Asia: "as", Australia: "oc", Pacific: "oc", Antarctica: "oc", Atlantic: "eu",
};

export interface Visitor {
  home: string | null;
  continent: Continent | null;
}

/** Where this browser says it is. Nothing here leaves the page. */
export function readVisitor(timeZone: string | undefined, language: string | undefined): Visitor {
  const zone = timeZone ?? "";
  const byZone = ZONE_HOME[zone] ?? (zone.startsWith("Australia/") ? "au" : undefined);
  if (byZone) return { home: byZone, continent: HOME_CONTINENT[byZone] ?? null };
  const country = /^[a-z]{2,3}[-_](?:[a-z]{4}[-_])?([a-z]{2})\b/i.exec(language ?? "")?.[1]?.toUpperCase();
  const byCountry = country ? COUNTRY_HOME[country] : undefined;
  // A zone we have no row for still names a continent; a language's country beats that.
  if (byCountry) return { home: byCountry, continent: HOME_CONTINENT[byCountry] ?? null };
  const area = zone.split("/")[0];
  if (area === "America") return { home: null, continent: "na" };
  return { home: null, continent: CONTINENT_OF_ZONE[area] ?? null };
}

export interface DeckOptions {
  /** This browser has a saved console board. */
  savedBoard?: boolean;
  /** 0 up to 1. Injected so a test can fix the order. */
  random?: () => number;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The repeating hand: two local places, one topic or board, one from further off. */
const WEAVE = ["home", "home", "topic", "world", "near", "topic", "home", "world"] as const;

/**
 * This visitor's list, in order, with nothing twice.
 *
 * Their own region's places come first, led by the region's first row (its best skyline:
 * the data file is in the order a person put them), then the rest, best known first, are
 * woven with topics, boards and famous places from elsewhere. A place with fame 1 is shown
 * only at home: Cleveland is worth a look from Ohio.
 */
export function deckFor(visitor: Visitor, options: DeckOptions = {}): CtaDoor[] {
  const random = options.random ?? Math.random;
  const doors = CTA_DOORS.filter((d) => !(options.savedBoard && d.writesLayers));
  const isHome = (d: CtaDoor) => visitor.home != null && d.homes.includes(visitor.home);
  const isNear = (d: CtaDoor) =>
    visitor.continent != null && d.homes.some((h) => HOME_CONTINENT[h] === visitor.continent);
  const places = doors.filter((d) => d.kind === "place");

  const home = places.filter(isHome);
  const lead = home.slice(0, 1);
  const pools = {
    // A stable sort over a shuffle: a new order each visit, inside each level of fame.
    home: shuffled(home.slice(1), random).sort((a, b) => b.fame - a.fame),
    near: shuffled(places.filter((d) => !isHome(d) && isNear(d) && d.fame >= 2), random),
    world: shuffled(places.filter((d) => !isHome(d) && !isNear(d) && d.fame === 3), random),
    topic: [
      ...shuffled(doors.filter((d) => d.kind !== "place" && isHome(d)), random),
      ...shuffled(doors.filter((d) => d.kind !== "place" && !isHome(d) && d.fame >= 2), random),
    ],
  };

  const out = [...lead];
  let left = pools.home.length + pools.near.length + pools.world.length + pools.topic.length;
  for (let turn = 0; left > 0; turn++) {
    const pool = pools[WEAVE[turn % WEAVE.length]];
    const next = pool.shift();
    if (!next) continue;
    out.push(next);
    left--;
  }
  return out;
}
