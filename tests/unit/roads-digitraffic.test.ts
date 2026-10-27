import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROAD_CLOSED_FI, normalizeDigitraffic, simplifyLine } from "@/lib/roads/digitraffic";
import { roadTitle } from "@/lib/signals/roads";

// Five verbatim messages of Fintraffic's Digitraffic traffic-message API (active only, no
// area geometry), recorded 27 Oct 2026 at 08:24 UTC:
//   roadWork      GUID50469553  road 11443 Nopontie, Hyvinkaa: bridge, ROAD_CLOSED, a line
//   roadWork      GUID50472796  road 2, Pori: buried cables, a point
//   roadWork      GUID50472782  road 51 Lansivayla, Helsinki: bridge, SINGLE_LANE_CLOSED, a line
//   announcement  GUID50472799  road 257, Pori: accident report, "Tie on suljettu liikenteeltä"
//   announcement  GUID50471971  road 1821, Turku: general announcement, a 143-point line
const FI = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/digitraffic-traffic-messages.json"), "utf8"));

describe("normalizeDigitraffic: Finland's traffic messages as road notices", () => {
  const [bridge, cables, lane] = normalizeDigitraffic(FI.roadWork);
  const [accident, general] = normalizeDigitraffic(FI.announcement);

  it("takes the words from Fintraffic's English codes, and its own last-change time", () => {
    expect(bridge).toMatchObject({
      id: "GUID50469553",
      kind: "works",
      category: "Road work",
      subCategory: "Bridge",
      severity: "Highest",
      street: "Road 11443",
      updated: "2026-08-25T06:40:20.738Z",
    });
    expect(cables).toMatchObject({ subCategory: "Buried cables", severity: "Low" });
    expect(accident).toMatchObject({ kind: "incident", category: "Traffic announcement", subCategory: "Accident report", severity: "Not stated" });
    expect(general.subCategory).toBe("General");
    expect(roadTitle(cables)).toBe("Buried cables, Road 2");
  });

  it("keeps Fintraffic's own Finnish location and title", () => {
    expect(cables.location).toBe(FI.roadWork.features[1].properties.announcements[0].location.description.split("\n")[0]);
    expect(cables.description).toBe(FI.roadWork.features[1].properties.announcements[0].title.trim());
  });

  it("is closed by ROAD_CLOSED, or by Fintraffic's own words on an announcement; a closed lane is not", () => {
    expect(bridge.closure).toBe("Closed");
    expect(bridge.closedLines.length).toBeGreaterThan(0);
    expect(bridge.openLines).toEqual([]);
    expect(lane.closure).toBeUndefined();
    expect(lane.openLines.length).toBeGreaterThan(0);
    const names = FI.announcement.features[0].properties.announcements[0].features.map((x: { name: string }) => x.name);
    expect(names).toContain(ROAD_CLOSED_FI);
    expect(accident.closure).toBe("Closed");
    expect(general.closure).toBeUndefined();
  });

  it("sends less than it reads: lines simplified to about 10 m, every point rounded", () => {
    const sent = general.openLines.reduce((n, l) => n + l.length, 0);
    expect(sent).toBeLessThan(143);
    expect(sent).toBeGreaterThanOrEqual(2);
    for (const [lon, lat] of general.openLines.flat()) {
      expect(Math.round(lon * 1e5) / 1e5).toBe(lon);
      expect(Math.round(lat * 1e5) / 1e5).toBe(lat);
    }
  });

  it("never throws, and drops what it cannot place", () => {
    expect(normalizeDigitraffic(null)).toEqual([]);
    expect(normalizeDigitraffic({ features: {} })).toEqual([]);
    expect(
      normalizeDigitraffic({
        features: [
          { geometry: { type: "Point", coordinates: [25, 60] }, properties: { situationId: "a" } },
          { geometry: null, properties: { situationId: "b", announcements: [{ language: "FI" }] } },
          { geometry: { type: "Point", coordinates: [25, 60] }, properties: { announcements: [{}] } },
        ],
      }),
    ).toEqual([]);
  });
});

describe("simplifyLine", () => {
  it("keeps both ends and drops points that lie on the line", () => {
    expect(simplifyLine([[0, 0], [0.5, 0], [1, 0]])).toEqual([[0, 0], [1, 0]]);
  });

  it("keeps a point that lies off the line by more than the tolerance", () => {
    expect(simplifyLine([[0, 0], [0.5, 0.01], [1, 0]])).toEqual([[0, 0], [0.5, 0.01], [1, 0]]);
    expect(simplifyLine([[0, 0], [0.5, 0.00005], [1, 0]])).toEqual([[0, 0], [1, 0]]);
  });
});
