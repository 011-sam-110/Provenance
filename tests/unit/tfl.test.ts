import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/tfl-place.json";
import { normalizeTfl, type TflPlace } from "@/lib/sources/tfl";
import { CameraArray } from "@/lib/types";

test("normalizes TfL places into valid Cameras", () => {
  const cams = normalizeTfl(fixture as TflPlace[]);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  expect(cams).toHaveLength(3);
});

test("maps id, coords, attribution and availability", () => {
  const [first, , offline] = normalizeTfl(fixture as TflPlace[]);
  expect(first.id).toBe("tfl:JamCams_00001.07450");
  expect(first.source).toBe("tfl");
  expect(first.country).toBe("GB");
  expect(first.name).toBe("A40 Westway/Woodger Rd");
  expect(first.imageUrl).toContain("00001.07450.jpg");
  expect(first.mediaType).toBe("both"); // has videoUrl
  expect(first.attribution).toBe("Powered by TfL Open Data");
  expect(first.refreshSeconds).toBe(300);
  expect(offline.available).toBe(false);
});

// The clip-size rule (audit 2026-10-16): TfL's `available` flag was wrong both ways,
// so a measured MP4 clip size decides when we have one. Sizes are real: 9,962 B was
// the "Camera 00001.06522 offline" card, 12,416 B an "in use keeping London moving"
// card on a camera flagged TRUE, 35,137 B the smallest live clip that night.
test("a measured clip size overrides TfL's flag in both directions", async () => {
  const { tflAvailable, TFL_CARD_MAX_CLIP_BYTES } = await import("@/lib/sources/tfl");
  expect(TFL_CARD_MAX_CLIP_BYTES).toBe(20_000);
  expect(tflAvailable(false, 35_137)).toBe(true); // flagged off, but a live picture
  expect(tflAvailable(true, 12_416)).toBe(false); // flagged on, but the "in use" card
  expect(tflAvailable(false, 9_962)).toBe(false); // the "offline" card
  // Not measured (or a nonsense size): the operator's flag stands.
  expect(tflAvailable(true, undefined)).toBe(true);
  expect(tflAvailable(false, undefined)).toBe(false);
  expect(tflAvailable(true, 0)).toBe(true);
});

test("normalizeTfl reads clip sizes by camera id and falls back to the flag", () => {
  const [first, , offline] = normalizeTfl(fixture as TflPlace[]);
  const clips = new Map([
    [first.id, 12_000], // a card behind a TRUE flag
    [offline.id, 140_000], // a live clip behind a FALSE flag
  ]);
  const [a, b, c] = normalizeTfl(fixture as TflPlace[], clips);
  expect(a.available).toBe(false);
  expect(c.available).toBe(true);
  // The middle camera has no measurement, so it keeps its flag unchanged.
  expect(b.available).toBe(normalizeTfl(fixture as TflPlace[])[1].available);
});
