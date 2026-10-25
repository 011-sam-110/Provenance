import { describe, expect, it } from "vitest";
import { creditsFromAttribution, fmtClockUtc, fmtHeading, fmtLat, fmtLon, plural, refreshedText } from "@/lib/eye/wording";

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
    expect(fmtClockUtc(Date.UTC(2026, 9, 24, 22, 42, 52), false)).toBe("22:42");
  });

  it("say how long ago the vessels and aircraft arrived", () => {
    const now = 1_000_000;
    expect(refreshedText(now - 2_000, now)).toBe("Vessels and aircraft refreshed just now");
    expect(refreshedText(now - 47_000, now)).toBe("Vessels and aircraft refreshed 47 s ago");
    expect(refreshedText(now - 300_000, now)).toBe("Vessels and aircraft refreshed 5 min ago");
  });

  it("count in the singular and the plural", () => {
    expect(plural(1, "vessel", "vessels")).toBe("1 vessel");
    expect(plural(0, "vessel", "vessels")).toBe("0 vessels");
    expect(plural(12, "vessel", "vessels")).toBe("12 vessels");
  });
});

describe("creditsFromAttribution", () => {
  it("puts the ground first, keeps each credit once and the feeds in order", () => {
    // MapLibre's control text on /eye at Westminster, 25 Oct 2026.
    const text =
      "Powered by TfL Open Data | Imagery © Esri, Maxar, Earthstar Geographics | Aircraft © adsb.lol contributors (ODbL) · gap fill © adsb.fi (non-commercial use) | OpenFreeMap © OpenMapTiles Data from OpenStreetMap | Powered by TfL Open Data";
    expect(creditsFromAttribution(text)).toEqual([
      "Imagery © Esri, Maxar, Earthstar Geographics",
      "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
      "Powered by TfL Open Data",
      "Aircraft © adsb.lol contributors (ODbL) · gap fill © adsb.fi (non-commercial use)",
    ]);
  });

  it("is empty for an empty control", () => {
    expect(creditsFromAttribution("")).toEqual([]);
    expect(creditsFromAttribution("  |  ")).toEqual([]);
  });
});
