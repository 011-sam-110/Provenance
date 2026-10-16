import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/iceland.json";
import { normalizeIceland } from "@/lib/sources/iceland";
import { CameraArray } from "@/lib/types";

test("groups flat view rows by Maelist_nr into one marker per station", () => {
  const cams = normalizeIceland(fixture as never);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  // Stations 7001 (3 views) and 7002 (3 views) collapse to one camera each;
  // station 9999 has an empty Slod on its only row → no camera.
  expect(cams).toHaveLength(2);
  expect(cams.map((c) => c.id).sort()).toEqual(["iceland:7001", "iceland:7002"]);
  for (const c of cams) {
    expect(c.source).toBe("iceland");
    expect(c.country).toBe("IS");
    expect(c.mediaType).toBe("jpeg");
    // Iceland's real bounding box.
    expect(c.lat).toBeGreaterThan(63);
    expect(c.lat).toBeLessThan(67);
    expect(c.lon).toBeGreaterThan(-25);
    expect(c.lon).toBeLessThan(-13);
  }
});

test("maps Breidd→lat, Lengd→lon and uses the station's first view image", () => {
  const cams = normalizeIceland(fixture as never);
  const c = cams.find((x) => x.id === "iceland:7001")!;
  expect(c).toBeTruthy();
  expect(c.lat).toBeCloseTo(64.018296, 5);
  expect(c.lon).toBeCloseTo(-21.342636, 5);
  expect(c.lat).toBeGreaterThan(0); // northern hemisphere — fails if lat/lon swapped
  expect(c.lon).toBeLessThan(0);
  // First view of the station wins.
  expect(c.imageUrl).toBe("https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_1.jpg");
  expect(c.road).toBe("Hringvegur");
});

test("the licence is the operator's own CC BY 4.0", () => {
  const [c] = normalizeIceland(fixture as never);
  expect(c.license).toBe("CC BY 4.0 (Vegagerðin / IRCA)");
});
