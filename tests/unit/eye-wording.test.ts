import { describe, expect, it } from "vitest";
import * as wording from "@/lib/eye/wording";
import {
  FULL_MAP_LABEL,
  SECTION_SHORT,
  creditsFromAttribution,
  drawnAsText,
  fmtClockUtc,
  fmtHeading,
  fmtLat,
  fmtLon,
  fullMapName,
  hereText,
  leftOutText,
  liftedText,
  movedPinText,
  noMatchText,
  pinCapText,
  pinName,
  pinnedText,
  plural,
  precisionWords,
  refreshedText,
  signalLedgerRow,
  sourcesName,
  switchName,
  unpinGhostText,
  unpinnedText,
} from "@/lib/eye/wording";

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

describe("the Sources tray's words", () => {
  const crime = { id: "crime", label: "UK street crime", credit: "data.police.uk", precision: "area" as const, color: "#9333ea" };

  it("name the button and say where the link goes, from the count it is given", () => {
    expect(sourcesName()).toBe("Sources");
    expect(FULL_MAP_LABEL).toBe("Open the full map");
    expect(fullMapName(55)).toBe("Open the full map with all 55 sources");
    expect(fullMapName(7)).toBe("Open the full map with all 7 sources");
  });

  it("say how precisely a layer places what it shows, for each level", () => {
    expect(precisionWords("exact")).toBe("exact points");
    expect(precisionWords("facility")).toBe("named sites");
    expect(precisionWords("area")).toBe("areas, not exact points");
    expect(precisionWords("country")).toBe("country figures");
    expect(drawnAsText("area")).toBe("Drawn as areas, not exact points");
    expect(drawnAsText(null)).toBe("Drawn on the map");
  });

  it("the ledger row of a console layer: how many, whose, and how precise", () => {
    const r = signalLedgerRow(crime, 14);
    expect(r).toMatchObject({ kind: "signal", id: "crime", count: 14, label: "UK street crime", short: "UK street crime", color: "#9333ea" });
    expect(r.detail).toBe("in view, data.police.uk, areas, not exact points");
  });

  it("the ledger row says so when none is in view, and for each precision", () => {
    expect(signalLedgerRow(crime, 0)).toMatchObject({ count: 0 });
    expect(signalLedgerRow(crime, 0).detail.startsWith("none in view, ")).toBe(true);
    expect(signalLedgerRow({ ...crime, precision: "exact" }, 3).detail).toBe("in view, data.police.uk, exact points");
    expect(signalLedgerRow({ ...crime, precision: "facility" }, 3).detail).toBe("in view, data.police.uk, named sites");
    expect(signalLedgerRow({ ...crime, precision: "country" }, 3).detail).toBe("in view, data.police.uk, country figures");
  });

  it("a layer with no marks to count states what it is instead of a number", () => {
    const r = signalLedgerRow({ ...crime, id: "countries", label: "Borders & names", precision: null }, null);
    expect(r.count).toBeNull();
    expect(r.detail).toBe("drawn on the map, data.police.uk");
  });

  it("derive every number from what they are given", () => {
    expect(hereText(0)).toBe("0 here");
    expect(hereText(14)).toBe("14 here");
    expect(pinCapText(5)).toBe("The bar holds 5. Unpin one first.");
    expect(pinCapText(6)).toBe("The bar holds 6. Unpin one first.");
    expect(noMatchText("zzz", 55)).toBe("No source here is called \u201czzz\u201d. Open the full map for all 55.");
    expect(leftOutText(55, { country: 5, widget: 1 })).toBe("all 55 sources. 6 are not drawn here: 5 country-wide, 1 headlines widget.");
    expect(leftOutText(30, { country: 1, widget: 0 })).toBe("all 30 sources. 1 is not drawn here: 1 country-wide.");
    expect(leftOutText(30, { country: 0, widget: 2 })).toBe("all 30 sources. 2 are not drawn here: 2 headlines widgets.");
    expect(leftOutText(30, { country: 0, widget: 0 })).toBe("all 30 sources.");
  });

  it("name the pin and the switch by the source's label", () => {
    expect(pinName("Protests", false)).toBe("Pin Protests to the bar");
    expect(pinName("Protests", true)).toBe("Unpin Protests from the bar");
    expect(switchName("Ships")).toBe("Show Ships in this view");
  });

  it("say a lift, a drop, a move and an unpin aloud", () => {
    expect(liftedText("Protests")).toContain("Picked up Protests");
    expect(pinnedText("Protests", 2, 3)).toBe("Pinned Protests, 2 of 3.");
    expect(movedPinText("Protests", 1, 3)).toBe("Protests moved to 1 of 3.");
    expect(unpinnedText("Protests")).toBe("Unpinned Protests.");
    expect(unpinGhostText("Protests")).toBe("Unpin Protests");
  });

  it("have a short name for each of the console's sections, Air quality for the last", () => {
    expect(Object.keys(SECTION_SHORT).sort()).toEqual(["air-space", "ground", "hazards", "human", "infrastructure", "security"]);
    expect(SECTION_SHORT.human).toBe("Air quality");
  });

  it("never call a still live: no string the module gives out contains the word", () => {
    const strings: string[] = [];
    for (const v of Object.values(wording)) if (typeof v === "string") strings.push(v);
    for (const v of Object.values(SECTION_SHORT)) strings.push(v);
    strings.push(
      sourcesName(),
      fullMapName(3),
      precisionWords("exact"),
      precisionWords("facility"),
      precisionWords("area"),
      precisionWords("country"),
      drawnAsText(null),
      hereText(2),
      pinCapText(5),
      noMatchText("x", 3),
      leftOutText(10, { country: 2, widget: 1 }),
      pinName("X", true),
      switchName("X"),
      liftedText("X"),
      pinnedText("X", 1, 2),
      movedPinText("X", 1, 2),
      unpinnedText("X"),
      unpinGhostText("X"),
      signalLedgerRow({ id: "x", label: "X", credit: "Y", precision: "area", color: "#000" }, 2).detail,
      signalLedgerRow({ id: "x", label: "X", credit: "Y", precision: null, color: "#000" }, null).detail,
    );
    for (const text of strings) expect(/\blive\b/i.test(text), text).toBe(false);
  });
});
