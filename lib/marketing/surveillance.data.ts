/**
 * The surveillance figures on the landing page, and where each one came from.
 *
 * WHY THIS FILE CARRIES ITS OWN CITATIONS. The page's argument is that its numbers are
 * checkable, so a camera count it cannot attribute is worse than no camera count at all.
 * Every row here names the study it came from, and `docs/LANDING_SOURCES.md` holds the
 * verbatim quote each figure was read from.
 *
 * THE SCOPE TRAP, WHICH THIS FILE EXISTS TO AVOID. There are two completely different
 * "cameras per 1,000 people" figures in circulation and they differ by more than twenty
 * times:
 *
 *   • PUBLIC CCTV — cameras operated by government bodies, which is what Comparitech
 *     counts and what this file uses. London measures 13.4 per 1,000.
 *   • TOTAL INSTALLED BASE — every camera in a country including private homes, shops and
 *     offices, which vendor market estimates count. Divide one of those by population and
 *     the UK comes out near 300 per 1,000.
 *
 * Ranking countries by mixing the two produces a league table where nothing is comparable
 * to anything else. The first draft of this page did exactly that: it ranked the UK at
 * ~304 per 1,000 against China at ~494, taking the first from a total-installed-base
 * estimate and the second from Comparitech's public-CCTV study. **Do not reintroduce a
 * mixed ranking.** One study, one scope, or no ranking.
 *
 * These rows are therefore CITY-scoped, because that is the scope Comparitech's study
 * actually supports. Its single country-wide figure is China's, and it is flagged as such
 * on the page rather than quietly ranked beside the cities.
 */

export interface SurveilledPlace {
  rank: string;
  /** The place as the study names it. */
  name: string;
  country: string;
  /** Cameras per 1,000 people, exactly as the study reports it. */
  per: string;
  /** Sort key for the bar, and the figure `per` is a rendering of. */
  perValue: number;
  /** Total cameras the study attributes to the place. */
  cameras: string;
  /** Population the study divided by. Shown so the arithmetic is visible. */
  population: string;
  /** Where the globe turns to. [lon, lat]. */
  lon: number;
  lat: number;
  /** Anything the reader needs in order to read the row correctly. */
  caveat?: string;
  /** The graffiti overlay. Decorative, and it may not assert anything a source does not carry. */
  tag: string;
  tagColor: string;
  tagRot: string;
  tagDeco?: string;
}

/**
 * Comparitech, "Surveillance Camera Statistics: Which City has the Most CCTV?", updated
 * 25 June 2025. Ranks 1 to 5 of its table, verbatim.
 *
 * Rank 1 is not a city. The study could not obtain per-city figures for China, so it
 * derived a national ratio and applied it to every Chinese city — which means the row is
 * an estimate ABOUT China, sitting at the top of a table of measurements about cities.
 * It is kept because removing it would flatter the ranking, and flagged because leaving
 * the flag off would misrepresent it.
 */
export const MOST_SURVEILLED: SurveilledPlace[] = [
  {
    rank: "01",
    name: "Cities of China",
    country: "China",
    per: "494.25",
    perValue: 494.25,
    cameras: "700,000,000",
    population: "1,420,000,000",
    lon: 104,
    lat: 35,
    caveat:
      "Not a measurement of any one city. Comparitech could not obtain per-city figures, so it divided an estimated 700 million cameras by the national population and applied that ratio to every Chinese city.",
    tag: "700 MILLION EYES, NONE OF THEM YOURS",
    tagColor: "#e0625c",
    tagRot: "-2deg",
  },
  {
    rank: "02",
    name: "Hyderabad",
    country: "India",
    per: "79.38",
    perValue: 79.38,
    cameras: "900,000",
    population: "11,337,900",
    lon: 78.49,
    lat: 17.39,
    caveat: "The most surveilled city on Earth for which a per-city figure exists.",
    tag: "YOU ARE ON CAMERA",
    tagColor: "#e0625c",
    tagRot: "-3deg",
  },
  {
    rank: "03",
    name: "Indore",
    country: "India",
    per: "72.21",
    perValue: 72.21,
    cameras: "251,500",
    population: "3,482,830",
    lon: 75.86,
    lat: 22.72,
    tag: "LIVE FEED",
    tagColor: "#f0a62e",
    tagRot: "2deg",
    tagDeco: "line-through",
  },
  {
    rank: "04",
    name: "Bangalore",
    country: "India",
    per: "40.66",
    perValue: 40.66,
    cameras: "585,284",
    population: "14,395,400",
    lon: 77.59,
    lat: 12.97,
    tag: "MASS SURVEILLANCE ≠ SAFETY",
    tagColor: "#f4f8fa",
    tagRot: "-2deg",
  },
  {
    rank: "05",
    name: "Lahore",
    country: "Pakistan",
    per: "27.67",
    perValue: 27.67,
    cameras: "410,297",
    population: "14,825,800",
    lon: 74.35,
    lat: 31.55,
    tag: "WATCH THE ROAD. NOT THE PEOPLE.",
    tagColor: "#3fb4ce",
    tagRot: "-3deg",
  },
];

/** The bar on each row is scaled to the top of the table, so rank 1 fills it. */
export const SURVEILLANCE_MAX = MOST_SURVEILLED[0].perValue;

/**
 * The two cities with the surveillance reputation, and the figures they actually carry.
 * This is the point of the section: the places people name are not the places that rank,
 * and the gap between the reputation and the measurement is about twenty-fold.
 */
export const REPUTATION_CHECK = [
  { name: "London", per: "13.4", cameras: "over 130,000", note: "public cameras" },
  { name: "Los Angeles", per: "12.4", cameras: "46,766", note: "cameras" },
  { name: "New York City", per: "10.12", cameras: "80,303", note: "cameras" },
];

/** Comparitech's own averages across the 150 most populated cities it studied. */
export const SURVEILLANCE_AVERAGE = {
  excludingChina: "5.82",
  includingChina: "139.96",
};

/** The study's own statement of how far its figures can be trusted. Quoted, not paraphrased. */
export const SURVEILLANCE_CAVEAT =
  "Due to a wide range of sources reporting estimates and a general lack of public information regarding CCTV cameras, actual figures may be higher or lower than what is indicated.";

export const SURVEILLANCE_SOURCE = {
  title: "Surveillance Camera Statistics: Which City has the Most CCTV?",
  publisher: "Comparitech",
  updated: "25 June 2025",
  url: "https://www.comparitech.com/vpn-privacy/the-worlds-most-surveilled-cities/",
};

/**
 * The public-money figures the hero rests on.
 *
 * The first draft said "$29,000,000,000 spent globally creating the infrastructure to
 * monitor the world". No source carries that sentence. The nearest real figure is Omdia's
 * video surveillance market, which is ANNUAL REVENUE for one year and is mostly private
 * spending — so it supports neither "spent creating" nor "you already paid for this".
 *
 * These three do. Each is a public budget, and the first comes with a statute saying the
 * data it buys must be given back free.
 */
export const PUBLIC_SPEND = [
  {
    figure: "€5.421bn",
    what: "Copernicus, the EU's Earth observation programme, 2021 to 2027",
    detail:
      "Set in law. The same regulation requires everything Copernicus produces to be handed back on a free, full and open basis, worldwide, with the right to redistribute and modify it.",
    source: "Regulation (EU) 2021/696, Articles 11 and 53",
    url: "https://eur-lex.europa.eu/eli/reg/2021/696/oj",
  },
  {
    figure: "$137.4bn",
    what: "Government space spending worldwide, 2025",
    detail: "Defence took $73.5bn of it and civil programmes $63.7bn.",
    source: "Novaspace, Government Space Programs, 25th edition",
    url: "https://nova.space/press-release/global-space-spending-reaches-137b-marking-a-defense-led-era/",
  },
  {
    figure: "$2.195bn",
    what: "NASA Earth Science, FY 2025",
    detail: "One line in one agency's spending plan, inside a $24.8bn budget.",
    source: "NASA, FY 2025 Spending Plan",
    url: "https://www.nasa.gov/wp-content/uploads/2024/03/fy-2025-spend-plan-march-2026.pdf",
  },
];
