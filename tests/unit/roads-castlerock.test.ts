import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { castleRockTime, eventWords, normalizeCastleRock, LAYERS_SERVED, TIME_ZONES } from "@/lib/roads/castlerock";
import { CASTLEROCK_SYSTEMS } from "@/lib/sources/castlerock";
import { roadTitle } from "@/lib/signals/roads";

// Verbatim rows of the Castle Rock 511 lists (POST /List/GetData/{layer}) and their map
// points (GET /map/mapIcons/{layer}), recorded 27 Oct 2026 at 08:40 UTC:
//   fl Closures      461840 Lox Rd, full closure, scheduled road work; 833662 not full, code "95"
//   fl Incidents     926459, 927026: code "2203", minor
//   id Construction  23, 32: Idaho's times end in " MT"
//   ga Construction  2541027 placed; 2920439 has no map point
const CR = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/castlerock-road-events.json"), "utf8"));
const fl = { system: "fl" };

describe("normalizeCastleRock: 511 road events as road notices", () => {
  const [lox, lane] = normalizeCastleRock(CR.fl.Closures.rows, CR.fl.Closures.icons, "Closures", fl);
  const incidents = normalizeCastleRock(CR.fl.Incidents.rows, CR.fl.Incidents.icons, "Incidents", fl);
  const idaho = normalizeCastleRock(CR.id.Construction.rows, CR.id.Construction.icons, "Construction", { system: "id" });
  const georgia = normalizeCastleRock(CR.ga.Construction.rows, CR.ga.Construction.icons, "Construction", { system: "ga" });

  it("places each row at its own map point, latitude first", () => {
    const icon = CR.fl.Closures.icons.item2.find((x: { itemId: string }) => x.itemId === "461840");
    expect([lox.lat, lox.lon]).toEqual(icon.location);
    expect(lox.openLines).toEqual([]);
  });

  it("drops a row with no map point", () => {
    expect(CR.ga.Construction.rows).toHaveLength(2);
    expect(georgia.map((n) => n.id)).toEqual(["ga/2541027"]);
  });

  it("is closed where the system marks a full closure, with its direction", () => {
    expect(lox).toMatchObject({
      id: "fl/461840",
      kind: "works",
      category: "Closure",
      subCategory: "Scheduled road work",
      severity: "Major",
      closure: "Closed, both directions",
      street: "Lox Rd",
    });
    expect(roadTitle(lox)).toBe("Scheduled road work, Lox Rd");
    expect(lane.closure).toBeUndefined();
  });

  it("leaves out a sub-category that is only a code, and draws a non-work closure row as an incident", () => {
    expect(lane.subCategory).toBeUndefined();
    expect(lane.kind).toBe("incident");
    for (const n of incidents) {
      expect(n.kind).toBe("incident");
      expect(n.subCategory).toBeUndefined();
    }
  });

  it("reads each time in its system's zone", () => {
    // "4/1/26, 9:48 AM" in New York is 13:48 UTC (summer time).
    expect(lox.updated).toBe("2026-04-01T13:48:00.000Z");
    // Idaho's "6/11/25, 3:02 PM MT" in Boise is 21:02 UTC.
    expect(idaho[0].updated).toBe("2025-06-11T21:02:00.000Z");
    expect(idaho[0]).toMatchObject({ subCategory: "Work on the shoulder", severity: "Not stated" });
  });

  it("never throws, and drops what it cannot place", () => {
    expect(normalizeCastleRock(null, null, "Incidents", fl)).toEqual([]);
    expect(normalizeCastleRock([{ id: 1 }], { item2: [{ itemId: "1", location: [95, 10] }] }, "Incidents", fl)).toEqual([]);
    expect(normalizeCastleRock([{ id: 1 }], { item2: "no" }, "Incidents", fl)).toEqual([]);
  });
});

describe("castleRockTime", () => {
  it("reads both forms, and a winter time in winter", () => {
    expect(castleRockTime("26-10-27 4:27 AM", "America/Toronto")).toBe("2026-10-27T08:27:00.000Z");
    expect(castleRockTime("1/15/26, 12:05 AM", "America/Chicago")).toBe("2026-01-15T06:05:00.000Z");
    expect(castleRockTime("1/15/26, 12:05 PM", "America/Chicago")).toBe("2026-01-15T18:05:00.000Z");
  });

  it("gives no time for what it cannot read", () => {
    expect(castleRockTime("yesterday", "America/Toronto")).toBeUndefined();
    expect(castleRockTime("13/40/26, 1:00 PM", "America/Toronto")).toBeUndefined();
    expect(castleRockTime(null, "America/Toronto")).toBeUndefined();
  });
});

describe("the systems", () => {
  it("gives every Castle Rock system its layers and its time zone", () => {
    for (const s of CASTLEROCK_SYSTEMS) {
      expect(LAYERS_SERVED[s.system]?.length, s.system).toBeGreaterThan(0);
      expect(TIME_ZONES[s.system], s.system).toBeTruthy();
    }
  });

  it("spells event types as words", () => {
    expect(eventWords("roadConstruction")).toBe("Road construction");
    expect(eventWords("[street event]")).toBe("Street event");
    expect(eventWords("Bridge Repair")).toBe("Bridge repair");
    expect(eventWords("95")).toBeUndefined();
  });
});
