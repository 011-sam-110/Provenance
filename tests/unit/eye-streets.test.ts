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
  streetFeatures,
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
    // Its one street is Closed, so every segment is a closed one: 16 of them, which
    // join end to end into one line (joinLines in lib/roads/tfl.ts).
    expect(lined.openLines).toEqual([]);
    expect(FIXTURE[0].streets[0].segments).toHaveLength(16);
    expect(lined.closedLines.length).toBe(1);
    for (const line of lined.closedLines) {
      expect(line.length).toBeGreaterThanOrEqual(2);
      for (const [lon, lat] of line) {
        expect(lat).toBeGreaterThan(51.4);
        expect(lon).toBeLessThan(0);
      }
    }
    expect(pointOnly.openLines).toEqual([]);
    expect(pointOnly.closedLines).toEqual([]);
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

  it("count what is on screen, of how many nearby, and credit TfL", () => {
    expect(streetsLedgerRow(2, 2)).toEqual({
      kind: "road",
      count: 2,
      label: "road disruptions",
      detail: TFL_CREDIT,
      short: "disruptions",
    });
    expect(streetsLedgerRow(3, 64).detail).toBe(`of 64 nearby · ${TFL_CREDIT}`);
    expect(streetsLedgerRow(1, 64).label).toBe("road disruption");
  });

  it("name TfL's newest change and the fetch apart, both in UTC", () => {
    const now = Date.parse("2026-10-27T06:00:00Z");
    const times = { changedAt: Date.parse("2026-10-27T05:45:12Z"), fetchedAt: Date.parse("2026-10-27T05:57:30Z"), now };
    expect(streetsLedgerRow(2, 66, times).detail).toBe(
      `of 66 nearby · TfL's newest change 05:45 UTC · fetched 05:57 UTC · ${TFL_CREDIT}`,
    );
    // An answer the server has held for 22 min says so: TfL down after a good answer.
    const stale = { ...times, now: Date.parse("2026-10-27T06:19:56Z") };
    expect(streetsLedgerRow(2, 66, stale).detail).toContain("fetched 05:57 UTC, 22 min ago");
    // A change on an earlier day names the day.
    const old = { ...times, changedAt: Date.parse("2026-10-26T15:59:00Z") };
    expect(streetsLedgerRow(2, 66, old).detail).toContain("TfL's newest change 26 Oct 15:59 UTC");
    // Unknown times are left out, never guessed.
    expect(streetsLedgerRow(2, 66, { changedAt: null, fetchedAt: null, now }).detail).toBe(`of 66 nearby · ${TFL_CREDIT}`);
  });

  it("say TfL is not answering, with no count, rather than 0", () => {
    expect(streetsDownRow()).toMatchObject({ kind: "road", count: null, detail: "TfL's feed is not answering" });
  });

  it("state that no speed is measured, and never show a count for it", () => {
    expect(speedLedgerRow(true)).toMatchObject({ kind: "speed", count: null, detail: "no open speed feed for London" });
    expect(speedLedgerRow(false).detail).toBe("not measured in this view");
    expect(speedPhoneNote(true)).toBe("No open road-speed feed for London");
    const now = Date.parse("2026-10-27T06:00:00Z");
    expect(speedPhoneNote(true, { changedAt: Date.parse("2026-10-27T05:45:00Z"), fetchedAt: Date.parse("2026-10-27T05:57:00Z"), now })).toBe(
      "No open road-speed feed for London · TfL notices: newest change 05:45 UTC · fetched 05:57 UTC",
    );
    expect(speedPhoneNote(false, { changedAt: now, fetchedAt: now, now })).toBe("Road speed is not measured in this view");
  });
});

describe("streetFeatures", () => {
  const [lined, pointOnly] = normalizeTflDisruptions(FIXTURE);

  it("paints a street TfL marks Closed as closed, and a point-only notice at its point", () => {
    const feats = streetFeatures([lined, pointOnly]);
    const lines = feats.filter((f) => f.geometry.type === "LineString");
    expect(lines).toHaveLength(1);
    expect(new Set(lines.map((f) => f.properties?.paint))).toEqual(new Set(["closed"]));
    const points = feats.filter((f) => f.geometry.type === "Point");
    expect(points).toHaveLength(1);
    expect(points[0].properties).toEqual({ id: "TIMS-236081", paint: "works", heavy: true });
    expect(points[0].geometry).toEqual({ type: "Point", coordinates: [pointOnly.lon, pointOnly.lat] });
  });

  it("carries severity as a flag for opacity, never as a width", () => {
    for (const f of streetFeatures([lined, pointOnly])) {
      expect(Object.keys(f.properties ?? {}).sort()).toEqual(["heavy", "id", "paint"]);
    }
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
