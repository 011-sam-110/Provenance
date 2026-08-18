import { expect, test } from "vitest";
import { nearest } from "@/lib/sources/select";
import { haversineKm } from "@/lib/geo/haversine";
import type { Camera } from "@/lib/types";

// `nearest` stopped ranking the whole registry to keep eight rows. That is only a
// safe change if the eight rows are the SAME eight, in the SAME order, and the place
// that is easy to get wrong is the tie-break: `sort` is stable, so the old
// `map -> sort -> slice` broke equal distances by original index, and a hand-rolled
// top-N does not do that unless both of its comparisons are strict.
//
// Rather than assert a handful of cases, this checks the new implementation against
// the OLD ONE VERBATIM over randomised sets, with ties made common on purpose.

/** The previous implementation, kept here as the oracle. Do not "tidy" it. */
function referenceNearest(
  cams: Camera[],
  lat: number,
  lon: number,
  limit: number,
): { camera: Camera; km: number }[] {
  return cams
    .map((camera) => ({ camera, km: haversineKm(lat, lon, camera.lat, camera.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

const base = {
  source: "tfl",
  country: "GB",
  mediaType: "jpeg" as const,
  refreshSeconds: 300,
  license: "OGL",
  attribution: "Powered by TfL Open Data",
  available: true,
};

/** Deterministic PRNG, so a failure is reproducible rather than a one-off. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `tieBuckets` is the point of the generator: coordinates are snapped onto a small
 * grid so many cameras land at *identical* distances. Uniform random points almost
 * never tie, which would let a wrong tie-break pass.
 */
function makeCameras(rand: () => number, n: number, tieBuckets: number): Camera[] {
  return Array.from({ length: n }, (_, i) => {
    const latStep = Math.floor(rand() * tieBuckets);
    const lonStep = Math.floor(rand() * tieBuckets);
    return {
      ...base,
      id: `cam:${i}`,
      name: `Camera ${i}`,
      lat: 51 + latStep * 0.01,
      lon: -0.2 + lonStep * 0.01,
    } as Camera;
  });
}

const shape = (rows: { camera: Camera; km: number }[]) =>
  rows.map((r) => ({ id: r.camera.id, km: r.km }));

test("matches the previous map/sort/slice exactly, ties included", () => {
  const rand = mulberry32(20260818);
  for (let run = 0; run < 200; run++) {
    const size = 1 + Math.floor(rand() * 60);
    // 3 buckets makes ties dense; 40 makes them rare. Cover both.
    const cams = makeCameras(rand, size, run % 2 === 0 ? 3 : 40);
    const limit = Math.floor(rand() * 12);
    const lat = 51 + rand() * 0.3;
    const lon = -0.2 + rand() * 0.3;

    expect(shape(nearest(cams, lat, lon, limit))).toEqual(
      shape(referenceNearest(cams, lat, lon, limit)),
    );
  }
});

test("returns the same camera OBJECTS, not copies", () => {
  const cams = makeCameras(mulberry32(7), 20, 5);
  const out = nearest(cams, 51.05, -0.15, 5);
  for (const row of out) expect(cams).toContain(row.camera);
});

test("a limit at or beyond the set size returns everything, fully ordered", () => {
  const cams = makeCameras(mulberry32(11), 9, 3);
  const all = nearest(cams, 51.02, -0.18, 50);
  expect(all).toHaveLength(9);
  expect(shape(all)).toEqual(shape(referenceNearest(cams, 51.02, -0.18, 50)));
  for (let i = 1; i < all.length; i++) expect(all[i].km).toBeGreaterThanOrEqual(all[i - 1].km);
});

test("a non-positive limit returns nothing, as slice(0, 0) did", () => {
  const cams = makeCameras(mulberry32(3), 5, 2);
  expect(nearest(cams, 51, -0.2, 0)).toEqual([]);
  expect(nearest(cams, 51, -0.2, -1)).toEqual([]);
});

test("an empty registry returns nothing rather than throwing", () => {
  expect(nearest([], 51, -0.2, 8)).toEqual([]);
});

test("ties are broken by registry order, which is what kept pagination stable", () => {
  // Four cameras at the same point. The old stable sort kept them in array order;
  // anything else would reshuffle a camera page's neighbour list between renders.
  const cams: Camera[] = ["w", "x", "y", "z"].map(
    (id) => ({ ...base, id: `cam:${id}`, name: id, lat: 51.5, lon: -0.12 }) as Camera,
  );
  expect(nearest(cams, 51.5, -0.12, 3).map((r) => r.camera.id)).toEqual([
    "cam:w",
    "cam:x",
    "cam:y",
  ]);
});
