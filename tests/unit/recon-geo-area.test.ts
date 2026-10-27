import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import city from "@/tests/fixtures/recon-geo-city.json";
import countryOnly from "@/tests/fixtures/recon-geo-country-only.json";
import { parseRipeGeo, type GeoLocation, type RipeGeoResponse } from "@/lib/recon/geo";
import { MAX_IP_ZOOM, areasOf, areasToFeatures, viewOfAreas } from "@/lib/recon/geoArea";
import { buildCountryOutlines } from "@/lib/map/precisionMarks";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";

// The real outline file the map loads, read the way lib/recon/ipLocate.ts reads it.
const outlines = buildCountryOutlines(
  JSON.parse(readFileSync(join("public", "geo", "countries-110m.geojson"), "utf8")) as GeoJSON.FeatureCollection,
);
const outlineOf = (iso2: string) => {
  const iso3 = centroidByIso2(iso2)?.iso3;
  return iso3 ? outlines.get(iso3) : undefined;
};

const loc = (over: Partial<GeoLocation>): GeoLocation => ({
  country: "SE",
  city: "Stockholm",
  lat: 59.3287,
  lon: 18.0717,
  coveredPct: 100,
  prefixes: [],
  countryOnly: false,
  radiusKm: null,
  ...over,
});

describe("areasOf", () => {
  it("draws a country-only answer as the whole country, never its centre point", () => {
    const areas = areasOf(parseRipeGeo(countryOnly as RipeGeoResponse).locations, outlineOf);
    expect(areas).toHaveLength(1);
    expect(areas[0].shape).toBe("country");
    expect(areas[0].country).toBe("US");
    expect(areas[0].parts.length).toBeGreaterThan(1); // the US outline has several parts
  });

  it("draws a city with no published radius as its country (the first release)", () => {
    const areas = areasOf(parseRipeGeo(city as RipeGeoResponse).locations, outlineOf);
    expect(areas.map((a) => [a.shape, a.country])).toEqual([["country", "SE"]]);
  });

  it("draws a circle only when a radius is published", () => {
    const [area] = areasOf([loc({ radiusKm: 25 })], outlineOf);
    expect(area.shape).toBe("circle");
    expect(area.parts).toHaveLength(1);
    expect(area.parts[0][0].length).toBeGreaterThanOrEqual(64);
    expect(area.zoom).toBeLessThanOrEqual(MAX_IP_ZOOM);
    // A country-only answer never becomes a circle, even with a radius.
    expect(areasOf([loc({ city: "", countryOnly: true, radiusKm: 1000 })], outlineOf)[0].shape).toBe("country");
  });

  it("draws one country once, and nothing for a country without an outline", () => {
    expect(areasOf([loc({}), loc({ city: "Gothenburg", lat: 57.7, lon: 11.97 })], outlineOf)).toHaveLength(1);
    expect(areasOf([loc({ country: "ZZ" })], outlineOf)).toEqual([]);
  });

  it("never frames closer than MAX_IP_ZOOM", () => {
    const tiny = areasOf([loc({ radiusKm: 1 })], outlineOf);
    expect(viewOfAreas(tiny)!.zoom).toBeLessThanOrEqual(MAX_IP_ZOOM);
    expect(viewOfAreas([])).toBeNull();
  });
});

describe("areasToFeatures", () => {
  it("returns polygons only: no point is ever drawn for a network", () => {
    const areas = [
      ...areasOf(parseRipeGeo(countryOnly as RipeGeoResponse).locations, outlineOf),
      ...areasOf([loc({ radiusKm: 25 })], outlineOf),
    ];
    const fc = areasToFeatures(areas);
    expect(fc.features).toHaveLength(2);
    for (const f of fc.features) expect(["Polygon", "MultiPolygon"]).toContain(f.geometry.type);
  });
});
