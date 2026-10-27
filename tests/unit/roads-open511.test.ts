import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { codeWords, normalizeOpen511, open511Kind } from "@/lib/roads/open511";
import { roadTitle } from "@/lib/signals/roads";

// Four verbatim events of DriveBC's Open511 answer (api.open511.gov.bc.ca/events, active),
// recorded 27 Oct 2026 at 07:56 UTC:
//   RIDE-102273  construction, a 12-point line, Gilbert Road CLOSED both ways
//   RIDE-104347  construction, a point, Bradner Road CLOSED northbound
//   RIDE-100047  incident (hazard: a washout), a point, all lanes open
//   RIDE-103094  construction (night work), a 16-point line on Highway 99, all lanes open
const BC = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/drivebc-open511-events.json"), "utf8"));

describe("normalizeOpen511: DriveBC's events as road notices", () => {
  const [bridge, bradner, washout, night] = normalizeOpen511(BC);

  it("keeps the operator's codes as words, and its own last-change time", () => {
    expect(bridge).toMatchObject({
      id: "drivebc.ca/RIDE-102273",
      kind: "works",
      category: "Construction",
      subCategory: "Road construction",
      severity: "Minor",
      updated: "2026-09-11T08:56:44-07:00",
    });
    expect(washout).toMatchObject({ kind: "incident", category: "Incident", subCategory: "Hazard" });
    expect(night.severity).toBe("Major");
  });

  it("closes an event's line only where a road it names is CLOSED, with the direction", () => {
    expect(bridge.closure).toBe("Closed, both directions");
    expect(bridge.closedLines).toHaveLength(1);
    expect(bridge.closedLines[0]).toHaveLength(12);
    expect(bridge.openLines).toEqual([]);
    expect(bradner.closure).toBe("Closed, northbound");
    expect(night.closure).toBeUndefined();
    expect(night.openLines[0]).toHaveLength(16);
    expect(night.closedLines).toEqual([]);
  });

  it("puts a point event at its point, and a line event at its line's middle vertex", () => {
    expect([washout.lon, washout.lat]).toEqual(BC.events[2].geography.coordinates);
    expect(washout.openLines).toEqual([]);
    const coords = BC.events[3].geography.coordinates;
    expect([night.lon, night.lat]).toEqual(coords[Math.floor(coords.length / 2)]);
  });

  it("labels a side road by the name DriveBC gives it, not 'Other Roads'", () => {
    expect(BC.events[0].roads[0].name).toBe("Other Roads");
    expect(roadTitle(bridge)).toBe("Road construction, Gilbert Road");
    expect(roadTitle(night)).toBe("Planned event, Highway 99");
  });

  it("keeps the operator's description, and its first sentence as the location", () => {
    expect(washout.location).toBe("Washout at Silver Skagit Road, In Hope.");
    expect(washout.description).toBe(BC.events[2].description.trim());
  });

  it("drops what it cannot place or what is not active, and never throws", () => {
    expect(normalizeOpen511(null)).toEqual([]);
    expect(normalizeOpen511({ events: "no" })).toEqual([]);
    expect(
      normalizeOpen511({
        events: [
          { id: "a", status: "ACTIVE", geography: { type: "Point", coordinates: [200, 95] } },
          { id: "b", status: "ARCHIVED", geography: { type: "Point", coordinates: [-120, 50] } },
          { status: "ACTIVE", geography: { type: "Point", coordinates: [-120, 50] } },
          { id: "c", status: "ACTIVE", geography: { type: "LineString", coordinates: [[-120, 50]] } },
        ],
      }),
    ).toEqual([]);
  });

  it("draws only CONSTRUCTION as works", () => {
    expect(open511Kind("CONSTRUCTION")).toBe("works");
    for (const t of ["INCIDENT", "ROAD_CONDITION", "SPECIAL_EVENT", "WEATHER_CONDITION"]) expect(open511Kind(t)).toBe("incident");
    expect(codeWords("ALMOST_IMPASSABLE")).toBe("Almost impassable");
  });
});
