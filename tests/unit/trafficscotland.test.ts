import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/scotland.json";
import { normalizeTrafficScotland, extractScotlandImage } from "@/lib/sources/trafficscotland";
import { CameraArray } from "@/lib/types";

test("normalizes the Traffic Scotland list, skipping rows with a blank coordinate", () => {
  const cams = normalizeTrafficScotland(fixture as never);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  // 3 rows have coords; the synthetic id 99999 has lat:"" (which Number() would
  // turn into 0, NOT NaN) → must be skipped by the blank-string guard.
  expect(cams).toHaveLength(3);
  for (const c of cams) {
    expect(c.id.startsWith("trafficscotland:")).toBe(true);
    expect(c.source).toBe("trafficscotland");
    expect(c.country).toBe("GB");
    expect(c.mediaType).toBe("jpeg");
    // Scotland's real bounding box.
    expect(c.lat).toBeGreaterThan(54);
    expect(c.lat).toBeLessThan(61);
    expect(c.lon).toBeGreaterThan(-8);
    expect(c.lon).toBeLessThan(-1);
  }
});

test("parses string coords and points imageUrl at the per-camera HTML page", () => {
  const cams = normalizeTrafficScotland(fixture as never);
  const c = cams.find((x) => x.id === "trafficscotland:1")!;
  expect(c).toBeTruthy();
  expect(c.name).toBe("M8 Kingston Br");
  expect(c.region).toBe("Strathclyde");
  expect(c.road).toBe("M8");
  expect(c.lat).toBeCloseTo(55.852826, 5);
  expect(c.lon).toBeCloseTo(-4.2708061, 5);
  // The image is a base64 JPEG inside the camerahtml page; the proxy resolves it.
  expect(c.imageUrl).toBe("https://www.traffic.gov.scot/tsis/camerahtml?sid=1");
});

test("extractScotlandImage pulls the base64 JPEG out of the camera HTML", () => {
  const html =
    '<html><body><img src="/themes/logo.png"/>' +
    '<img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD="/>' +
    "</body></html>";
  const img = extractScotlandImage(html);
  expect(img).not.toBeNull();
  expect(img!.contentType).toBe("image/jpeg");
  expect(img!.base64).toBe("/9j/4AAQSkZJRgABAgAAAQABAAD=");
});

test("extractScotlandImage returns null when no embedded image is present", () => {
  expect(extractScotlandImage("<html><body>no image here</body></html>")).toBeNull();
});

// Audit 2026-10-16: 20% of sampled cameras served one byte-identical "Currently
// Unavailable" card while the adapter marked every camera available.
test("a camera last seen serving the operator's card is not available", async () => {
  const { isScotlandCard, SCOTLAND_CARD_MD5 } = await import("@/lib/sources/trafficscotland");
  expect(SCOTLAND_CARD_MD5).toMatch(/^[0-9a-f]{32}$/);
  expect(isScotlandCard(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(false);
  const cams = normalizeTrafficScotland(fixture as never, (id) => id === "trafficscotland:1");
  expect(cams.find((c) => c.id === "trafficscotland:1")!.available).toBe(false);
  expect(cams.filter((c) => c.id !== "trafficscotland:1").every((c) => c.available)).toBe(true);
});

test("the licence string no longer claims the Open Government Licence", () => {
  const [c] = normalizeTrafficScotland(fixture as never);
  expect(c.license).not.toMatch(/Open Government/i);
  expect(c.license).toMatch(/Crown copyright/);
});

test("the placeholder memo expires, so a camera that comes back is not held down", async () => {
  const m = await import("@/lib/sources/placeholderMemo");
  m.resetPlaceholderMemo();
  m.notePlaceholder("trafficscotland:9", true, 1_000);
  expect(m.showsPlaceholder("trafficscotland:9", 1_000 + 60_000)).toBe(true);
  expect(m.showsPlaceholder("trafficscotland:9", 1_000 + m.PLACEHOLDER_MEMORY_MS + 1)).toBe(false);
  m.notePlaceholder("trafficscotland:9", false, 2_000);
  expect(m.showsPlaceholder("trafficscotland:9", 3_000)).toBe(false);
  m.resetPlaceholderMemo();
});
