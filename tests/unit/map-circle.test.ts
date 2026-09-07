import { describe, expect, it } from "vitest";
import { CIRCLE_VERTICES, crossesAntimeridian, haversineKm, ringFromCircle } from "@/lib/map/circle";
import { camerasInRing } from "@/lib/console/widgets/camslot.pick";

describe("haversineKm", () => {
  it("is zero for a point against itself", () => {
    expect(haversineKm({ lat: 32.76, lon: -117.15 }, { lat: 32.76, lon: -117.15 })).toBeCloseTo(0, 6);
  });

  it("measures one degree of latitude as ~111.19 km anywhere", () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111.19, 1);
    expect(haversineKm({ lat: 60, lon: 20 }, { lat: 61, lon: 20 })).toBeCloseTo(111.19, 1);
  });
});

describe("crossesAntimeridian", () => {
  it("is true for a circle straddling the seam east of it", () => {
    expect(crossesAntimeridian({ lat: 0, lon: 179.9, radiusKm: 50 })).toBe(true);
  });

  it("is true for a circle straddling the seam west of it too", () => {
    expect(crossesAntimeridian({ lat: 0, lon: -179.9, radiusKm: 50 })).toBe(true);
  });

  it("is false for an ordinary circle nowhere near the seam", () => {
    expect(crossesAntimeridian({ lat: 32.7641, lon: -117.1577, radiusKm: 5 })).toBe(false);
  });

  it("is true for a radius so large the circle spans the globe, at any longitude", () => {
    expect(crossesAntimeridian({ lat: 0, lon: 0, radiusKm: 25000 })).toBe(true);
    expect(crossesAntimeridian({ lat: 32.7641, lon: -117.1577, radiusKm: 25000 })).toBe(true);
  });
});

describe("ringFromCircle", () => {
  it("returns an OPEN ring of the requested vertex count", () => {
    const ring = ringFromCircle({ lat: 0, lon: 0, radiusKm: 5 });
    expect(ring).toHaveLength(CIRCLE_VERTICES);
    // Open: the last vertex is not a repeat of the first.
    expect(ring[ring.length - 1]).not.toEqual(ring[0]);
  });

  it("puts every vertex at the requested radius, at the equator and at 60N", () => {
    for (const lat of [0, 60]) {
      const ring = ringFromCircle({ lat, lon: 10, radiusKm: 5 });
      for (const [lon, vlat] of ring) {
        expect(haversineKm({ lat, lon: 10 }, { lat: vlat, lon })).toBeCloseTo(5, 1);
      }
    }
  });

  it("returns an empty ring for a circle that crosses the antimeridian, rather than an inverted one", () => {
    // Wrapping each vertex's longitude independently (the old behaviour) would
    // produce a ring whose bbox covers nearly the globe and whose containment
    // is inverted through `pointInRing` — the centre tests OUTSIDE and a point
    // 111 km away tests INSIDE. Refusing is the honest answer.
    expect(ringFromCircle({ lat: 0, lon: 179.9, radiusKm: 50 })).toEqual([]);
    expect(ringFromCircle({ lat: 0, lon: -179.9, radiusKm: 50 })).toEqual([]);
  });

  it("refuses a circle so large it would span the globe, regardless of longitude", () => {
    expect(ringFromCircle({ lat: 0, lon: 0, radiusKm: 25000 })).toEqual([]);
  });

  it("selects nothing — not an inverted set — for a straddling circle via camerasInRing", () => {
    // A grid of candidate points straddling 179.9°E/-180/-179.9°W.
    const rows: { id: string; lat: number; lon: number }[] = [];
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        let lon = 179.9 + dx * 0.05;
        if (lon > 180) lon -= 360;
        if (lon < -180) lon += 360;
        rows.push({ id: `${dx},${dy}`, lat: dy * 0.05, lon });
      }
    }

    const straddling = ringFromCircle({ lat: 0, lon: 179.9, radiusKm: 50 });
    expect(straddling).toEqual([]);
    // Without the refusal, the centre (0 km away) and several nearby points
    // would test as "inside" or "outside" backwards. With the refusal, the
    // ring is empty and nothing is selected at all — never an inverted set.
    expect(camerasInRing(rows, straddling)).toEqual([]);

    // The San Diego control still selects correctly through the same path —
    // the refusal is narrow and has not broken an ordinary circle.
    const centre = { lat: 32.7641, lon: -117.1577 };
    const controlRing = ringFromCircle({ ...centre, radiusKm: 5 });
    const controlRows = [
      { id: "centre", lat: centre.lat, lon: centre.lon },
      { id: "far", lat: centre.lat + 1, lon: centre.lon + 1 },
    ];
    expect(camerasInRing(controlRows, controlRing).map((r) => r.id)).toEqual(["centre"]);
  });

  it("clamps latitude at the poles rather than producing an invalid coordinate", () => {
    const ring = ringFromCircle({ lat: 89.9, lon: 0, radiusKm: 200 });
    for (const [, lat] of ring) {
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
    }
  });

  it("agrees with camerasInRing to within one vertex spacing", () => {
    const centre = { lat: 32.7641, lon: -117.1577 };
    const radiusKm = 5;
    const ring = ringFromCircle({ ...centre, radiusKm });

    // A grid of candidate points around the centre.
    const rows: { id: string; lat: number; lon: number }[] = [];
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        rows.push({ id: `${dx},${dy}`, lat: centre.lat + dy * 0.01, lon: centre.lon + dx * 0.01 });
      }
    }

    const inRing = new Set(camerasInRing(rows, ring).map((r) => r.id));
    // A 64-gon inscribes the circle, so it can only ever EXCLUDE points just inside
    // the true radius — never include one outside it. Allow a 1% band for that.
    for (const r of rows) {
      const d = haversineKm(centre, r);
      if (d < radiusKm * 0.99) expect(inRing.has(r.id)).toBe(true);
      if (d > radiusKm * 1.01) expect(inRing.has(r.id)).toBe(false);
    }
  });

  it("returns an empty ring for a non-finite or non-positive radius", () => {
    expect(ringFromCircle({ lat: 0, lon: 0, radiusKm: 0 })).toEqual([]);
    expect(ringFromCircle({ lat: 0, lon: 0, radiusKm: -1 })).toEqual([]);
    expect(ringFromCircle({ lat: 0, lon: 0, radiusKm: Number.NaN })).toEqual([]);
  });
});
