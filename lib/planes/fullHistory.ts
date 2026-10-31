// The tab's long lines, for the Full flight trail setting. Pure and unit-tested; the hook that
// drives it is lib/planes/usePlanes.ts. With the switch off nothing here runs, and the line is
// the 12 points it has always been.
//
// THE RULE. Each plane in the feed grows a line with the same thinning as the server's store
// (lib/planes/trackLine.ts). A plane that leaves the feed loses its line, as it always has.
// A click joins the server's stored line on behind the tab's own.
//
// THE CAPS ARE THE POINT. A tab can stay open for hours while `setData` runs on every new
// snapshot, so the tab holds a hard number of points, measured with
// `scripts/planes-trail-fps.mjs`. Past it, every line gives up its oldest points until the
// total fits. The lines someone clicked lose theirs last, and there are at most MAX_KEPT_LINES.

import type { WorldObject } from "@/lib/world";
import {
  GAP_MS,
  heardAt,
  newLine,
  pointAt,
  pointCount,
  stepLine,
  dropOldest,
  type StoredTrack,
  type TrackLine,
  type TrackPoint,
} from "@/lib/planes/trackLine";
import { lookaheadKm, projectAhead, type TrailPoint } from "@/lib/planes/trail";
import type { PlaneTrail } from "@/lib/planes/usePlanes";

/** Points for one plane in the tab. Matches the server's, so a stored line always fits. */
export const FULL_MAX_POINTS_PER_PLANE = 500;
/** Points in the tab, over all planes. What the frame-time measurement chose. */
export const FULL_MAX_TOTAL_POINTS = 60_000;
/** Lines a click has loaded that the overall cap spares. */
export const MAX_KEPT_LINES = 8;

export interface FullCaps {
  maxPointsPerPlane: number;
  maxTotalPoints: number;
}

export const FULL_CAPS: FullCaps = {
  maxPointsPerPlane: FULL_MAX_POINTS_PER_PLANE,
  maxTotalPoints: FULL_MAX_TOTAL_POINTS,
};

/** One row of a snapshot as a line point. */
export function pointOf(o: WorldObject, at: number): TrackPoint {
  return {
    lat: o.lat,
    lon: o.lon,
    altKm: o.altKm ?? 0,
    t: heardAt(at, (o.meta as { posAgeS?: unknown } | undefined)?.posAgeS),
  };
}

/** A line from the tab's short history, so turning the switch on keeps what is already drawn. */
export function lineFromHistory(history: readonly TrailPoint[], at: number): TrackLine | null {
  if (history.length === 0) return null;
  const first = history[0];
  const line = newLine({ ...first, t: first.t ?? at });
  for (let i = 1; i < history.length; i++) {
    const p = history[i];
    stepLine(line, { ...p, t: p.t ?? at }, FULL_MAX_POINTS_PER_PLANE);
  }
  return line;
}

/**
 * One snapshot's step. Returns the map of lines for the planes in this snapshot, so a plane
 * that left the feed is gone. Grows the lines it keeps in place.
 */
export function stepFullHistory(
  lines: ReadonlyMap<string, TrackLine>,
  planes: readonly WorldObject[],
  at: number,
  caps: FullCaps = FULL_CAPS,
): Map<string, TrackLine> {
  const next = new Map<string, TrackLine>();
  for (const o of planes) {
    const pt = pointOf(o, at);
    const line = lines.get(o.id);
    if (line) {
      stepLine(line, pt, caps.maxPointsPerPlane);
      next.set(o.id, line);
    } else {
      next.set(o.id, newLine(pt));
    }
  }
  return next;
}

/**
 * Hold the tab to its overall cap: find the longest a line may be for the total to fit, and cut
 * every line down to that, newest points kept. Cuts to 90% of the cap, so it does not run again
 * on the next snapshot. `kept` lines stay whole and count against the budget first.
 */
export function capOverall(
  lines: ReadonlyMap<string, TrackLine>,
  kept: ReadonlySet<string>,
  caps: FullCaps = FULL_CAPS,
): void {
  let total = 0;
  for (const line of lines.values()) total += pointCount(line);
  if (total <= caps.maxTotalPoints) return;

  let budget = Math.floor(caps.maxTotalPoints * 0.9);
  const lengths: number[] = [];
  for (const [id, line] of lines) {
    if (kept.has(id)) budget -= pointCount(line);
    else lengths.push(pointCount(line));
  }
  lengths.sort((a, b) => a - b);
  // Water-fill: short lines take what they need, and the rest share what is left evenly.
  let allowance = 1;
  let left = Math.max(0, budget);
  for (let i = 0; i < lengths.length; i++) {
    const share = Math.floor(left / (lengths.length - i));
    if (lengths[i] > share) {
      allowance = Math.max(1, share);
      break;
    }
    left -= lengths[i];
    allowance = lengths[i];
  }
  for (const [id, line] of lines) {
    if (kept.has(id)) continue;
    const over = pointCount(line) - allowance;
    if (over > 0) dropOldest(line, over);
  }
}

/**
 * Put a stored line behind the tab's own, in place. Only the stored points older than the tab's
 * first point are used: from then on the tab's own points are the same positions, because both
 * come from one pull, so the two lie on one path and the join shows no jump.
 *
 * WHICH JOINS ARE A GAP. The stored line says so itself: the point after the join starts a part,
 * or, when the tab's first point is newer than everything stored, the server has not heard the
 * plane for as long as a gap. Time between the two points would not do: a thinned straight can
 * cover half an hour between two points with the plane heard all the way.
 *
 * Returns how many stored points it used. Zero means the tab's line was already as long.
 */
export function joinStoredLine(line: TrackLine, stored: StoredTrack, maxPoints = FULL_MAX_POINTS_PER_PLANE): number {
  const first = pointAt(line, 0);
  let used = 0;
  while (used < stored.points.length && stored.points[used][3] < first.t) used++;
  if (used === 0) return 0;

  const gap =
    used < stored.points.length
      ? stored.breaks.includes(used)
      : stored.lastHeardAt === null || first.t - stored.lastHeardAt >= GAP_MS;

  const older: number[] = [];
  for (let i = 0; i < used; i++) older.push(...stored.points[i]);
  line.data = older.concat(line.data);
  line.breaks = [...stored.breaks.filter((b) => b < used), ...(gap ? [used] : []), ...line.breaks.map((b) => b + used)];
  if (stored.firstHeardAt !== null) line.firstHeardAt = stored.firstHeardAt;
  if (stored.trimmed) line.trimmed = true;
  if (pointCount(line) > maxPoints) dropOldest(line, pointCount(line) - maxPoints);
  return used;
}

/**
 * Keep longitudes continuous along a line, in place on the tuples. A plane crossing the 180th
 * meridian would otherwise draw a line the whole way round a flat map, for hours now rather than
 * for the minutes a 12-point line lasts. The map's tiler wraps a longitude past 180 by itself.
 */
export function unwrapLongitudes(points: [number, number, number][]): void {
  for (let i = 1; i < points.length; i++) {
    const d = points[i][1] - points[i - 1][1];
    if (d > 180) points[i][1] -= 360 * Math.round(d / 360);
    else if (d < -180) points[i][1] += 360 * Math.round(-d / 360);
  }
}

/**
 * One plane's drawn line: its stored and heard points, then where it is and the point ahead,
 * as `buildTrailPath` draws them. Written out here rather than called, because this runs on
 * tens of thousands of points and a tuple is what it needs, not an object first.
 */
export function fullTrailOf(line: TrackLine, o: WorldObject): PlaneTrail {
  const altKm = o.altKm ?? 0;
  const points: [number, number, number][] = [];
  for (let i = 0; i < line.data.length; i += 4) points.push([line.data[i], line.data[i + 1], line.data[i + 2]]);
  // The end of the line IS the current position unless a small step was skipped. Then the end
  // stays where it was and the line runs on to the plane, under a kilometre away.
  const last = points[points.length - 1];
  if (last[0] === o.lat && last[1] === o.lon) points.pop();
  const ahead = projectAhead(o.lat, o.lon, o.heading ?? 0, lookaheadKm((o.meta?.velocityMs as number | null) ?? null));
  points.push([o.lat, o.lon, altKm], [ahead.lat, ahead.lon, altKm]);
  unwrapLongitudes(points);
  return {
    id: o.id,
    color: o.color ?? "#fbbf24",
    points,
    ...(line.breaks.length ? { breaks: line.breaks } : {}),
  };
}

/** Every plane's drawn line for one snapshot. */
export function fullTrails(lines: ReadonlyMap<string, TrackLine>, planes: readonly WorldObject[]): PlaneTrail[] {
  const out: PlaneTrail[] = [];
  for (const o of planes) {
    const line = lines.get(o.id);
    if (line) out.push(fullTrailOf(line, o));
  }
  return out;
}
