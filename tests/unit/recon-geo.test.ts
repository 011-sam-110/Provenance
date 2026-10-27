import { describe, expect, it } from "vitest";
import city from "@/tests/fixtures/recon-geo-city.json";
import countryOnly from "@/tests/fixtures/recon-geo-country-only.json";
import unknown from "@/tests/fixtures/recon-geo-unknown.json";
import none from "@/tests/fixtures/recon-geo-none.json";
import v6 from "@/tests/fixtures/recon-geo-v6.json";
import {
  GEOLITE_CREDIT,
  NOT_A_PERSON,
  hostingNetwork,
  networkTargetOf,
  parseRipeGeo,
  verdictOf,
  type RipeGeoResponse,
} from "@/lib/recon/geo";

// Fixtures are RIPEstat maxmind-geo-lite answers captured live on 2026-10-27:
//   city          13.51.62.86 (ox.ac.uk's A record): Stockholm, an Amazon data centre
//   country-only  8.8.8.8: "US" with no city, at MaxMind's US centre point in Kansas
//   unknown       1.1.1.1: country "?" at 0, 0
//   none          192.0.2.1 (a documentation range): no location at all
//   v6            2001:4860:4860::8888: "US" with no city

const name = (iso2: string) => ({ SE: "Sweden", US: "United States", IE: "Ireland" })[iso2] ?? iso2;

describe("parseRipeGeo", () => {
  it("reads a city answer, with no radius because RIPEstat publishes none", () => {
    const { locations, dataDate } = parseRipeGeo(city as RipeGeoResponse);
    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({
      country: "SE",
      city: "Stockholm",
      countryOnly: false,
      radiusKm: null,
      coveredPct: 100,
      prefixes: ["13.48.0.0/14"],
    });
    expect(dataDate).toBe("2026-10-23T16:46:41");
  });

  it("marks a country-only answer, so nothing downstream draws its centre point", () => {
    const { locations } = parseRipeGeo(countryOnly as RipeGeoResponse);
    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({ country: "US", city: "", countryOnly: true });
    // The point it carries IS the Kansas centre point: that is why it is flagged.
    expect([locations[0].lat, locations[0].lon]).toEqual([37.751, -97.822]);
    expect(parseRipeGeo(v6 as RipeGeoResponse).locations[0]).toMatchObject({ country: "US", countryOnly: true });
  });

  it('drops "?" at 0, 0 and an empty answer: neither is a place', () => {
    expect(parseRipeGeo(unknown as RipeGeoResponse).locations).toEqual([]);
    expect(parseRipeGeo(none as RipeGeoResponse).locations).toEqual([]);
    expect(
      parseRipeGeo({ data: { located_resources: [{ locations: [{ country: "FR", city: "", latitude: 0, longitude: 0 }] }] } })
        .locations,
    ).toEqual([]);
  });

  it("is robust to a missing or malformed answer", () => {
    expect(parseRipeGeo(null).locations).toEqual([]);
    expect(parseRipeGeo(undefined).locations).toEqual([]);
    expect(parseRipeGeo({ data: { located_resources: [{ locations: [{ country: "SE", latitude: "x" as unknown as number }] }] } }).locations).toEqual([]);
  });

  it("orders several places by how much of the address space each covers", () => {
    const { locations } = parseRipeGeo({
      data: {
        located_resources: [
          {
            locations: [
              { country: "IE", city: "Dublin", latitude: 53.3, longitude: -6.2, covered_percentage: 25 },
              { country: "se", city: "Stockholm", latitude: 59.3, longitude: 18.0, covered_percentage: 75 },
            ],
          },
        ],
      },
    });
    expect(locations.map((l) => [l.country, l.coveredPct])).toEqual([
      ["SE", 75],
      ["IE", 25],
    ]);
  });
});

describe("networkTargetOf", () => {
  it("takes an IP or a domain, and nothing that is a place name or an ASN", () => {
    expect(networkTargetOf("8.8.8.8")).toEqual({ kind: "ip", value: "8.8.8.8" });
    expect(networkTargetOf("2001:4860:4860::8888")).toEqual({ kind: "ip", value: "2001:4860:4860::8888" });
    expect(networkTargetOf("  Ox.AC.uk ")).toEqual({ kind: "domain", value: "ox.ac.uk" });
    expect(networkTargetOf("London")).toBeNull();
    expect(networkTargetOf("Trafalgar Square")).toBeNull();
    expect(networkTargetOf("AS15169")).toBeNull();
    expect(networkTargetOf("")).toBeNull();
  });
});

describe("hostingNetwork", () => {
  it("names the cloud or CDN networks on the list, and only those", () => {
    expect(hostingNetwork(16509)).toBe("Amazon");
    expect(hostingNetwork(15169)).toBe("Google");
    expect(hostingNetwork(54113)).toBe("Fastly");
    expect(hostingNetwork(9498)).toBeNull(); // an ISP: off the list says nothing
    expect(hostingNetwork(undefined)).toBeNull();
  });
});

describe("verdictOf and the fixed lines", () => {
  it("says what the source says, in one sentence", () => {
    expect(verdictOf(parseRipeGeo(city as RipeGeoResponse).locations, name)).toBe(
      "MaxMind places this network in Stockholm, Sweden.",
    );
    expect(verdictOf(parseRipeGeo(countryOnly as RipeGeoResponse).locations, name)).toBe(
      "MaxMind knows only the country: United States.",
    );
    expect(verdictOf([], name)).toBe("MaxMind has no location for this address.");
  });

  it("keeps the exact fixed line and the MaxMind credit", () => {
    expect(NOT_A_PERSON).toBe("Approximate network location. It is not where a person is.");
    expect(GEOLITE_CREDIT).toContain("This product includes GeoLite Data created by MaxMind");
  });
});
