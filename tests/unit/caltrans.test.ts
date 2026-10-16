import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/caltrans-d11.json";
import { districtStatusUrl, normalizeCaltrans } from "@/lib/sources/caltrans";
import { CameraArray } from "@/lib/types";

test("normalizes Caltrans records into valid Cameras and skips no-media records", () => {
  const cams = normalizeCaltrans(fixture as never, 11);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  expect(cams).toHaveLength(2); // record 3 has no image and no stream
});

test("maps id, region, media type, availability and refresh", () => {
  const [a, b] = normalizeCaltrans(fixture as never, 11);
  expect(a.id).toBe("caltrans:d11-1");
  expect(a.country).toBe("US");
  expect(a.region).toBe("California");
  expect(a.mediaType).toBe("both"); // has a stream
  expect(a.available).toBe(true);
  expect(a.road).toBe("SR-163");
  expect(a.refreshSeconds).toBe(120); // 2 minutes * 60
  expect(b.mediaType).toBe("jpeg"); // empty streamingVideoURL
  expect(b.available).toBe(false);
});

// The folder is unpadded and the file name is not. The unpadded file name answers 500
// for D1-D9, which cost prod three quarters of California (2026-10-16 audit).
test("builds the two-digit status file name inside the unpadded district folder", () => {
  expect(districtStatusUrl(1)).toBe("https://cwwp2.dot.ca.gov/data/d1/cctv/cctvStatusD01.json");
  expect(districtStatusUrl(9)).toBe("https://cwwp2.dot.ca.gov/data/d9/cctv/cctvStatusD09.json");
  expect(districtStatusUrl(12)).toBe("https://cwwp2.dot.ca.gov/data/d12/cctv/cctvStatusD12.json");
});
