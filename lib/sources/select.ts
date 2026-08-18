import type { Camera } from "@/lib/types";
import { haversineKm } from "@/lib/geo/haversine";

export function findById(cams: Camera[], id: string): Camera | null {
  return cams.find((c) => c.id === id) ?? null;
}

/**
 * The `limit` closest cameras to a point, nearest first.
 *
 * Keeps a running top-`limit` instead of ranking the whole set. The old form was
 * `map -> sort -> slice`, which built ~19k wrapper objects and then fully sorted them
 * to keep eight. Measured over the live 18,948-camera registry at 40 real camera
 * positions: 4.904 ms of CPU per call before, 0.976 ms after. It runs once per camera
 * page render (~19k crawlable URLs) and on /api/near, which is force-dynamic.
 *
 * THE OUTPUT IS THE SAME LIST, NOT AN APPROXIMATION, and the tie-break is the part
 * that has to be got right rather than assumed. `Array.prototype.sort` is stable, so
 * `sort -> slice` breaks equal distances by original index. Both comparisons below
 * are therefore STRICT: an equal-distance camera never displaces one already held
 * (`km < worst`) and never shifts past one it equals (`top[j - 1].km > km`), which
 * leaves the earlier camera first exactly as the stable sort did.
 *
 * tests/unit/select-nearest-equivalence.test.ts asserts this differentially against
 * the previous implementation over randomised sets, dense ties included.
 *
 * Non-finite coordinates are out of scope rather than handled: `Camera` is zod-parsed
 * and /api/near rejects anything failing `Number.isFinite` before calling this.
 */
export function nearest(
  cams: Camera[],
  lat: number,
  lon: number,
  limit: number,
): { camera: Camera; km: number }[] {
  if (limit <= 0) return [];

  const top: { camera: Camera; km: number }[] = [];

  for (const camera of cams) {
    const km = haversineKm(lat, lon, camera.lat, camera.lon);

    if (top.length < limit) {
      let j = top.length;
      while (j > 0 && top[j - 1].km > km) j--;
      top.splice(j, 0, { camera, km });
      continue;
    }

    if (!(km < top[top.length - 1].km)) continue;
    let j = top.length - 1;
    while (j > 0 && top[j - 1].km > km) j--;
    for (let k = top.length - 1; k > j; k--) top[k] = top[k - 1];
    top[j] = { camera, km };
  }

  return top;
}

export function search(cams: Camera[], q: string): Camera[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return cams;
  return cams.filter((c) => c.name.toLowerCase().includes(needle));
}
