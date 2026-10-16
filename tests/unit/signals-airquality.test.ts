import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/open-meteo-air.json";
import pollutants from "@/tests/fixtures/open-meteo-air-pollutants.json";
import { normalizeAirQuality, usAqiBand, US_AQI_MAX } from "@/lib/signals/airquality";
import type { City } from "@/lib/signals/cities.data";

const CITIES: City[] = [
  { name: "London", country: "United Kingdom", lat: 51.5074, lon: -0.1278 },
  { name: "Paris", country: "France", lat: 48.8566, lon: 2.3522 },
  { name: "Tokyo", country: "Japan", lat: 35.6762, lon: 139.6503 },
];

test("normalizes Open-Meteo air quality, one feature per city with a US-AQI reading", () => {
  const out = normalizeAirQuality(fixture as never, CITIES);
  expect(out).toHaveLength(3);
  expect(out.map((f) => f.signalId)).toEqual(["airquality", "airquality", "airquality"]);
  expect(out[0].id).toBe("airquality:London");
  expect(out[0].lat).toBe(51.5074);

  const aqi = Math.round((fixture as never[])[0]["current"]["us_aqi"] as number);
  expect(out[0].props?.usAqi).toBe(aqi);
  expect(out[0].color).toBe(usAqiBand(aqi).color);
  expect(out[0].props?.category).toBe(usAqiBand(aqi).category);
});

test("skips a city with no AQI value", () => {
  const points = [...(fixture as never[]), { latitude: 0, longitude: 0, current: { us_aqi: null } }];
  const cities = [...CITIES, { name: "Nowhere", country: "—", lat: 0, lon: 0 }];
  expect(normalizeAirQuality(points as never, cities)).toHaveLength(3);
});

test("US AQI bands map to the EPA six-tier scale", () => {
  expect(usAqiBand(25).category).toBe("Good");
  expect(usAqiBand(75).category).toBe("Moderate");
  expect(usAqiBand(125).category).toBe("Unhealthy (sensitive)");
  expect(usAqiBand(180).category).toBe("Unhealthy");
  expect(usAqiBand(250).category).toBe("Very unhealthy");
  expect(usAqiBand(400).category).toBe("Hazardous");
});

// Captured 2026-10-16 20:00 UTC: London, Riyadh (dust: us_aqi 949), Singapore, Mumbai.
const FOUR: City[] = [
  { name: "London", country: "United Kingdom", lat: 51.5074, lon: -0.1278 },
  { name: "Riyadh", country: "Saudi Arabia", lat: 24.7136, lon: 46.6753 },
  { name: "Singapore", country: "Singapore", lat: 1.3521, lon: 103.8198 },
  { name: "Mumbai", country: "India", lat: 19.076, lon: 72.8777 },
];

test("an AQI past the top of the US scale is capped at 500 and labelled beyond the index", () => {
  const out = normalizeAirQuality(pollutants as never, FOUR);
  const riyadh = out.find((f) => f.id === "airquality:Riyadh")!;
  expect(riyadh.props?.usAqi).toBe(US_AQI_MAX);
  expect(riyadh.title).toBe("Riyadh — AQI 500+ (24 h, Hazardous)");
  expect(String(riyadh.props?.aqiBeyondIndex)).toContain("949");
  expect(riyadh.props?.dominantPollutant).toBe("PM10");
  // A value inside the scale is not touched and carries no beyond-index note.
  const london = out.find((f) => f.id === "airquality:London")!;
  expect(london.props?.usAqi).toBe(28);
  expect(london.props?.aqiBeyondIndex).toBeUndefined();
});

test("the AQI is labelled as a 24 h value, and the pollutant that sets it is named", () => {
  const out = normalizeAirQuality(pollutants as never, FOUR);
  for (const f of out) {
    expect(f.title).toContain("(24 h, ");
    expect(String(f.props?.aqiWindow)).toContain("24 h");
  }
  // Mumbai's AQI 173 is set by ozone, not by PM.
  expect(out.find((f) => f.id === "airquality:Mumbai")!.props?.dominantPollutant).toBe("O₃");
});
