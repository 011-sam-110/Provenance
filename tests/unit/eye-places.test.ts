import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLACE,
  EYE_CAMERA_ZOOM,
  EYE_DEFAULT_TILT,
  EYE_MAX_TILT,
  EYE_MAX_ZOOM,
  EYE_MIN_ZOOM,
  EYE_PLACES,
  consoleHref,
  eyeCameraHref,
  eyePlaceHref,
  eyeSpotHref,
  parseEyeLink,
  wrapHeading,
} from "@/lib/eye/places";
import { decodeViewState } from "@/lib/share/url";

const parse = (href: string, portrait = false) => parseEyeLink(new URL(href, "https://x.test").searchParams, portrait);

/** Metres between two points, flat-earth: plenty at city scale. */
const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const dy = (a.lat - b.lat) * 111_320;
  const dx = (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

describe("the presets", () => {
  it("are the three reel places, with unique ids", () => {
    expect(EYE_PLACES.map((p) => p.id)).toEqual(["westminster", "tower-bridge", "piccadilly"]);
  });

  it("frame every view inside the range a link may ask for", () => {
    for (const p of EYE_PLACES) {
      for (const v of [p.wide, p.tall]) {
        expect(v.zoom).toBeGreaterThanOrEqual(EYE_MIN_ZOOM);
        expect(v.zoom).toBeLessThanOrEqual(EYE_MAX_ZOOM);
        expect(v.tilt).toBeGreaterThan(0);
        expect(v.tilt).toBeLessThanOrEqual(EYE_MAX_TILT);
        expect(v.heading).toBeGreaterThanOrEqual(0);
        expect(v.heading).toBeLessThan(360);
      }
    }
  });

  it("frame the wide and the tall view on the same place", () => {
    for (const p of EYE_PLACES) {
      expect(metres(p.wide, p.tall)).toBeLessThan(400);
    }
  });
});

describe("parseEyeLink", () => {
  it("opens the first preset on a bare link, framed for the screen's shape", () => {
    expect(parse("/eye")).toEqual({ kind: "place", place: DEFAULT_PLACE, view: DEFAULT_PLACE.wide });
    expect(parse("/eye", true)).toEqual({ kind: "place", place: DEFAULT_PLACE, view: DEFAULT_PLACE.tall });
  });

  it("opens a named preset, and the first one for a name it does not know", () => {
    const t = parse("/eye?place=tower-bridge");
    expect(t.kind === "place" && t.place.id).toBe("tower-bridge");
    expect(parse("/eye?place=atlantis")).toEqual(parse("/eye"));
  });

  it("opens any spot, clamped to where there is a city to see", () => {
    expect(parse("/eye?lat=48.8584&lon=2.2945&z=16.5&heading=120&tilt=50")).toEqual({
      kind: "spot",
      view: { lat: 48.8584, lon: 2.2945, zoom: 16.5, tilt: 50, heading: 120 },
    });
    const far = parse("/eye?lat=48.8584&lon=2.2945&z=3&heading=-30&tilt=88");
    expect(far.view).toEqual({ lat: 48.8584, lon: 2.2945, zoom: EYE_MIN_ZOOM, tilt: EYE_MAX_TILT, heading: 330 });
    expect(parse("/eye?lat=48.8584&lon=2.2945&z=40").view.zoom).toBe(EYE_MAX_ZOOM);
    expect(parse("/eye?lat=48.8584&lon=2.2945").view.tilt).toBe(EYE_DEFAULT_TILT);
  });

  it("falls back to the first preset on a broken or impossible position", () => {
    for (const href of ["/eye?lat=abc&lon=2", "/eye?lat=51.5", "/eye?lat=91&lon=0", "/eye?lat=0&lon=200", "/eye?lat=&lon="]) {
      expect(parse(href)).toEqual(parse("/eye"));
    }
  });

  it("opens a camera's spot close in, and only for a real camera id", () => {
    const t = parse("/eye?cam=tfl:JamCams_00001.04227&lat=51.50127&lon=-0.12397");
    expect(t).toEqual({
      kind: "camera",
      cameraId: "tfl:JamCams_00001.04227",
      view: { lat: 51.50127, lon: -0.12397, zoom: EYE_CAMERA_ZOOM, tilt: EYE_DEFAULT_TILT, heading: 0 },
    });
    expect(parse("/eye?cam=%3Cscript%3E&lat=51.5&lon=-0.12").kind).toBe("spot");
    expect(parse("/eye?cam=no-colon&lat=51.5&lon=-0.12").kind).toBe("spot");
  });

  it("opens a place link that also names a view at that view, under the place's name", () => {
    const t = parse("/eye?place=tower-bridge&lat=51.50531&lon=-0.08056&z=15.7&heading=247&tilt=48");
    expect(t).toEqual({
      kind: "place",
      place: EYE_PLACES.find((p) => p.id === "tower-bridge"),
      view: { lat: 51.50531, lon: -0.08056, zoom: 15.7, tilt: 48, heading: 247 },
    });
    expect(t.kind === "place" && t.place.name).toBe("Tower Bridge");
  });

  it("frames what such a link leaves out as the place is framed, for the screen's shape", () => {
    const tower = EYE_PLACES.find((p) => p.id === "tower-bridge")!;
    const bare = "/eye?place=tower-bridge&lat=51.5&lon=-0.08";
    expect(parse(bare).view).toEqual({ lat: 51.5, lon: -0.08, zoom: tower.wide.zoom, tilt: tower.wide.tilt, heading: tower.wide.heading });
    expect(parse(bare, true).view).toEqual({ lat: 51.5, lon: -0.08, zoom: tower.tall.zoom, tilt: tower.tall.tilt, heading: tower.tall.heading });
  });

  it("clamps such a link as it clamps a spot, and ignores a broken position", () => {
    const far = parse("/eye?place=westminster&lat=51.5&lon=-0.12&z=3&heading=-30&tilt=88");
    expect(far.view).toEqual({ lat: 51.5, lon: -0.12, zoom: EYE_MIN_ZOOM, tilt: EYE_MAX_TILT, heading: 330 });
    // A broken position is no position: the place opens as framed by hand.
    expect(parse("/eye?place=westminster&lat=abc&lon=-0.12")).toEqual(parse("/eye?place=westminster"));
    expect(parse("/eye?place=westminster&lat=91&lon=0")).toEqual(parse("/eye?place=westminster"));
  });

  it("leaves a bare place link as it was", () => {
    const t = parse("/eye?place=piccadilly");
    expect(t.kind === "place" && t.view).toEqual(EYE_PLACES.find((p) => p.id === "piccadilly")!.wide);
  });
});

describe("links", () => {
  it("a preset link opens that preset", () => {
    for (const p of EYE_PLACES) {
      const t = parse(eyePlaceHref(p.id));
      expect(t.kind === "place" && t.place.id).toBe(p.id);
    }
  });

  it("a spot link round-trips, rounded to what a link needs", () => {
    const view = { lat: 51.507351234, lon: -0.127758891, zoom: 16.237, tilt: 47.6, heading: 211.4 };
    expect(parse(eyeSpotHref(view)).view).toEqual({ lat: 51.50735, lon: -0.12776, zoom: 16.24, tilt: 48, heading: 211 });
  });

  it("a spot link from a console looking straight down asks for the view's own tilt", () => {
    expect(parse(eyeSpotHref({ lat: 51.5, lon: -0.12, zoom: 15, tilt: 0, heading: 0 })).view.tilt).toBe(EYE_DEFAULT_TILT);
  });

  it("a negative console bearing becomes a compass heading", () => {
    expect(parse(eyeSpotHref({ lat: 51.5, lon: -0.12, zoom: 15, tilt: 50, heading: -45 })).view.heading).toBe(315);
  });

  it("a camera link round-trips", () => {
    const t = parse(eyeCameraHref("tfl:JamCams_00001.04227", 51.501273, -0.123971));
    expect(t.kind).toBe("camera");
    expect(t.view.lat).toBe(51.50127);
    expect(t.view.lon).toBe(-0.12397);
  });

  it("a link kept from a view still reopens it, for a place, a camera and a spot", () => {
    const rounded = { lat: 51.50531, lon: -0.08057, zoom: 15.71, tilt: 48, heading: 247 };
    const tower = EYE_PLACES.find((p) => p.id === "tower-bridge")!;
    const toLink = (q: string) => new URLSearchParams(q);
    const position = "lat=51.50531&lon=-0.08057&z=15.71&heading=247&tilt=48";

    expect(parseEyeLink(toLink(`place=tower-bridge&${position}`), false)).toEqual({ kind: "place", place: tower, view: rounded });
    const cam = "tfl:JamCams_00001.04227";
    expect(parseEyeLink(toLink(`cam=${encodeURIComponent(cam)}&${position}`), false)).toEqual({
      kind: "camera",
      cameraId: cam,
      view: rounded,
    });
    expect(parseEyeLink(toLink(position), false)).toEqual({ kind: "spot", view: rounded });
  });

  it("the way back is the console's own link format, at the same spot", () => {
    const href = consoleHref({ lat: 51.50135, lon: -0.1218, zoom: 15.9 });
    expect(href.startsWith("/app?")).toBe(true);
    const back = decodeViewState(new URL(href, "https://x.test").searchParams);
    expect(back).toEqual({ lat: 51.50135, lon: -0.1218, zoom: 15.9 });
  });
});

describe("wrapHeading", () => {
  it("puts any heading on the compass", () => {
    expect(wrapHeading(0)).toBe(0);
    expect(wrapHeading(360)).toBe(0);
    expect(wrapHeading(-90)).toBe(270);
    expect(wrapHeading(725)).toBe(5);
    expect(wrapHeading(Number.NaN)).toBe(0);
  });
});
