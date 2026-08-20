// lib/analytics/limits.ts
// What Vercel Web Analytics will and will not tell us, as data rather than prose.
//
// WHY THIS IS A FILE AND NOT A PARAGRAPH IN THE PAGE. The dashboard this feeds is
// the only place anyone will look before concluding something about Provenance's
// traffic, and the most expensive mistake it could make is letting an absence read
// as a zero. "No camera page was visited", "the plan will not sell us that number"
// and "that date is off the end of our retention" look identical on a chart and
// mean completely different things. So each limit is a value the UI can render
// deliberately, and each one carries the VERBATIM refusal we measured, so a reader
// can tell a quoted upstream fact from our summary of it.
//
// Every string in MEASURED_REFUSALS was copied from a real API response on the date
// stated. None of it is paraphrased and none of it is predicted.

/** Days of history the Hobby plan will serve. Stated by the API, not by us — see below. */
export const HOBBY_WINDOW_DAYS = 31;

/** A refusal we actually received, kept verbatim so the UI can quote rather than summarise. */
export interface MeasuredRefusal {
  /** What we asked for. */
  asked: string;
  /** HTTP status the API answered with. */
  status: number;
  /** The `error.message` field, character for character. */
  message: string;
  /** ISO date on which this response was observed. */
  measuredOn: string;
}

/**
 * The three refusals that define the shape of this dashboard.
 *
 * These are why the page has no custom-event section and no UTM section: not an
 * oversight, not a to-do, but a plan boundary we hit and recorded.
 */
export const MEASURED_REFUSALS: MeasuredRefusal[] = [
  {
    asked: "Custom events (anything sent with track())",
    status: 402,
    message: "Accessing Analytics custom events requires an Enterprise or Pro plan.",
    measuredOn: "2026-08-19",
  },
  {
    asked: "UTM campaign dimensions (utmSource and the rest)",
    status: 402,
    message: "UTM dimensions require an Enterprise plan or the Web Analytics Plus add-on.",
    measuredOn: "2026-08-19",
  },
  {
    asked: "Any date more than 31 days old",
    status: 400,
    message: "Invalid request: the hobby plan only grants access to the latest 31 days of data.",
    measuredOn: "2026-08-19",
  },
];

/** One row of Vercel's published plan comparison. */
export interface PlanRow {
  feature: string;
  hobby: string;
  pro: string;
  proPlus: string;
}

/**
 * Vercel's own pricing table for Web Analytics, transcribed from
 * vercel.com/docs/analytics/limits-and-pricing (page last updated 2026-06-26,
 * read 2026-08-19). Kept verbatim in substance so the "what you would gain"
 * panel quotes Vercel rather than our recollection of Vercel.
 */
export const PLAN_TABLE: PlanRow[] = [
  { feature: "Custom events", hobby: "Not available", pro: "Included", proPlus: "Included" },
  { feature: "Properties per custom event", hobby: "Not available", pro: "2", proPlus: "8" },
  { feature: "UTM parameters", hobby: "Not available", pro: "Not available", proPlus: "Included" },
  { feature: "Reporting window", hobby: "1 month", pro: "12 months", proPlus: "24 months" },
  { feature: "Included events", hobby: "50,000 / month", pro: "None included", proPlus: "None included" },
  { feature: "Extra events", hobby: "Cannot be purchased", pro: "$0.03 per 1,000", proPlus: "$0.03 per 1,000" },
];

/**
 * The Pro price, stated once. $20/month per user for the Pro plan, plus $10/month
 * per team for the Web Analytics Plus add-on if the 8-property tier is wanted.
 * These are list prices at the date read; nobody should quote them from memory.
 */
export const PRO_PRICE_NOTE =
  "Pro is $20/month per user. The Web Analytics Plus add-on is a further $10/month per team, " +
  "and is the only tier that unlocks UTM dimensions and 8 properties per event.";

/**
 * The cap that bites hardest and is easiest to miss: the event allowance is
 * TEAM-WIDE, not per project, so another project's traffic can pause collection
 * here. Stated on the same Vercel page under "Is usage shared across projects?".
 */
export const SHARED_ALLOWANCE_NOTE =
  "The 50,000-event monthly allowance is shared across every project on the Vercel team, " +
  "not per project. When it runs out, collection pauses after a three-day grace period and " +
  "Hobby teams cannot buy more.";

/** The API's own ceiling on how many distinct values one grouped query will return. */
export const MAX_DISTINCT_PER_QUERY = 100;
