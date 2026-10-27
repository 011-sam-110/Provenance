// London's streets in the God's eye view: what TfL says about them, and nothing it
// does not. Pure, so tests/unit/eye-streets.test.ts holds the mapping against a real
// TfL answer. The mapping itself lives in lib/roads/tfl.ts, in the road-notice shape
// (lib/roads/notice.ts) that the console's road layer reads too.
//
// THERE IS NO SPEED HERE, AND THAT IS MEASURED, NOT MISSED. No keyless live road-speed
// feed exists for London, New York, San Francisco or Los Angeles (checked 24 Oct
// 2026); TfL publishes corridor status by bounding box only. What TfL does publish
// keyless is its road disruptions: each one's category, severity, its own words and,
// for some, the street segments it covers. The view draws those on the street with
// TfL's words, and says in its ledger that there is no open speed feed. A disruption
// line is a notice on a street, never a measured speed.
//
// EVERY TIME SAYS WHOSE IT IS. The ledger states TfL's newest change among the notices
// around the view, and the time this server last asked TfL. TfL's own edge cache holds
// its answer up to 5 min and this route holds it 2 min more, so "every 2 min" alone
// told a reader nothing about how old the notices were.

import { ofNearby, type LedgerRow } from "@/lib/eye/wording";
import { changeText, fetchedText, type RoadKind, type RoadNotice } from "@/lib/roads/notice";
import { TFL_CREDIT, TFL_NAME, normalizeTflNotices } from "@/lib/roads/tfl";

export { TFL_CREDIT, TFL_DISRUPTIONS_URL } from "@/lib/roads/tfl";

/** How often the server asks TfL again. */
export const STREETS_EVERY_MS = 120_000;

/** One TfL disruption, as the view reads it: the shared road-notice shape. */
export type StreetDisruption = RoadNotice;

/** TfL's answer to the view's disruptions (lib/roads/tfl.ts). */
export const normalizeTflDisruptions = normalizeTflNotices;

/** Greater London, roughly: the area TfL's road network covers. */
export const LONDON_BOUNDS = { west: -0.56, south: 51.27, east: 0.34, north: 51.7 } as const;

export function inLondon(lat: number, lon: number): boolean {
  const b = LONDON_BOUNDS;
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

/**
 * The route's answer. `fetchedAt` is absolute, so a body served from a cache still
 * tells its reader how old it is (lib/http/originCache.ts states the rule).
 */
export function streetsBody(features: StreetDisruption[], fetchedAt: number): string {
  return JSON.stringify({ ok: true, credit: TFL_CREDIT, fetchedAt, count: features.length, features });
}

/**
 * How heavily a disruption is drawn, and how early it gets a tag, by TfL's own
 * severity. TfL also lists works it marks "No impact": drawn, but faintest and last.
 */
export function severityWeight(severity: string): number {
  const s = severity.toLowerCase();
  if (s === "serious" || s === "severe") return 3;
  if (s === "moderate") return 2;
  if (s === "no impact") return 0.5;
  return 1;
}

/**
 * How a piece of a notice is painted. "closed" is only a street TfL marks Closed (rose
 * and white bars); the notice's other streets keep its kind: "works" (rose dashes) or
 * "incident" (violet dots). A notice with no segments is a ring at TfL's point, in its
 * kind's colour, or "closed" when TfL closes a street it gave no line for.
 */
export type StreetPaint = "closed" | RoadKind;

/** The paint layers' features: one per segment, or one point per notice with no segment. */
export function streetFeatures(list: readonly StreetDisruption[]): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];
  for (const d of list) {
    // Severity is drawn as opacity, never as width: MapLibre draws a dashed line solid
    // when its width reads a feature property, and a solid line reads as a measurement.
    const heavy = severityWeight(d.severity) >= 2;
    const props = (paint: StreetPaint) => ({ id: d.id, paint, heavy });
    if (d.openLines.length === 0 && d.closedLines.length === 0) {
      features.push({
        type: "Feature",
        properties: props(d.closure ? "closed" : d.kind),
        geometry: { type: "Point", coordinates: [d.lon, d.lat] },
      });
      continue;
    }
    for (const line of d.openLines) {
      features.push({ type: "Feature", properties: props(d.kind), geometry: { type: "LineString", coordinates: line } });
    }
    for (const line of d.closedLines) {
      features.push({ type: "Feature", properties: props("closed"), geometry: { type: "LineString", coordinates: line } });
    }
  }
  return features;
}

/** "Utility works" / "Serious · Closed, southbound". TfL's words, never a speed. */
export function streetTag(d: StreetDisruption): { title: string; meta: string } {
  const meta = [d.severity, d.closure].filter(Boolean).join(" · ");
  return { title: d.subCategory ?? d.category, meta };
}

/** The two times the road words state, in epoch ms; either may be unknown. */
export interface StreetTimes {
  /** TfL's newest change among the notices around the view. */
  changedAt: number | null;
  /** When this server last asked TfL (the route's `fetchedAt`). */
  fetchedAt: number | null;
  now: number;
}

/** "TfL's newest change 05:45 UTC · fetched 05:57 UTC", or the parts that are known. */
export function streetTimesText(t: StreetTimes): string {
  const parts: string[] = [];
  if (t.changedAt != null) parts.push(changeText(TFL_NAME, t.changedAt, t.now));
  if (t.fetchedAt != null) parts.push(fetchedText(t.fetchedAt, t.now));
  return parts.join(" · ");
}

/**
 * The road row: disruptions tagged on screen, of how many nearby, TfL's newest change
 * and when this server asked, and whose words they are.
 */
export function streetsLedgerRow(n: number, nearby: number, times?: StreetTimes): LedgerRow {
  const when = times ? streetTimesText(times) : "";
  return {
    kind: "road",
    count: n,
    label: n === 1 ? "road disruption" : "road disruptions",
    detail: [...ofNearby(n, nearby), ...(when ? [when] : []), TFL_CREDIT].join(" · "),
    short: n === 1 ? "disruption" : "disruptions",
  };
}

/**
 * The road row when TfL has not answered this server since it started: no count,
 * because "0 road disruptions" would say TfL reported none. The route keeps serving
 * its last good answer through later failures, so this shows only on a cold start.
 */
export function streetsDownRow(): LedgerRow {
  return { kind: "road", count: null, label: "Road disruptions", detail: "TfL's feed is not answering", short: "" };
}

/** The ledger's statement of what is not here: no measured speed. */
export function speedLedgerRow(london: boolean): LedgerRow {
  return {
    kind: "speed",
    count: null,
    label: "Road speed",
    detail: london ? "no open speed feed for London" : "not measured in this view",
    short: "",
  };
}

/** The same statement, for the phone's bottom band, with the road notices' times in London. */
export function speedPhoneNote(london: boolean, times?: StreetTimes): string {
  if (!london) return "Road speed is not measured in this view";
  const when = times ? streetTimesText(times) : "";
  return when ? `No open road-speed feed for London · TfL notices: ${when.replace(/^TfL's /, "")}` : "No open road-speed feed for London";
}
