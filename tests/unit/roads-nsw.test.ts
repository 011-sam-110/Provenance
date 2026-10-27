import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePolyline, normalizeNswHazards, nswWords } from "@/lib/roads/nsw";
import { roadTitle } from "@/lib/signals/roads";

// Four verbatim hazards from Live Traffic NSW's files (www.livetraffic.com/traffic/hazards/
// <kind>.json), recorded 27 Oct 2026 at 08:15 UTC, each file keeping its own `rights`:
//   roadwork 274378  Glebe Road, Pitt Town: scheduled roadwork, Closed both ways, one line
//   incident 95130   Lobs Hole Ravine Road: changed conditions, Closed both ways, two lines
//   incident 292434  Central Coast Highway: lights flashing yellow, ENDED
//   flood    131861  Garden Vale Road: flooding, no closure period, one line
const NSW = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/nsw-live-traffic-hazards.json"), "utf8"));

describe("normalizeNswHazards: Live Traffic NSW as road notices", () => {
  const [glebe] = normalizeNswHazards(NSW.roadwork, "roadwork");
  const incidents = normalizeNswHazards(NSW.incident, "incident");
  const [flood] = normalizeNswHazards(NSW.flood, "flood");

  it("carries its rights in every file: Transport for NSW, Creative Commons Attribution dataset", () => {
    for (const file of [NSW.roadwork, NSW.incident, NSW.flood]) {
      expect(file.rights).toEqual({
        copyright: "Transport for NSW",
        licence: "https://opendata.transport.nsw.gov.au/dataset/live-traffic-hazards",
      });
    }
  });

  it("drops an ended hazard", () => {
    expect(incidents.map((n) => n.id)).toEqual(["incident/95130"]);
  });

  it("keeps the operator's words, and its own last-change time", () => {
    expect(glebe).toMatchObject({
      id: "roadwork/274378",
      kind: "works",
      category: "Scheduled roadwork",
      severity: "Not major",
      location: "Glebe Road between Pitt Town Road, Pitt Town",
      street: "Glebe Road",
      updated: new Date(NSW.roadwork.features[0].properties.lastUpdated).toISOString(),
    });
    expect(glebe.subCategory).toBeUndefined();
    expect(incidents[0]).toMatchObject({ kind: "incident", category: "Changed traffic conditions" });
    expect(incidents[0].description).toBe("Snowy 2.0 construction vehicles only will be allowed access.");
    expect(flood).toMatchObject({ kind: "incident", category: "Flooding" });
    expect(roadTitle(glebe)).toBe("Scheduled roadwork, Glebe Road");
  });

  it("is closed only where a period's road extent is Closed", () => {
    expect(glebe.closure).toBe("Closed, both directions");
    expect(glebe.closedLines).toHaveLength(1);
    expect(glebe.openLines).toEqual([]);
    expect(incidents[0].closedLines).toHaveLength(2);
    expect(flood.closure).toBeUndefined();
    expect(flood.openLines).toHaveLength(1);
  });

  it("decodes each road line next to the hazard's own point", () => {
    for (const n of [glebe, incidents[0], flood]) {
      for (const line of [...n.openLines, ...n.closedLines]) {
        expect(line.length).toBeGreaterThanOrEqual(2);
        const near = line.some(([lon, lat]) => Math.abs(lon - n.lon) < 0.2 && Math.abs(lat - n.lat) < 0.2);
        expect(near, n.id).toBe(true);
      }
    }
  });

  it("never throws, and drops what it cannot place", () => {
    expect(normalizeNswHazards(null, "incident")).toEqual([]);
    expect(normalizeNswHazards({ features: "no" }, "incident")).toEqual([]);
    expect(
      normalizeNswHazards(
        {
          features: [
            { id: 1, geometry: { type: "Point", coordinates: [200, -95] }, properties: {} },
            { geometry: { type: "Point", coordinates: [151, -33] }, properties: {} },
            { id: 3, geometry: { type: "Point", coordinates: [151, -33] } },
          ],
        },
        "incident",
      ),
    ).toEqual([]);
  });
});

describe("decodePolyline", () => {
  it("decodes Google's own example", () => {
    // developers.google.com/maps/documentation/utilities/polylinealgorithm
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("stops at a string that ends mid-number", () => {
    expect(decodePolyline("_p~iF~ps|U_ulL")).toEqual([[-120.2, 38.5]]);
  });
});

describe("nswWords", () => {
  it("spells a code as words, and keeps a word with a digit as written", () => {
    expect(nswWords("SCHEDULED ROADWORK")).toBe("Scheduled roadwork");
    expect(nswWords("OPEN TO  4WD ONLY")).toBe("Open to 4WD only");
  });
});
