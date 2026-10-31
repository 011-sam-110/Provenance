// The God's eye view's aircraft, the pure half of /api/eye/planes: which planes a box gets
// and what the answer says about them. Pinned by tests/unit/eye-plane-models.test.ts.
//
// WHY A BOX, as for the boats (lib/eye/vessels.ts, whose box rules this shares). The console
// reads a 3,000 sample of the world, spread by area, so a city can hold none of it: measured
// 2026-10-31 02:50 UTC, 0 aircraft of the sample within 50 km of Westminster. The view asks for
// the planes around what is on screen instead, from everything the pull heard
// (lib/planes/pool.ts), and asks again once it has settled outside the box it holds.
//
// NO NEW REQUEST UPSTREAM. This reads what the one type pull already fetched, on its own 90 s
// clock. CLAUDE.md's rule about adsb.lol's small bucket is why that matters.
//
// IT NEVER SERVES SOMETHING OLDER THAN THE SNAPSHOT. The snapshot went through the staleness gate
// (lib/sources/opensky.ts), so a pool older than it (adsb.fi's failover is serving, or this
// process has just restarted) is passed over, and the answer says it is the sample.

import type { WorldObject } from "@/lib/world";
import type { AircraftSnapshot } from "@/lib/sources/opensky";
import type { PlanePool } from "@/lib/planes/pool";
import { applyCap, describeCoverage, readCoverage, type SignalCoverage } from "@/lib/signals/coverage";
import { inBox, nearestFirst, type Box } from "@/lib/eye/vessels";

/** The most aircraft one answer carries. */
export const EYE_PLANE_CAP = 500;
/** How often an open view asks again: the pull's own clock (REVALIDATE_S in lib/sources/opensky.ts). */
export const EYE_PLANES_EVERY_MS = 90_000;

export interface EyePlanesBody {
  ok: boolean;
  /** The box the answer covers: the one asked for, capped. The view compares itself to this. */
  box: Box;
  /** The box asked for was wider than MAX_SPAN and was cut down about its centre. */
  clamped: boolean;
  count: number;
  /** True when this is the worldwide sample's share of the box, not everything the pull heard. */
  sampled: boolean;
  /** When these positions were pulled, epoch ms. Absent before any pull has succeeded. */
  fetchedAt?: number;
  coverage: SignalCoverage;
  planes: WorldObject[];
}

/**
 * Pure: the route's answer. Every aircraft inside the box from the whole pool when it is as
 * new as the snapshot, else from the snapshot's sample, the EYE_PLANE_CAP nearest the middle
 * of the box. `sampled` says which. A snapshot withheld as too old gives no aircraft and
 * `ok: false`, whatever the pool holds: an old position is not served as a current one.
 */
export function eyePlanesBody(input: {
  box: Box;
  clamped: boolean;
  snapshot: Pick<AircraftSnapshot, "planes" | "fetchedAt" | "staleness">;
  pool: PlanePool | null;
}): EyePlanesBody {
  const { box, clamped, snapshot, pool } = input;
  const tooOld = snapshot.staleness != null && "reason" in snapshot.staleness;
  const usePool = !tooOld && pool != null && (snapshot.fetchedAt == null || pool.fetchedAt >= snapshot.fetchedAt);
  const from: readonly WorldObject[] = tooOld ? [] : usePool ? pool.objects : snapshot.planes;
  const inside = from.filter((p) => inBox(p.lat, p.lon, box));
  const centre = { lat: (box[1] + box[3]) / 2, lon: (box[0] + box[2]) / 2 };
  const planes = applyCap(nearestFirst(inside, centre), EYE_PLANE_CAP, {
    noun: "aircraft",
    rule: `the ${EYE_PLANE_CAP} nearest the middle of the view`,
  });
  const coverage = readCoverage(planes);
  const fetchedAt = usePool ? pool.fetchedAt : snapshot.fetchedAt;
  return {
    ok: !tooOld && fetchedAt != null,
    box,
    clamped,
    count: planes.length,
    sampled: !usePool,
    ...(fetchedAt != null ? { fetchedAt } : {}),
    coverage: coverage ? describeCoverage(coverage) : { returned: planes.length, available: planes.length, availableExact: true, capped: false },
    planes,
  };
}
