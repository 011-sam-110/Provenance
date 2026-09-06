/**
 * A render cap that keeps the whole world.
 *
 * WHY: /api/planes serves at most MAX_PLANES aircraft out of a worldwide pool. The
 * previous cap was `objects.slice(0, cap)` on a region-ordered concatenation, so
 * the survivors were whole regions in list order and the globe showed one or two
 * dense discs (prod 2026-09-06: 1,311 aircraft, every one between 2° and 15° E).
 * A cap on a worldwide pool has to be a SAMPLE of the world, not a prefix of it.
 *
 * THE RULE, stated so the coverage record can quote it:
 *   - Partition the pool into 10°×10° lat/lon cells.
 *   - Give every cell a share of the cap proportional to how many aircraft it holds
 *     (largest-remainder / Hamilton allocation, so the shares sum to the cap exactly).
 *   - Every non-empty cell keeps at least one aircraft, taken from the largest cells.
 *   - Inside a cell, airborne aircraft come before aircraft on the ground.
 *
 * The density gradient survives (New York stays dense, a lone Pacific crossing
 * stays visible) and no region can be dropped wholesale.
 *
 * DETERMINISTIC. No Date, no Math.random. Inside a cell the order is a 32-bit FNV-1a
 * hash of the id rather than the id itself, because ICAO 24-bit blocks are
 * allocated by state (0xA… USA, 0x3C… Germany, 0x40… UK) and id order would always
 * drop the same registries first — US-registered aircraft over Europe, say. A hash
 * is still stable from one snapshot to the next (the same aircraft mostly stays in
 * or out, so client trails are not churned) but carries no registry bias.
 *
 * Pure and unit-tested (tests/unit/planes-sample.test.ts).
 */

import type { WorldObject } from "@/lib/world";

/** 32-bit FNV-1a. Exported for the tests; not a security primitive. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function onGround(o: WorldObject): boolean {
  return (o.meta as { onGround?: unknown } | undefined)?.onGround === true;
}

/**
 * Cell key for a coordinate. Zero-padded so lexicographic order equals grid order,
 * and clamped so lat 90 and lon 180 land in the last cell instead of one past it.
 */
function cellKey(o: WorldObject, cellDeg: number): string {
  const rows = Math.ceil(180 / cellDeg);
  const cols = Math.ceil(360 / cellDeg);
  const r = Math.min(rows - 1, Math.max(0, Math.floor((o.lat + 90) / cellDeg)));
  const c = Math.min(cols - 1, Math.max(0, Math.floor((o.lon + 180) / cellDeg)));
  return `${String(r).padStart(3, "0")},${String(c).padStart(3, "0")}`;
}

function byGroundThenHash(a: WorldObject, b: WorldObject): number {
  const ga = onGround(a) ? 1 : 0;
  const gb = onGround(b) ? 1 : 0;
  if (ga !== gb) return ga - gb;
  const ha = fnv1a32(a.id);
  const hb = fnv1a32(b.id);
  if (ha !== hb) return ha - hb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Keep at most `cap` aircraft as a proportional spatial sample. Returns a new array;
 * the input is not mutated. With no effective cap (non-finite, zero or negative) or
 * a pool already within the cap, every aircraft is returned.
 */
export function sampleSpatially(
  objects: readonly WorldObject[],
  cap: number,
  cellDeg = 10,
): WorldObject[] {
  const cells = new Map<string, WorldObject[]>();
  for (const o of objects) {
    const k = cellKey(o, cellDeg);
    const bucket = cells.get(k);
    if (bucket) bucket.push(o);
    else cells.set(k, [o]);
  }
  const keys = [...cells.keys()].sort();
  for (const k of keys) cells.get(k)!.sort(byGroundThenHash);

  const n = objects.length;
  const hasCap = Number.isFinite(cap) && cap > 0;
  if (!hasCap || n <= cap) return keys.flatMap((k) => cells.get(k)!);

  // Hamilton (largest remainder): floors first, then the leftover seats go to the
  // cells with the largest fractional share, so the quotas sum to `cap` exactly.
  const quota = new Map<string, number>();
  const remainders: { key: string; r: number; n: number }[] = [];
  let seats = cap;
  for (const k of keys) {
    const size = cells.get(k)!.length;
    const exact = (size * cap) / n;
    const q = Math.floor(exact);
    quota.set(k, q);
    seats -= q;
    remainders.push({ key: k, r: exact - q, n: size });
  }
  remainders.sort((a, b) => b.r - a.r || b.n - a.n || (a.key < b.key ? -1 : 1));
  for (let i = 0; i < seats && i < remainders.length; i++) {
    const k = remainders[i].key;
    quota.set(k, quota.get(k)! + 1);
  }

  // Every non-empty cell keeps at least one; the seats come out of the largest
  // quotas so a dense hub pays for it, not another sparse cell.
  let deficit = 0;
  for (const k of keys) {
    if (quota.get(k) === 0) {
      quota.set(k, 1);
      deficit++;
    }
  }
  while (deficit > 0) {
    let largest: string | null = null;
    for (const k of keys) {
      const q = quota.get(k)!;
      if (q > 1 && (largest === null || q > quota.get(largest)!)) largest = k;
    }
    // Only reachable when there are more non-empty cells than the cap allows; then
    // one-per-cell is impossible and the final slice below is the honest fallback.
    if (largest === null) break;
    quota.set(largest, quota.get(largest)! - 1);
    deficit--;
  }

  const out: WorldObject[] = [];
  for (const k of keys) out.push(...cells.get(k)!.slice(0, quota.get(k)!));
  return out.length > cap ? out.slice(0, cap) : out;
}
