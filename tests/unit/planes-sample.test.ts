/**
 * The render cap must not drop whole regions.
 *
 * WHY THIS TEST EXISTS: /api/planes used to cap with `objects.slice(0, 3000)` on a
 * region-ordered concatenation, so the 3,000 survivors were whole regions in list
 * order and the globe showed one or two dense discs (prod 2026-09-06: 1,311
 * aircraft, every one between 2° and 15° E). A cap on a worldwide pool has to be a
 * SAMPLE of the world, not a prefix of it.
 *
 * `sampleSpatially` is pure: no Date, no Math.random, no network. Same input, same
 * output, in any input order.
 */

import { describe, expect, it } from "vitest";
import { sampleSpatially } from "@/lib/planes/sample";
import { regionOf, REGION_LABELS } from "@/lib/planes/ops";
import type { WorldObject } from "@/lib/world";

// --- fixtures ---------------------------------------------------------------

let hexCounter = 0;
function plane(lat: number, lon: number, onGround = false): WorldObject {
  const hex = (hexCounter++).toString(16).padStart(6, "0");
  return {
    kind: "plane",
    id: `plane:${hex}`,
    lat,
    lon,
    altKm: onGround ? 0 : 10,
    heading: 90,
    label: hex,
    meta: { onGround },
  };
}

/** 10° cell key, the same partition the sampler uses. */
function cellOf(o: WorldObject): string {
  const r = Math.min(17, Math.floor((o.lat + 90) / 10));
  const c = Math.min(35, Math.floor((o.lon + 180) / 10));
  return `${r},${c}`;
}

/**
 * A skewed world: a grid of cell centres spanning every continent, one cell
 * (the first) holding 5,000 aircraft the way New York does, every other cell
 * holding 40. Every 10th aircraft is on the ground.
 */
function skewedPool(): { pool: WorldObject[]; cells: string[]; bigCell: string } {
  hexCounter = 0;
  const centres: [number, number][] = [];
  for (let lat = -55; lat <= 65; lat += 10) {
    for (let lon = -175; lon <= 175; lon += 35) centres.push([lat, lon]);
  }
  const pool: WorldObject[] = [];
  centres.forEach(([lat, lon], i) => {
    const n = i === 0 ? 5000 : 40;
    for (let k = 0; k < n; k++) {
      // Jitter inside the cell: centres sit at x5, offsets stay under 2.5°.
      pool.push(plane(lat + (k % 5) * 0.5, lon + (k % 7) * 0.5, k % 10 === 0));
    }
  });
  const cells = [...new Set(pool.map(cellOf))];
  return { pool, cells, bigCell: cellOf(pool[0]) };
}

function shuffled<T>(xs: readonly T[]): T[] {
  // Deterministic shuffle (LCG), so the test itself is reproducible.
  const out = xs.slice();
  let s = 42;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- the cap is a sample, not a prefix -------------------------------------

describe("sampleSpatially — a cap that keeps the whole world", () => {
  const CAP = 3000;

  it("returns exactly the cap when the pool is larger", () => {
    const { pool } = skewedPool();
    expect(pool.length).toBeGreaterThan(CAP);
    expect(sampleSpatially(pool, CAP)).toHaveLength(CAP);
  });

  it("keeps at least one aircraft from every non-empty 10° cell", () => {
    const { pool, cells } = skewedPool();
    const kept = new Set(sampleSpatially(pool, CAP).map(cellOf));
    for (const c of cells) expect(kept.has(c), `cell ${c} was dropped`).toBe(true);
  });

  it("keeps every continent the pool covered", () => {
    const { pool } = skewedPool();
    const regions = new Set(sampleSpatially(pool, CAP).map((o) => regionOf(o.lat, o.lon)));
    for (const label of REGION_LABELS) expect(regions.has(label), label).toBe(true);
  });

  it("gives each cell its proportional share, to within one aircraft", () => {
    const { pool, bigCell } = skewedPool();
    const out = sampleSpatially(pool, CAP);
    const share = (5000 * CAP) / pool.length;
    const got = out.filter((o) => cellOf(o) === bigCell).length;
    expect(Math.abs(got - share)).toBeLessThanOrEqual(1);
  });

  it("prefers airborne aircraft: a cell only keeps ground rows once all its airborne rows are in", () => {
    const { pool } = skewedPool();
    const out = sampleSpatially(pool, CAP);
    const byCell = new Map<string, { air: number; ground: number }>();
    for (const o of pool) {
      const e = byCell.get(cellOf(o)) ?? { air: 0, ground: 0 };
      (o.meta?.onGround ? (e.ground += 1) : (e.air += 1));
      byCell.set(cellOf(o), e);
    }
    const keptAir = new Map<string, number>();
    for (const o of out) {
      if (!o.meta?.onGround) keptAir.set(cellOf(o), (keptAir.get(cellOf(o)) ?? 0) + 1);
    }
    for (const o of out) {
      if (o.meta?.onGround) {
        const c = cellOf(o);
        expect(keptAir.get(c) ?? 0, `ground row kept in ${c} ahead of airborne`).toBe(byCell.get(c)!.air);
      }
    }
  });

  it("is deterministic and independent of input order", () => {
    const { pool } = skewedPool();
    const a = sampleSpatially(pool, CAP).map((o) => o.id);
    const b = sampleSpatially(shuffled(pool), CAP).map((o) => o.id);
    expect(b).toEqual(a);
  });

  it("returns every aircraft, untouched, when the pool is within the cap", () => {
    const { pool } = skewedPool();
    const small = pool.slice(0, 200);
    const out = sampleSpatially(small, CAP);
    expect(new Set(out.map((o) => o.id))).toEqual(new Set(small.map((o) => o.id)));
    expect(out).toHaveLength(200);
  });

  it("does not mutate the input array", () => {
    const { pool } = skewedPool();
    const before = pool.map((o) => o.id);
    sampleSpatially(pool, CAP);
    expect(pool.map((o) => o.id)).toEqual(before);
  });

  it("places the poles and the antimeridian in valid cells instead of throwing", () => {
    hexCounter = 0;
    const edges = [
      plane(90, 0),
      plane(-90, 0),
      plane(0, 180),
      plane(0, -180),
      plane(90, 180),
      plane(-90, -180),
      plane(89.9999, 179.9999),
      plane(-89.9999, -179.9999),
    ];
    const ids = new Set(edges.map((o) => o.id));
    const out = sampleSpatially(edges, 4);
    expect(out).toHaveLength(4);
    for (const o of out) expect(ids.has(o.id)).toBe(true);
  });

  it("never returns more than the pool holds, even with a cap of zero or a negative cap", () => {
    const { pool } = skewedPool();
    expect(sampleSpatially(pool.slice(0, 10), 0)).toHaveLength(10);
    expect(sampleSpatially(pool.slice(0, 10), -5)).toHaveLength(10);
  });
});
