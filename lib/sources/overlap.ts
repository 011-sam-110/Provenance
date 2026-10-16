import type { Camera } from "@/lib/types";

/**
 * The same camera reached through two feeds.
 *
 * Some city networks are also republished by a regional 511 system: 89 of the 336
 * City of Toronto RESCU cameras sit within 150 m of a 511 Ontario camera, which is
 * the city's own picture relayed. Serving both draws two pins on one junction and
 * counts one camera twice. A feed that declares `yieldsTo` in registry.ts drops each
 * camera that sits within this radius of a camera from one of those feeds.
 *
 * 150 m is the radius the source audit measured overlap with, and the one the
 * discovery overlap gate uses for the same question.
 */
export const DUPLICATE_RADIUS_M = 150;

const M_PER_DEG_LAT = 111_320;

function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (a.lat - b.lat) * M_PER_DEG_LAT;
  const dLon = (a.lon - b.lon) * M_PER_DEG_LAT * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/**
 * Drop each camera of a yielding source that has a camera of a source it yields to
 * within `radiusM`. Cameras of every other source pass untouched, in order. Pure.
 *
 * @param yields source -> the sources it yields to
 */
export function dropNearDuplicates(
  cameras: readonly Camera[],
  yields: Readonly<Record<string, readonly string[]>>,
  radiusM: number = DUPLICATE_RADIUS_M,
): Camera[] {
  const targets = new Set(Object.values(yields).flat());
  if (targets.size === 0) return [...cameras];
  // A grid of cells one radius tall, so a neighbour can only be in the 3x3 block around
  // a point's cell. Longitude cells are widened by latitude well enough for 150 m.
  const cellDeg = radiusM / M_PER_DEG_LAT;
  const key = (lat: number, lon: number) =>
    `${Math.floor(lat / cellDeg)}:${Math.floor((lon * Math.cos((lat * Math.PI) / 180)) / cellDeg)}`;
  const grid = new Map<string, Camera[]>();
  for (const c of cameras) {
    if (!targets.has(c.source)) continue;
    const k = key(c.lat, c.lon);
    const list = grid.get(k);
    if (list) list.push(c);
    else grid.set(k, [c]);
  }
  return cameras.filter((c) => {
    const to = yields[c.source];
    if (!to?.length) return true;
    const cy = Math.floor(c.lat / cellDeg);
    const cx = Math.floor((c.lon * Math.cos((c.lat * Math.PI) / 180)) / cellDeg);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const o of grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
          if (to.includes(o.source) && metres(c, o) <= radiusM) return false;
        }
      }
    }
    return true;
  });
}
