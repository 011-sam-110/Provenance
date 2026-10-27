// Open511 road events (the open standard British Columbia's DriveBC publishes), mapped to
// RoadNotice and nothing else. Pure, so tests/unit/roads-open511.test.ts holds it against
// real DriveBC events.
//
// DriveBC's Open511 API is keyless. Its use is governed by the Open Government Licence -
// British Columbia (OGL-BC 2.0, the API's own jurisdiction record names it), whose credit
// is "Contains information licensed under the Open Government Licence - British Columbia".
//
// CLOSED IS PER ROAD, AS WITH TfL. An event names its roads, each with its own state
// (ALL_LANES_OPEN, SOME_LANES_CLOSED, CLOSED; measured 27 Oct 2026: 272 open and 18
// closed among 290 events). An event's line is closed only where a road it names is
// CLOSED. Open511 gives one line per event, not per road, so a closed event's whole line
// is closed.
//
// THE OPERATOR'S WORDS. Category, sub-category and severity are the operator's codes,
// spelled as words ("ROAD_MAINTENANCE" reads "Road maintenance"). The location is the
// first sentence of the operator's own description.

import type { RoadKind, RoadNotice } from "@/lib/roads/notice";

/** DriveBC's Open511 events, active only. 500 is the API's own page limit. */
export const DRIVEBC_EVENTS_URL = "https://api.open511.gov.bc.ca/events?format=json&status=ACTIVE&limit=500";
export const DRIVEBC_CREDIT = "Contains information licensed under the Open Government Licence - British Columbia";
export const DRIVEBC_NAME = "DriveBC";
export const DRIVEBC_HOME = "https://www.drivebc.ca/";

/** "ROAD_MAINTENANCE" -> "Road maintenance". */
export function codeWords(code: string): string {
  const w = code.trim().toLowerCase().replace(/_+/g, " ");
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Open511's CONSTRUCTION is planned work; every other event type is drawn as an incident. */
export function open511Kind(eventType: string): RoadKind {
  return eventType.trim().toUpperCase() === "CONSTRUCTION" ? "works" : "incident";
}

const DIRECTION: Record<string, string> = {
  N: "northbound",
  S: "southbound",
  E: "eastbound",
  W: "westbound",
  BOTH: "both directions",
};

const isLonLat = (p: unknown): p is [number, number] =>
  Array.isArray(p) &&
  p.length >= 2 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[1] as number) <= 90 &&
  Math.abs(p[0] as number) <= 180;

const lineOf = (c: unknown): [number, number][] | null =>
  Array.isArray(c) && c.length >= 2 && c.every(isLonLat) ? (c as [number, number][]).map(([x, y]) => [x, y]) : null;

/** The event's lines and its anchor point (the middle vertex of its first line). */
function placeOf(g: Record<string, unknown> | undefined): { lines: [number, number][][]; at: [number, number] } | null {
  if (!g || typeof g !== "object") return null;
  if (g.type === "Point" && isLonLat(g.coordinates)) return { lines: [], at: [g.coordinates[0], g.coordinates[1]] };
  const lines: [number, number][][] = [];
  if (g.type === "LineString") {
    const l = lineOf(g.coordinates);
    if (l) lines.push(l);
  } else if (g.type === "MultiLineString" && Array.isArray(g.coordinates)) {
    for (const c of g.coordinates) {
      const l = lineOf(c);
      if (l) lines.push(l);
    }
  }
  if (lines.length === 0) return null;
  const first = lines[0];
  return { lines, at: first[Math.floor(first.length / 2)] };
}

/** The first sentence of the operator's description: "Washout at Silver Skagit Road, In Hope." */
function firstSentence(text: string): string {
  const i = text.search(/\.(\s|$)/);
  return (i >= 0 ? text.slice(0, i + 1) : text).trim();
}

/** Pure: an Open511 events answer to road notices. Rows it cannot place are dropped; it never throws. */
export function normalizeOpen511(raw: unknown): RoadNotice[] {
  const events = (raw as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  const out: RoadNotice[] = [];
  for (const e of events as Record<string, unknown>[]) {
    if (!e || typeof e !== "object" || typeof e.id !== "string") continue;
    if (typeof e.status === "string" && e.status !== "ACTIVE") continue;
    const place = placeOf(e.geography as Record<string, unknown> | undefined);
    if (!place) continue;
    const roads = (Array.isArray(e.roads) ? e.roads : []) as Record<string, unknown>[];
    const closedRoad = roads.find((r) => r?.state === "CLOSED");
    const dir = typeof closedRoad?.direction === "string" ? DIRECTION[closedRoad.direction.toUpperCase()] : undefined;
    const closure = closedRoad ? (dir ? `Closed, ${dir}` : "Closed") : undefined;
    const road = closedRoad ?? roads[0];
    // DriveBC files a side road under the name "Other Roads" and names it in `from`.
    const street =
      typeof road?.name === "string" && road.name && road.name !== "Other Roads"
        ? road.name
        : typeof road?.from === "string" && road.from
          ? road.from
          : undefined;
    const eventType = typeof e.event_type === "string" && e.event_type ? e.event_type : "INCIDENT";
    const subtype = Array.isArray(e.event_subtypes) && typeof e.event_subtypes[0] === "string" ? e.event_subtypes[0] : undefined;
    const description = typeof e.description === "string" ? e.description.trim() : "";
    out.push({
      id: e.id,
      kind: open511Kind(eventType),
      category: codeWords(eventType),
      ...(subtype ? { subCategory: codeWords(subtype) } : {}),
      severity: typeof e.severity === "string" && e.severity ? codeWords(e.severity) : "Unknown",
      ...(closure ? { closure } : {}),
      ...(description ? { location: firstSentence(description), description } : {}),
      ...(street ? { street } : {}),
      lat: place.at[1],
      lon: place.at[0],
      openLines: closure ? [] : place.lines,
      closedLines: closure ? place.lines : [],
      ...(typeof e.updated === "string" ? { updated: e.updated } : {}),
    });
  }
  return out;
}
