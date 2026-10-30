// One road notice, from any operator: the shape every road source normalises into, and
// the pure words that state its time. Pinned by tests/unit/roads-tfl.test.ts.
//
// A NOTICE IS NEVER A SPEED. An operator tells us that a street has works on it, or an
// incident, or that it is closed. It does not tell us how fast traffic moves there, and
// nothing in this shape can carry a speed. A measured speed is a different record from a
// different feed (none is wired yet), so the two can never be confused on screen.
//
// TWO TIMES, NAMED APART. A notice carries the operator's own last-change time. The
// route that serves it carries the time it last asked the operator (`fetchedAt`). They
// differ by minutes, and a reader who sees one age cannot tell which it is, so the words
// below always say which: "TfL's newest change 05:45 UTC" and "fetched 05:57 UTC".

/**
 * How a notice is drawn. The operator's own category stays in `category` for the words;
 * this only picks the paint: planned works, or anything else that is happening on the
 * road (a collision, a hazard, police activity, a signal fault).
 */
export type RoadKind = "works" | "incident";

/** One street a notice names, in the operator's words: the panel lists it as it came. */
export interface NamedStreet {
  name: string;
  /** True only where the operator marks this street "Closed". */
  closed: boolean;
  /** The operator's own words for the directions, e.g. "Westbound", "Both directions". */
  direction?: string;
}

/** One street a notice names, with the operator's own closure word for it. */
export interface RoadStreet {
  name?: string;
  /** The operator's own words for the directions the street's entry covers, trimmed. */
  direction?: string;
  /** True only where the operator marks this street "Closed". */
  closed: boolean;
  /** The operator's words, e.g. "Closed, southbound", where it is closed. */
  closure?: string;
  /** The street's segments, as [lon, lat] lines. Often empty. */
  lines: [number, number][][];
}

export interface RoadNotice {
  id: string;
  kind: RoadKind;
  /** The operator's category, e.g. "Works", "Hazards". */
  category: string;
  /** The operator's sub-category, e.g. "Utility works", where it gives one. */
  subCategory?: string;
  /** The operator's severity, e.g. "Minimal", "Moderate", "Serious". */
  severity: string;
  /** The operator's closure words for the first closed street, e.g. "Closed, southbound". */
  closure?: string;
  /** The operator's own location line. */
  location?: string;
  /** The street the map label names, where the operator names one apart from `location`. */
  street?: string;
  /** The operator's own description of the notice, where it gives one. */
  description?: string;
  /** The operator's start and end of the notice, ISO 8601, as it wrote them. */
  starts?: string;
  ends?: string;
  /** The operator's own status words, e.g. TfL's "Active", "Active Long Term". */
  status?: string;
  /** The operator's latest update, and when it wrote it (ISO 8601). */
  update?: string;
  updateAt?: string;
  /** TfL's level of interest: "Low", "Medium", "High". */
  interest?: string;
  /** Present (true) only where the operator marks the dates provisional. */
  provisional?: true;
  /** The streets the notice names, in the operator's words; often absent. */
  namedStreets?: NamedStreet[];
  /** Times within its dates when the works run, where the operator gives them. */
  schedule?: { from: string; to: string }[];
  /** The operator's representative point. */
  lat: number;
  lon: number;
  /**
   * The segments of the streets the notice names that the operator does NOT mark
   * "Closed", as [lon, lat] lines: each street's segments joined end to end (joinLines in
   * lib/roads/tfl.ts). With `closedLines`, every segment once. Often both are empty, and
   * the notice is drawn at its point.
   */
  openLines: [number, number][][];
  /** The segments of the streets the operator marks "Closed". */
  closedLines: [number, number][][];
  /** When the operator last changed it, as the operator wrote it (ISO 8601). */
  updated?: string;
  /**
   * The Provenance ids of the cameras the operator itself links to this notice, e.g.
   * "castlerock:fl:1696" (lib/roads/nearCamera.ts puts such a notice first on that
   * camera's card). Only Castle Rock gives them today.
   */
  cameras?: string[];
}

/** The operator's newest change among these notices, in epoch ms, or null if none says. */
export function newestChange(notices: readonly Pick<RoadNotice, "updated">[]): number | null {
  let best: number | null = null;
  for (const n of notices) {
    const t = n.updated ? Date.parse(n.updated) : NaN;
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "05:45 UTC", or "26 Oct 15:59 UTC" when it is not the same UTC day as `now`. UTC
 * because the God's eye view's clock is UTC and says so beside it.
 */
export function utcStamp(ms: number, now: number): string {
  const d = new Date(ms);
  const hhmm = d.toISOString().slice(11, 16);
  const sameDay = new Date(now).toISOString().slice(0, 10) === d.toISOString().slice(0, 10);
  return sameDay ? `${hhmm} UTC` : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hhmm} UTC`;
}

/** Past this, "fetched" also says how long ago: the route is serving an old answer. */
export const FETCH_AGE_SHOWN_MS = 5 * 60_000;

/** "fetched 05:57 UTC", or "fetched 05:57 UTC, 22 min ago" once it is old. */
export function fetchedText(fetchedAt: number, now: number): string {
  const age = now - fetchedAt;
  const base = `fetched ${utcStamp(fetchedAt, now)}`;
  return age >= FETCH_AGE_SHOWN_MS ? `${base}, ${Math.round(age / 60_000)} min ago` : base;
}

/** "TfL's newest change 05:45 UTC". */
export function changeText(operator: string, changedAt: number, now: number): string {
  return `${operator}'s newest change ${utcStamp(changedAt, now)}`;
}
