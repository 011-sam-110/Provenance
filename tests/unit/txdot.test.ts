import { describe, expect, test } from "vitest";
import fixture from "@/tests/fixtures/txdot-elp.json";
import {
  TXDOT_DISTRICTS,
  extractTxdotSnapshot,
  normalizeTxdot,
  snapshotUrl,
} from "@/lib/sources/txdot";
import { isAllowed } from "@/lib/proxy/allowlist";
import { CameraArray } from "@/lib/types";

// Five cameras from the El Paso district, captured 2026-10-16: three online, two offline.
describe("normalizeTxdot", () => {
  test("normalizes every captured camera into a valid Camera", () => {
    const cams = normalizeTxdot(fixture as never, "ELP");
    expect(() => CameraArray.parse(cams)).not.toThrow();
    expect(cams).toHaveLength(5);
  });

  test("keys a camera by district and icd_Id, and keeps latitude as latitude", () => {
    const [a] = normalizeTxdot(fixture as never, "ELP");
    expect(a.id).toBe("txdot:ELP:Airport @ Founders");
    expect(a.source).toBe("txdot");
    expect(a.region).toBe("Texas");
    expect(a.lat).toBeCloseTo(31.817401, 6);
    expect(a.lon).toBeCloseTo(-106.404614, 6);
    expect(a.road).toBeTruthy();
  });

  test("an offline device is shown but not called online", () => {
    const cams = normalizeTxdot(fixture as never, "ELP");
    expect(cams.filter((c) => c.available)).toHaveLength(3);
    expect(cams.find((c) => c.id === "txdot:ELP:Airport @ Leigh Fisher")?.available).toBe(false);
  });

  test("the picture is the snapshot endpoint, encoded, and the proxy accepts it", () => {
    const [a] = normalizeTxdot(fixture as never, "ELP");
    expect(a.imageUrl).toBe(
      "https://its.txdot.gov/its/DistrictIts/GetCctvSnapshotByIcdId?icdId=Airport%20%40%20Founders&districtCode=ELP",
    );
    expect(new URL(a.imageUrl!).searchParams.get("icdId")).toBe("Airport @ Founders");
    expect(isAllowed(new URL(a.imageUrl!))).toBe(true);
  });

  test("a camera listed under two roadways is served once", () => {
    const body = fixture as unknown as { roadwayCctvStatuses: Record<string, unknown[]> };
    const first = Object.values(body.roadwayCctvStatuses)[0][0];
    const doubled = { roadwayCctvStatuses: { ...body.roadwayCctvStatuses, Extra: [first] } };
    expect(normalizeTxdot(doubled as never, "ELP")).toHaveLength(5);
  });

  test("skips a camera without a snapshot or with no coordinate", () => {
    const body = { roadwayCctvStatuses: { X: [
      { icd_Id: "a", latitude: 31, longitude: -106, hasSnapshot: false },
      { icd_Id: "b", latitude: 0, longitude: 0, hasSnapshot: true },
      { icd_Id: "c", hasSnapshot: true },
    ] } };
    expect(normalizeTxdot(body, "ELP")).toEqual([]);
  });
});

describe("the Houston network", () => {
  // Its snapshots answer a bare null (8 of 8 samples, 2026-10-16); TranStar serves it.
  test("cameras on the HOUSTON network are left out, others kept", () => {
    const body = { roadwayCctvStatuses: { X: [
      { icd_Id: "h", latitude: 29.76, longitude: -95.37, hasSnapshot: true, netId: "HOUSTON" },
      { icd_Id: "b", latitude: 30.08, longitude: -94.1, hasSnapshot: true, netId: "HOU2" },
    ] } };
    expect(normalizeTxdot(body, "BMT").map((c) => c.id)).toEqual(["txdot:BMT:b"]);
  });
});

describe("extractTxdotSnapshot", () => {
  test("decodes a base64 JPEG", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]).toString("base64");
    const out = extractTxdotSnapshot({ icd_Id: "x", snippet: jpeg, timestampFormatted: "10/16/2026 3:41 PM" });
    expect(out?.contentType).toBe("image/jpeg");
    expect(Buffer.from(out!.base64, "base64")[0]).toBe(0xff);
  });

  test("returns null for an answer with no picture in it", () => {
    expect(extractTxdotSnapshot({ snippet: null })).toBeNull();
    expect(extractTxdotSnapshot({ snippet: "<html>error</html>" })).toBeNull();
    expect(extractTxdotSnapshot(null)).toBeNull();
    expect(extractTxdotSnapshot({ snippet: "QUJDREVGR0hJSktMTU5PUA==" })).toBeNull(); // base64, not an image
  });
});

test("asks every district the ITS page lists, once", () => {
  expect(TXDOT_DISTRICTS).toHaveLength(25);
  expect(new Set(TXDOT_DISTRICTS).size).toBe(25);
  expect(TXDOT_DISTRICTS).toContain("HOU");
  expect(snapshotUrl("DAL", "IH20 @ X")).toContain("districtCode=DAL");
});
