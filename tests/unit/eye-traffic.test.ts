import { describe, expect, it } from "vitest";
import {
  AIRCRAFT_CREDIT,
  METRES_PER_KNOT_MINUTE,
  aircraftLedgerRow,
  aircraftTag,
  inBounds,
  oneMinuteAhead,
  readDegrees,
  toAircraft,
  toVessel,
  vesselCredits,
  vesselLedgerRow,
  vesselTag,
  type AisFeatureLike,
} from "@/lib/eye/traffic";
import { AISSTREAM_ATTRIBUTION } from "@/lib/signals/ais";
import { ADSB_ATTRIBUTION } from "@/lib/sources/adsb";

/** Great-circle metres between two [lon, lat] points. */
function metres(a: [number, number], b: [number, number]): number {
  const R = 6_371_008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const feature = (props: AisFeatureLike["props"], over: Partial<AisFeatureLike> = {}): AisFeatureLike => ({
  id: "ais:235000001",
  lat: 51.503,
  lon: -0.12,
  title: "PEARL OF LONDON",
  props: { vessel: "PEARL OF LONDON", source: "AISStream", ...props },
  ...over,
});

describe("readDegrees", () => {
  it("reads the adapter's degree strings, and treats AIS's 360 as not sent", () => {
    expect(readDegrees("028°")).toBe(28);
    expect(readDegrees("0°")).toBe(0);
    expect(readDegrees("359°")).toBe(359);
    expect(readDegrees("360°")).toBeNull();
    expect(readDegrees("—")).toBeNull();
    expect(readDegrees(undefined)).toBeNull();
  });
});

describe("the one-minute line", () => {
  it("is a minute's run at the reported speed, along the reported course", () => {
    const start: [number, number] = [-0.12, 51.5];
    const north = oneMinuteAhead(51.5, -0.12, 0, 10);
    expect(metres(start, north)).toBeCloseTo(10 * METRES_PER_KNOT_MINUTE, 0);
    expect(north[0]).toBeCloseTo(-0.12, 9);
    expect(north[1]).toBeGreaterThan(51.5);
    const east = oneMinuteAhead(51.5, -0.12, 90, 4.4);
    expect(metres(start, east)).toBeCloseTo(4.4 * METRES_PER_KNOT_MINUTE, 0);
    expect(east[0]).toBeGreaterThan(-0.12);
  });

  it("10 knots is about 309 metres a minute", () => {
    expect(10 * METRES_PER_KNOT_MINUTE).toBeCloseTo(308.67, 1);
  });
});

describe("toVessel", () => {
  it("draws a moving vessel along its course, with a line a minute ahead", () => {
    const v = toVessel(feature({ speedKt: 4.4, course: "028°", heading: "031°" }))!;
    expect(v.moving).toBe(true);
    expect(v.rot).toBe(28);
    expect(v.ahead).not.toBeNull();
  });

  it("points a stopped vessel by its bow, with no line", () => {
    const v = toVessel(feature({ speedKt: 0, course: "203°", heading: "250°" }))!;
    expect(v.moving).toBe(false);
    expect(v.rot).toBe(250);
    expect(v.ahead).toBeNull();
  });

  it("does not take AIS's 'speed not available' for a speed", () => {
    const v = toVessel(feature({ speedKt: 102.3, course: "028°" }))!;
    expect(v.knots).toBeNull();
    expect(v.moving).toBe(false);
    expect(vesselTag(v).meta).toBe("Speed not sent");
  });

  it("refuses a feature with no position", () => {
    expect(toVessel(feature({}, { lat: Number.NaN }))).toBeNull();
  });
});

describe("vesselTag", () => {
  it("keeps the name as AIS sends it, and says type, knots and course", () => {
    const v = toVessel(feature({ speedKt: 4.4, course: "028°", shipType: "passenger" }))!;
    expect(vesselTag(v)).toEqual({ title: "PEARL OF LONDON", meta: "Passenger · 4.4 kn · 028°" });
  });

  it("says Stopped for a vessel at rest", () => {
    const v = toVessel(feature({ speedKt: 0.2, course: "100°" }))!;
    expect(vesselTag(v).meta).toBe("Stopped");
  });
});

describe("aircraft", () => {
  it("leaves out aircraft on the ground", () => {
    expect(toAircraft({ id: "plane:1", lat: 51.47, lon: -0.45, meta: { onGround: true } })).toBeNull();
  });

  it("gives feet to the nearest 50, the callsign and the type", () => {
    const a = toAircraft({ id: "plane:1", lat: 51.5, lon: -0.1, altKm: 2.5755, heading: 271.4, meta: { callsign: "BAW123", typeCode: "A320" } })!;
    expect(a.feet).toBe(8450);
    expect(a.rot).toBe(271.4);
    expect(aircraftTag(a)).toEqual({ title: "BAW123", meta: "8,450 ft · A320" });
  });

  it("says so when no altitude was sent, and falls back from the callsign", () => {
    const a = toAircraft({ id: "plane:2", lat: 51.5, lon: -0.1, label: "", meta: { registration: "G-ABCD" } })!;
    expect(aircraftTag(a)).toEqual({ title: "G-ABCD", meta: "Altitude not sent" });
  });
});

describe("the ledger rows", () => {
  it("counts vessels and how many are moving", () => {
    const vs = [
      toVessel(feature({ speedKt: 4.4, course: "028°" }))!,
      toVessel(feature({ speedKt: 0 }, { id: "ais:2" }))!,
    ];
    expect(vesselLedgerRow(vs)).toEqual({
      kind: "ship",
      count: 2,
      label: "vessels",
      detail: "1 moving · AIS heard in the last 20 min",
      short: "vessels",
    });
  });

  it("says aircraft are a sample, never the whole sky, and how old the positions are", () => {
    expect(aircraftLedgerRow(0, { sampled: true, ageMs: 30_000 }).detail).toBe(
      "adsb.lol (ODbL) · from a worldwide sample, not every aircraft",
    );
    expect(aircraftLedgerRow(2, { sampled: false, ageMs: 7 * 60_000 }).detail).toBe("adsb.lol (ODbL) · positions 7 min old");
  });

  it("credits each vessel feed once, and the aircraft feed by its own credit", () => {
    expect(vesselCredits([{ source: "AISStream" }, { source: "AISStream" }])).toEqual([AISSTREAM_ATTRIBUTION]);
    expect(AIRCRAFT_CREDIT).toBe(ADSB_ATTRIBUTION);
  });
});

describe("inBounds", () => {
  it("keeps what is inside the box plus its pad", () => {
    const b = { west: -0.2, south: 51.45, east: 0, north: 51.55 };
    expect(inBounds(51.5, -0.1, b, 0)).toBe(true);
    expect(inBounds(51.56, -0.1, b, 0)).toBe(false);
    expect(inBounds(51.56, -0.1, b, 0.02)).toBe(true);
  });
});
