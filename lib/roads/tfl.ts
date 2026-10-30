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
//
// A STREET'S SEGMENTS ARE JOINED INTO ONE LINE. TfL cuts a street into short pieces, out of
// order (on the A12 notice: 5 m to 989 m, 13 pieces), and MapLibre starts a dash pattern
// again at the start of every line. A street of short pieces then draws as one solid line,
// whatever its pattern, and a solid line is how a measured speed will look. Joining the
// pieces end to end (joinLines) keeps every point TfL sent and lets the pattern run.

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

/** Two points closer than this, in degrees, are one point: about 1 m in London. */
const JOIN_TOLERANCE_DEG = 1e-5;

const samePoint = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) <= JOIN_TOLERANCE_DEG && Math.abs(a[1] - b[1]) <= JOIN_TOLERANCE_DEG;

const sameLine = (a: [number, number][], b: [number, number][]) =>
  a.length === b.length && a.every((p, i) => samePoint(p, b[i]));

/**
 * Pure: joins line pieces that share an end into longer lines, in either direction, and
 * drops a piece that repeats another (forwards or backwards). Pieces that touch nothing
 * stay apart: a gap is never bridged. At a fork, two of the three pieces are joined and
 * the third stays its own line.
 */
export function joinLines(pieces: readonly [number, number][][]): [number, number][][] {
  const out: [number, number][][] = [];
  for (const piece of pieces) {
    if (piece.length < 2) continue;
    const reversed = [...piece].reverse();
    if (out.some((o) => sameLine(o, piece) || sameLine(o, reversed))) continue;
    out.push([...piece]);
  }
  let joined = true;
  while (joined) {
    joined = false;
    search: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        let line: [number, number][] | null = null;
        if (samePoint(a[a.length - 1], b[0])) line = [...a, ...b.slice(1)];
        else if (samePoint(b[b.length - 1], a[0])) line = [...b, ...a.slice(1)];
        else if (samePoint(a[a.length - 1], b[b.length - 1])) line = [...a, ...b.slice(0, -1).reverse()];
        else if (samePoint(a[0], b[0])) line = [...[...a].reverse(), ...b.slice(1)];
        if (line) {
          out[i] = line;
          out.splice(j, 1);
          joined = true;
          break search;
        }
      }
    }
  }
  return out;
}

/** A string TfL typed, trimmed, with line breaks and runs of spaces made one space; "" if none. */
const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** One of TfL's streets: its name, its own closure word, its segments joined into lines. */
function tflStreet(street: Record<string, unknown>): RoadStreet {
  const closed = street?.closure === "Closed";
  const directions = typeof street?.directions === "string" ? street.directions.trim() : "";
  const dir = directions.toLowerCase();
  const lines: [number, number][][] = [];
  for (const seg of Array.isArray(street?.segments) ? (street.segments as Record<string, unknown>[]) : []) {
    const coords = parseJson(seg?.lineString);
    if (Array.isArray(coords) && coords.length >= 2 && coords.every(isLonLat)) {
      lines.push((coords as [number, number][]).map(([x, y]) => [x, y]));
    }
  }
  return {
    ...(typeof street?.name === "string" && street.name.trim() ? { name: street.name.trim() } : {}),
    ...(directions ? { direction: directions } : {}),
    closed,
    ...(closed ? { closure: dir ? `Closed, ${dir}` : "Closed" } : {}),
    lines: joinLines(lines),
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
    const description = clean(d.comments);
    const update = clean(d.currentUpdate);
    const namedStreets = streets
      .filter((s) => s.name)
      .map((s) => ({ name: s.name!, closed: s.closed, ...(s.direction ? { direction: s.direction } : {}) }));
    const schedule = (Array.isArray(d.recurringSchedules) ? (d.recurringSchedules as Record<string, unknown>[]) : []).flatMap((r) =>
      typeof r?.startTime === "string" && r.startTime && typeof r?.endTime === "string" && r.endTime
        ? [{ from: r.startTime, to: r.endTime }]
        : [],
    );
    out.push({
      id: d.id,
      kind: tflKind(category),
      category,
      ...(typeof d.subCategory === "string" && d.subCategory ? { subCategory: d.subCategory } : {}),
      severity: typeof d.severity === "string" && d.severity ? d.severity : "Unknown",
      ...(closure ? { closure } : {}),
      ...(typeof d.location === "string" && d.location ? { location: d.location.trim() } : {}),
      ...(description ? { description } : {}),
      lat: pt[1],
      lon: pt[0],
      openLines,
      closedLines,
      ...(typeof d.lastModifiedTime === "string" ? { updated: d.lastModifiedTime } : {}),
      ...(isText(d.startDateTime) ? { starts: d.startDateTime } : {}),
      ...(isText(d.endDateTime) ? { ends: d.endDateTime } : {}),
      ...(isText(d.status) ? { status: d.status.trim() } : {}),
      ...(update ? { update } : {}),
      ...(isText(d.currentUpdateDateTime) ? { updateAt: d.currentUpdateDateTime } : {}),
      ...(isText(d.levelOfInterest) ? { interest: d.levelOfInterest.trim() } : {}),
      ...(d.isProvisional === true ? { provisional: true as const } : {}),
      ...(namedStreets.length > 0 ? { namedStreets } : {}),
      ...(schedule.length > 0 ? { schedule } : {}),
    });
  }
  return out;
}
