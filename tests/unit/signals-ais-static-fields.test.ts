import { describe, expect, it } from "vitest";
import {
  cleanCallSign,
  draughtFromTenths,
  etaFromIso,
  etaFromPacked,
  etaFromParts,
  sizeFrom,
  validImo,
} from "@/lib/signals/aisStatic";

// The values below are real ones from 28 Oct 2026: Digitraffic's ship register
// (tests/fixtures/eye-ais-helsinki.json is a cut of what it served) and the live ETAs of
// vessels in it. AISStream's own messages could not be captured without a socket, so its
// tests build the message from the published schema (see signals-ais-static.test.ts).

describe("cleanCallSign", () => {
  it("strips the @ padding and trims", () => {
    expect(cleanCallSign("OFNR@@@")).toBe("OFNR");
    expect(cleanCallSign("  OH2BHA ")).toBe("OH2BHA");
    expect(cleanCallSign("MBLC5@@")).toBe("MBLC5");
  });
  it("gives none for empty, all padding or not a string", () => {
    expect(cleanCallSign("")).toBeUndefined();
    expect(cleanCallSign("@@@@@@@")).toBeUndefined();
    expect(cleanCallSign("   ")).toBeUndefined();
    expect(cleanCallSign(null)).toBeUndefined();
    expect(cleanCallSign(undefined)).toBeUndefined();
  });
});

describe("validImo", () => {
  it("accepts a number whose check digit is right", () => {
    expect(validImo(5375462)).toBe(5375462);
    expect(validImo(9773064)).toBe(9773064);
    expect(validImo(8802076)).toBe(8802076);
  });
  it("rejects a wrong check digit, a wrong length and a placeholder", () => {
    expect(validImo(5375463)).toBeUndefined();
    expect(validImo(0)).toBeUndefined();
    expect(validImo(303174162)).toBeUndefined(); // in the live Digitraffic register
    expect(validImo(536491800)).toBeUndefined(); // so is this
    expect(validImo(123456)).toBeUndefined();
    expect(validImo(1234567.5)).toBeUndefined();
    expect(validImo(null)).toBeUndefined();
    expect(validImo(undefined)).toBeUndefined();
  });
});

describe("sizeFrom", () => {
  it("adds bow and stern for the length, port and starboard for the beam", () => {
    expect(sizeFrom(20, 10, 3, 4)).toEqual({ lengthM: 30, beamM: 7 });
  });
  it("leaves out a dimension whose sum is 0, which is how AIS says not sent", () => {
    expect(sizeFrom(0, 0, 0, 0)).toEqual({});
    expect(sizeFrom(30, 0, 0, 0)).toEqual({ lengthM: 30 });
    expect(sizeFrom(0, 0, 3, 4)).toEqual({ beamM: 7 });
    expect(sizeFrom()).toEqual({});
    expect(sizeFrom(null, undefined, null, null)).toEqual({});
  });
  it("treats a missing part as 0 and ignores a negative one", () => {
    expect(sizeFrom(25, undefined, 5, null)).toEqual({ lengthM: 25, beamM: 5 });
    expect(sizeFrom(-5, 10)).toEqual({ lengthM: 10 });
  });
});

describe("draughtFromTenths", () => {
  it("turns tenths of a metre into metres", () => {
    expect(draughtFromTenths(24)).toBe(2.4);
    expect(draughtFromTenths(255)).toBe(25.5);
    expect(draughtFromTenths(103)).toBe(10.3);
  });
  it("gives none for 0, which is not available", () => {
    expect(draughtFromTenths(0)).toBeUndefined();
    expect(draughtFromTenths(null)).toBeUndefined();
    expect(draughtFromTenths(undefined)).toBeUndefined();
    expect(draughtFromTenths(-3)).toBeUndefined();
  });
});

describe("etaFromParts", () => {
  it("writes a date and a time, UTC", () => {
    expect(etaFromParts(10, 28, 22, 30)).toBe("10-28T22:30Z");
    expect(etaFromParts(9, 8, 5, 0)).toBe("09-08T05:00Z");
  });
  it("needs a real month and day", () => {
    expect(etaFromParts(0, 0, 24, 60)).toBeUndefined();
    expect(etaFromParts(13, 1, 0, 0)).toBeUndefined();
    expect(etaFromParts(1, 0, 0, 0)).toBeUndefined();
    expect(etaFromParts(1, 32, 0, 0)).toBeUndefined();
    expect(etaFromParts(null, null)).toBeUndefined();
    expect(etaFromParts()).toBeUndefined();
  });
  it("drops the time only when the hour is 24 or the minute 60", () => {
    expect(etaFromParts(10, 28, 24, 0)).toBe("10-28");
    expect(etaFromParts(10, 28, 12, 60)).toBe("10-28");
    expect(etaFromParts(10, 28, 24, 60)).toBe("10-28");
    expect(etaFromParts(10, 28)).toBe("10-28");
  });
});

describe("etaFromPacked", () => {
  it("unpacks Digitraffic's number (checked against real vessels, 28 Oct 2026)", () => {
    expect(etaFromPacked(713024)).toBe("10-28T05:00Z");
    expect(etaFromPacked(627904)).toBe("09-18T19:00Z"); // VALBORG
    expect(etaFromPacked(714142)).toBe("10-28T22:30Z");
  });
  it("gives none for month 0, day 0, hour 24, minute 60", () => {
    expect(etaFromPacked(1596)).toBeUndefined();
    expect(etaFromPacked(0)).toBeUndefined();
    expect(etaFromPacked(null)).toBeUndefined();
    expect(etaFromPacked(undefined)).toBeUndefined();
    expect(etaFromPacked(-1)).toBeUndefined();
  });
});

describe("etaFromIso", () => {
  it("keeps the UTC month, day, hour and minute and drops the year", () => {
    expect(etaFromIso("2026-10-28T22:30:00Z")).toBe("10-28T22:30Z");
    expect(etaFromIso("2026-10-28T23:30:00+01:00")).toBe("10-28T22:30Z");
  });
  it("gives none for text that is not a date, and for a default date", () => {
    expect(etaFromIso("soon")).toBeUndefined();
    expect(etaFromIso("")).toBeUndefined();
    expect(etaFromIso(null)).toBeUndefined();
    expect(etaFromIso(undefined)).toBeUndefined();
    expect(etaFromIso("0001-01-01T00:00:00Z")).toBeUndefined();
  });
});
