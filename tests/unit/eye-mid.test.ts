import { describe, expect, it } from "vitest";
import { MID } from "@/lib/eye/mid.data";
import { flagFromMmsi, midOf } from "@/lib/eye/mid";

describe("the maritime identification digits", () => {
  it("has the 292 entries of the transcribed table, each a three-digit key", () => {
    const keys = Object.keys(MID);
    expect(keys).toHaveLength(292);
    for (const k of keys) {
      expect(k).toMatch(/^[2-7]\d\d$/);
      expect(MID[k].length).toBeGreaterThan(0);
      for (const name of MID[k]) expect(name.trim()).toBe(name);
    }
  });

  it("names the flags the real vessels in the plan carry", () => {
    expect(flagFromMmsi(232000001)).toBe("United Kingdom");
    expect(flagFromMmsi(235092958)).toBe("United Kingdom"); // MILLENNIUM DIAMOND
    expect(flagFromMmsi(230108270)).toBe("Finland"); // VALBORG
    expect(flagFromMmsi(276000000)).toBe("Estonia");
    expect(flagFromMmsi(636012345)).toBe("Liberia");
    expect(flagFromMmsi(538001234)).toBe("Marshall Islands");
  });

  it("joins the three names MID 306 is shared by", () => {
    expect(flagFromMmsi(306123456)).toBe("Bonaire, Sint Eustatius and Saba, Curaçao or Sint Maarten");
  });

  it("reads the first three digits of a nine-digit ship station number only", () => {
    expect(midOf(235092958)).toBe("235");
    expect(midOf(710000000)).toBe("710");
  });

  it("gives no flag for a number that is not a ship station's", () => {
    expect(midOf(2320001)).toBeNull(); // 002320001, a coast station: the leading zeros are gone
    expect(midOf(23500001)).toBeNull(); // 023500001, a group call: eight digits
    expect(midOf(111232001)).toBeNull(); // SAR aircraft
    expect(midOf(992320001)).toBeNull(); // aid to navigation
    expect(midOf(982320001)).toBeNull();
    expect(midOf(812345678)).toBeNull(); // handheld VHF
    expect(midOf(970123456)).toBeNull(); // beacon
    expect(midOf(23509295)).toBeNull(); // eight digits
    expect(midOf(2350929580)).toBeNull(); // ten digits
    expect(midOf(0)).toBeNull();
    expect(midOf(235092958.5)).toBeNull();
    expect(midOf(undefined)).toBeNull();
    expect(midOf(null)).toBeNull();
    for (const n of [2320001, 23500001, 111232001, 992320001, 982320001, 812345678, 970123456]) {
      expect(flagFromMmsi(n)).toBeNull();
    }
  });

  it("gives no flag for a ship station number whose three digits are not in the table", () => {
    expect(midOf(200123456)).toBe("200");
    expect(flagFromMmsi(200123456)).toBeNull();
  });
});
