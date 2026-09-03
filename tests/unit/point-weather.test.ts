import { describe, it, expect, vi, afterEach } from "vitest";
import {
  coordKey,
  parsePointsParam,
  pointsParam,
  planBatches,
  normalizePointWeather,
  pointWeatherUrl,
  fetchPointWeather,
  MAX_POINTS,
  COORD_DP,
} from "@/lib/weather/pointWeather";
import { readOutcome } from "@/lib/signals/outcome";
import {
  formatLocalClock,
  zoneOffsetLabel,
} from "@/lib/console/widgets/camslot.conditions";
import fixture from "@/tests/fixtures/open-meteo-points.json";

// open-meteo-points.json was captured live on 2026-09-03 from
// api.open-meteo.com/v1/forecast with these four coordinates and `&timezone=auto`. It is
// left as a bare top-level ARRAY because that is exactly what the upstream returns for a
// multi-coordinate request — wrapping it in an object to hold a provenance note would
// misrepresent the shape the parser has to survive.
//
// Kathmandu and Chatham are in it deliberately: a clock built on integer-hour arithmetic
// passes London and Helsinki and fails only those two.
const COORDS = [
  { lat: 51.51, lon: -0.13 }, // Europe/London      +01:00
  { lat: 27.72, lon: 85.32 }, // Asia/Kathmandu     +05:45  <- non-integer offset
  { lat: 60.23, lon: 24.6 }, // Europe/Helsinki    +03:00
  { lat: -43.95, lon: -176.55 }, // Pacific/Chatham +12:45  <- non-integer offset
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("coordKey", () => {
  it("rounds to a stable, canonical key", () => {
    expect(coordKey(51.5074, -0.1278)).toBe("51.51,-0.13");
    expect(COORD_DP).toBe(2); // ~1.1 km, inside Open-Meteo's ~11 km grid
  });

  it("collapses two cameras on the same street onto one key", () => {
    // The point of rounding: one cache entry and one upstream point, not two.
    expect(coordKey(51.5074, -0.1278)).toBe(coordKey(51.5069, -0.1301));
  });
});

describe("parsePointsParam — an untrusted boundary", () => {
  it("parses a well-formed list", () => {
    expect(parsePointsParam("51.51,-0.13;60.23,24.60")).toEqual([
      { lat: 51.51, lon: -0.13 },
      { lat: 60.23, lon: 24.6 },
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(parsePointsParam(null)).toEqual([]);
    expect(parsePointsParam("")).toEqual([]);
  });

  it("drops a malformed pair without discarding the good ones", () => {
    // One bad stream in a wall of sixty must not blank the other fifty-nine.
    const out = parsePointsParam("51.51,-0.13;banana;;99,99;60.23,24.60");
    expect(out).toEqual([
      { lat: 51.51, lon: -0.13 },
      { lat: 60.23, lon: 24.6 },
    ]);
  });

  it("rejects out-of-range coordinates a share link could carry", () => {
    expect(parsePointsParam("91,0")).toEqual([]);
    expect(parsePointsParam("0,181")).toEqual([]);
    expect(parsePointsParam("-91,0;0,-181")).toEqual([]);
  });

  it("deduplicates", () => {
    expect(parsePointsParam("51.51,-0.13;51.5074,-0.1278")).toHaveLength(1);
  });

  it("caps the number of points a single request may ask for", () => {
    const many = Array.from({ length: MAX_POINTS + 25 }, (_, i) => `${(i * 0.37).toFixed(2)},0`).join(";");
    expect(parsePointsParam(many)).toHaveLength(MAX_POINTS);
  });
});

describe("pointsParam", () => {
  it("sorts, so the same places in a different order share one cache entry", () => {
    const a = pointsParam([{ lat: 60.23, lon: 24.6 }, { lat: 51.51, lon: -0.13 }]);
    const b = pointsParam([{ lat: 51.51, lon: -0.13 }, { lat: 60.23, lon: 24.6 }]);
    expect(a).toBe(b);
  });
});

describe("planBatches", () => {
  it("chunks at the upstream limit", () => {
    const items = Array.from({ length: 130 }, (_, i) => i);
    const batches = planBatches(items, MAX_POINTS);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(MAX_POINTS);
    expect(batches.flat()).toEqual(items);
  });

  it("is empty for empty", () => {
    expect(planBatches([], MAX_POINTS)).toEqual([]);
  });
});

describe("pointWeatherUrl", () => {
  it("asks for timezone=auto, which is what makes a local clock possible", () => {
    const url = pointWeatherUrl(COORDS);
    expect(url).toContain("timezone=auto");
    expect(url).toContain("latitude=51.51,27.72,60.23,-43.95");
    expect(url).toContain("precipitation");
    expect(url).toContain("snowfall");
  });
});

describe("normalizePointWeather", () => {
  const points = fixture as never as Parameters<typeof normalizePointWeather>[0];

  it("aligns results to the coordinates we asked for, by index", () => {
    const out = normalizePointWeather(points, COORDS);
    expect(out).toHaveLength(4);
    expect(out[0].timeZone).toBe("Europe/London");
    expect(out[1].timeZone).toBe("Asia/Kathmandu");
    expect(out[3].timeZone).toBe("Pacific/Chatham");
    // Keyed by OUR coordinate, not the model's snapped grid point.
    expect(out[0].key).toBe("51.51,-0.13");
  });

  it("carries the fields the derived rule needs", () => {
    const out = normalizePointWeather(points, COORDS);
    for (const p of out) {
      expect(Number.isFinite(p.tempC)).toBe(true);
      expect(typeof p.isDay).toBe("boolean");
      expect(Number.isFinite(p.utcOffsetSeconds)).toBe(true);
    }
  });

  it("skips a garbled point instead of defaulting it to a confident zero", () => {
    const broken = [...(points as unknown[])];
    broken[1] = { timezone: "Asia/Kathmandu", current: null };
    const out = normalizePointWeather(broken as never, COORDS);
    expect(out).toHaveLength(3);
    expect(out.map((p) => p.timeZone)).not.toContain("Asia/Kathmandu");
  });

  it("refuses a point with no timezone rather than guessing one", () => {
    const noZone = [{ ...(points as never as Record<string, unknown>[])[0], timezone: "" }];
    expect(normalizePointWeather(noZone as never, [COORDS[0]])).toHaveLength(0);
  });
});

describe("fetchPointWeather — dormant-safe", () => {
  it("declares a degraded outcome on a refused upstream, never a bare empty list", () => {
    // The house rule: an empty array reads as a quiet layer, not a broken one.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    return fetchPointWeather(COORDS).then((res) => {
      const outcome = readOutcome(res);
      expect(outcome?.ok).toBe(false);
      expect(outcome?.reason).toContain("503");
    });
  });

  it("declares a degraded outcome when the network throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network refused (test)");
    }));
    const outcome = readOutcome(await fetchPointWeather(COORDS));
    expect(outcome?.ok).toBe(false);
  });

  it("does not call the upstream at all for an empty request", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await fetchPointWeather([]);
    expect(spy).not.toHaveBeenCalled();
    expect(res).toHaveLength(0);
    expect(readOutcome(res)?.ok).toBe(true);
  });
});

describe("the local clock", () => {
  const NOON_UTC = Date.UTC(2026, 8, 3, 12, 0, 0);

  it("reads the camera's own wall clock", () => {
    expect(formatLocalClock("Europe/London", NOON_UTC)).toBe("13:00"); // BST
    expect(formatLocalClock("Europe/Helsinki", NOON_UTC)).toBe("15:00");
  });

  it("handles a non-integer offset, which offset arithmetic would get wrong", () => {
    expect(formatLocalClock("Asia/Kathmandu", NOON_UTC)).toBe("17:45");
    expect(zoneOffsetLabel("Asia/Kathmandu", NOON_UTC)).toBe("UTC+5:45");
    expect(zoneOffsetLabel("Pacific/Chatham", NOON_UTC)).toBe("UTC+12:45");
  });

  it("labels the offset, never the city", () => {
    // "Helsinki" on a camera in Oulu would be false. An offset implies nothing.
    const label = zoneOffsetLabel("Europe/Helsinki", NOON_UTC);
    expect(label).toBe("UTC+3");
    expect(label).not.toContain("Helsinki");
  });

  it("tracks a DST transition rather than trusting a cached offset", () => {
    const jan = Date.UTC(2026, 0, 15, 12, 0, 0);
    const jul = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(zoneOffsetLabel("Europe/London", jan)).toBe("UTC");
    expect(zoneOffsetLabel("Europe/London", jul)).toBe("UTC+1");
  });

  it("falls back to the cached offset only when the zone is unknown to the runtime", () => {
    expect(zoneOffsetLabel("Not/AZone", NOON_UTC, 20700)).toBe("UTC+5:45");
    expect(formatLocalClock("Not/AZone", NOON_UTC)).toBe("");
  });
});
