// One plane's thinned line, and the rules for growing it. Pure and unit-tested. The server's
// store (lib/planes/trackStore.ts) and the tab's Full flight trail history
// (lib/planes/fullHistory.ts) both grow their lines with this file, so the two agree on what
// a line is and can be joined without a visible jump.
//
// WHAT A LINE CAN CLAIM. Every point is a position a receiver heard, on our pull, which moves
// about every 2 minutes. A line runs from when WE first heard the plane, never from its take-off:
// the free networks answer
// a server with no history (adsb.lol and adsb.fi's /data/traces/ refuse it, adsb.lol's API has
// no history path), and a receiver hears a plane only inside its range. So the words on screen
// are "from when we first heard it", and a stretch nobody heard stays a gap in the line.
//
// THINNING. A cruise is a long straight line, so a new position on the same heading moves the
// end of the line instead of adding a point. "Same heading" is measured from the start of the
// current straight, against the bearing that straight began with, so a slow curve cannot creep
// away from the line by small steps: once the end is 2.5 degrees off, the curve gets a point.
// The end of the line is always the newest position, which is what lets it meet the plane. On 54
// minutes of real tracks a dropped position sat within 5.5 km of the line that replaced it at the
// 99th percentile, against 2.7 km with straights half as long, for about 15% fewer points.
//
// A NEW FLIGHT is one rule, and no ground flag. A plane that has not moved 1 km for 20 minutes
// has stopped, and when it next appears it has started a new flight, unless the distance it
// covered in that time means it was flying (150 km/h or more, which covers a crossing outside
// receiver range). Why not the ground flag: a receiver often loses a plane near the ground, so a
// landing is usually silence and not a flag, and the one test covers a stop that was heard and a
// stop that was not. Why 20 minutes: a short turnaround is longer than that,
// and a touch-and-go keeps moving, so a circuit stays one line. Why 150 km/h: slower than an
// airliner can fly, and a wrong answer costs little either way, because no line is ever drawn
// across the gap. The old flight goes, because the line reads "from when we first heard it"
// and a line through a stop would read as one journey.
//
// A LONG GAP is 10 minutes of silence, about 150 km at cruise and five pulls, so a missed pull
// or two is not one. A gap is a BREAK: the point after it starts a new part, and nothing joins the
// two. So does a jump no aircraft on the listed types can fly (1,500 km/h), which is a bad
// position, not a plane.

export interface TrackPoint {
  lat: number;
  lon: number;
  altKm: number;
  /** Epoch ms the network last had this position. */
  t: number;
}

export interface TrackLine {
  /**
   * [lat, lon, altKm, t, lat, lon, ...]. Flat, because an array of plain numbers is held
   * unboxed at 8 bytes a value, where an object per point costs about 100 bytes, and the
   * server holds hundreds of thousands of these.
   */
  data: number[];
  /** Point indexes, ascending, where a new part starts because nobody heard the plane. */
  breaks: number[];
  /** The bearing the current straight began with. NaN while the end of the line starts a part. */
  bearing: number;
  /** When this flight was first heard. */
  firstHeardAt: number;
  /** When any position was last heard, moved or not. */
  lastHeardAt: number;
  /** True once a cap or the age limit has dropped this line's oldest points. */
  trimmed: boolean;
}

/** One line, as GET /api/planes/track sends it. */
export interface StoredTrack {
  id: string;
  /** Null when we hold no line for this plane. */
  firstHeardAt: number | null;
  lastHeardAt: number | null;
  trimmed: boolean;
  /** [lat, lon, altKm, t] */
  points: [number, number, number, number][];
  breaks: number[];
}

const STRIDE = 4;
const EARTH_R_KM = 6371;

/** Closer than this to the end of the line and the position adds nothing: a parked or taxiing plane. */
export const MIN_STEP_KM = 1;
/** Within this of the straight's first bearing, a position only moves the end of the line. */
export const SAME_HEADING_DEG = 2.5;
/** A straight longer than this gets a point anyway, so a long line stays close to the path flown. */
export const MAX_SEGMENT_KM = 300;
/** Silence of at least this long is a gap, and the line breaks. */
export const GAP_MS = 10 * 60_000;
/** Not moving for at least this long, then moving on slowly, is a new flight. */
export const STOP_MS = 20 * 60_000;
/** Covering ground over a silence at this speed or more means the plane was flying. */
export const STOP_KMH = 150;
/** Faster than this between two positions is a bad position. */
export const MAX_KMH = 1_500;

const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from a to b, in degrees. A great circle holds it from the same start. */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function bearingGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * When the network last had this position: the snapshot's own instant, less the row's age
 * (`seen_pos`, up to about a minute). Pure, and the same on both sides, so a server point and
 * a tab point from one snapshot carry one time and the join can line them up.
 */
export function heardAt(fetchedAt: number, posAgeS: unknown): number {
  return typeof posAgeS === "number" && Number.isFinite(posAgeS) && posAgeS > 0
    ? Math.round(fetchedAt - posAgeS * 1000)
    : fetchedAt;
}

export type LineStep = "skip" | "extend" | "append" | "gap" | "new-flight";

/**
 * What a new position does to a line. `head` is the end of the line, `prev` the point before
 * it in the same part (null while the head starts a part), `bearing` the bearing the current
 * straight began with.
 */
export function classifyStep(
  prev: { lat: number; lon: number } | null,
  head: { lat: number; lon: number; t: number },
  bearing: number,
  lastHeardAt: number,
  pt: TrackPoint,
): LineStep {
  // A snapshot can repeat a reading, or carry an older one. Neither is news.
  if (pt.t <= lastHeardAt) return "skip";
  const moved = distanceKm(head, pt);
  if (moved < MIN_STEP_KM) return "skip";
  const sinceMovedMs = pt.t - head.t;
  const kmh = (moved / sinceMovedMs) * 3_600_000;
  if (sinceMovedMs >= STOP_MS && kmh < STOP_KMH) return "new-flight";
  if (pt.t - lastHeardAt >= GAP_MS || kmh > MAX_KMH) return "gap";
  if (
    prev &&
    !Number.isNaN(bearing) &&
    distanceKm(prev, pt) <= MAX_SEGMENT_KM &&
    bearingGap(bearingDeg(prev, pt), bearing) <= SAME_HEADING_DEG
  ) {
    return "extend";
  }
  return "append";
}

export function newLine(pt: TrackPoint): TrackLine {
  return {
    data: [pt.lat, pt.lon, pt.altKm, pt.t],
    breaks: [],
    bearing: Number.NaN,
    firstHeardAt: pt.t,
    lastHeardAt: pt.t,
    trimmed: false,
  };
}

export function pointCount(line: TrackLine): number {
  return line.data.length / STRIDE;
}

export function pointAt(line: TrackLine, i: number): TrackPoint {
  const o = i * STRIDE;
  return { lat: line.data[o], lon: line.data[o + 1], altKm: line.data[o + 2], t: line.data[o + 3] };
}

/** Grow a line by one position, in place. Returns what the position did. */
export function stepLine(line: TrackLine, pt: TrackPoint, maxPoints: number): LineStep {
  const n = pointCount(line);
  const head = pointAt(line, n - 1);
  const headStartsPart = n === 1 || line.breaks[line.breaks.length - 1] === n - 1;
  const prev = headStartsPart ? null : pointAt(line, n - 2);
  const step = classifyStep(prev, head, line.bearing, line.lastHeardAt, pt);

  if (step === "new-flight") {
    Object.assign(line, newLine(pt));
    return step;
  }
  if (step === "extend") {
    const o = (n - 1) * STRIDE;
    line.data[o] = pt.lat;
    line.data[o + 1] = pt.lon;
    line.data[o + 2] = pt.altKm;
    line.data[o + 3] = pt.t;
  } else if (step === "append") {
    line.bearing = bearingDeg(head, pt);
    line.data.push(pt.lat, pt.lon, pt.altKm, pt.t);
  } else if (step === "gap") {
    line.breaks.push(n);
    line.bearing = Number.NaN;
    line.data.push(pt.lat, pt.lon, pt.altKm, pt.t);
  }
  if (pt.t > line.lastHeardAt) line.lastHeardAt = pt.t;
  if (pointCount(line) > maxPoints) dropOldest(line, pointCount(line) - maxPoints);
  return step;
}

/** Drop a line's `k` oldest points, in place. A line never drops its end. */
export function dropOldest(line: TrackLine, k: number): void {
  const drop = Math.min(k, pointCount(line) - 1);
  if (drop <= 0) return;
  line.data.splice(0, drop * STRIDE);
  line.breaks = line.breaks.filter((b) => b > drop).map((b) => b - drop);
  line.trimmed = true;
}

/** Drop the points older than `minT`, in place. A plane still heard keeps at least its end. */
export function trimOlderThan(line: TrackLine, minT: number): void {
  if (line.data[3] >= minT) return;
  let k = 0;
  while (k < pointCount(line) && line.data[k * STRIDE + 3] < minT) k++;
  dropOldest(line, k);
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A line for the wire, or an empty answer for a plane we hold no line for. */
export function toStoredTrack(id: string, line: TrackLine | undefined): StoredTrack {
  if (!line) return { id, firstHeardAt: null, lastHeardAt: null, trimmed: false, points: [], breaks: [] };
  const points: StoredTrack["points"] = [];
  for (let i = 0; i < pointCount(line); i++) {
    const p = pointAt(line, i);
    points.push([round5(p.lat), round5(p.lon), round2(p.altKm), p.t]);
  }
  return {
    id,
    firstHeardAt: line.firstHeardAt,
    lastHeardAt: line.lastHeardAt,
    trimmed: line.trimmed,
    points,
    breaks: line.breaks,
  };
}
