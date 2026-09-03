// The board-wide weather store's PURE half: how a playlist of places becomes a set
// of /api/point-weather requests.
//
// Only the exported pure functions are tested here. The hook itself is React, and
// this repo has no React testing library (CLAUDE.md), so `usePointWeather` has no
// unit test at all — that is a real gap and it is stated rather than papered over.
// What IS testable is the part that decides how many requests a board makes and
// whether two walls share them, which is the whole reason the store exists.

import { describe, it, expect } from "vitest";
import { dedupeCoords, pointWeatherRequestUrls } from "@/lib/console/widgets/camslot.conditions.store";
import { MAX_POINTS, coordKey } from "@/lib/weather/pointWeather";
import type { Coord } from "@/lib/weather/pointWeather";

const LONDON: Coord = { lat: 51.5072, lon: -0.1276 };
const TALLINN: Coord = { lat: 59.437, lon: 24.7536 };
const MADRID: Coord = { lat: 40.41666, lon: -3.70028 };

describe("dedupeCoords", () => {
  it("collapses two cameras that round to the same 2dp cell into one request point", () => {
    // Measured 1.05 km apart — well inside Open-Meteo's ~11 km grid, so asking
    // twice would buy nothing but a second row of the same numbers.
    const a: Coord = { lat: 51.506, lon: -0.126 };
    const b: Coord = { lat: 51.514, lon: -0.134 };
    expect(coordKey(a.lat, a.lon)).toBe(coordKey(b.lat, b.lon));
    expect(dedupeCoords([a, b])).toHaveLength(1);
  });

  it("keeps genuinely different places apart", () => {
    expect(dedupeCoords([LONDON, TALLINN, MADRID])).toHaveLength(3);
  });

  it("drops NaN and Infinity rather than sending them upstream", () => {
    const bad = [
      { lat: Number.NaN, lon: 0 },
      { lat: 0, lon: Number.NaN },
      { lat: Number.POSITIVE_INFINITY, lon: 0 },
      LONDON,
    ];
    expect(dedupeCoords(bad)).toEqual([LONDON]);
  });

  it("is order-independent — the same places in any order dedupe to the same list", () => {
    const one = dedupeCoords([LONDON, TALLINN, MADRID]);
    const two = dedupeCoords([MADRID, LONDON, TALLINN]);
    expect(one).toEqual(two);
  });

  it("returns nothing for nothing", () => {
    expect(dedupeCoords([])).toEqual([]);
  });
});

describe("pointWeatherRequestUrls — the fan-out control", () => {
  it("asks for nothing when there is nowhere to ask about", () => {
    expect(pointWeatherRequestUrls([])).toEqual([]);
    // A slot holding only YouTube streams has no coordinates at all. It must not
    // produce a request for the empty string.
    expect(pointWeatherRequestUrls([{ lat: Number.NaN, lon: Number.NaN }])).toEqual([]);
  });

  it("puts a whole small board in ONE request", () => {
    expect(pointWeatherRequestUrls([LONDON, TALLINN, MADRID])).toHaveLength(1);
  });

  it("is the same URL set for two walls holding the same places in a different order", () => {
    // This is what makes a board with several camera walls share one cache entry
    // instead of minting one per wall. If it ever stops holding, the symptom is a
    // silent multiplication of upstream requests, not a visible bug.
    const wallA = pointWeatherRequestUrls([LONDON, TALLINN, MADRID]);
    const wallB = pointWeatherRequestUrls([MADRID, TALLINN, LONDON, LONDON]);
    expect(wallA).toEqual(wallB);
  });

  it("splits at MAX_POINTS and never exceeds it in any batch", () => {
    // Spread over real latitudes so no two round into the same 2dp cell.
    const many: Coord[] = Array.from({ length: MAX_POINTS * 2 + 5 }, (_, i) => ({
      lat: 10 + i * 0.03,
      lon: 10 + i * 0.03,
    }));
    const urls = pointWeatherRequestUrls(many);
    expect(urls).toHaveLength(3);
    for (const url of urls) {
      const points = new URL(url, "http://x").searchParams.get("points") ?? "";
      expect(points.split(";").length).toBeLessThanOrEqual(MAX_POINTS);
    }
  });

  it("loses no place across a split", () => {
    const many: Coord[] = Array.from({ length: MAX_POINTS + 7 }, (_, i) => ({
      lat: 10 + i * 0.03,
      lon: 10 + i * 0.03,
    }));
    const sent = pointWeatherRequestUrls(many)
      .flatMap((url) => (new URL(url, "http://x").searchParams.get("points") ?? "").split(";"))
      .filter(Boolean);
    const expected = dedupeCoords(many).map((c) => coordKey(c.lat, c.lon));
    expect(new Set(sent)).toEqual(new Set(expected));
    expect(sent).toHaveLength(expected.length);
  });

  it("targets the internal route, never an upstream host", () => {
    // The browser must not talk to Open-Meteo directly: the route is where the
    // cache, the batch cap and the failure policy live.
    for (const url of pointWeatherRequestUrls([LONDON, TALLINN])) {
      expect(url.startsWith("/api/point-weather?points=")).toBe(true);
      expect(url).not.toMatch(/open-meteo|https?:/i);
    }
  });
});
