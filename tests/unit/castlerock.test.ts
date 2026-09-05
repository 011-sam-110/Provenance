import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/castlerock.json";
import laFixture from "@/tests/fixtures/castlerock-la.json";
import {
  normalizeCastleRock,
  parseWktPoint,
  pageStarts,
  CASTLEROCK_SYSTEMS,
} from "@/lib/sources/castlerock";
import { CameraArray } from "@/lib/types";

const FL = CASTLEROCK_SYSTEMS.find((s) => s.system === "fl")!;
const ON = CASTLEROCK_SYSTEMS.find((s) => s.system === "on")!;
const LA = CASTLEROCK_SYSTEMS.find((s) => s.system === "la")!;

test("parseWktPoint reads 'POINT (lon lat)' as longitude-first", () => {
  const pt = parseWktPoint("POINT (-80.892882 26.17325)");
  expect(pt).not.toBeNull();
  expect(pt!.lon).toBeCloseTo(-80.892882, 5);
  expect(pt!.lat).toBeCloseTo(26.17325, 5);
  expect(parseWktPoint("not wkt")).toBeNull();
  expect(parseWktPoint(null)).toBeNull();
});

test("normalizes Castle Rock records, skipping null-geometry and image-less ones", () => {
  const cams = normalizeCastleRock(fixture as never, FL);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  expect(cams).toHaveLength(2); // id 99 (null latLng) + id 100 (no images) are skipped
});

test("maps namespaced id, region, road, snapshot URL, media type and availability", () => {
  const [a, b] = normalizeCastleRock(fixture as never, FL);
  expect(a.id).toBe("castlerock:fl:1");
  expect(a.source).toBe("castlerock");
  expect(a.country).toBe("US");
  expect(a.region).toBe("Florida");
  expect(a.road).toBe("I-75");
  expect(a.direction).toBe("Northbound");
  expect(a.imageUrl).toBe("https://fl511.com/map/Cctv/1");
  expect(a.mediaType).toBe("jpeg"); // auth-gated video is intentionally dropped
  expect(a.available).toBe(true);
  expect(b.id).toBe("castlerock:fl:3");
  expect(b.available).toBe(false); // image is blocked
});

test("attribution is present and credits the operating agency", () => {
  const [a] = normalizeCastleRock(fixture as never, FL);
  expect(a.attribution.length).toBeGreaterThan(0);
  expect(a.attribution).toContain("Florida");
  expect(a.license.length).toBeGreaterThan(0);
});

// The load-bearing assertion: WKT is lon-first, so a correct adapter must place
// 26.17 in `lat` and -80.89 in `lon`. If the two were swapped, `lat` would be
// -80.89 (still a *valid* latitude, so the zod schema would NOT catch it) and
// `lon` would be +26.17 — both of the assertions below would then fail.
test("assigns lat/lon in the correct order (fails loudly if swapped)", () => {
  const [a] = normalizeCastleRock(fixture as never, FL);
  expect(a.lat).toBeCloseTo(26.17325, 4);
  expect(a.lon).toBeCloseTo(-80.892882, 4);
  // Florida is in the northern, western hemisphere: a swap would invert both signs.
  expect(a.lat).toBeGreaterThan(0);
  expect(a.lon).toBeLessThan(0);
});

// The endpoint caps each response at 100 rows, so fetchRegistry pages by `start`.
// pageStarts yields the offsets needed AFTER page 0 to cover the reported total.
test("pageStarts walks 100-row pages after page 0, capped for safety", () => {
  expect(pageStarts(57)).toEqual([]); // a single 100-row page already covers it
  expect(pageStarts(100)).toEqual([]); // exactly one full page → no extra fetches
  expect(pageStarts(250)).toEqual([100, 200]); // page0 + two more = 0..249
  expect(pageStarts(4881)).toHaveLength(48); // FL: page0 + 48 pages = 49 → 4900 ≥ 4881
  expect(pageStarts(4881)[0]).toBe(100);
  expect(pageStarts(4881).at(-1)).toBe(4800);
  // A bogus huge total can't loop us forever: capped at MAX_PAGES_PER_SYSTEM-1.
  expect(pageStarts(10_000_000).length).toBe(119);
});

test("the same record set re-namespaces and re-flags country per system", () => {
  const [a] = normalizeCastleRock(fixture as never, ON);
  expect(a.id).toBe("castlerock:on:1"); // namespace switches with the system
  expect(a.country).toBe("CA"); // Canadian systems map to CA, US systems to US
  expect(a.imageUrl).toBe("https://511on.ca/map/Cctv/1"); // snapshot host follows the site
});

// ── Louisiana (511la.org), added 2026-09-05 ────────────────────────────────────
// The fixture is two VERBATIM rows from a live `POST /List/GetData/Cameras`, kept
// so the "it is the same Castle Rock software" claim is checked rather than
// asserted. It was first shipped as a separate `la511` adapter aimed at a
// non-existent `POST https://511la.org/cctv` (that path 302s to /NotFound), and
// described as Los Angeles. Both of those are what these tests exist to stop.
test("Louisiana rides the existing Castle Rock adapter, not a module of its own", () => {
  const cams = normalizeCastleRock(laFixture as never, LA);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  expect(cams).toHaveLength(2);

  const [a] = cams;
  expect(a.id).toBe("castlerock:la:1");
  expect(a.source).toBe("castlerock"); // NOT a "la511" source id
  expect(a.imageUrl).toBe("https://511la.org/map/Cctv/1");
  expect(a.road).toBe("I-20");
  expect(a.name).toBe("I-20 at I-220 Off Ramp");
  expect(a.mediaType).toBe("jpeg"); // LADOTD's HLS is open, but we still ship the still
});

// The rows carry `state: null`, so `region` can only come from the system table.
// This is the assertion that fails if anyone re-reads "LA" as Los Angeles: a
// California label here would be wrong by ~2,000 km and nothing else would catch it.
test("Louisiana is Louisiana, not Los Angeles", () => {
  const [a] = normalizeCastleRock(laFixture as never, LA);
  expect(LA.site).toBe("511la.org");
  expect(a.country).toBe("US");
  expect(a.region).toBe("Louisiana");
  expect(a.region).not.toBe("California");
  // Shreveport, LA. California would put lon near -118 and lat near 34.
  expect(a.lat).toBeCloseTo(32.538889, 4);
  expect(a.lon).toBeCloseTo(-93.630833, 4);
});

// 336 rows over a 100-row cap = page 0 plus three more.
test("Louisiana's measured total pages correctly", () => {
  expect(pageStarts(336)).toEqual([100, 200, 300]);
});
