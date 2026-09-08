import { describe, expect, it } from "vitest";
import { CIRCLE_VERTICES, crossesAntimeridian, haversineKm, ringBounds, ringFromCircle, toWatchRingFC } from "@/lib/map/circle";
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

describe("toWatchRingFC — the monitored area as something the map can draw", () => {
  it("CLOSES the ring, because ringFromCircle deliberately does not", () => {
    const ring = ringFromCircle({ lat: 32.7641, lon: -117.1577, radiusKm: 5 });
    const fc = toWatchRingFC(ring);
    const coords = (fc.features[0].geometry as GeoJSON.Polygon).coordinates[0];
    // One MORE than the vertex count: GeoJSON requires the first coordinate repeated,
    // and ringFromCircle's count is pinned as the vertex count by the test above. If
    // this closing were left to the caller it would be forgotten at one of them, and
    // MapLibre drops an invalid layer silently rather than complaining.
    expect(coords).toHaveLength(CIRCLE_VERTICES + 1);
    expect(coords[0]).toEqual(coords[coords.length - 1]);
  });

  it("does not double-close a ring that already closes", () => {
    const fc = toWatchRingFC([[0, 0], [1, 0], [1, 1], [0, 0]]);
    const coords = (fc.features[0].geometry as GeoJSON.Polygon).coordinates[0];
    expect(coords).toHaveLength(4);
  });

  it("returns NO FEATURE for fewer than three vertices, rather than a line or a point", () => {
    // Not a degenerate polygon — not an area. Drawing an area whose extent the user
    // cannot see is worse than drawing nothing, because it still reads as a boundary.
    for (const ring of [undefined, [] as [number, number][], [[0, 0]] as [number, number][], [[0, 0], [1, 1]] as [number, number][]]) {
      expect(toWatchRingFC(ring).features).toEqual([]);
    }
  });

  it("keeps [lon, lat] order, which is the order GeoJSON wants and the opposite of the store's", () => {
    const fc = toWatchRingFC([[-117.1577, 32.7641], [-117, 32.7641], [-117, 33]]);
    const coords = (fc.features[0].geometry as GeoJSON.Polygon).coordinates[0];
    expect(coords[0]).toEqual([-117.1577, 32.7641]);
  });
});

describe("ringBounds — where the camera should open", () => {
  it("boxes a circle tightly enough that the area fills the view", () => {
    const c = { lat: 32.7641, lon: -117.1577, radiusKm: 5 };
    const b = ringBounds(ringFromCircle(c))!;
    expect(b).not.toBeNull();
    const [[w, s], [e, n]] = b;
    expect(w).toBeLessThan(c.lon);
    expect(e).toBeGreaterThan(c.lon);
    expect(s).toBeLessThan(c.lat);
    expect(n).toBeGreaterThan(c.lat);
    // A 5km radius is a ~10km box. At this latitude that is well under a quarter
    // degree of latitude — the assertion that matters is that it is SMALL, because
    // the bug this replaces was a camera showing the whole planet.
    expect(n - s).toBeLessThan(0.25);
  });

  it("REFUSES a straddling ring that arrived from a ?c= LINK, which is the only way one can", () => {
    // The route matters, and the first version of this test got it wrong. Going
    // through ringFromCircle proves nothing: it already returns [] for a circle that
    // crosses the antimeridian, so ringBounds refuses on `length < 3` and the guard
    // below is never reached — the test passed with the guard deleted, which is how
    // it was caught.
    //
    // The live route is sanitize.ts's readWatch. It accepts any lon in [-180, 180]
    // with NO wrap check, so a hand-built `?c=` link can put this ring into
    // layout.watch. Un-refused, min/max spans ~358 degrees and fitBounds frames the
    // whole planet — the exact opposite of framing the area, and it would read as
    // the feature being broken rather than as a bad link.
    expect(ringFromCircle({ lat: 0, lon: 179.9, radiusKm: 50 })).toEqual([]);
    const fromLink: [number, number][] = [[179, 0], [-179, 0], [-179, 1], [179, 1]];
    expect(ringBounds(fromLink)).toBeNull();
  });

  it("returns null for anything that is not an area", () => {
    expect(ringBounds(undefined)).toBeNull();
    expect(ringBounds([])).toBeNull();
    expect(ringBounds([[0, 0], [1, 1]])).toBeNull();
  });
});
