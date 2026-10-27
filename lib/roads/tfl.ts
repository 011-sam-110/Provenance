// TfL's road notices (the Unified API's /Road/all/Disruption), mapped to RoadNotice and
// nothing else. Pure, so tests/unit/roads-tfl.test.ts and tests/unit/eye-streets.test.ts
// hold it against real TfL answers. Keyless; TfL's transport data terms (based on the
// Open Government Licence v2) ask for the credit "Powered by TfL Open Data".
//
// CLOSED IS PER STREET, NOT PER NOTICE. A notice can name one stretch closed and the next
// open (measured 27 Oct 2026, 06:19 UTC: of 123 notices, 62 named streets, 29 Closed and
// 33 Open, and two notices mixed the two). TfL's own `hasClosures` flag was false on every
// notice that day, closed streets included, so the street's own `closure` word is what
// decides. The segments of a street TfL marks "Closed" go into `closedLines`, the rest into
// `openLines`, so each segment is sent once.

import type { RoadKind, RoadNotice, RoadStreet } from "@/lib/roads/notice";

/** TfL's Unified API, keyless. */
export const TFL_DISRUPTIONS_URL = "https://api.tfl.gov.uk/Road/all/Disruption";
export const TFL_CREDIT = "Powered by TfL Open Data";
/** How the words name TfL, e.g. "TfL's newest change 05:45 UTC". */
export const TFL_NAME = "TfL";

/**
 * TfL's "Works" is planned work. Every other category it uses (collisions, hazards,
 * emergency service incidents, asset issues such as a signal fault) is something
 * happening on the road, and is drawn as an incident. The words stay TfL's own.
 */
export function tflKind(category: string): RoadKind {
  return category.trim().toLowerCase() === "works" ? "works" : "incident";
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
  Array.isArray(p) &&
  p.length >= 2 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[1] as number) <= 90 &&
  Math.abs(p[0] as number) <= 180;

/** One of TfL's streets: its name, its own closure word, its segments. */
function tflStreet(street: Record<string, unknown>): RoadStreet {
  const closed = street?.closure === "Closed";
  const dir = typeof street?.directions === "string" ? street.directions.trim().toLowerCase() : "";
  const lines: [number, number][][] = [];
  for (const seg of Array.isArray(street?.segments) ? (street.segments as Record<string, unknown>[]) : []) {
    const coords = parseJson(seg?.lineString);
    if (Array.isArray(coords) && coords.length >= 2 && coords.every(isLonLat)) {
      lines.push((coords as [number, number][]).map(([x, y]) => [x, y]));
    }
  }
  return {
    ...(typeof street?.name === "string" && street.name ? { name: street.name } : {}),
    closed,
    ...(closed ? { closure: dir ? `Closed, ${dir}` : "Closed" } : {}),
    lines,
  };
}

/** Pure: TfL's answer to road notices. Rows it cannot place are dropped; it never throws. */
export function normalizeTflNotices(raw: unknown): RoadNotice[] {
  if (!Array.isArray(raw)) return [];
  const out: RoadNotice[] = [];
  for (const d of raw as Record<string, unknown>[]) {
    if (!d || typeof d !== "object" || typeof d.id !== "string") continue;
    const pt = parseJson(d.point);
    if (!isLonLat(pt)) continue;
    const streets = (Array.isArray(d.streets) ? (d.streets as Record<string, unknown>[]) : []).map(tflStreet);
    const openLines = streets.filter((s) => !s.closed).flatMap((s) => s.lines);
    const closedLines = streets.filter((s) => s.closed).flatMap((s) => s.lines);
    let closure = streets.find((s) => s.closed)?.closure;
    if (!closure && d.hasClosures === true) closure = "Closed";
    const category = typeof d.category === "string" && d.category ? d.category : "Disruption";
    out.push({
      id: d.id,
      kind: tflKind(category),
      category,
      ...(typeof d.subCategory === "string" && d.subCategory ? { subCategory: d.subCategory } : {}),
      severity: typeof d.severity === "string" && d.severity ? d.severity : "Unknown",
      ...(closure ? { closure } : {}),
      ...(typeof d.location === "string" && d.location ? { location: d.location.trim() } : {}),
      lat: pt[1],
      lon: pt[0],
      openLines,
      closedLines,
      ...(typeof d.lastModifiedTime === "string" ? { updated: d.lastModifiedTime } : {}),
    });
  }
  return out;
}
