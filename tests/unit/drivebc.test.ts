import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/drivebc.json";
import { normalizeDriveBc } from "@/lib/sources/drivebc";
import { CameraArray } from "@/lib/types";

test("normalizes DriveBC webcams into valid Camera[], skipping null-location rows", () => {
  const cams = normalizeDriveBc(fixture as never);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  // 717, 580, 927, 301 map; 99999 (null location) is skipped.
  expect(cams).toHaveLength(4);
  for (const c of cams) {
    expect(c.id.startsWith("drivebc:")).toBe(true);
    expect(c.source).toBe("drivebc");
    expect(c.country).toBe("CA");
    expect(c.mediaType).toBe("jpeg");
    expect(c.attribution.length).toBeGreaterThan(0);
    expect(c.license.length).toBeGreaterThan(0);
    // Every camera should sit inside British Columbia's real bounding box.
    expect(c.lat).toBeGreaterThan(48);
    expect(c.lat).toBeLessThan(60);
    expect(c.lon).toBeGreaterThan(-139);
    expect(c.lon).toBeLessThan(-114);
  }
});

test("maps coordinates as [lon, lat] (would FAIL if swapped), builds image URL, namespaces id", () => {
  const cams = normalizeDriveBc(fixture as never);
  const c = cams.find((x) => x.id === "drivebc:717")!;
  expect(c).toBeTruthy();
  expect(c.name).toBe("Hwy 17 at 52 Street - E");
  expect(c.region).toBe("Lower Mainland");
  expect(c.road).toBe("17");
  expect(c.direction).toBe("E");

  // --- lon/lat swap guard -------------------------------------------------
  // Fixture coords are [-123.079678, 49.037442] = [lon, lat]. Correct mapping
  // puts a small positive value in lat and a large negative value in lon. If the
  // adapter swapped them, lat would become -123 (BC is northern hemisphere) and
  // lon would become +49 — each of these assertions then fails.
  expect(c.lat).toBeCloseTo(49.037442, 5);
  expect(c.lon).toBeCloseTo(-123.079678, 5);
  expect(c.lat).toBeGreaterThan(0); // fails if lat/lon swapped
  expect(c.lon).toBeLessThan(-100); // fails if lat/lon swapped

  // Origin-prefixed, cache-bust query stripped.
  expect(c.imageUrl).toBe("https://www.drivebc.ca/images/717.jpg");
});

test("respects marked_stale / freshness flags via available", () => {
  const cams = normalizeDriveBc(fixture as never);
  const healthy = cams.find((x) => x.id === "drivebc:717")!;
  const stale = cams.find((x) => x.id === "drivebc:580")!;
  expect(healthy.available).toBe(true);
  // 580 is marked_stale: true — still present, but flagged not-live.
  expect(stale.available).toBe(false);
});

test("prefers name_override over the raw name", () => {
  const cams = normalizeDriveBc(fixture as never);
  const c = cams.find((x) => x.id === "drivebc:301")!;
  expect(c.name).toBe("Pine Pass Summit");
});

// Audit 2026-10-16: the per-camera `credit` was ignored, so the 8 TransLink cameras
// carried MoTI-only attribution, and the operator's last-frame time was dropped.
// The credit strings below are verbatim from /api/webcams/ that day.
test("an image-owner credit joins the attribution; a delay notice does not", async () => {
  const { imageCredit } = await import("@/lib/sources/drivebc");
  expect(imageCredit('Images courtesy of <a href="https://www.translink.ca/" target="_blank">TransLink</a>')).toBe(
    "Images courtesy of TransLink",
  );
  expect(imageCredit("Images provided by Parks Canada and Alberta Motor Association.")).toBe(
    "Images provided by Parks Canada and Alberta Motor Association",
  );
  expect(
    imageCredit(
      "This camera is located in a remote area and relies on solar power. As a result, transmission delays may occur. Thank you for your understanding.",
    ),
  ).toBeUndefined();
  expect(imageCredit("")).toBeUndefined();
  expect(imageCredit(null)).toBeUndefined();

  const base = (fixture as Array<Record<string, unknown>>).find((w) => w.id === 717)!;
  const [cam] = normalizeDriveBc([
    {
      ...base,
      credit: 'Images courtesy of <a href="https://www.translink.ca/">TransLink</a>',
      last_update_modified: "2026-10-16T13:40:55-07:00",
    },
  ] as never);
  expect(cam.attribution).toMatch(/DriveBC/);
  expect(cam.attribution).toMatch(/Images courtesy of TransLink$/);
  expect(cam.lastSampledAt).toBe("2026-10-16T20:40:55.000Z");
});
