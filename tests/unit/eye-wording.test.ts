import { describe, expect, it } from "vitest";
import { fmtClockUtc, fmtHeading, fmtLat, fmtLon, plural } from "@/lib/eye/wording";

describe("the HUD readouts", () => {
  it("print positions to four decimals with their hemisphere", () => {
    expect(fmtLat(51.50134)).toBe("51.5013° N");
    expect(fmtLat(-33.8568)).toBe("33.8568° S");
    expect(fmtLon(-0.12182)).toBe("0.1218° W");
    expect(fmtLon(151.2153)).toBe("151.2153° E");
  });

  it("print a heading as three digits on the compass", () => {
    expect(fmtHeading(32)).toBe("032");
    expect(fmtHeading(-68)).toBe("292");
    expect(fmtHeading(359.6)).toBe("000");
    expect(fmtHeading(720)).toBe("000");
  });

  it("print the clock in UTC", () => {
    expect(fmtClockUtc(Date.UTC(2026, 9, 24, 22, 42, 52))).toBe("22:42:52");
  });

  it("count in the singular and the plural", () => {
    expect(plural(1, "vessel", "vessels")).toBe("1 vessel");
    expect(plural(0, "vessel", "vessels")).toBe("0 vessels");
    expect(plural(12, "vessel", "vessels")).toBe("12 vessels");
  });
});
