import { expect, test, describe } from "vitest";
import {
  matchCountryFeature,
  activeEventLine,
  featureCode,
  reliefwebCountryUrl,
} from "@/lib/geo/countryActive";
import type { SignalFeature } from "@/lib/signals/types";

const feat = (id: string, props: Record<string, unknown>, title = ""): SignalFeature => ({
  id,
  lat: 0,
  lon: 0,
  title,
  signalId: id.split(":")[0],
  props,
});

describe("matchCountryFeature", () => {
  const features = [
    feat("displacement:AFG", { country: "Afghanistan", totalDisplaced: "3,220,946" }),
    feat("cyber-ransomware:US", { country: "United States", victims: 12 }),
    feat("ioda:SD", { country: "Sudan", severity: "severe" }),
  ];

  test("matches by ISO-3 suffix", () => {
    expect(matchCountryFeature(features, { iso3: "AFG" })?.id).toBe("displacement:AFG");
  });
  test("matches by ISO-2 suffix", () => {
    expect(matchCountryFeature(features, { iso2: "US" })?.id).toBe("cyber-ransomware:US");
  });
  test("falls back to the country name", () => {
    expect(matchCountryFeature(features, { name: "Sudan" })?.id).toBe("ioda:SD");
  });
  test("returns null when the country has no feature in the layer (honest quiet)", () => {
    expect(matchCountryFeature(features, { iso2: "FR", iso3: "FRA", name: "France" })).toBeNull();
    expect(matchCountryFeature([], { iso3: "AFG" })).toBeNull();
    expect(matchCountryFeature(undefined, { iso3: "AFG" })).toBeNull();
  });
});

test("featureCode extracts the trailing code", () => {
  expect(featureCode(feat("food:AFG", {}))).toBe("AFG");
  expect(featureCode(feat("cyber-ransomware:us", {}))).toBe("US");
});

describe("activeEventLine", () => {
  test("summarises each country-coded layer with its real value", () => {
    expect(activeEventLine("cyber-ransomware", feat("x:US", { victims: 12 }))).toBe(
      "12 ransomware victims claimed",
    );
    expect(activeEventLine("cyber-ransomware", feat("x:US", { victims: 1 }))).toBe(
      "1 ransomware victim claimed",
    );
    expect(activeEventLine("internet-outages", feat("x:SD", { severity: "severe" }))).toBe(
      "Internet outage — severe",
    );
    expect(activeEventLine("displacement", feat("x:AFG", { totalDisplaced: "3,220,946" }))).toBe(
      "3,220,946 forcibly displaced",
    );
    // food-security had a fourth case here until 2026-09-05, removed with the layer.
    // The default branch is what a retired id hits now, so assert THAT rather than
    // leaving the removal untested -- an unknown id must fall back to the feature's own
    // title, never render a half-built sentence.
    expect(activeEventLine("food-security", feat("x:AFG", { insufficientFood: "15M" }))).toBe("Active signal");
  });
  test("falls back to the feature title for an unmapped layer", () => {
    expect(activeEventLine("mystery", feat("x:US", {}, "Something happened"))).toBe("Something happened");
  });
});

test("reliefwebCountryUrl deep-links by ISO-3", () => {
  expect(reliefwebCountryUrl("SYR")).toBe("https://reliefweb.int/country/syr");
  expect(reliefwebCountryUrl(undefined)).toBe("https://reliefweb.int/countries");
});
