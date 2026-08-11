import { describe, expect, it } from "vitest";
import {
  STATUS_LAYERS,
  appStatusLine,
  breakingAnnouncement,
  stageRegionLabel,
} from "@/components/shell/a11y";

describe("stageRegionLabel", () => {
  it("names the flat map and the globe differently", () => {
    expect(stageRegionLabel({ focusedWidgetId: null, stage: "map2d" })).toBe("Live map");
    expect(stageRegionLabel({ focusedWidgetId: null, stage: "map3d" })).toBe("Live map, 3D globe");
  });

  it("stops claiming to be a map once a widget is expanded onto the stage", () => {
    const label = stageRegionLabel({ focusedWidgetId: "w1", focusedTitle: "Cameras", stage: "map2d" });
    expect(label).toBe("Cameras, expanded");
    expect(label).not.toMatch(/map/i);
  });

  it("still says something honest when the focused widget's type is unknown", () => {
    expect(stageRegionLabel({ focusedWidgetId: "w1", focusedTitle: null, stage: "map2d" }))
      .toBe("Expanded widget");
  });

  it("falls back for the retired clock stage rather than lying about a map", () => {
    expect(stageRegionLabel({ focusedWidgetId: null, stage: "clock" })).toBe("Main stage");
  });
});

describe("appStatusLine", () => {
  const allOn = { cameras: true, planes: true, satellites: true, webcams: true };

  it("reports the board and splits the layers into on and off", () => {
    expect(appStatusLine({ boardTitle: "World Overview", layers: { cameras: true, planes: false, satellites: true, webcams: false } }))
      .toBe("World Overview board. Layers on: cameras, satellites. Off: planes, webcams.");
  });

  it("collapses the all-on and all-off cases instead of listing an empty side", () => {
    expect(appStatusLine({ boardTitle: "Tools", layers: allOn })).toBe("Tools board. All data layers are on.");
    expect(appStatusLine({ boardTitle: "Tools", layers: {} })).toBe("Tools board. No data layers are on.");
  });

  it("drops the board sentence entirely when no board is loaded", () => {
    expect(appStatusLine({ boardTitle: null, layers: allOn })).toBe("All data layers are on.");
    expect(appStatusLine({ layers: allOn })).toBe("All data layers are on.");
  });

  // The whole point of this string: it is what a polite live region will repeat, so
  // it must not move when the underlying tallies move. A count anywhere in here
  // would make a screen reader recite the camera total every few seconds.
  it("contains no digits, so a ticking count can never churn the live region", () => {
    expect(appStatusLine({ boardTitle: "World Overview", layers: allOn })).not.toMatch(/\d/);
    expect(appStatusLine({ boardTitle: "Air · Sea · Space", layers: { cameras: true } })).not.toMatch(/\d/);
  });

  it("is stable across re-renders that change nothing", () => {
    const a = appStatusLine({ boardTitle: "Earth Systems", layers: { cameras: true, satellites: true } });
    const b = appStatusLine({ boardTitle: "Earth Systems", layers: { cameras: true, satellites: true } });
    expect(a).toBe(b);
  });

  it("treats a missing key as off rather than throwing", () => {
    expect(appStatusLine({ layers: { cameras: true } }))
      .toBe("Layers on: cameras. Off: planes, satellites, webcams.");
  });

  it("only ever talks about the four real data layers", () => {
    expect([...STATUS_LAYERS]).toEqual(["cameras", "planes", "satellites", "webcams"]);
  });
});

describe("breakingAnnouncement", () => {
  const quake = { key: "q:us7000", kind: "quake" as const, text: "M6.4 earthquake, 32 km SW of Hualien", detail: "USGS · 11 minutes ago" };
  const news = { key: "n:abc", kind: "news" as const, text: "Three outlets report a ceasefire", detail: "Reuters, AP, AFP" };

  it("says nothing when there is nothing to announce", () => {
    expect(breakingAnnouncement(null, null)).toBe("");
    expect(breakingAnnouncement(undefined, null)).toBe("");
  });

  it("spells the tag out in words instead of leaving the banner's shouty capitals", () => {
    expect(breakingAnnouncement(quake, null)).toBe("Alert: M6.4 earthquake, 32 km SW of Hualien. USGS · 11 minutes ago");
    expect(breakingAnnouncement(news, null)).toBe("Breaking news: Three outlets report a ceasefire. Reuters, AP, AFP");
  });

  it("goes silent for an alert the user has already dismissed", () => {
    expect(breakingAnnouncement(quake, "q:us7000")).toBe("");
  });

  it("still announces a NEW alert while an older one stays dismissed", () => {
    expect(breakingAnnouncement(news, "q:us7000")).toContain("Breaking news:");
  });

  it("does not leave a dangling full stop when there is no detail line", () => {
    expect(breakingAnnouncement({ ...quake, detail: "   " }, null)).toBe("Alert: M6.4 earthquake, 32 km SW of Hualien");
  });
});
