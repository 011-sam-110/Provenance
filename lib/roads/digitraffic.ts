// Fintraffic's Digitraffic traffic messages (Finland's road works and traffic
// announcements), mapped to RoadNotice and nothing else. Pure, so
// tests/unit/roads-digitraffic.test.ts holds it against real messages.
//
// THE FEED. tie.digitraffic.fi/api/traffic-message/v1/messages, keyless, under CC BY 4.0
// (Fintraffic). It asks every client to name itself in a Digitraffic-User header.
//
// IT IS BIG. The road works answer was 5.9 MB with 106,444 points on 27 Oct 2026, so the
// server reads it every 10 minutes, not every minute, and sends on only what the layers
// draw: each line simplified to about 10 m and rounded to 5 decimals (about 1 m).
//
// THE WORDS. Fintraffic writes its messages in Finnish. Its codes are English: a road
// work's work types ("BURIED_CABLES") and restrictions ("ROAD_CLOSED"), a phase's
// severity ("HIGH"), an announcement's type ("ACCIDENT_REPORT"). The map's words come
// from those codes. The location and the title stay Fintraffic's own Finnish.
//
// CLOSED. A road work is closed where a phase restricts the road with ROAD_CLOSED, or
// SINGLE_CARRIAGEWAY_CLOSED (one carriageway of a two-carriageway road). An announcement
// has no restriction codes, so it is closed only where Fintraffic lists the feature
// "Tie on suljettu liikenteeltä" ("the road is closed to traffic").

import type { RoadNotice } from "@/lib/roads/notice";
import { codeWords } from "@/lib/roads/open511";
import { joinLines } from "@/lib/roads/tfl";
import { simplifyLine } from "@/lib/roads/lines";

export { SIMPLIFY_DEG, simplifyLine } from "@/lib/roads/lines";

export type DigitrafficSituation = "ROAD_WORK" | "TRAFFIC_ANNOUNCEMENT";
export const digitrafficUrl = (type: DigitrafficSituation) =>
  `https://tie.digitraffic.fi/api/traffic-message/v1/messages?inactiveHours=0&includeAreaGeometry=false&situationType=${type}`;
export const DIGITRAFFIC_CREDIT = "Contains data from Fintraffic / Digitraffic, licensed under CC BY 4.0";
export const DIGITRAFFIC_NAME = "Fintraffic";
export const DIGITRAFFIC_HOME = "https://liikennetilanne.fintraffic.fi/";
export const DIGITRAFFIC_USER = "Provenance/1.0 (+github.com/011-sam-110/Provenance)";

/** Fintraffic's own words for "the road is closed to traffic". */
export const ROAD_CLOSED_FI = "Tie on suljettu liikenteeltä";


const SEVERITY_ORDER = ["LOW", "HIGH", "HIGHEST"];

const isLonLat = (p: unknown): p is [number, number] =>
  Array.isArray(p) &&
  p.length >= 2 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[1] as number) <= 90 &&
  Math.abs(p[0] as number) <= 180;


/** The message's lines, joined end to end and simplified, and its anchor point. */
function placeOf(g: Record<string, unknown> | null | undefined): { lines: [number, number][][]; at: [number, number] } | null {
  if (!g || typeof g !== "object") return null;
  if (g.type === "Point" && isLonLat(g.coordinates)) return { lines: [], at: [g.coordinates[0], g.coordinates[1]] };
  const raw: unknown[] = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" && Array.isArray(g.coordinates) ? g.coordinates : [];
  const pieces = raw.filter((c): c is [number, number][] => Array.isArray(c) && c.length >= 2 && c.every(isLonLat));
  if (pieces.length === 0) return null;
  const lines = joinLines(pieces.map((c) => c.map(([x, y]) => [x, y] as [number, number]))).map((l) => simplifyLine(l));
  const first = pieces[0];
  return { lines, at: first[Math.floor(first.length / 2)] };
}

type Announcement = Record<string, unknown> & {
  language?: string;
  title?: string;
  location?: { description?: string };
  locationDetails?: { roadAddressLocation?: { primaryPoint?: { roadAddress?: { road?: number } } } };
  features?: { name?: string }[];
  roadWorkPhases?: { severity?: string; workTypes?: { type?: string }[]; restrictions?: { type?: string }[] }[];
};

/** Pure: one Digitraffic traffic-message answer to road notices. Rows it cannot place are dropped; it never throws. */
export function normalizeDigitraffic(raw: unknown): RoadNotice[] {
  const features = (raw as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: RoadNotice[] = [];
  for (const f of features as Record<string, unknown>[]) {
    const p = (f?.properties ?? null) as Record<string, unknown> | null;
    if (!p || typeof p.situationId !== "string") continue;
    const place = placeOf(f.geometry as Record<string, unknown> | null);
    if (!place) continue;
    const anns = (Array.isArray(p.announcements) ? p.announcements : []) as Announcement[];
    const ann = anns.find((a) => a?.language === "EN") ?? anns[0];
    if (!ann) continue;
    const isWork = p.situationType === "ROAD_WORK";
    const phases = Array.isArray(ann.roadWorkPhases) ? ann.roadWorkPhases : [];
    const restrictions = phases.flatMap((ph) => (Array.isArray(ph?.restrictions) ? ph.restrictions : [])).map((r) => r?.type);
    const workType = phases
      .flatMap((ph) => (Array.isArray(ph?.workTypes) ? ph.workTypes : []))
      .map((w) => w?.type)
      .find((t): t is string => typeof t === "string" && t !== "OTHER");
    const severity = phases
      .map((ph) => ph?.severity)
      .filter((s): s is string => typeof s === "string")
      .sort((a, b) => SEVERITY_ORDER.indexOf(b) - SEVERITY_ORDER.indexOf(a))[0];
    const names = (Array.isArray(ann.features) ? ann.features : []).map((x) => x?.name);
    const closure = restrictions.includes("ROAD_CLOSED") || names.includes(ROAD_CLOSED_FI)
      ? "Closed"
      : restrictions.includes("SINGLE_CARRIAGEWAY_CLOSED")
        ? "Closed, one carriageway"
        : undefined;
    const road = ann.locationDetails?.roadAddressLocation?.primaryPoint?.roadAddress?.road;
    const location = typeof ann.location?.description === "string" ? ann.location.description.split("\n")[0].trim() : "";
    const title = typeof ann.title === "string" ? ann.title.trim() : "";
    const subCategory = isWork
      ? workType && codeWords(workType)
      : typeof p.trafficAnnouncementType === "string" && p.trafficAnnouncementType
        ? codeWords(p.trafficAnnouncementType)
        : undefined;
    out.push({
      id: p.situationId,
      kind: isWork ? "works" : "incident",
      category: isWork ? "Road work" : "Traffic announcement",
      ...(subCategory ? { subCategory } : {}),
      severity: severity ? codeWords(severity) : "Not stated",
      ...(closure ? { closure } : {}),
      ...(location ? { location } : {}),
      ...(typeof road === "number" && road > 0 ? { street: `Road ${road}` } : {}),
      ...(title ? { description: title } : {}),
      lat: place.at[1],
      lon: place.at[0],
      openLines: closure ? [] : place.lines,
      closedLines: closure ? place.lines : [],
      ...(typeof p.versionTime === "string" ? { updated: p.versionTime } : {}),
    });
  }
  return out;
}
