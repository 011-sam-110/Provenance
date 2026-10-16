import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/vdot-cameras.json";
import { normalizeVdot } from "@/lib/sources/vdot";
import { isAllowed } from "@/lib/proxy/allowlist";
import { CameraArray } from "@/lib/types";

// Three rows captured 2026-10-16 from the 511 Virginia camera layer; the third has its
// geometry removed to check it is skipped.
test("normalizes the 511 Virginia layer and skips a feature with no geometry", () => {
  const cams = normalizeVdot(fixture as never);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  expect(cams).toHaveLength(2);
});

test("uses the numeric id, the description as name, and lon/lat order", () => {
  const [a, b] = normalizeVdot(fixture as never);
  expect(a.id).toBe("vdot:3958");
  expect(a.source).toBe("vdot");
  expect(a.region).toBe("Virginia");
  expect(a.name).toBe("University Drive and Sager Avenue");
  expect(a.lat).toBeCloseTo(38.84519, 5);
  expect(a.lon).toBeCloseTo(-77.3055, 4);
  expect(b.road).toBe("RT 50");
  expect(a.attribution).toContain("Virginia DOT");
});

test("stills only: the HLS stream is not taken", () => {
  for (const c of normalizeVdot(fixture as never)) {
    expect(c.streamUrl).toBeUndefined();
    expect(c.mediaType).toBe("jpeg");
  }
});

test("pre-resolves the redirecting thumb to the snapshot the proxy serves", () => {
  const [a] = normalizeVdot(fixture as never);
  expect(a.imageUrl).toBe("https://snapshot.vdotcameras.com/0i6a7bfbs60yq2lbgivq0b8xk3scij3c.png");
  expect(isAllowed(new URL(a.imageUrl!))).toBe(true);
});
