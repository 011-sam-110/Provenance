import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SPEED_BANDS, joinSpeeds, parseHkSpeeds, speedBand, type SegmentLine } from "@/lib/roads/hk-speed";
import { ROAD_SPEED_SOURCE, roadSpeedFeatures } from "@/lib/signals/road-speed";
import { MAP_SIGNALS } from "@/lib/signals/registry";
import HK from "@/lib/roads/hk-irn-segments.data.json";

// The head of the Transport Department's segment speed file (irnAvgSpeed-all.xml), read
// 27 Oct 2026 at 16:43 Hong Kong time: six verbatim segments, one of them marked invalid
// (105697, valid N), and one segment (261330) the committed lines file has no line for.
const XML = readFileSync(resolve(__dirname, "../fixtures/hk-irn-speeds.xml"), "utf8");
const SEGMENTS = (HK as unknown as { segments: Record<string, SegmentLine> }).segments;

describe("parseHkSpeeds", () => {
  const file = parseHkSpeeds(XML)!;

  it("reads the file's one time as Hong Kong time", () => {
    expect(new Date(file.at).toISOString()).toBe("2026-10-27T08:43:00.000Z");
    expect(file.irnVersion).toBe("20221210");
  });

  it("keeps only the readings the Department marks valid", () => {
    expect(file.readings.map((r) => r.id)).toEqual(["103495", "105500", "105543", "106257", "106550", "261330"]);
    expect(file.invalid).toBe(1);
    expect(file.readings[0].kmh).toBe(74);
  });

  it("is null for anything that is not the speed file", () => {
    expect(parseHkSpeeds("<html></html>")).toBeNull();
    expect(parseHkSpeeds(null)).toBeNull();
  });
});

describe("the speed bands", () => {
  it("are design A's three, and none is red", () => {
    expect(SPEED_BANDS.map((b) => b.color)).toEqual(["#4ade80", "#facc15", "#f97316"]);
    expect(speedBand(74).band).toBe("hi");
    expect(speedBand(70).band).toBe("hi");
    expect(speedBand(44.7).band).toBe("mid");
    expect(speedBand(35.2).band).toBe("lo");
    expect(speedBand(0).band).toBe("lo");
  });
});

describe("the committed lines", () => {
  it("hold a line for nearly every segment the Department measures", () => {
    const meta = HK as unknown as { irnVersion: string; speedSegments: number; withLine: number };
    expect(meta.irnVersion).toBe("20221210");
    expect(meta.withLine / meta.speedSegments).toBeGreaterThan(0.99);
    for (const s of Object.values(SEGMENTS).slice(0, 200)) {
      for (const [lon, lat] of s.c.flat()) {
        expect(lon).toBeGreaterThan(113.8);
        expect(lon).toBeLessThan(114.5);
        expect(lat).toBeGreaterThan(22.1);
        expect(lat).toBeLessThan(22.6);
      }
    }
  });
});

describe("the measured speed layer", () => {
  const file = parseHkSpeeds(XML)!;
  const feats = roadSpeedFeatures(file, SEGMENTS);

  it("draws each valid reading that has a line, as a solid speed line in its band's colour", () => {
    expect(feats.map((f) => f.id)).toEqual(["hk:103495", "hk:105500", "hk:105543", "hk:106257", "hk:106550"]);
    for (const f of feats) {
      expect(f.line).toBe("speed");
      expect(f.geometry?.type).toBe("LineString");
    }
    expect(feats[0].color).toBe("#4ade80");
    expect(feats[1].color).toBe("#f97316");
    expect(feats[2].color).toBe("#facc15");
  });

  it("names the street, says the speed and its time, and credits the Department", () => {
    expect(feats[1].title).toBe("35 km/h, HOI WANG ROAD");
    // The network's "-99" is no name, so that segment's label is its speed alone.
    expect(feats[0].title).toBe("74 km/h");
    expect(feats[1].props).toEqual({ speed: "35.2 km/h (under 40 km/h)", segment: "105500", street: "HOI WANG ROAD" });
    expect(feats[1].ts).toBe("2026-10-27T08:43:00.000Z");
    expect(joinSpeeds(file, {})).toEqual([]);
  });

  it("is a map layer in the Roads group, credited as the terms ask", () => {
    expect(MAP_SIGNALS).toContain(ROAD_SPEED_SOURCE);
    expect(ROAD_SPEED_SOURCE.group).toBe("Roads");
    expect(ROAD_SPEED_SOURCE.attribution).toContain("Transport Department, HKSAR Government, via DATA.GOV.HK");
    expect(ROAD_SPEED_SOURCE.attribution).toContain("via the CSDI Portal");
  });
});
