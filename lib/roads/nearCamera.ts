// The camera's road: what the road operators say about the road a camera looks at.
// Pure and client-safe (it imports only lib/roads/notice.ts), so the camera detail, the
// camera wall and the God's eye cards all say it in the same words, and
// tests/unit/roads-near-camera.test.ts holds it against real notices.
//
// THE PICK, IN THIS ORDER.
//   1. A notice the operator itself links to this camera (Castle Rock names the cameras
//      that see an event, `RoadNotice.cameras`), however far its point is.
//   2. Else the nearest notice whose road, or whose point when it gives no road, is
//      within 250 m of the camera.
//   3. Else "No road notice within 250 m", and how far the nearest one is when it is
//      within 2 km. Past that, a distance says nothing about this road.
// A camera that no operator's area holds gets no road line at all. A notice is never a
// speed, so nothing here says how traffic moves.
//
// DISTANCE. Metres on a flat plane centred on the camera (an equirectangular
// projection), which is good to well under a metre at these distances.

import { utcStamp, type RoadKind, type RoadNotice } from "@/lib/roads/notice";

export const CAMERA_ROAD_RADIUS_M = 250;
/** Past this, "nearest" is not said. */
export const NEAREST_SHOWN_M = 2000;

const R = 6_371_008.8;
const RAD = Math.PI / 180;

export interface CameraAt {
  id: string;
  lat: number;
  lon: number;
}

/** One notice as a camera's road line shows it. */
export interface CameraRoadNotice {
  /** The map's label for it: "Utility works, [A12] EASTERN AVENUE EAST". */
  title: string;
  kind: RoadKind;
  /** The operator's severity; "Not stated" where it gives none. */
  severity: string;
  /** The operator's closure words, only when the closed road is the one by the camera. */
  closure?: string;
  /** Metres from the camera to the notice's road, or to its point when it gives no road. */
  distanceM: number;
  /** True when the operator itself links this camera to the notice. */
  linked: boolean;
  /** The operator's name, e.g. "TfL". */
  operator: string;
  /** The operator's own last change, ISO 8601. */
  updated?: string;
}

export type CameraRoad =
  | {
      state: "notice";
      notice: CameraRoadNotice;
      /** Other notices within 250 m, or linked to this camera. */
      others: number;
      operators: string[];
      credits: string[];
      readAt: number;
    }
  | { state: "none"; nearestM?: number; operators: string[]; credits: string[]; readAt: number }
  /** Operators cover this place, and none of them answered. */
  | { state: "unread"; operators: string[] }
  /** No operator whose notices are read covers this place. */
  | { state: "uncovered" };

/** One operator's notices, as the route hands them over. */
export interface OperatorRead {
  operator: string;
  credit: string;
  notices: readonly RoadNotice[];
  readAt: number;
}

/** Pure: metres from the origin (0, 0) to the segment a-b on the plane. */
function segmentM(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Pure: metres from the camera to the nearest point of these [lon, lat] lines; Infinity for none. */
export function linesDistanceM(cam: Pick<CameraAt, "lat" | "lon">, lines: readonly (readonly [number, number])[][]): number {
  const kx = R * RAD * Math.cos(cam.lat * RAD);
  const ky = R * RAD;
  let best = Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const ax = (line[i][0] - cam.lon) * kx;
      const ay = (line[i][1] - cam.lat) * ky;
      if (line.length === 1) {
        best = Math.min(best, Math.hypot(ax, ay));
        break;
      }
      if (i === line.length - 1) break;
      best = Math.min(best, segmentM(ax, ay, (line[i + 1][0] - cam.lon) * kx, (line[i + 1][1] - cam.lat) * ky));
    }
  }
  return best;
}

/** Pure: metres from the camera to the notice's roads, or to its point when it gives none. */
export function noticeDistanceM(cam: Pick<CameraAt, "lat" | "lon">, n: Pick<RoadNotice, "lat" | "lon" | "openLines" | "closedLines">): {
  distanceM: number;
  closedM: number;
} {
  const open = linesDistanceM(cam, n.openLines);
  const closed = linesDistanceM(cam, n.closedLines);
  if (open === Infinity && closed === Infinity) {
    const point = linesDistanceM(cam, [[[n.lon, n.lat]]]);
    return { distanceM: point, closedM: point };
  }
  return { distanceM: Math.min(open, closed), closedM: closed };
}

/**
 * Pure: the camera's road from the notices of the operators that cover it. `covered`
 * names those operators, including any that did not answer; `title` is the map's label
 * for a notice (roadTitle in lib/signals/roads.ts).
 */
export function pickCameraRoad(
  cam: CameraAt,
  covered: readonly string[],
  reads: readonly OperatorRead[],
  title: (n: RoadNotice) => string,
): CameraRoad {
  if (covered.length === 0) return { state: "uncovered" };
  if (reads.length === 0) return { state: "unread", operators: [...covered] };
  const operators = reads.map((r) => r.operator);
  const credits = [...new Set(reads.map((r) => r.credit))];
  const readAt = Math.min(...reads.map((r) => r.readAt));
  const near: CameraRoadNotice[] = [];
  let nearest = Infinity;
  for (const r of reads) {
    for (const n of r.notices) {
      const { distanceM, closedM } = noticeDistanceM(cam, n);
      nearest = Math.min(nearest, distanceM);
      const linked = n.cameras?.includes(cam.id) ?? false;
      if (!linked && distanceM > CAMERA_ROAD_RADIUS_M) continue;
      near.push({
        title: title(n),
        kind: n.kind,
        severity: n.severity,
        ...(n.closure && closedM <= Math.max(CAMERA_ROAD_RADIUS_M, distanceM) ? { closure: n.closure } : {}),
        distanceM: Math.round(distanceM),
        linked,
        operator: r.operator,
        ...(n.updated ? { updated: n.updated } : {}),
      });
    }
  }
  if (near.length === 0) {
    return {
      state: "none",
      ...(nearest <= NEAREST_SHOWN_M ? { nearestM: Math.round(nearest) } : {}),
      operators,
      credits,
      readAt,
    };
  }
  near.sort((a, b) => Number(b.linked) - Number(a.linked) || a.distanceM - b.distanceM);
  return { state: "notice", notice: near[0], others: near.length - 1, operators, credits, readAt };
}

/** "under 10 m", "70 m", "1.2 km". */
export function distanceWords(m: number): string {
  if (m < 10) return "under 10 m";
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** The words of a camera's road line. Null when there is nothing to say (no operator here). */
export interface CameraRoadWords {
  /** "closed" draws the closure mark, "notice" the notice mark, "none" an empty ring. */
  tone: "closed" | "notice" | "none";
  /** The first line: the notice's label, or "No TfL notice within 250 m". */
  head: string;
  /** The second line: how near, or how the operator links it, and its state. */
  detail: string;
  /** The operator and its own time: "TfL 02:39 UTC". Empty when there is no notice. */
  when: string;
  /** "2 more within 250 m", or empty. */
  more: string;
}

const join = (parts: (string | undefined | false)[]) => parts.filter(Boolean).join(" · ");

/** Pure: a camera's road in words. Null for a camera no operator covers. */
export function cameraRoadWords(road: CameraRoad, now: number): CameraRoadWords | null {
  if (road.state === "uncovered") return null;
  if (road.state === "unread") {
    return {
      tone: "none",
      head: `${road.operators.join(" and ")} did not answer`,
      detail: "No road notices for this camera just now",
      when: "",
      more: "",
    };
  }
  if (road.state === "none") {
    const who = road.operators.length === 1 ? `${road.operators[0]} notice` : "road notice";
    return {
      tone: "none",
      head: `No ${who} within ${CAMERA_ROAD_RADIUS_M} m`,
      detail: road.nearestM != null ? `nearest ${distanceWords(road.nearestM)}` : `none within ${distanceWords(NEAREST_SHOWN_M)}`,
      when: "",
      more: "",
    };
  }
  const n = road.notice;
  const t = n.updated ? Date.parse(n.updated) : NaN;
  return {
    tone: n.closure ? "closed" : "notice",
    head: n.title,
    detail: join([
      n.closure,
      n.severity !== "Not stated" && n.severity,
      n.linked ? `${n.operator} links this camera to it` : `${distanceWords(n.distanceM)} from this camera`,
    ]),
    when: Number.isFinite(t) ? `${n.operator} ${utcStamp(t, now)}` : n.operator,
    more: road.others > 0 ? `${road.others} more within ${CAMERA_ROAD_RADIUS_M} m` : "",
  };
}

/**
 * Pure: the one line a camera wall tile has room for. `text` is the notice's label or the
 * "no notice" line, `aside` how near it is, and `title` every word of cameraRoadWords
 * for the tooltip. Null for a camera no operator covers.
 */
export function cameraRoadTileWords(
  road: CameraRoad,
  now: number,
): { tone: CameraRoadWords["tone"]; text: string; aside: string; title: string } | null {
  const w = cameraRoadWords(road, now);
  if (!w) return null;
  const n = road.state === "notice" ? road.notice : null;
  return {
    tone: w.tone,
    text: w.head,
    aside: n ? (n.linked ? "linked" : distanceWords(n.distanceM)) : "",
    title: [w.head, w.detail, w.when, w.more].filter(Boolean).join(". "),
  };
}

/** The `c` parameter of /api/camera-road for one camera: "lat,lon,id". */
export function cameraRoadParam(cam: CameraAt): string {
  return `${cam.lat.toFixed(5)},${cam.lon.toFixed(5)},${cam.id}`;
}

/** Pure: one `c` parameter back to a camera; null when it is not one. */
export function parseCameraRoadParam(v: string): CameraAt | null {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(.{1,120})$/.exec(v);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lat, lon, id: m[3] };
}

/** At most this many cameras per request. */
export const CAMERA_ROAD_MAX = 40;
