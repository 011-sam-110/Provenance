/**
 * Unit tests for the OpenSky state-vector parser and WorldObject mapper.
 * NO network calls — all data is hardcoded inline.
 */

import { expect, test, describe } from "vitest";
import { parseStates, planeToWorldObject, capPlanes } from "@/lib/sources/opensky";
import type { WorldObject } from "@/lib/world";

// ---------------------------------------------------------------------------
// Fixture
//
// State-vector positional indices (from OpenSky docs):
//  0  icao24        string
//  1  callsign      string | null
//  2  country       string
//  3  time_position number | null
//  4  last_contact  number
//  5  longitude     number | null
//  6  latitude      number | null
//  7  baro_altitude number | null  (metres)
//  8  on_ground     boolean
//  9  velocity      number | null  (m/s)
// 10  true_track    number | null  (degrees)
// 11  vertical_rate number | null  (m/s)
// 12  sensors       number[] | null
// 13  geo_altitude  number | null  (metres)
// 14  squawk        string | null
// 15  spi           boolean
// 16  position_src  number
// ---------------------------------------------------------------------------

const VECTOR_CRUISER: unknown[] = [
  /* 0  icao24        */ "3c4b2d",
  /* 1  callsign      */ "  DLH456 ",   // ← padded — must be trimmed to "DLH456"
  /* 2  country       */ "Germany",
  /* 3  time_position */ 1719394800,
  /* 4  last_contact  */ 1719394800,
  /* 5  longitude     */ -0.1278,
  /* 6  latitude      */ 51.5074,
  /* 7  baro_altitude */ 9900,           // ← baro present but geo takes priority
  /* 8  on_ground     */ false,
  /* 9  velocity      */ 240,            // m/s
  /* 10 true_track    */ 87.5,
  /* 11 vertical_rate */ 3.2,
  /* 12 sensors       */ null,
  /* 13 geo_altitude  */ 10200,          // ← geo_altitude used → altKm = 10.2
  /* 14 squawk        */ "1234",
  /* 15 spi           */ false,
  /* 16 position_src  */ 0,
];

// Row where latitude is null — MUST be skipped by the parser
const VECTOR_NULL_LAT: unknown[] = [
  /* 0  */ "deadbe",
  /* 1  */ "GHOST01",
  /* 2  */ "Unknown",
  /* 3  */ null,
  /* 4  */ 1719394800,
  /* 5  */ 2.35,
  /* 6  */ null,          // ← null latitude → row must be skipped
  /* 7  */ null,
  /* 8  */ false,
  /* 9  */ null,
  /* 10 */ null,
  /* 11 */ null,
  /* 12 */ null,
  /* 13 */ null,
  /* 14 */ null,
  /* 15 */ false,
  /* 16 */ 0,
];

const VECTOR_ON_GROUND: unknown[] = [
  /* 0  icao24        */ "4ca8ef",
  /* 1  callsign      */ null,           // ← null callsign → falls back to icao24 "4ca8ef"
  /* 2  country       */ "Ireland",
  /* 3  time_position */ null,
  /* 4  last_contact  */ 1719394805,
  /* 5  longitude     */ -6.2597,
  /* 6  latitude      */ 53.3498,
  /* 7  baro_altitude */ null,
  /* 8  on_ground     */ true,
  /* 9  velocity      */ 8,
  /* 10 true_track    */ null,           // ← null heading → falls back to 0
  /* 11 vertical_rate */ null,
  /* 12 sensors       */ null,
  /* 13 geo_altitude  */ null,           // ← geo + baro both null → altKm = 0
  /* 14 squawk        */ null,
  /* 15 spi           */ false,
  /* 16 position_src  */ 0,
];

// ---------------------------------------------------------------------------
// parseStates() tests
// ---------------------------------------------------------------------------

describe("parseStates", () => {
  const fixture: unknown[][] = [VECTOR_CRUISER, VECTOR_NULL_LAT, VECTOR_ON_GROUND];

  test("skips the null-latitude row and returns 2 planes", () => {
    const planes = parseStates(fixture);
    expect(planes).toHaveLength(2);
  });

  test("trims padded callsign correctly", () => {
    const [p] = parseStates([VECTOR_CRUISER]);
    expect(p.callsign).toBe("DLH456");
  });

  test("falls back to icao24 when callsign is null", () => {
    const [p] = parseStates([VECTOR_ON_GROUND]);
    expect(p.callsign).toBe("4ca8ef");
    expect(p.icao24).toBe("4ca8ef");
  });

  test("prefers geo_altitude over baro_altitude for altKm", () => {
    const [p] = parseStates([VECTOR_CRUISER]);
    // geo_altitude = 10200 m → 10.2 km
    expect(p.altKm).toBeCloseTo(10.2, 3);
  });

  test("falls back to baro_altitude when geo_altitude is null", () => {
    // Use a variant with geo=null but baro=5000
    const v: unknown[] = [...VECTOR_CRUISER];
    v[13] = null;
    v[7] = 5000;
    const [p] = parseStates([v]);
    expect(p.altKm).toBeCloseTo(5.0, 3);
  });

  test("altKm is 0 when both altitude fields are null", () => {
    const [p] = parseStates([VECTOR_ON_GROUND]);
    expect(p.altKm).toBe(0);
  });

  test("copies lat and lon exactly", () => {
    const [p] = parseStates([VECTOR_CRUISER]);
    expect(p.lat).toBe(51.5074);
    expect(p.lon).toBe(-0.1278);
  });

  test("heading falls back to 0 when true_track is null", () => {
    const [p] = parseStates([VECTOR_ON_GROUND]);
    expect(p.headingDeg).toBe(0);
  });

  test("heading is set from true_track when present", () => {
    const [p] = parseStates([VECTOR_CRUISER]);
    expect(p.headingDeg).toBe(87.5);
  });

  test("onGround flag is correctly parsed", () => {
    const [cruiser] = parseStates([VECTOR_CRUISER]);
    const [ground] = parseStates([VECTOR_ON_GROUND]);
    expect(cruiser.onGround).toBe(false);
    expect(ground.onGround).toBe(true);
  });

  test("velocityMs and verticalRateMs are passed through", () => {
    const [p] = parseStates([VECTOR_CRUISER]);
    expect(p.velocityMs).toBe(240);
    expect(p.verticalRateMs).toBeCloseTo(3.2);
  });

  test("velocityMs and verticalRateMs are null when not in vector", () => {
    const [p] = parseStates([VECTOR_ON_GROUND]);
    expect(p.verticalRateMs).toBeNull();
  });

  test("country is copied from origin_country", () => {
    const [p] = parseStates([VECTOR_CRUISER]);
    expect(p.country).toBe("Germany");
  });
});

// ---------------------------------------------------------------------------
// planeToWorldObject() tests
// ---------------------------------------------------------------------------

describe("planeToWorldObject", () => {
  const [cruiser, onGround] = parseStates([VECTOR_CRUISER, VECTOR_ON_GROUND]);

  test("kind is 'plane'", () => {
    expect(planeToWorldObject(cruiser).kind).toBe("plane");
  });

  test("id is namespaced as plane:<icao24>", () => {
    expect(planeToWorldObject(cruiser).id).toBe("plane:3c4b2d");
    expect(planeToWorldObject(onGround).id).toBe("plane:4ca8ef");
  });

  test("lat and lon are forwarded verbatim", () => {
    const obj = planeToWorldObject(cruiser);
    expect(obj.lat).toBe(51.5074);
    expect(obj.lon).toBe(-0.1278);
  });

  test("altKm maps through correctly", () => {
    const obj = planeToWorldObject(cruiser);
    expect(obj.altKm).toBeCloseTo(10.2, 3);
  });

  test("heading maps to headingDeg", () => {
    const obj = planeToWorldObject(cruiser);
    expect(obj.heading).toBe(87.5);
  });

  test("heading falls back to 0 for on-ground with null true_track", () => {
    const obj = planeToWorldObject(onGround);
    expect(obj.heading).toBe(0);
  });

  test("label is the trimmed callsign", () => {
    expect(planeToWorldObject(cruiser).label).toBe("DLH456");
  });

  test("label falls back to icao24 when callsign was null", () => {
    expect(planeToWorldObject(onGround).label).toBe("4ca8ef");
  });

  test("type is inferred from the flight profile (high+fast cruiser → airliner)", () => {
    const obj = planeToWorldObject(cruiser);
    expect(obj.color).toBe("#fbbf24"); // PLANE_META.airliner colour
    expect(obj.icon).toBe("plane-airliner");
    expect(obj.typeLabel).toBe("Airliner");
  });

  test("meta carries all required keys", () => {
    const { meta } = planeToWorldObject(cruiser);
    expect(meta).toBeDefined();
    expect(meta).toHaveProperty("callsign", "DLH456");
    expect(meta).toHaveProperty("country", "Germany");
    expect(meta).toHaveProperty("velocityMs", 240);
    expect(meta).toHaveProperty("altKm");
    expect((meta as Record<string, unknown>).altKm).toBeCloseTo(10.2, 3);
    expect(meta).toHaveProperty("verticalRateMs");
    expect(meta).toHaveProperty("onGround", false);
  });

  test("meta.onGround is true for the ground vector", () => {
    const { meta } = planeToWorldObject(onGround);
    expect((meta as Record<string, unknown>).onGround).toBe(true);
  });

  test("meta.categoryTrusted is always false — this parser's input never carries a broadcast category", () => {
    // Matches lib/sources/adsb.ts's meta shape exactly (same field, real value, never
    // omitted), so a consumer reading categoryTrusted cannot tell which provider
    // served a given aircraft just from whether the field exists.
    expect((planeToWorldObject(cruiser).meta as Record<string, unknown>).categoryTrusted).toBe(false);
    expect((planeToWorldObject(onGround).meta as Record<string, unknown>).categoryTrusted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// squawk — index 14, drives the emergency-squawk (7500/7600/7700) alerts.
// The regional adapter dropped it; the global one MUST carry it through.
// ---------------------------------------------------------------------------

describe("squawk", () => {
  test("parseStates captures the squawk code when present", () => {
    const [p] = parseStates([VECTOR_CRUISER]);
    expect(p.squawk).toBe("1234");
  });

  test("parseStates yields empty string when squawk is null", () => {
    const [p] = parseStates([VECTOR_ON_GROUND]);
    expect(p.squawk).toBe("");
  });

  test("planeToWorldObject carries squawk on meta (emergency-squawk alerts read this)", () => {
    const [p] = parseStates([VECTOR_CRUISER]);
    const { meta } = planeToWorldObject(p);
    expect((meta as Record<string, unknown>).squawk).toBe("1234");
  });
});

// ---------------------------------------------------------------------------
// capPlanes — bounds the served set (payload + Data Cache 2 MB limit), keeping
// airborne aircraft ahead of ground ones. A global snapshot is ~10k aircraft,
// so this cap is load-bearing.
// ---------------------------------------------------------------------------

describe("capPlanes", () => {
  const mk = (id: string, onGround: boolean): WorldObject => ({
    kind: "plane",
    id,
    lat: 0,
    lon: 0,
    altKm: 0,
    heading: 0,
    label: id,
    color: "#000",
    icon: "plane-airliner",
    typeLabel: "Airliner",
    meta: { onGround },
  });

  test("returns the input unchanged when under the cap", () => {
    const objs = [mk("a", false), mk("b", true)];
    expect(capPlanes(objs, 5)).toHaveLength(2);
  });

  test("caps to the limit, preferring airborne over ground", () => {
    const objs = [mk("g1", true), mk("a1", false), mk("g2", true), mk("a2", false)];
    const capped = capPlanes(objs, 2);
    expect(capped).toHaveLength(2);
    expect(
      capped.every((o) => (o.meta as { onGround?: boolean }).onGround === false),
    ).toBe(true);
  });
});
