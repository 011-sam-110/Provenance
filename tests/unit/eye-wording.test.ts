import { describe, expect, it } from "vitest";
import * as wording from "@/lib/eye/wording";
import {
  AUTO_TURN_LABEL,
  CONTROLS_LABEL,
  CREDITS_LABEL,
  EXIT_LABEL,
  EYE_SEARCH_NAME,
  EYE_SEARCH_PLACEHOLDER,
  HOME_LABEL,
  SECTION_SHORT,
  creditsFromAttribution,
  drawnAsText,
  fmtClockUtc,
  fmtHeading,
  fmtLat,
  fmtLon,
  leftOutText,
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

describe("the frame's words", () => {
  it("are the design's, short and active", () => {
    expect(sourcesName()).toBe("Sources & layers");
    expect(AUTO_TURN_LABEL).toBe("Auto-turn");
    expect(CONTROLS_LABEL).toBe("Controls");
    expect(EXIT_LABEL).toBe("Exit to dashboard");
    expect(CREDITS_LABEL).toBe("© Credits");
    expect(HOME_LABEL).toBe("About Provenance");
    expect(EYE_SEARCH_PLACEHOLDER).toBe("Search places, cameras, vessels");
  });

  it("name the search box in a sentence, which a screen reader reads whole", () => {
    expect(EYE_SEARCH_NAME).toBe("Search places, cameras and vessels");
  });
});

describe("the Sources tray's words", () => {
  const crime = { id: "crime", label: "UK street crime", credit: "data.police.uk", precision: "area" as const, color: "#9333ea" };

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

  it("say what is left out in words, with no count", () => {
    expect(pinCapText(6)).toBe("The sidebar holds 6. Unpin one first.");
    expect(noMatchText("zzz")).toBe("No source here is called \u201czzz\u201d.");
    expect(leftOutText({ country: 5, widget: 1 })).toBe("Not drawn here: country-wide layers and the headlines. The dashboard has them.");
    expect(leftOutText({ country: 1, widget: 0 })).toBe("Not drawn here: country-wide layers. The dashboard has them.");
    expect(leftOutText({ country: 0, widget: 2 })).toBe("Not drawn here: the headlines. The dashboard has them.");
    expect(leftOutText({ country: 0, widget: 0 })).toBeNull();
  });

  it("name the pin and the switch by the source's label", () => {
    expect(pinName("Protests", false)).toBe("Pin Protests to the sidebar");
    expect(pinName("Protests", true)).toBe("Unpin Protests from the sidebar");
    expect(switchName("Ships")).toBe("Show Ships in this view");
  });

  it("say a pin and an unpin aloud", () => {
    expect(pinnedText("Protests")).toBe("Pinned Protests to the sidebar.");
    expect(unpinnedText("Protests")).toBe("Unpinned Protests.");
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
      precisionWords("exact"),
      precisionWords("facility"),
      precisionWords("area"),
      precisionWords("country"),
      drawnAsText(null),
      pinCapText(5),
      noMatchText("x"),
      leftOutText({ country: 2, widget: 1 })!,
      pinName("X", true),
      switchName("X"),
      pinnedText("X"),
      unpinnedText("X"),
      signalLedgerRow({ id: "x", label: "X", credit: "Y", precision: "area", color: "#000" }, 2).detail,
      signalLedgerRow({ id: "x", label: "X", credit: "Y", precision: null, color: "#000" }, null).detail,
    );
    for (const text of strings) expect(/\blive\b/i.test(text), text).toBe(false);
  });
});
