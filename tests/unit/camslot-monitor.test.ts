import { describe, expect, it } from "vitest";
import { planMonitor, ringCentre, type CameraRow, type WebcamRow } from "@/lib/console/widgets/camslot.monitor";
import { ringFromCircle } from "@/lib/map/circle";

const centre = { lat: 32.7641, lon: -117.1577 };
const ring = ringFromCircle({ ...centre, radiusKm: 5 });

const road = (id: string, live: boolean, away = 1): CameraRow => ({
  id, name: id, live, lat: centre.lat + away * 0.005, lon: centre.lon,
});
const web = (id: string, away = 1): WebcamRow => ({
  id, label: id, lat: centre.lat + away * 0.005, lon: centre.lon,
});

describe("ringCentre", () => {
  it("returns the mean of the vertices", () => {
    const c = ringCentre([[0, 0], [2, 0], [2, 2], [0, 2]]);
    expect(c.lon).toBeCloseTo(1, 6);
    expect(c.lat).toBeCloseTo(1, 6);
  });
});

describe("planMonitor", () => {
  it("builds nine tiles from a ring holding more than nine cameras", () => {
    const cameras = Array.from({ length: 30 }, (_, i) => road(`c${i}`, true, (i % 8) + 1));
    const plan = planMonitor({ ring, cameras, webcams: [] });
    expect(plan.tiles).toHaveLength(9);
    expect(plan.found).toBe(30);
    expect(plan.live).toBe(30);
  });

  it("ignores cameras outside the ring", () => {
    const cameras = [road("in", true, 1), { ...road("out", true), lat: 40, lon: -80 }];
    const plan = planMonitor({ ring, cameras, webcams: [] });
    expect(plan.found).toBe(1);
    expect(plan.tiles).toHaveLength(1);
  });

  it("includes webcams, and counts them as not live", () => {
    const plan = planMonitor({ ring, cameras: [road("r", true)], webcams: [web("w")] });
    expect(plan.found).toBe(2);
    expect(plan.live).toBe(1);
    // Live first: the road camera leads.
    expect(plan.tiles[0].streams[0]).toEqual({ k: "cam", id: "r" });
  });

  it("says nothing was found when the ring holds no cameras, and makes no tiles", () => {
    const plan = planMonitor({ ring, cameras: [], webcams: [] });
    expect(plan.tiles).toEqual([]);
    expect(plan.found).toBe(0);
    expect(plan.message).toContain("No cameras");
  });

  it("states the live count in its message when the ring holds both kinds", () => {
    const cameras = [road("a", true), road("b", false, 2)];
    const plan = planMonitor({ ring, cameras, webcams: [] });
    expect(plan.message).toContain("2");
    expect(plan.message).toContain("1 live");
  });

  it("reports how many were left out when the ring holds more than the wall shows", () => {
    const cameras = Array.from({ length: 30 }, (_, i) => road(`c${i}`, true, (i % 8) + 1));
    const plan = planMonitor({ ring, cameras, webcams: [] });
    // Nothing is dropped — the overflow rotates — so the message must not claim a loss.
    expect(plan.message).not.toContain("not placed");
    expect(plan.message).toContain("30");
  });

  it("refuses a ring with fewer than three vertices", () => {
    const plan = planMonitor({ ring: [[0, 0], [1, 1]], cameras: [road("a", true)], webcams: [] });
    expect(plan.tiles).toEqual([]);
    expect(plan.found).toBe(0);
    expect(plan.message).toBe("That area is not a shape.");
  });

  it("refuses a real ringFromCircle antimeridian straddle end to end", () => {
    // A ~50 km circle centred at 179.9°E — the exact case lib/map/circle.ts
    // documents as inverting under pointInRing if it were not refused.
    const straddling = ringFromCircle({ lat: 0, lon: 179.9, radiusKm: 50 });
    // Assert the refusal itself first: if ringFromCircle ever stops refusing
    // this circle, this test must fail loudly here rather than quietly
    // degenerate into a duplicate of the empty-cameras test above.
    expect(straddling).toEqual([]);

    const plan = planMonitor({ ring: straddling, cameras: [road("a", true)], webcams: [] });
    expect(plan.tiles).toEqual([]);
    expect(plan.found).toBe(0);
    expect(plan.message).toBe("That area is not a shape.");
  });
});
