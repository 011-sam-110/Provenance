import { expect, test } from "vitest";
import {
  normalizeCetsp,
  snapshotUrl,
  MAX_SNAPSHOT_AGE_MS,
  CETSP_SOURCE,
  type SnapshotProbe,
} from "@/lib/sources/cetsp";
import { CETSP_CAMERAS } from "@/lib/sources/cetsp.data";
import { CameraArray } from "@/lib/types";
import { isAllowed } from "@/lib/proxy/allowlist";

const NOW = Date.UTC(2026, 7, 14, 0, 0, 0);
const fresh = (pasta: number, minsAgo = 1): SnapshotProbe => ({
  pasta,
  lastModifiedMs: NOW - minsAgo * 60_000,
});

test("normalizes into schema-valid Cameras", () => {
  const cams = normalizeCetsp(CETSP_CAMERAS.map((c) => fresh(c.pasta)), NOW);
  expect(cams.length).toBe(CETSP_CAMERAS.length);
  expect(() => CameraArray.parse(cams)).not.toThrow();
});

test("maps id, country, coords and image url", () => {
  const cams = normalizeCetsp([fresh(225)], NOW, [
    CETSP_CAMERAS.find((c) => c.pasta === 225)!,
  ]);
  const [cam] = cams;
  expect(cam.id).toBe("cetsp:225");
  expect(cam.source).toBe("cetsp");
  expect(cam.country).toBe("BR");
  expect(cam.region).toBe("São Paulo");
  expect(cam.lat).toBeCloseTo(-23.59765, 5);
  expect(cam.lon).toBeCloseTo(-46.65113, 5);
  expect(cam.imageUrl).toBe("https://cameras.cetsp.com.br/cams/225/1.jpg");
  expect(cam.mediaType).toBe("jpeg");
  expect(cam.attribution).toBe(CETSP_SOURCE.attribution);
});

// The reason this adapter exists. ~195 folders on that host serve HTTP 200 JPEGs
// that were last written between 2017 and 2025; pasta 22 has been static since
// 25 Feb 2026. Availability must come from the snapshot's age, not its status.
test("a stale snapshot is unavailable, however happily it serves HTTP 200", () => {
  const staleByADay = [{ pasta: 22, lastModifiedMs: NOW - 169 * 24 * 60 * 60_000 }];
  const [cam] = normalizeCetsp(staleByADay, NOW, [CETSP_CAMERAS.find((c) => c.pasta === 22)!]);
  expect(cam.available).toBe(false);
  expect(cam.lastSampledAt).toBe(new Date(NOW - 169 * 24 * 60 * 60_000).toISOString());
});

test("a fresh snapshot is available", () => {
  const [cam] = normalizeCetsp([fresh(180)], NOW, [CETSP_CAMERAS.find((c) => c.pasta === 180)!]);
  expect(cam.available).toBe(true);
});

test("the freshness boundary is inclusive on the fresh side", () => {
  const one = [CETSP_CAMERAS[0]];
  const atLimit = normalizeCetsp([{ pasta: one[0].pasta, lastModifiedMs: NOW - MAX_SNAPSHOT_AGE_MS }], NOW, one);
  const pastLimit = normalizeCetsp([{ pasta: one[0].pasta, lastModifiedMs: NOW - MAX_SNAPSHOT_AGE_MS - 1 }], NOW, one);
  expect(atLimit[0].available).toBe(true);
  expect(pastLimit[0].available).toBe(false);
});

test("a failed probe reports the camera unavailable, and does not drop it", () => {
  const cams = normalizeCetsp([{ pasta: 195, lastModifiedMs: null }], NOW, [
    CETSP_CAMERAS.find((c) => c.pasta === 195)!,
  ]);
  // Kept, so the coverage denominator stays "known" rather than quietly shrinking.
  expect(cams).toHaveLength(1);
  expect(cams[0].available).toBe(false);
  expect(cams[0].lastSampledAt).toBeUndefined();
});

test("a camera with no probe at all is unavailable rather than missing", () => {
  const cams = normalizeCetsp([], NOW, CETSP_CAMERAS);
  expect(cams).toHaveLength(CETSP_CAMERAS.length);
  expect(cams.every((c) => c.available === false)).toBe(true);
});

test("a future-dated Last-Modified reads as fresh, not as a huge negative age", () => {
  const one = [CETSP_CAMERAS[0]];
  const [cam] = normalizeCetsp([{ pasta: one[0].pasta, lastModifiedMs: NOW + 10 * 60_000 }], NOW, one);
  expect(cam.available).toBe(true);
});

test("every committed camera has plausible São Paulo coordinates", () => {
  // Guards the failure mode that produced two wrong rows during research: a bad
  // intersection match silently placing a camera in another part of the city.
  for (const cam of CETSP_CAMERAS) {
    expect(cam.lat).toBeGreaterThan(-24.1);
    expect(cam.lat).toBeLessThan(-23.3);
    expect(cam.lon).toBeGreaterThan(-46.9);
    expect(cam.lon).toBeLessThan(-46.3);
  }
});

test("pasta ids are unique", () => {
  const ids = CETSP_CAMERAS.map((c) => c.pasta);
  expect(new Set(ids).size).toBe(ids.length);
});

test("snapshot urls pass the media proxy allowlist", () => {
  for (const cam of CETSP_CAMERAS) {
    expect(isAllowed(new URL(snapshotUrl(cam.pasta)))).toBe(true);
  }
  // And the rule stays tight — not the whole host.
  expect(isAllowed(new URL("https://cameras.cetsp.com.br/View/Cam.aspx"))).toBe(false);
});
