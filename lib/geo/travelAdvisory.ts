// Pure shaping for the country dossier's "Travel advisory" slot.
//
// SOURCE CHANGE, 2026-08-10. This used to read travel-advisory.info, an aggregator
// that produced a single 0–5 score across several governments. That host has
// stopped resolving: production returned {"advisory":null} for every country
// tested, so the dossier section had been silently dormant while the README still
// advertised it.
//
// It now reads the UK FCDO's own travel advice, published on gov.uk at
// /api/content/foreign-travel-advice/<slug>. Keyless, no signup, government
// primary source, and updated continuously.
//
// The trade-off is honest and must stay visible in the UI: this is ONE
// government's advice to ITS OWN nationals, not a neutral world risk index. A
// British citizen and, say, a Brazilian citizen are not given the same advice
// about the same country. The old aggregate score implied an objectivity it did
// not have; naming the issuing government is more useful and more truthful.
//
// No DOM, no fetch here — the status→band mapping and the payload parsing are
// unit-tested.

export type AdvisoryBand = "low" | "moderate" | "high";

export interface AdvisoryView {
  iso2: string;
  name: string;
  /** 0–5, derived from the FCDO's own alert statuses. See ADVISORY_LEVELS. */
  score: number;
  band: AdvisoryBand;
  /** Short band label, e.g. "Advise against all but essential travel". */
  label: string;
  /** Status hue (theme-independent, matches the map severity swatches). */
  color: string;
  /** What most recently changed in the advice, in the FCDO's own words. */
  message: string;
  /** ISO date the advice was last updated. */
  updated: string;
  /** Deep link to the country's advice page. */
  source: string;
  /** Who issued it. Rendered in the UI — this is one government's view. */
  issuer: string;
  /** The FCDO's raw alert_status values, so the dossier can show them verbatim. */
  statuses: string[];
}

interface LevelSpec {
  /** FCDO alert_status token. */
  key: string;
  score: number;
  label: string;
  band: AdvisoryBand;
  color: string;
}

/**
 * The FCDO's alert_status vocabulary, most severe first.
 *
 * These four tokens are the COMPLETE set, harvested on 2026-08-10 by reading all
 * 226 published country pages: avoid_all_travel_to_parts (41 countries),
 * avoid_all_but_essential_travel_to_parts (38), avoid_all_travel_to_whole_country
 * (11), avoid_all_but_essential_travel_to_whole_country (4). A country carries
 * zero or more; the most severe wins.
 *
 * The first draft of this table guessed at `avoid_all_travel` and
 * `avoid_all_but_essential_travel` — tokens that do not exist. The live check
 * caught it on Syria, which carries avoid_all_travel_to_whole_country and was
 * therefore being rendered as a green "No FCDO travel warning". Hence
 * UNRECOGNISED below: a status we do not know must never score zero.
 *
 * Ordering judgement: "avoid all travel to PARTS" outranks "avoid all but
 * essential travel to the WHOLE country". A total no-go region is the stronger
 * instruction, and it is the one that matters on a map of hotspots.
 */
export const ADVISORY_LEVELS: LevelSpec[] = [
  { key: "avoid_all_travel_to_whole_country", score: 5, label: "Advise against all travel", band: "high", color: "#dc2626" },
  { key: "avoid_all_travel_to_parts", score: 4, label: "Advise against all travel to parts", band: "high", color: "#ea580c" },
  { key: "avoid_all_but_essential_travel_to_whole_country", score: 3, label: "Advise against all but essential travel", band: "moderate", color: "#ea580c" },
  { key: "avoid_all_but_essential_travel_to_parts", score: 2, label: "Advise against all but essential travel to parts", band: "moderate", color: "#d97706" },
];

/**
 * Fail-safe for a status the FCDO introduces after this table was written. It is
 * scored as a serious warning, not ignored: under-reporting a travel warning is
 * the one error here with real-world consequences.
 */
const UNRECOGNISED: LevelSpec = {
  key: "unrecognised",
  score: 4,
  label: "FCDO warning in place — see gov.uk for the detail",
  band: "high",
  color: "#ea580c",
};

const NO_WARNING: LevelSpec = {
  key: "",
  score: 0,
  label: "No FCDO travel warning",
  band: "low",
  color: "#16a34a",
};

/** Map a 0–5 score back to a band — for callers that only hold the number. */
export function advisoryBand(score: number): { band: AdvisoryBand; label: string; color: string } {
  // ADVISORY_LEVELS is ordered most-severe-first, so the first level at or below
  // the score is the right one.
  const level = ADVISORY_LEVELS.find((l) => score >= l.score) ?? NO_WARNING;
  return { band: level.band, label: level.label, color: level.color };
}

/**
 * The most severe level among the FCDO's statuses.
 *
 * Only an EMPTY status list means no warning. A non-empty list we cannot decode
 * returns UNRECOGNISED — silence is reserved for the case where the FCDO itself
 * is silent.
 */
export function worstLevel(statuses: string[]): LevelSpec {
  for (const level of ADVISORY_LEVELS) {
    if (statuses.includes(level.key)) return level;
  }
  return statuses.length > 0 ? UNRECOGNISED : NO_WARNING;
}

export interface FcdoPayload {
  title?: string;
  public_updated_at?: string;
  details?: {
    alert_status?: string[] | null;
    change_description?: string | null;
    country?: { name?: string; slug?: string };
    reviewed_at?: string | null;
  };
}

/**
 * Pure: an FCDO country page → the dossier view, or null when the payload carries
 * nothing usable.
 *
 * An EMPTY alert_status is a real, meaningful answer — "the UK has no warning in
 * place" — and produces a green low-risk view, not a null. Returning null there
 * would make "no warning" indistinguishable from "we could not reach the source",
 * which is the whole failure mode this rewrite exists to remove.
 */
export function parseFcdoAdvisory(payload: FcdoPayload | null | undefined, iso2: string): AdvisoryView | null {
  const want = (iso2 ?? "").trim().toUpperCase();
  if (!want || want.length !== 2) return null;
  if (!payload || typeof payload !== "object") return null;

  const details = payload.details;
  const name = details?.country?.name?.trim() || payload.title?.replace(/\s+travel advice$/i, "").trim() || want;
  const slug = details?.country?.slug?.trim();
  // A page with no country block and no title is not an advisory page at all.
  if (!details && !payload.title) return null;

  const statuses = (details?.alert_status ?? []).filter((s): s is string => typeof s === "string" && s.length > 0);
  const level = worstLevel(statuses);

  return {
    iso2: want,
    name,
    score: level.score,
    band: level.band,
    label: level.label,
    color: level.color,
    message: details?.change_description?.trim() || "",
    updated: (payload.public_updated_at ?? "").slice(0, 10),
    source: slug
      ? `https://www.gov.uk/foreign-travel-advice/${slug}`
      : "https://www.gov.uk/foreign-travel-advice",
    issuer: "UK Foreign, Commonwealth & Development Office",
    statuses,
  };
}
