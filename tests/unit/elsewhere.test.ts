import { describe, it, expect } from "vitest";
import {
  COORD_DECIMALS,
  SPOT_WORDING,
  coordsText,
  elsewhereLinks,
  formatCoord,
  normaliseSpot,
  spotKindOf,
  type SpotKind,
} from "@/lib/map/elsewhere";
import { COUNTRY_SCOPED_SIGNALS } from "@/lib/map/hitTest";

// The test point of the address check: the Sydney Opera House. Both values are negative
// or large on purpose, so a lat/lon swap or a lost sign cannot pass.
const LAT = -33.8568;
const LON = 151.2153;

const byLabel = (lat: unknown, lon: unknown, kind?: SpotKind) =>
  Object.fromEntries(elsewhereLinks(lat, lon, kind).map((l) => [l.label, l.href]));

describe("elsewhereLinks: an exact place", () => {
  it("gives the five services, in a fixed order", () => {
    expect(elsewhereLinks(LAT, LON).map((l) => l.label)).toEqual([
      "Google Earth",
      "Google Maps",
      "Copernicus Browser",
      "OpenStreetMap",
      "Wikimapia",
    ]);
  });

  it("writes each address in the form that was checked against the service", () => {
    expect(byLabel(LAT, LON)).toEqual({
      "Google Earth": "https://earth.google.com/web/@-33.8568,151.2153,0a,1500d,35y,0h,0t,0r",
      "Google Maps": "https://www.google.com/maps/search/?api=1&query=-33.8568%2C151.2153",
      "Copernicus Browser": "https://browser.dataspace.copernicus.eu/?zoom=15&lat=-33.8568&lng=151.2153",
      OpenStreetMap: "https://www.openstreetmap.org/?mlat=-33.8568&mlon=151.2153#map=15/-33.8568/151.2153",
      Wikimapia: "https://wikimapia.org/#lang=en&lat=-33.8568&lon=151.2153&z=15&m=w",
    });
  });

  it("puts latitude before longitude in every address (a swap would land in another ocean)", () => {
    for (const { href, label } of elsewhereLinks(LAT, LON)) {
      const at = href.indexOf("-33.8568");
      const on = href.indexOf("151.2153");
      expect(at, label).toBeGreaterThan(-1);
      expect(on, label).toBeGreaterThan(at);
    }
  });

  it("every address is https, parses as a URL and carries no space", () => {
    for (const { href, label } of elsewhereLinks(LAT, LON)) {
      expect(href.startsWith("https://"), label).toBe(true);
      expect(() => new URL(href), label).not.toThrow();
      expect(href, label).not.toMatch(/\s/);
    }
  });

  it("does not link the EO Browser, which is shut down", () => {
    for (const kind of ["point", "area", "line", "country"] as SpotKind[]) {
      for (const { href } of elsewhereLinks(LAT, LON, kind)) expect(href).not.toContain("sentinel-hub.com");
    }
  });
});

describe("elsewhereLinks: rounding", () => {
  it("rounds to five decimal places, about one metre", () => {
    expect(COORD_DECIMALS).toBe(5);
    const links = byLabel(31.501234567, 34.466789012);
    expect(links["Google Maps"]).toBe("https://www.google.com/maps/search/?api=1&query=31.50123%2C34.46679");
    for (const href of Object.values(links)) {
      expect(href).toContain("31.50123");
      expect(href).toContain("34.46679");
      expect(href).not.toContain("31.501234");
    }
  });

  it("drops trailing zeros and never writes an exponent or a minus zero", () => {
    expect(formatCoord(10)).toBe("10");
    expect(formatCoord(10.5)).toBe("10.5");
    expect(formatCoord(0.00001)).toBe("0.00001");
    expect(formatCoord(1e-7)).toBe("0");
    expect(formatCoord(-1e-7)).toBe("0");
    expect(formatCoord(-0)).toBe("0");
    expect(formatCoord(-0.000004)).toBe("0");
    expect(formatCoord(-0.00001)).toBe("-0.00001");
    for (const { href } of elsewhereLinks(1e-7, -1e-9)) {
      expect(href).not.toMatch(/\de-\d/);
      expect(href).not.toContain("-0,");
      expect(href).not.toContain("-0&");
    }
  });
});

describe("elsewhereLinks: negative and antimeridian values", () => {
  it("keeps both signs for a place in the south-west quarter", () => {
    const links = byLabel(-54.8019, -68.303);
    expect(links["Google Earth"]).toBe("https://earth.google.com/web/@-54.8019,-68.303,0a,1500d,35y,0h,0t,0r");
    expect(links.OpenStreetMap).toBe("https://www.openstreetmap.org/?mlat=-54.8019&mlon=-68.303#map=15/-54.8019/-68.303");
    expect(links["Copernicus Browser"]).toContain("lat=-54.8019&lng=-68.303");
    expect(links.Wikimapia).toContain("lat=-54.8019&lon=-68.303");
    expect(links["Google Maps"]).toContain("query=-54.8019%2C-68.303");
  });

  it("accepts the antimeridian itself, on both sides", () => {
    expect(byLabel(-16.5, 180)["Google Maps"]).toContain("query=-16.5%2C180");
    expect(byLabel(-16.5, -180)["Google Maps"]).toContain("query=-16.5%2C-180");
    expect(normaliseSpot(-16.5, 180)).toEqual({ lat: -16.5, lon: 180 });
    expect(normaliseSpot(-16.5, -180)).toEqual({ lat: -16.5, lon: -180 });
  });

  it("a value that rounds up to the antimeridian stays a valid longitude", () => {
    expect(byLabel(0, 179.999999)["Google Maps"]).toContain("query=0%2C180");
    expect(byLabel(0, -179.999999)["Google Maps"]).toContain("query=0%2C-180");
  });

  it("wraps a longitude from a map that went round the world: the same meridian", () => {
    expect(normaliseSpot(10, 190)).toEqual({ lat: 10, lon: -170 });
    expect(normaliseSpot(10, -190)).toEqual({ lat: 10, lon: 170 });
    expect(normaliseSpot(10, 540)!.lon).toBe(-180);
    expect(byLabel(10, 190)["Google Maps"]).toContain("query=10%2C-170");
  });

  it("accepts the two poles and the null point", () => {
    expect(elsewhereLinks(90, 0)).toHaveLength(5);
    expect(elsewhereLinks(-90, 0)).toHaveLength(5);
    expect(byLabel(0, 0)["Google Maps"]).toContain("query=0%2C0");
  });
});

describe("elsewhereLinks: refusal", () => {
  it.each([
    ["NaN latitude", Number.NaN, 10],
    ["NaN longitude", 10, Number.NaN],
    ["infinite latitude", Number.POSITIVE_INFINITY, 10],
    ["infinite longitude", 10, Number.NEGATIVE_INFINITY],
    ["latitude above the pole", 90.00001, 10],
    ["latitude below the pole", -91, 10],
    ["a string that looks like a number", "51.5", "-0.12"],
    ["null", null, null],
    ["undefined", undefined, undefined],
  ])("gives no link for %s", (_name, lat, lon) => {
    expect(elsewhereLinks(lat, lon)).toEqual([]);
    expect(normaliseSpot(lat, lon)).toBeNull();
    expect(coordsText(lat, lon)).toBeNull();
  });
});

describe("elsewhereLinks: a centre, not a spot", () => {
  it("sets no marker and opens wide for an area", () => {
    const links = byLabel(LAT, LON, "area");
    expect(links).toEqual({
      "Google Earth": "https://earth.google.com/web/@-33.8568,151.2153,0a,96000d,35y,0h,0t,0r",
      "Google Maps": "https://www.google.com/maps/@?api=1&map_action=map&center=-33.8568%2C151.2153&zoom=9",
      "Copernicus Browser": "https://browser.dataspace.copernicus.eu/?zoom=9&lat=-33.8568&lng=151.2153",
      OpenStreetMap: "https://www.openstreetmap.org/#map=9/-33.8568/151.2153",
      Wikimapia: "https://wikimapia.org/#lang=en&lat=-33.8568&lon=151.2153&z=9&m=w",
    });
  });

  it.each(["area", "line", "country"] as SpotKind[])("no marker and no search for kind '%s'", (kind) => {
    const links = byLabel(LAT, LON, kind);
    expect(links.OpenStreetMap).not.toContain("mlat");
    expect(links.OpenStreetMap).not.toContain("mlon");
    expect(links["Google Maps"]).not.toContain("/search/");
    expect(links["Google Maps"]).not.toContain("query=");
  });

  it("opens a country wider than an area, and an area wider than a place", () => {
    const zoomOf = (kind: SpotKind) => Number(new URL(byLabel(LAT, LON, kind)["Copernicus Browser"]).searchParams.get("zoom"));
    expect(zoomOf("country")).toBeLessThan(zoomOf("area"));
    expect(zoomOf("area")).toBeLessThan(zoomOf("point"));
    expect(zoomOf("line")).toBe(zoomOf("area"));
    const distanceOf = (kind: SpotKind) => Number(/,(\d+)d,/.exec(byLabel(LAT, LON, kind)["Google Earth"])![1]);
    expect(distanceOf("country")).toBeGreaterThan(distanceOf("area"));
    expect(distanceOf("area")).toBeGreaterThan(distanceOf("point"));
  });

  it("Google Maps zoom stays a whole number inside the range its document allows (0 to 21)", () => {
    for (const kind of ["area", "line", "country"] as SpotKind[]) {
      const zoom = new URL(byLabel(LAT, LON, kind)["Google Maps"]).searchParams.get("zoom")!;
      expect(zoom).toMatch(/^\d+$/);
      expect(Number(zoom)).toBeGreaterThanOrEqual(0);
      expect(Number(zoom)).toBeLessThanOrEqual(21);
    }
  });
});

describe("coordsText", () => {
  it("is latitude, then longitude, at the same rounding as the links", () => {
    expect(coordsText(LAT, LON)).toBe("-33.8568, 151.2153");
    expect(coordsText(31.501234567, 34.466789012)).toBe("31.50123, 34.46679");
    expect(coordsText(10, 190)).toBe("10, -170");
  });
});

describe("spotKindOf: only what the types say today", () => {
  it("a feature with no geometry is a point", () => {
    expect(spotKindOf({ signalId: "earthquakes", props: {} })).toBe("point");
    expect(spotKindOf({})).toBe("point");
    expect(spotKindOf(undefined)).toBe("point");
  });

  it("a polygon geometry makes the coordinates the centre of an area", () => {
    const ring: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(spotKindOf({ signalId: "gps-jamming", geometry: { type: "Polygon", coordinates: [ring] } })).toBe("area");
    expect(spotKindOf({ geometry: { type: "MultiPolygon", coordinates: [[ring]] } })).toBe("area");
  });

  it("a line geometry makes the coordinates an anchor point", () => {
    expect(spotKindOf({ signalId: "cables", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } })).toBe("line");
    expect(spotKindOf({ geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] } })).toBe("line");
  });

  it("a country-scoped signal is a country figure", () => {
    expect(COUNTRY_SCOPED_SIGNALS.length).toBeGreaterThan(0);
    for (const signalId of COUNTRY_SCOPED_SIGNALS) expect(spotKindOf({ signalId })).toBe("country");
  });

  it("reads the typed precision level: a country figure and an area are not a spot", () => {
    expect(spotKindOf({ signalId: "displacement" }, "country")).toBe("country");
    expect(spotKindOf({ signalId: "ukraine-alerts" }, "area")).toBe("area");
    expect(spotKindOf({ signalId: "earthquakes" }, "exact")).toBe("point");
    expect(spotKindOf({ signalId: "ports" }, "facility")).toBe("point");
  });

  it("keeps a line a line, whatever level its layer has", () => {
    const line = { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] };
    expect(spotKindOf({ signalId: "cables", geometry: line }, "facility")).toBe("line");
    expect(spotKindOf({ geometry: line }, "country")).toBe("line");
  });

  it("a country figure with an area shape is still a country figure", () => {
    const ring: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(spotKindOf({ geometry: { type: "Polygon", coordinates: [ring] } }, "country")).toBe("country");
  });

  it("keeps no list of layer names of its own: with no level passed, the answer is a point", () => {
    // These layers DO put one marker per country on a centroid. The level is the
    // typed fact that says so, and the panel passes it in.
    for (const signalId of ["displacement", "cyber-c2", "cyber-ransomware"]) {
      expect(spotKindOf({ signalId })).toBe("point");
    }
  });

  it("ignores a geometry value that is not a geometry", () => {
    expect(spotKindOf({ geometry: "Polygon" })).toBe("point");
    expect(spotKindOf({ geometry: null })).toBe("point");
    expect(spotKindOf({ geometry: { type: "Point", coordinates: [0, 0] } })).toBe("point");
  });
});

describe("SPOT_WORDING", () => {
  it("only an exact place is called a spot", () => {
    expect(SPOT_WORDING.point.heading).toBe("Open this spot elsewhere");
    expect(SPOT_WORDING.point.note).toBeUndefined();
    for (const kind of ["area", "line", "country"] as SpotKind[]) {
      const w = SPOT_WORDING[kind];
      expect(w.heading.toLowerCase(), kind).not.toContain("spot");
      expect(w.copy.toLowerCase(), kind).not.toBe("copy coordinates");
      expect(w.note, kind).toMatch(/not the place of an event/);
    }
    expect(SPOT_WORDING.area.heading).toContain("centre of this area");
    expect(SPOT_WORDING.country.heading).toContain("centre of this country");
  });
});
