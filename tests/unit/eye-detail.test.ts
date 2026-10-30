import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NOT_SENT,
  ageText,
  aircraftDetail,
  dayMonthText,
  distanceText,
  etaText,
  noticeGoneText,
  positionSourceText,
  roadDetail,
  staleText,
  streetLabel,
  tflPlace,
  vesselDetail,
  type DetailModel,
} from "@/lib/eye/detail";
import { normalizeTflNotices } from "@/lib/roads/tfl";
import { AIRCRAFT_CREDIT, toAircraft, toVessel, type AisFeatureLike, type PlaneLike } from "@/lib/eye/traffic";
import { AISSTREAM_ATTRIBUTION, vesselFeature } from "@/lib/signals/ais";
import { DIGITRAFFIC_CREDIT, normalizeDigitraffic, type DigitrafficLocations, type DigitrafficVessel } from "@/lib/signals/aisDigitraffic";
import { ADSB_ATTRIBUTION, adsbRowToWorldObject, type AdsbRow } from "@/lib/sources/adsb";

const fixture = (name: string) => JSON.parse(readFileSync(resolve(__dirname, "../fixtures", name), "utf8"));

// --- the real rows the plan's mockups show ------------------------------------------
// AISStream's, from production's /api/signals/ais at 22:49Z on 28 Oct 2026.
const thames = fixture("eye-ais-thames.json").features as AisFeatureLike[];
const vesselNamed = (name: string) => toVessel(thames.find((f) => f.title === name)!)!;
const DIAMOND = vesselNamed("MILLENNIUM DIAMOND");
const EDWARDIAN = vesselNamed("EDWARDIAN");
const MERCURY = vesselNamed("MERCURY CLIPPER");

// Digitraffic's: the two register rows verbatim from its /vessels answer of 28 Oct 2026,
// joined to the position the plan shows, through the real adapter.
const register: DigitrafficVessel[] = [
  { callSign: "OFNR", destination: "HELSINKI", draught: 24, eta: 627904, imo: 5375462, mmsi: 230108270, name: "VALBORG", shipType: 36, referencePointA: 23, referencePointB: 7, referencePointC: 2, referencePointD: 5 },
  { callSign: "OH2372", destination: "FAIRWAYWORKS", draught: 0, eta: 1596, imo: 0, mmsi: 230046990, name: "MT5300", shipType: 70, referencePointA: 16, referencePointB: 4, referencePointC: 3, referencePointD: 3 },
];
const T = Date.parse("2026-10-28T22:49:06Z");
const locations: DigitrafficLocations = {
  features: [
    { properties: { mmsi: 230108270, sog: 0, cog: 330, navStat: 5, heading: 511, timestampExternal: T }, geometry: { coordinates: [24.962137, 60.171152] } },
    { properties: { mmsi: 230046990, sog: 0, cog: 150, navStat: 0, heading: 114, timestampExternal: T + 35_000 }, geometry: { coordinates: [24.969833, 60.168833] } },
  ],
};
const finland = normalizeDigitraffic(locations, register, T, 20 * 60_000).map((v) => toVessel(vesselFeature(v)! as AisFeatureLike)!);
const VALBORG = finland.find((v) => v.name === "VALBORG")!;
const MT5300 = finland.find((v) => v.name === "MT5300")!;

// adsb.lol's: one verbatim row of 28 Oct 2026, through the adapter.
const rowFile = fixture("adsb-row-ezy78xp.json") as { now: number; row: AdsbRow };
const plane = (row: AdsbRow, extra: Record<string, unknown> = {}): PlaneLike => {
  const o = adsbRowToWorldObject(row)!;
  return { ...(o as unknown as PlaneLike), meta: { ...(o.meta as PlaneLike["meta"]), ...extra } };
};
const EZY = toAircraft(plane(rowFile.row))!;

const NOW = Date.parse("2026-10-28T22:52:30Z");
const PULLED = Date.parse("2026-10-28T23:09:10Z");

const rowsOf = (m: DetailModel, heading: string) => m.groups.find((g) => g.heading === heading)?.rows ?? [];
const valueOf = (m: DetailModel, label: string) => m.groups.flatMap((g) => g.rows).find((r) => r.label === label);
const labelsOf = (m: DetailModel) => m.groups.flatMap((g) => g.rows.map((r) => r.label));
const rowsNamed = (m: DetailModel, label: string) => m.groups.flatMap((g) => g.rows).filter((r) => r.label === label);

// TfL's own rows, verbatim, from its /Road/all/Disruption answer of 27 Oct 2026: works that
// close one stretch of the A12, a burst water main and police activity.
const [A12, WATER, POLICE] = normalizeTflNotices(fixture("tfl-road-disruptions-mixed.json"));
const NOW_ROAD = Date.parse("2026-10-27T06:20:00Z");
const FETCHED = NOW_ROAD - 4 * 60_000;

/** Every string a model can put on screen. */
function strings(m: DetailModel): string[] {
  return [
    m.title, m.kindLine, ...(m.note ? [m.note] : []), m.credit,
    ...m.readout.flatMap((r) => [r.label, r.value ?? NOT_SENT]),
    ...(m.prose ?? []).flatMap((p) => [p.heading, p.text]),
    ...m.groups.flatMap((g) => [g.heading, ...g.rows.flatMap((r) => [r.label, r.value, r.note ?? ""])]),
  ];
}

describe("vesselDetail, an AISStream vessel with what production sent", () => {
  const m = vesselDetail(DIAMOND, NOW);

  it("names the ship and its type, and says the speed and course, with no heading sent", () => {
    expect(m.kind).toBe("ship");
    expect(m.title).toBe("MILLENNIUM DIAMOND");
    expect(m.kindLine).toBe("Passenger");
    expect(m.readout).toEqual([
      { label: "Speed", value: "7.3 kn" },
      { label: "Course", value: "024°" },
      { label: "Heading", value: null },
    ]);
  });

  it("puts what the crew set in its own group, and leaves out what was not sent", () => {
    expect(rowsOf(m, "Voyage, as set by the crew")).toEqual([
      { label: "Status", value: "Under way (engine)" },
      { label: "Destination", value: "LONDON" },
    ]);
    expect(labelsOf(m)).not.toContain("ETA");
    expect(labelsOf(m)).not.toContain("Draught");
    expect(labelsOf(m)).not.toContain("Size");
    expect(labelsOf(m)).not.toContain("IMO");
    expect(labelsOf(m)).not.toContain("Call sign");
  });

  it("derives the flag from the MMSI and says so in the label", () => {
    expect(valueOf(m, "Flag (from MMSI)")?.value).toBe("United Kingdom");
    expect(labelsOf(m)).toContain("Flag (from MMSI)");
    expect(labelsOf(m)).not.toContain("Flag");
    expect(valueOf(m, "MMSI")?.value).toBe("235092958");
  });

  it("says where and when it was heard", () => {
    expect(valueOf(m, "Position")?.value).toBe("51.5053° N, 0.1200° W");
    expect(valueOf(m, "Last report")?.value).toBe("22:49:11 UTC, 3 min ago");
    expect(valueOf(m, "Heard by")?.value).toBe("AISStream");
  });

  it("states what it is: the ship's own transponder, and the feed's credit", () => {
    expect(m.note).toBe("Each value is what the ship's AIS transponder sent. The mark sits where its last report put it.");
    expect(m.credit).toBe(AISSTREAM_ATTRIBUTION);
  });

  it("words the other two real vessels", () => {
    expect(vesselDetail(EDWARDIAN, NOW).title).toBe("EDWARDIAN");
    expect(vesselDetail(MERCURY, NOW).kindLine).toBe("High-speed craft");
    expect(valueOf(vesselDetail(MERCURY, NOW), "Flag (from MMSI)")?.value).toBe("United Kingdom");
  });
});

describe("vesselDetail, Digitraffic's vessels with every field", () => {
  const m = vesselDetail(VALBORG, NOW);

  it("shows status, destination, ETA and draught in the crew's group, the ETA with its year caveat", () => {
    expect(rowsOf(m, "Voyage, as set by the crew")).toEqual([
      { label: "Status", value: "Moored" },
      { label: "Destination", value: "HELSINKI" },
      { label: "ETA", value: "18 Sep, 19:00 UTC", note: "AIS sends no year" },
      { label: "Draught", value: "2.4 m" },
    ]);
  });

  it("shows size, MMSI, IMO, call sign and the derived flag in the ship's group", () => {
    expect(rowsOf(m, "Ship, as its AIS is set up")).toEqual([
      { label: "Size", value: "30 × 7 m" },
      { label: "MMSI", value: "230108270" },
      { label: "IMO", value: "5375462" },
      { label: "Call sign", value: "OFNR" },
      { label: "Flag (from MMSI)", value: "Finland" },
    ]);
  });

  it("reads 0.0 kn as a speed and 511 as no heading", () => {
    expect(m.readout[0]).toEqual({ label: "Speed", value: "0.0 kn" });
    expect(m.readout[2]).toEqual({ label: "Heading", value: null });
    expect(m.credit).toBe(DIGITRAFFIC_CREDIT);
    expect(valueOf(m, "Heard by")?.value).toBe("Digitraffic");
  });

  it("leaves out a draught, an ETA and an IMO the register sent as 0", () => {
    const t = vesselDetail(MT5300, NOW);
    expect(labelsOf(t)).not.toContain("Draught");
    expect(labelsOf(t)).not.toContain("ETA");
    expect(labelsOf(t)).not.toContain("IMO");
    expect(valueOf(t, "Size")?.value).toBe("20 × 6 m");
    expect(valueOf(t, "Call sign")?.value).toBe("OH2372");
    expect(valueOf(t, "Destination")?.value).toBe("FAIRWAYWORKS");
    expect(t.kindLine).toBe("Cargo");
  });

  it("says a length alone, a draught of 25.5 m or more, and no type", () => {
    const long = vesselDetail({ ...VALBORG, beamM: undefined, draughtM: 25.5, type: undefined }, NOW);
    expect(valueOf(long, "Size")?.value).toBe("30 m long");
    expect(valueOf(long, "Draught")?.value).toBe("25.5 m or more");
    expect(long.kindLine).toBe("Type not sent");
  });

  it("gives no flag for a number that is not a ship's, and none when no MMSI came", () => {
    expect(labelsOf(vesselDetail({ ...VALBORG, mmsi: 992320001 }, NOW))).not.toContain("Flag (from MMSI)");
    expect(labelsOf(vesselDetail({ ...VALBORG, mmsi: undefined }, NOW))).not.toContain("Flag (from MMSI)");
  });

  it("sends a speed, a course or a heading that was not sent to the readout as null", () => {
    const m2 = vesselDetail({ ...VALBORG, knots: null, course: null, heading: null }, NOW);
    expect(m2.readout.map((r) => r.value)).toEqual([null, null, null]);
    expect(NOT_SENT).toBe("Not sent");
  });
});

describe("aircraftDetail, EZY78XP from adsb.lol's real row", () => {
  const m = aircraftDetail(EZY, NOW, PULLED);

  it("titles it by call sign and says its type and class", () => {
    expect(m.kind).toBe("plane");
    expect(m.id).toBe("plane:407568");
    expect(m.title).toBe("EZY78XP");
    expect(m.kindLine).toBe("A20N, airliner");
  });

  it("reads altitude, ground speed, track and vertical speed", () => {
    expect(m.readout).toEqual([
      { label: "Altitude", value: "3,600 ft" },
      { label: "Ground speed", value: "194 kn" },
      { label: "Track", value: "306°" },
      { label: "Vertical speed", value: "−640 ft/min" },
    ]);
  });

  it("puts what the transponder sent in the cockpit's group, and the database's in its own", () => {
    expect(rowsOf(m, "Transponder, as set in the cockpit")).toEqual([
      { label: "Squawk", value: "1167" },
      { label: "Selected altitude", value: "2,016 ft" },
    ]);
    expect(rowsOf(m, "Aircraft, from adsb.lol's database")).toEqual([
      { label: "Registration", value: "G-UZHI" },
      { label: "Type", value: "A20N" },
      { label: "ICAO address", value: "407568" },
    ]);
    expect(labelsOf(m)).not.toContain("Emergency");
  });

  it("says where the position came from, when it was pulled, and who heard it", () => {
    expect(valueOf(m, "Position from")?.value).toBe("ADS-B, the aircraft's own satellite fix");
    // Pulled at 23:09:10, read at 22:52:30: before the pull, so "just now", never a negative age.
    expect(valueOf(m, "Pulled")).toEqual({ label: "Pulled", value: "23:09 UTC, just now", note: "position 0.3 s old at the pull" });
    expect(valueOf(aircraftDetail(EZY, PULLED + 70_000, PULLED), "Pulled")?.value).toBe("23:09 UTC, 1 min ago");
    expect(valueOf(m, "Heard by")?.value).toBe("adsb.lol");
  });

  it("credits adsb.lol, and says the registration and type are its database's", () => {
    expect(m.credit).toBe("Aircraft © adsb.lol contributors (ODbL)");
    expect(m.note).toBe(
      "Altitude, speed, track and squawk are what the aircraft's transponder sent. Registration and type come from adsb.lol's aircraft database.",
    );
  });

  it("words a squawk of 7700 as the code for an emergency, and an emergency as sent", () => {
    const sos = aircraftDetail(toAircraft(plane({ ...rowFile.row, squawk: "7700", emergency: "general" }))!, NOW, PULLED);
    expect(valueOf(sos, "Squawk")).toEqual({ label: "Squawk", value: "7700", note: "the code for an emergency" });
    expect(valueOf(sos, "Emergency")).toEqual({ label: "Emergency", value: "General", note: "as sent" });
    const hijack = aircraftDetail(toAircraft(plane({ ...rowFile.row, squawk: "7500" }))!, NOW, PULLED);
    expect(valueOf(hijack, "Squawk")?.note).toBe("the code for a hijack");
    const radio = aircraftDetail(toAircraft(plane({ ...rowFile.row, squawk: "7600", emergency: "no_comm" }))!, NOW, PULLED);
    expect(valueOf(radio, "Squawk")?.note).toBe("the code for radio failure");
    expect(valueOf(radio, "Emergency")?.value).toBe("No comm");
  });

  it("says a climb with a plus, a level flight as 0, and a class the aircraft did not broadcast as estimated", () => {
    const climb = aircraftDetail({ ...EZY, fpm: 1340 }, NOW, PULLED);
    expect(climb.readout[3].value).toBe("+1,340 ft/min");
    expect(aircraftDetail({ ...EZY, fpm: 0 }, NOW, PULLED).readout[3].value).toBe("0 ft/min");
    expect(aircraftDetail({ ...EZY, classTrusted: false }, NOW, PULLED).kindLine).toBe("A20N, airliner (estimated)");
  });

  it("prefers the database's long type name, and falls back to the class alone", () => {
    expect(aircraftDetail({ ...EZY, typeDescription: "AIRBUS A-320neo" }, NOW, PULLED).kindLine).toBe("AIRBUS A-320neo, airliner");
    expect(aircraftDetail({ ...EZY, typeCode: undefined }, NOW, PULLED).kindLine).toBe("Airliner");
    expect(aircraftDetail({ ...EZY, typeCode: undefined, classLabel: undefined }, NOW, PULLED).kindLine).toBe("Type not sent");
  });

  it("leaves out the rows it was not given, and sends missing figures to the readout as null", () => {
    const bare = aircraftDetail({ ...EZY, feet: null, knots: null, fpm: null, squawk: undefined, selAltFt: undefined, registration: undefined, posSource: undefined, posAgeS: undefined }, NOW, null);
    expect(bare.readout.filter((r) => r.value === null).map((r) => r.label)).toEqual(["Altitude", "Ground speed", "Vertical speed"]);
    for (const l of ["Squawk", "Selected altitude", "Registration", "Position from", "Pulled"]) expect(labelsOf(bare), l).not.toContain(l);
    expect(rowsOf(bare, "Transponder, as set in the cockpit")).toEqual([]);
    expect(bare.groups.map((g) => g.heading)).not.toContain("Transponder, as set in the cockpit");
  });

  it("names adsb.fi where adsb.fi heard it", () => {
    const fi = aircraftDetail(toAircraft(plane(rowFile.row, { network: "adsb.fi" }))!, NOW, PULLED);
    expect(fi.groups.map((g) => g.heading)).toContain("Aircraft, from adsb.fi's database");
    expect(valueOf(fi, "Heard by")?.value).toBe("adsb.fi");
    expect(fi.credit).toBe("Aircraft © adsb.fi (non-commercial use)");
    expect(fi.note).toContain("adsb.fi's aircraft database");
  });
});

describe("the credits", () => {
  it("are the licences the console already states, in the view's own wording", () => {
    // ADSB_ATTRIBUTION names both licences ("Live aircraft ... · gap fill ... "); the
    // view says "Aircraft", so each credit is the licence part of it.
    expect(AIRCRAFT_CREDIT).toContain("Aircraft © adsb.lol contributors (ODbL)");
    expect(ADSB_ATTRIBUTION).toContain("© adsb.lol contributors (ODbL)");
    expect(ADSB_ATTRIBUTION).toContain("© adsb.fi (non-commercial use)");
    expect(aircraftDetail(EZY, NOW, PULLED).credit.replace(/^Aircraft /, "")).toBe("© adsb.lol contributors (ODbL)");
    expect(aircraftDetail({ ...EZY, network: "adsb.fi" }, NOW, PULLED).credit.replace(/^Aircraft /, "")).toBe("© adsb.fi (non-commercial use)");
  });
});

describe("etaText", () => {
  it("words a date and a time, and says AIS sends no year", () => {
    expect(etaText("10-28T22:30Z")).toEqual({ value: "28 Oct, 22:30 UTC", note: "AIS sends no year" });
    expect(etaText("09-18T19:00Z")).toEqual({ value: "18 Sep, 19:00 UTC", note: "AIS sends no year" });
    expect(etaText("01-05T00:00Z")?.value).toBe("5 Jan, 00:00 UTC");
  });
  it("words a date alone, and gives nothing for text that is not an ETA", () => {
    expect(etaText("10-28")).toEqual({ value: "28 Oct", note: "AIS sends no year" });
    expect(etaText("13-01")).toBeNull();
    expect(etaText("soon")).toBeNull();
    expect(etaText("")).toBeNull();
  });
});

describe("ageText", () => {
  const at = 1_000_000_000_000;
  it("says just now under 5 s, then seconds, minutes and hours", () => {
    expect(ageText(at, at)).toBe("just now");
    expect(ageText(at, at + 4_000)).toBe("just now");
    expect(ageText(at, at + 5_000)).toBe("5 s ago");
    expect(ageText(at, at + 41_000)).toBe("41 s ago");
    expect(ageText(at, at + 59_000)).toBe("59 s ago");
    expect(ageText(at, at + 60_000)).toBe("1 min ago");
    expect(ageText(at, at + 3 * 60_000 + 20_000)).toBe("3 min ago");
    expect(ageText(at, at + 59 * 60_000)).toBe("59 min ago");
    expect(ageText(at, at + 2 * 3_600_000)).toBe("2 h ago");
  });
  it("never says a negative age", () => {
    expect(ageText(at + 10_000, at)).toBe("just now");
  });
});

describe("the small words", () => {
  it("staleText names the last time the mark was heard", () => {
    expect(staleText(Date.parse("2026-10-28T22:49:06Z"))).toBe("Not in the latest report. Last heard 22:49 UTC.");
  });
  it("positionSourceText words each code, and anything else as Other", () => {
    expect(positionSourceText("adsb")).toBe("ADS-B, the aircraft's own satellite fix");
    expect(positionSourceText("adsr")).toBe("ADS-R, an ADS-B report relayed by a ground station");
    expect(positionSourceText("tisb")).toBe("TIS-B, a ground radar track relayed");
    expect(positionSourceText("mlat")).toBe("MLAT, worked out by receivers from signal timing");
    expect(positionSourceText("adsc")).toBe("ADS-C, sent over a satellite link");
    expect(positionSourceText("other")).toBe("Other");
    expect(positionSourceText("mode_s")).toBe("Other");
  });
  it("distanceText gives metres, then kilometres", () => {
    expect(distanceText(0)).toBe("0 m");
    expect(distanceText(33.6)).toBe("34 m");
    expect(distanceText(999)).toBe("999 m");
    expect(distanceText(1250)).toBe("1.3 km");
  });
});

describe("every word of every model", () => {
  const models: [string, DetailModel][] = [
    ["MILLENNIUM DIAMOND", vesselDetail(DIAMOND, NOW)],
    ["EDWARDIAN", vesselDetail(EDWARDIAN, NOW)],
    ["MERCURY CLIPPER", vesselDetail(MERCURY, NOW)],
    ["VALBORG", vesselDetail(VALBORG, NOW)],
    ["MT5300", vesselDetail(MT5300, NOW)],
    ["EZY78XP", aircraftDetail(EZY, NOW, PULLED)],
    ["EZY78XP on adsb.fi", aircraftDetail({ ...EZY, network: "adsb.fi", emergency: "general", squawk: "7700", fpm: 1340 }, NOW, PULLED)],
    ["TIMS-237054, utility works", roadDetail(A12, NOW_ROAD, FETCHED)],
    ["TIMS-236919, burst water main", roadDetail(WATER, NOW_ROAD, FETCHED)],
    ["TIMS-237055, police activity", roadDetail(POLICE, NOW_ROAD, FETCHED)],
  ];

  it.each(models)("%s never says live, and has no em or en dash", (_name, m) => {
    const all = strings(m);
    expect(all.length).toBeGreaterThan(10);
    for (const s of all) {
      expect(s, s).not.toMatch(/\blive\b/i);
      expect(s, s).not.toContain("—");
      expect(s, s).not.toContain("–");
    }
  });

  it("has no empty value and no empty group", () => {
    for (const [, m] of models) {
      for (const g of m.groups) {
        expect(g.rows.length).toBeGreaterThan(0);
        for (const r of g.rows) expect(r.value.trim()).not.toBe("");
      }
    }
  });
});

describe("tflPlace, from the detail module", () => {
  it("is the same function the Also here chip uses", () => {
    expect(tflPlace("[A400] NORTHUMBERLAND AVENUE (SW1A ,WC2N ) (Westminster)")).toEqual({
      road: "[A400] NORTHUMBERLAND AVENUE",
      postcodes: "SW1A, WC2N",
      boroughs: "Westminster",
    });
    expect(tflPlace("[A3220] WARWICK ROAD (SW5 ) (Kensington & Chelsea,Wandsworth)").boroughs).toBe("Kensington & Chelsea, Wandsworth");
    expect(tflPlace("HIGH STREET")).toEqual({ road: "HIGH STREET" });
  });
});

describe("the road notice's small words", () => {
  it("dayMonthText gives the day and month, and the year only when it is not this one", () => {
    const now = Date.parse("2026-10-27T06:20:00Z");
    expect(dayMonthText("2026-10-08T11:00:00Z", now)).toBe("8 Oct");
    expect(dayMonthText("2026-12-31T23:59:59Z", now)).toBe("31 Dec");
    expect(dayMonthText("2022-08-11T07:30:00Z", now)).toBe("11 Aug 2022");
    expect(dayMonthText("2027-01-01T00:00:00Z", now)).toBe("1 Jan 2027");
    expect(dayMonthText("not a date", now)).toBeNull();
  });

  it("noticeGoneText names the time TfL last changed it, with the day when it is not today", () => {
    const now = Date.parse("2026-10-27T06:20:00Z");
    expect(noticeGoneText(Date.parse("2026-10-27T03:30:00Z"), now)).toBe("Not in TfL's latest list. Last changed 03:30 UTC.");
    expect(noticeGoneText(Date.parse("2026-10-26T15:59:00Z"), now)).toBe("Not in TfL's latest list. Last changed 26 Oct 15:59 UTC.");
  });

  it("streetLabel drops the postcode bracket TfL ends a street's name with, and nothing else", () => {
    expect(streetLabel("[A400] NORTHUMBERLAND AVENUE (SW1A ,WC2N)")).toBe("[A400] NORTHUMBERLAND AVENUE");
    expect(streetLabel("[A12] EASTERN AVENUE EAST (RM2 ,RM3)")).toBe("[A12] EASTERN AVENUE EAST");
    expect(streetLabel("[A23] BRIXTON HILL")).toBe("[A23] BRIXTON HILL");
  });
});

describe("roadDetail, utility works that close one stretch of the A12", () => {
  const m = roadDetail(A12, NOW_ROAD, FETCHED);

  it("titles it by TfL's sub-category, names the road, and wears the closure's paint", () => {
    expect(m).toMatchObject({ kind: "road", id: "TIMS-237054", paint: "closed", title: "Utility works", kindLine: "[A12] EASTERN AVENUE EAST" });
  });

  it("reads severity and the two dates as figures", () => {
    expect(m.readout).toEqual([
      { label: "Severity", value: "Minimal" },
      { label: "From", value: "27 Oct" },
      { label: "Until", value: "27 Oct" },
    ]);
  });

  it("puts TfL's own sentences first, the update headed by its time", () => {
    expect(m.prose).toEqual([
      {
        heading: "TfL's description",
        text: "[A12] Eastern Avenue East (Westbound) at the junction of [A127] Southend Arterial Road - Flyover is closed for Cadent Gas works.",
      },
      { heading: "TfL's latest update, 05:56 UTC", text: "Use another route. Diverted traffic is flowing well." },
    ]);
  });

  it("has a Where group and a Notice group, in that order, with the rows TfL filled", () => {
    expect(m.groups.map((g) => g.heading)).toEqual(["Where", "Notice"]);
    expect(labelsOf(m)).toEqual([
      "Road",
      "Borough",
      "Postcode areas",
      "Street named",
      "Street named",
      "TfL reference",
      "Status",
      "Runs",
      "Level of interest",
      "Last change",
      "Fetched",
    ]);
  });

  it("says where it is, in TfL's words", () => {
    expect(valueOf(m, "Road")?.value).toBe("[A12] EASTERN AVENUE EAST");
    expect(valueOf(m, "Borough")?.value).toBe("Havering");
    expect(valueOf(m, "Postcode areas")?.value).toBe("RM2, RM3");
  });

  it("lists each street TfL names with its closure and direction in TfL's words, lower-cased", () => {
    expect(rowsNamed(m, "Street named")).toEqual([
      { label: "Street named", value: "[A12] EASTERN AVENUE EAST", note: "Closed, westbound" },
      { label: "Street named", value: "[A12] EASTERN AVENUE EAST", note: "Open, both directions" },
    ]);
  });

  it("states the notice: reference, status, dates with the time, interest, and both ages", () => {
    expect(rowsOf(m, "Notice")).toEqual([
      { label: "TfL reference", value: "TIMS-237054" },
      { label: "Status", value: "Active" },
      { label: "Runs", value: "27 Oct 00:17 UTC to 27 Oct 23:59 UTC" },
      { label: "Level of interest", value: "Medium" },
      { label: "Last change", value: "05:56 UTC, 23 min ago" },
      { label: "Fetched", value: "06:16 UTC, 4 min ago" },
    ]);
  });

  it("names no company, and its footer is TfL's credit alone", () => {
    expect(labelsOf(m)).not.toContain("Works by");
    // TfL's description names the company, and says so in its own words; the panel adds no row for it.
    expect(m.groups.flatMap((g) => g.rows.map((r) => r.label)).join(" ")).not.toMatch(/\b(by|company|contractor|operator)\b/i);
    expect(m.note).toBeUndefined();
    expect(m.credit).toBe("Powered by TfL Open Data");
    expect(JSON.stringify(m)).not.toContain("Every value is TfL's own");
  });

  it("leaves a vessel's and an aircraft's footers as they were", () => {
    expect(vesselDetail(DIAMOND, NOW).note).toMatch(/^Each value is what the ship's AIS transponder sent/);
    expect(aircraftDetail(EZY, NOW, PULLED).note).toMatch(/^Altitude, speed, track and squawk/);
  });
});

describe("roadDetail, a burst water main", () => {
  const m = roadDetail(WATER, NOW_ROAD, FETCHED);

  it("is an incident, titled by TfL's sub-category, with one borough", () => {
    expect(m).toMatchObject({ paint: "incident", title: "Burst water main", kindLine: "[A243] HOOK ROAD" });
    expect(m.readout.map((r) => r.value)).toEqual(["Minimal", "24 Oct", "24 Oct"]);
    expect(rowsNamed(m, "Borough")[0].value).toBe("Kingston upon Thames");
    expect(rowsNamed(m, "Boroughs")).toEqual([]);
    expect(valueOf(m, "Postcode areas")?.value).toBe("KT6, KT9");
    expect(m.prose?.map((p) => p.heading)).toEqual(["TfL's description", "TfL's latest update, 05:23 UTC"]);
  });

  it("says the road is closed northbound, as TfL's street entry does", () => {
    expect(rowsNamed(m, "Street named")).toEqual([{ label: "Street named", value: "[A243] HOOK ROAD", note: "Closed, northbound" }]);
    expect(valueOf(m, "Runs")?.value).toBe("24 Oct 05:43 UTC to 24 Oct 23:59 UTC");
  });
});

describe("roadDetail, police activity that closes Blackstock Road", () => {
  const m = roadDetail(POLICE, NOW_ROAD, FETCHED);

  it("is an incident even though it closes the road, and calls three boroughs Boroughs", () => {
    expect(m).toMatchObject({ paint: "incident", title: "Police activity", kindLine: "[A1201] BLACKSTOCK ROAD" });
    expect(m.readout[0]).toEqual({ label: "Severity", value: "No impact" });
    expect(rowsNamed(m, "Borough")).toEqual([]);
    expect(rowsNamed(m, "Boroughs")[0].value).toBe("Hackney, Haringey, Islington");
    expect(valueOf(m, "Level of interest")?.value).toBe("Low");
  });
});

describe("roadDetail, what TfL did not send", () => {
  it("leaves the empty rows and blocks out, and shows a missing date as Not sent", () => {
    const bare = { ...A12, description: undefined, update: undefined, updateAt: undefined, starts: undefined, ends: undefined, status: undefined, interest: undefined, namedStreets: undefined, location: undefined, updated: undefined, street: undefined };
    const m = roadDetail(bare, NOW_ROAD, null);
    expect(m.prose).toEqual([]);
    expect(m.kindLine).toBe("Road not named");
    expect(m.readout).toEqual([
      { label: "Severity", value: "Minimal" },
      { label: "From", value: null },
      { label: "Until", value: null },
    ]);
    expect(m.groups.map((g) => g.heading)).toEqual(["Notice"]);
    expect(labelsOf(m)).toEqual(["TfL reference"]);
  });

  it("names the street when TfL gave one and no location, and keeps TfL's missing-severity word", () => {
    const m = roadDetail({ ...A12, location: undefined, street: "Eastern Avenue", severity: "Unknown" }, NOW_ROAD, FETCHED);
    expect(m.kindLine).toBe("Eastern Avenue");
    expect(m.readout[0].value).toBe("Unknown");
  });

  it("heads the update with no time when TfL sent none", () => {
    const m = roadDetail({ ...A12, updateAt: undefined }, NOW_ROAD, FETCHED);
    expect(m.prose?.[1].heading).toBe("TfL's latest update");
  });

  it("says the dates are provisional only where TfL marks them, and gives the works times it sent", () => {
    const m = roadDetail(
      {
        ...A12,
        provisional: true,
        schedule: [
          { from: "2026-10-31T08:00:00Z", to: "2026-11-02T16:00:00Z" },
          { from: "2026-10-29T08:00:00Z", to: "2026-10-29T20:00:00Z" },
        ],
      },
      NOW_ROAD,
      FETCHED,
    );
    expect(valueOf(m, "Dates")).toEqual({ label: "Dates", value: "Provisional", note: "as TfL marks them" });
    expect(valueOf(m, "Works times")?.value).toBe("29 Oct 08:00 to 20:00 UTC; 31 Oct 08:00 to 2 Nov 16:00 UTC");
    expect(valueOf(roadDetail(A12, NOW_ROAD, FETCHED), "Dates")).toBeUndefined();
    expect(valueOf(roadDetail(A12, NOW_ROAD, FETCHED), "Works times")).toBeUndefined();
  });

  it("puts a year on a date from another year, and the day on a last change from another day", () => {
    const m = roadDetail({ ...A12, starts: "2022-08-11T07:30:00Z", ends: "2022-08-12T07:30:00Z", updated: "2026-10-26T15:59:00Z" }, NOW_ROAD, FETCHED);
    expect(m.readout.map((r) => r.value)).toEqual(["Minimal", "11 Aug 2022", "12 Aug 2022"]);
    expect(valueOf(m, "Runs")?.value).toBe("11 Aug 2022 07:30 UTC to 12 Aug 2022 07:30 UTC");
    expect(valueOf(m, "Last change")?.value).toBe("26 Oct 15:59 UTC, 14 h ago");
  });

  it("calls a notice with a closure word but no closed line closed, and one with neither works", () => {
    expect(roadDetail({ ...A12, closedLines: [], closure: "Closed" }, NOW_ROAD, null).paint).toBe("closed");
    expect(roadDetail({ ...A12, closedLines: [], closure: undefined }, NOW_ROAD, null).paint).toBe("works");
  });
});
