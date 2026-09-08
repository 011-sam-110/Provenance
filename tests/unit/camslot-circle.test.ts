import { describe, expect, it } from "vitest";
import { specFrom } from "@/lib/console/widgets/camslot.circle";
import { haversineKm } from "@/lib/map/circle";

describe("specFrom", () => {
  it("keeps the centre and measures the radius to the dragged edge", () => {
    const center = { lat: 32.7641, lon: -117.1577 };
    const edge = { lat: 32.8091, lon: -117.1577 };
    const spec = specFrom(center, edge);
    expect(spec.lat).toBe(center.lat);
    expect(spec.lon).toBe(center.lon);
    expect(spec.radiusKm).toBeCloseTo(haversineKm(center, edge), 6);
  });

  it("gives a zero radius when the pointer has not moved, which is every drag's first frame", () => {
    const p = { lat: 10, lon: 10 };
    expect(specFrom(p, p).radiusKm).toBeCloseTo(0, 9);
  });
});
