import { expect, test } from "vitest";
import {
  normalizeActPr,
  resolveImageUrl,
  MAX_FRAME_AGE_MS,
  ACT_PR_SOURCE,
  type ActPrRow,
  type ActPrProbe,
} from "@/lib/sources/actpr";
import { CameraArray } from "@/lib/types";
import { isAllowed } from "@/lib/proxy/allowlist";

const NOW = Date.UTC(2026, 7, 20, 13, 0, 0);
const fresh = (id: string, minsAgo = 1): ActPrProbe => ({
  id,
  lastModifiedMs: NOW - minsAgo * 60_000,
});

// Rows exactly as ACT publishes them, including the one whose LocationEn is just
// the internal code again and the one with no route ref in its label.
const ROWS: ActPrRow[] = [
  {
    Id: 13,
    Name: "26-0.7_02 MD-IPV",
    LocationEn: "PR-26 Miramar ",
    LocationEs: "Miramar PR-26",
    Latitude: 18.456976,
    Longitude: -66.080456,
    ImageUrl: "/images/cameras/26-0.7_02_MD-IPV.jpg",
  },
  {
    Id: 14,
    Name: "26-0.1_01 MD-IPV",
    LocationEn: "26-0.1_01 MD-IPV",
    Latitude: 18.458411,
    Longitude: -66.085735,
    ImageUrl: "/images/cameras/26-0.1_01_MD-IPV.jpg",
  },
  {
    Id: 68,
    Name: "SAN JUAN-CAM 07",
    LocationEn: "ISLET OF SAN JUAN ENTRANCE (DOS HERMANOS)",
    Latitude: 18.4589,
    Longitude: -66.0913,
    ImageUrl: "/images/cameras/SJCAM07.jpg",
  },
];

test("normalizes into schema-valid Cameras", () => {
  const cams = normalizeActPr(ROWS, ROWS.map((r) => fresh(String(r.Id))), NOW);
  expect(cams.length).toBe(3);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  expect(cams.every((c) => c.country === "PR")).toBe(true);
});

test("maps id, coords, image url and the route ref off the operator's label", () => {
  const [cam] = normalizeActPr([ROWS[0]], [fresh("13")], NOW);
  expect(cam.id).toBe("act-pr:13");
  expect(cam.source).toBe("act-pr");
  expect(cam.region).toBe("Puerto Rico");
  expect(cam.name).toBe("PR-26 Miramar"); // trailing space trimmed
  expect(cam.lat).toBeCloseTo(18.456976, 6);
  expect(cam.lon).toBeCloseTo(-66.080456, 6);
  expect(cam.road).toBe("PR-26");
  expect(cam.imageUrl).toBe("https://its.act.pr.gov/images/cameras/26-0.7_02_MD-IPV.jpg");
  expect(cam.attribution).toBe(ACT_PR_SOURCE.attribution);
});

test("a label with no route ref leaves road undefined rather than inventing one", () => {
  const [cam] = normalizeActPr([ROWS[2]], [fresh("68")], NOW);
  expect(cam.name).toBe("ISLET OF SAN JUAN ENTRANCE (DOS HERMANOS)");
  expect(cam.road).toBeUndefined();
});

// Measured 2026-08-20: this camera's last frame was 209 hours old while the other
// thirty were under a minute, and IIS served all of them HTTP 200.
test("a stale frame is unavailable, however happily it serves HTTP 200", () => {
  const cams = normalizeActPr(ROWS, [fresh("13"), { id: "68", lastModifiedMs: NOW - 209 * 60 * 60_000 }], NOW);
  expect(cams.find((c) => c.id === "act-pr:68")!.available).toBe(false);
  expect(cams.find((c) => c.id === "act-pr:13")!.available).toBe(true);
});

// One ACT still answers HTTP 500 today. That must cost one camera, not the feed.
test("a camera we could not probe at all is unavailable and undated", () => {
  const cam = normalizeActPr([ROWS[1]], [], NOW)[0];
  expect(cam.available).toBe(false);
  expect(cam.lastSampledAt).toBeUndefined();
});

test("the freshness boundary is inclusive on the fresh side", () => {
  const at = normalizeActPr([ROWS[0]], [{ id: "13", lastModifiedMs: NOW - MAX_FRAME_AGE_MS }], NOW);
  const past = normalizeActPr([ROWS[0]], [{ id: "13", lastModifiedMs: NOW - MAX_FRAME_AGE_MS - 1 }], NOW);
  expect(at[0].available).toBe(true);
  expect(past[0].available).toBe(false);
});

test("a future-dated frame reads as fresh rather than as a huge negative age", () => {
  const [cam] = normalizeActPr([ROWS[0]], [{ id: "13", lastModifiedMs: NOW + 60_000 }], NOW);
  expect(cam.available).toBe(true);
});

// The guard that exists because a lat/lon swap produces a VALID coordinate. Left
// unchecked, this San Juan camera lands in the South Atlantic and every range
// assertion in lib/types.ts still passes.
test("a latitude/longitude swap is rejected instead of pinning the Atlantic", () => {
  const swapped: ActPrRow = { ...ROWS[0], Latitude: -66.080456, Longitude: 18.456976 };
  expect(normalizeActPr([swapped], [fresh("13")], NOW)).toEqual([]);
});

test("rows with unusable or missing coordinates are dropped", () => {
  const rows: ActPrRow[] = [
    { ...ROWS[0], Id: 90, Latitude: undefined },
    { ...ROWS[0], Id: 91, Longitude: "not a number" },
    { ...ROWS[0], Id: 92, Latitude: 0, Longitude: 0 },
  ];
  expect(normalizeActPr(rows, [], NOW)).toEqual([]);
});

test("a duplicate id is taken once", () => {
  expect(normalizeActPr([ROWS[0], ROWS[0]], [fresh("13")], NOW).length).toBe(1);
});

test("a row with neither a location nor a name is dropped", () => {
  const nameless: ActPrRow = { ...ROWS[0], Id: 99, LocationEn: "  ", Name: "" };
  expect(normalizeActPr([nameless], [], NOW)).toEqual([]);
});

test("a non-array payload yields no cameras rather than throwing", () => {
  expect(normalizeActPr(undefined as unknown as ActPrRow[], [], NOW)).toEqual([]);
});

// The source policy, as code: ACT's attribution may only ever be attached to
// ACT's own pictures.
test("only ACT's own host is accepted as an image origin", () => {
  expect(resolveImageUrl("/images/cameras/x.jpg")).toBe(
    "https://its.act.pr.gov/images/cameras/x.jpg",
  );
  expect(resolveImageUrl("https://its.act.pr.gov/images/cameras/x.jpg")).toBe(
    "https://its.act.pr.gov/images/cameras/x.jpg",
  );
  expect(resolveImageUrl("https://traffic-cams.com/pr/x.jpg")).toBeNull();
  expect(resolveImageUrl("http://its.act.pr.gov/images/cameras/x.jpg")).toBeNull();
  expect(resolveImageUrl("https://64.185.202.41/images/cameras/x.jpg")).toBeNull();
  expect(resolveImageUrl(undefined)).toBeNull();
  expect(resolveImageUrl("   ")).toBeNull();
});

test("a row pointing off-host is dropped rather than republished under ACT", () => {
  const relayed: ActPrRow = { ...ROWS[0], ImageUrl: "https://traffic-cams.com/pr/13.jpg" };
  expect(normalizeActPr([relayed], [fresh("13")], NOW)).toEqual([]);
});

test("every emitted image url is proxy-allowed", () => {
  const cams = normalizeActPr(ROWS, ROWS.map((r) => fresh(String(r.Id))), NOW);
  expect(cams.length).toBeGreaterThan(0);
  for (const cam of cams) expect(isAllowed(new URL(cam.imageUrl!))).toBe(true);
  // And the rule stays tight: the portal itself is not a camera.
  expect(isAllowed(new URL("https://its.act.pr.gov/es/Default.aspx"))).toBe(false);
});
