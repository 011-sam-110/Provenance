import { describe, expect, it } from "vitest";
// REAL captures, 2026-10-16 20:07:51 UTC (Digitraffic's dataUpdatedTime):
//   digitraffic-ais-locations.json  meri.digitraffic.fi/api/ais/v1/locations?from=<now-20min>,
//                                   trimmed from 626 positions to 25 inside the Gulf of
//                                   Finland box and 5 outside it
//   digitraffic-ais-vessels.json    /api/ais/v1/vessels, the 29 register rows for those MMSIs
import locations from "@/tests/fixtures/digitraffic-ais-locations.json";
import register from "@/tests/fixtures/digitraffic-ais-vessels.json";
import { normalizeDigitraffic, shipTypeLabel, type DigitrafficLocations, type DigitrafficVessel } from "@/lib/signals/aisDigitraffic";
import { bwRequestBody, normalizeBarentswatch } from "@/lib/signals/aisBarentswatch";
import { AIS_ATTRIBUTION, chokepointFor, mergeVessels, normalizeAis, VESSEL_TTL_MS, type AisVessel } from "@/lib/signals/ais";

const NOW = Date.parse("2026-10-16T20:07:51Z");
const dt = normalizeDigitraffic(locations as DigitrafficLocations, register as DigitrafficVessel[], NOW, VESSEL_TTL_MS);

describe("Digitraffic", () => {
  it("joins each position to its name and type", () => {
    expect(dt).toHaveLength(30);
    const tanker = dt.find((v) => v.MMSI === 273257030)!;
    expect(tanker.ShipName).toBe("KRASNOYARSK");
    expect(tanker.shipType).toBe("tanker");
    expect(tanker.destination).toBe("RU  ULU");
    expect(tanker.source).toBe("Digitraffic");
  });

  it("reads the register's call sign, IMO, size, draught and ETA", () => {
    // KRASNOYARSK's register row, verbatim (tests/fixtures/digitraffic-ais-vessels.json).
    const tanker = dt.find((v) => v.MMSI === 273257030)!;
    expect(tanker.callSign).toBe("UAWA8");
    expect(tanker.imo).toBe(9312896);
    expect(tanker.draughtM).toBe(8.2); // 82 tenths of a metre
    expect(tanker.eta).toBe("09-20T15:00Z"); // 631744 packed
    expect(tanker.lengthM).toBeUndefined(); // its four reference points are all 0: not sent
    expect(tanker.beamM).toBeUndefined();
    // HWA LAND: 197 + 28 long, 22 + 10 wide.
    const bulk = dt.find((v) => v.MMSI === 357381000)!;
    expect(bulk).toMatchObject({ callSign: "3FHP9", imo: 9187722, lengthM: 225, beamM: 32, draughtM: 6.2 });
  });

  it("leaves out a draught of 0 and an IMO of 0, which the register sends for 'none'", () => {
    // NORDENSKIOLD: draught 0, imo 0, a size of 4+3 by 1+2.
    const survey = dt.find((v) => v.MMSI === 230182220)!;
    expect(survey.draughtM).toBeUndefined();
    expect(survey.imo).toBeUndefined();
    expect(survey).toMatchObject({ callSign: "OHA5145", lengthM: 7, beamM: 3 });
  });

  it("reads 102.2 kt as 'speed not available', not as a speed", () => {
    expect(dt.find((v) => v.MMSI === 273299870)!.Sog).toBeNull();
  });

  it("drops a position older than the window", () => {
    expect(normalizeDigitraffic(locations as DigitrafficLocations, [], NOW + VESSEL_TTL_MS + 60 * 60_000, VESSEL_TTL_MS)).toEqual([]);
  });

  it("puts the Gulf of Finland vessels on the new chokepoint, and the rest of the Baltic off the layer", () => {
    const merged = mergeVessels(dt);
    expect(merged).toHaveLength(25);
    expect(merged.every((v) => chokepointFor(v.latitude!, v.longitude!) === "Gulf of Finland")).toBe(true);
    const f = normalizeAis(merged);
    expect(f.every((x) => x.props?.source === "Digitraffic")).toBe(true);
  });
});

describe("mergeVessels", () => {
  const v = (mmsi: number, t: string, source: AisVessel["source"]): AisVessel => ({
    MMSI: mmsi, latitude: 60, longitude: 25, time_utc: t, source,
  });

  it("keeps one row per ship, the newer report", () => {
    const out = mergeVessels(
      [v(1, "2026-10-16 20:00:00.000 +0000 UTC", "AISStream")],
      [v(1, "2026-10-16T20:05:00.000Z", "Digitraffic"), v(2, "2026-10-16T20:01:00.000Z", "Digitraffic")],
    );
    expect(out.map((x) => `${x.MMSI}:${x.source}`).sort()).toEqual(["1:Digitraffic", "2:Digitraffic"]);
  });
});

describe("BarentsWatch", () => {
  // No capture: the API needs the sign-up. These rows follow the field names of the
  // published OpenAPI document (AisComboFull); the values are made up for the test.
  const rows = [
    { mmsi: 257000001, name: "TEST VESSEL", latitude: 70.5, longitude: 25.0, speedOverGround: 11.2, courseOverGround: 80, trueHeading: 79, navigationalStatus: 0, shipType: 80, msgtime: "2026-10-16T20:00:00+00:00" },
    { mmsi: 257000002, name: null, latitude: 70.6, longitude: 26.0, msgtime: "2026-10-15T20:00:00+00:00" },
  ];

  it("keeps recent positions only, with the feed named", () => {
    const out = normalizeBarentswatch(rows, NOW, VESSEL_TTL_MS);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("BarentsWatch");
    expect(out[0].shipType).toBe("tanker");
    expect(chokepointFor(out[0].latitude!, out[0].longitude!)).toBe("Barents Sea – North Cape");
  });

  it("reads call sign, IMO, size, draught, destination and ETA from a Full row", () => {
    const [v] = normalizeBarentswatch(
      [
        {
          mmsi: 257000003, name: "FULL ROW", latitude: 70.5, longitude: 25.0, shipType: 70, msgtime: "2026-10-16T20:00:00+00:00",
          callSign: "LABC@@@", imoNumber: 9773064, shipLength: 183, shipWidth: 32, draught: 112, destination: "NO HVG ", eta: "2026-10-18T06:30:00Z",
        },
      ],
      NOW,
      VESSEL_TTL_MS,
    );
    expect(v).toMatchObject({
      callSign: "LABC", imo: 9773064, lengthM: 183, beamM: 32, draughtM: 11.2, destination: "NO HVG", eta: "10-18T06:30Z",
    });
  });

  it("leaves out a Full row's empty fields", () => {
    const [v] = normalizeBarentswatch(
      [{ mmsi: 257000004, latitude: 70.5, longitude: 25.0, msgtime: "2026-10-16T20:00:00+00:00", callSign: "", imoNumber: 0, shipLength: 0, shipWidth: 0, draught: 0, destination: "  ", eta: "0001-01-01T00:00:00Z" }],
      NOW,
      VESSEL_TTL_MS,
    );
    for (const k of ["callSign", "imo", "lengthM", "beamM", "draughtM", "destination", "eta"]) expect(k in v, k).toBe(false);
  });

  it("asks for a closed GeoJSON polygon around the box, lon before lat", () => {
    const body = bwRequestBody([[68, 15], [72, 35]], NOW);
    expect(body.geometry.coordinates[0][0]).toEqual([15, 68]);
    expect(body.geometry.coordinates[0][4]).toEqual([15, 68]);
    expect(body.since).toBe("2026-10-16T20:07:51.000Z");
    // "Full" is the model that carries call sign, IMO, size, draught, destination and ETA.
    expect(body.modelType).toBe("Full");
  });
});

describe("credits and labels", () => {
  it("names all three feeds", () => {
    expect(AIS_ATTRIBUTION).toContain("AISStream");
    expect(AIS_ATTRIBUTION).toContain("digitraffic.fi");
    expect(AIS_ATTRIBUTION).toContain("BarentsWatch");
  });

  it("labels the common ship types", () => {
    expect(shipTypeLabel(70)).toBe("cargo");
    expect(shipTypeLabel(84)).toBe("tanker");
    expect(shipTypeLabel(35)).toBe("military");
    expect(shipTypeLabel(0)).toBeUndefined();
    expect(shipTypeLabel(99)).toBeUndefined();
  });
});
