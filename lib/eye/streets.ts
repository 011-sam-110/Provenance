// London's streets in the God's eye view: what TfL says about them, and nothing it
// does not. Pure, so tests/unit/eye-streets.test.ts holds the mapping against a real
// TfL answer.
//
// THERE IS NO SPEED HERE, AND THAT IS MEASURED, NOT MISSED. No keyless live road-speed
// feed exists for London, New York, San Francisco or Los Angeles (checked 24 Oct
// 2026); TfL publishes corridor status by bounding box only. What TfL does publish
// keyless is its road disruptions: each one's category, severity, its own words and,
// for some, the street segments it covers. The view draws those on the street with
// TfL's words, and says in its ledger that there is no open speed feed. A disruption
// line is a notice on a street, never a measured speed.

import { ofNearby, type LedgerRow } from "@/lib/eye/wording";

/** TfL's Unified API, keyless. Open Government Licence: "Powered by TfL Open Data". */
export const TFL_DISRUPTIONS_URL = "https://api.tfl.gov.uk/Road/all/Disruption";
export const TFL_CREDIT = "Powered by TfL Open Data";
/** How often the server asks TfL again, and the cadence the ledger states. */
export const STREETS_EVERY_MS = 120_000;

/** One TfL disruption, reduced to what the view draws. */
export interface StreetDisruption {
  id: string;
  /** TfL's category, e.g. "Works", "Collisions". */
  category: string;
  /** TfL's sub-category, e.g. "Utility works", where it gives one. */
  subCategory?: string;
  /** TfL's severity, e.g. "Minimal", "Moderate", "Serious". */
  severity: string;
  /**
   * TfL's own closure words for the first closed street, e.g. "Closed, southbound".
   * Read per street: on 24 Oct 2026, 24 of TfL's 120 rows named a street "Closed",
   * and TfL's own `hasClosures` flag was false on all 120.
   */
  closure?: string;
  /** TfL's own location line. */
  location?: string;
  /** TfL's representative point. */
  lat: number;
  lon: number;
  /** The street segments TfL names, as [lon, lat] lines. Often empty. */
  lines: [number, number][][];
  /** When TfL last changed it. */
  updated?: string;
}

/** Greater London, roughly: the area TfL's road network covers. */
export const LONDON_BOUNDS = { west: -0.56, south: 51.27, east: 0.34, north: 51.7 } as const;

export function inLondon(lat: number, lon: number): boolean {
  const b = LONDON_BOUNDS;
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

function parseJson(s: unknown): unknown {
  if (typeof s !== "string") return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const isLonLat = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1] as number) <= 90 && Math.abs(p[0] as number) <= 180;

/** Pure: TfL's answer to the view's disruptions. Rows it cannot place are dropped. */
export function normalizeTflDisruptions(raw: unknown): StreetDisruption[] {
  if (!Array.isArray(raw)) return [];
  const out: StreetDisruption[] = [];
  for (const d of raw as Record<string, unknown>[]) {
    if (!d || typeof d !== "object" || typeof d.id !== "string") continue;
    const pt = parseJson(d.point);
    if (!isLonLat(pt)) continue;
    const lines: [number, number][][] = [];
    let closure: string | undefined;
    for (const street of Array.isArray(d.streets) ? (d.streets as Record<string, unknown>[]) : []) {
      if (!closure && street?.closure === "Closed") {
        const dir = typeof street.directions === "string" ? street.directions.trim().toLowerCase() : "";
        closure = dir ? `Closed, ${dir}` : "Closed";
      }
      for (const seg of Array.isArray(street?.segments) ? (street.segments as Record<string, unknown>[]) : []) {
        const coords = parseJson(seg?.lineString);
        if (Array.isArray(coords) && coords.length >= 2 && coords.every(isLonLat)) {
          lines.push((coords as [number, number][]).map(([x, y]) => [x, y]));
        }
      }
    }
    if (!closure && d.hasClosures === true) closure = "Closed";
    out.push({
      id: d.id,
      category: typeof d.category === "string" && d.category ? d.category : "Disruption",
      ...(typeof d.subCategory === "string" && d.subCategory ? { subCategory: d.subCategory } : {}),
      severity: typeof d.severity === "string" && d.severity ? d.severity : "Unknown",
      ...(closure ? { closure } : {}),
      ...(typeof d.location === "string" && d.location ? { location: d.location.trim() } : {}),
      lat: pt[1],
      lon: pt[0],
      lines,
      ...(typeof d.lastModifiedTime === "string" ? { updated: d.lastModifiedTime } : {}),
    });
  }
  return out;
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
 * severity. TfL also lists works it marks "No impact": drawn, but thinnest and last.
 */
export function severityWeight(severity: string): number {
  const s = severity.toLowerCase();
  if (s === "serious" || s === "severe") return 3;
  if (s === "moderate") return 2;
  if (s === "no impact") return 0.5;
  return 1;
}

/** "Utility works" / "Serious · Closed, southbound". TfL's words, never a speed. */
export function streetTag(d: StreetDisruption): { title: string; meta: string } {
  const meta = [d.severity, d.closure].filter(Boolean).join(" · ");
  return { title: d.subCategory ?? d.category, meta };
}

/** The road row: disruptions tagged on screen, of how many nearby, and whose words. */
export function streetsLedgerRow(n: number, nearby: number): LedgerRow {
  return {
    kind: "road",
    count: n,
    label: n === 1 ? "road disruption" : "road disruptions",
    detail: [...ofNearby(n, nearby), `${TFL_CREDIT}, every ${Math.round(STREETS_EVERY_MS / 60_000)} min`].join(" · "),
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

/** The same statement, for the phone's bottom band. */
export function speedPhoneNote(london: boolean): string {
  return london ? "No open road-speed feed for London" : "Road speed is not measured in this view";
}
