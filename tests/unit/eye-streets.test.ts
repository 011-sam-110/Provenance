import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TFL_CREDIT,
  inLondon,
  normalizeTflDisruptions,
  severityWeight,
  speedLedgerRow,
  speedPhoneNote,
  streetTag,
  streetsBody,
  streetsDownRow,
  streetsLedgerRow,
} from "@/lib/eye/streets";

// Two verbatim rows of TfL's /Road/all/Disruption answer, recorded 24 Oct 2026 at
// about 22:00 UTC: one with street segments and a closed street, one point only.
const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/tfl-road-disruptions.json"), "utf8"));

describe("normalizeTflDisruptions", () => {
  const [lined, pointOnly] = normalizeTflDisruptions(FIXTURE);

  it("keeps TfL's own category, sub-category and severity", () => {
    expect(lined).toMatchObject({ id: "TIMS-236204", category: "Works", subCategory: "Utility works", severity: "Serious" });
    expect(lined.location).toContain("WANDSWORTH HIGH STREET");
  });

  it("places it at TfL's point, and draws TfL's street segments", () => {
    expect(lined.lat).toBeCloseTo(51.45711, 5);
    expect(lined.lon).toBeCloseTo(-0.194259, 6);
    expect(lined.lines.length).toBeGreaterThan(0);
    for (const line of lined.lines) {
      expect(line.length).toBeGreaterThanOrEqual(2);
      for (const [lon, lat] of line) {
        expect(lat).toBeGreaterThan(51.4);
        expect(lon).toBeLessThan(0);
      }
    }
    expect(pointOnly.lines).toEqual([]);
  });

  it("reads a closure from the street, where TfL's own flag says none", () => {
    expect(FIXTURE[0].hasClosures).toBe(false);
    expect(lined.closure).toBe("Closed, southbound");
    expect(pointOnly.closure).toBeUndefined();
  });

  it("drops what it cannot place, and never throws", () => {
    expect(normalizeTflDisruptions(null)).toEqual([]);
    expect(normalizeTflDisruptions({ not: "a list" })).toEqual([]);
    expect(
      normalizeTflDisruptions([
        { id: "a", point: "not json" },
        { id: "b", point: "[200, 95]" },
        { point: "[-0.1, 51.5]" },
        { id: "c", point: "[-0.1, 51.5]", streets: [{ segments: [{ lineString: "[[1]]" }] }] },
      ]).map((d) => d.id),
    ).toEqual(["c"]);
  });
});

describe("the words", () => {
  it("tag a disruption with TfL's words and nothing that reads as a speed", () => {
    const [lined, pointOnly] = normalizeTflDisruptions(FIXTURE);
    expect(streetTag(lined)).toEqual({ title: "Utility works", meta: "Serious · Closed, southbound" });
    const t = streetTag(pointOnly);
    expect(`${t.title} ${t.meta}`).not.toMatch(/mph|km\/h|speed|slow|fast|flow/i);
  });

  it("weigh the line by TfL's severity", () => {
    expect(severityWeight("Serious")).toBe(3);
    expect(severityWeight("Moderate")).toBe(2);
    expect(severityWeight("Minimal")).toBe(1);
    expect(severityWeight("No impact")).toBe(0.5);
  });

  it("count what is on screen, of how many nearby, and credit TfL with the cadence", () => {
    expect(streetsLedgerRow(2, 2)).toEqual({
      kind: "road",
      count: 2,
      label: "road disruptions",
      detail: `${TFL_CREDIT}, every 2 min`,
      short: "disruptions",
    });
    expect(streetsLedgerRow(3, 64).detail).toBe(`of 64 nearby · ${TFL_CREDIT}, every 2 min`);
    expect(streetsLedgerRow(1, 64).label).toBe("road disruption");
  });

  it("say TfL is not answering, with no count, rather than 0", () => {
    expect(streetsDownRow()).toMatchObject({ kind: "road", count: null, detail: "TfL's feed is not answering" });
  });

  it("state that no speed is measured, and never show a count for it", () => {
    expect(speedLedgerRow(true)).toMatchObject({ kind: "speed", count: null, detail: "no open speed feed for London" });
    expect(speedLedgerRow(false).detail).toBe("not measured in this view");
    expect(speedPhoneNote(true)).toBe("No open road-speed feed for London");
  });
});

describe("the route's body", () => {
  it("carries an absolute fetch time, so a cached copy still says its age", () => {
    const body = JSON.parse(streetsBody([], 1_792_876_905_714));
    expect(body).toEqual({ ok: true, credit: TFL_CREDIT, fetchedAt: 1_792_876_905_714, count: 0, features: [] });
  });
});

describe("inLondon", () => {
  it("is true for the presets and false for Paris", () => {
    expect(inLondon(51.5013, -0.1218)).toBe(true);
    expect(inLondon(51.5062, -0.0772)).toBe(true);
    expect(inLondon(48.8584, 2.2945)).toBe(false);
  });
});
