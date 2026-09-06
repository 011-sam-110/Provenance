import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AIR_FIELDS,
  aqiScaleFor,
  airQualityUrl,
  fetchAirQuality,
  normalizeAirQuality,
  readAqi,
  type AirQuality,
} from "@/lib/weather/airQuality";
import { readOutcome } from "@/lib/signals/outcome";
import fixture from "@/tests/fixtures/open-meteo-air-quality.json";

// open-meteo-air-quality.json was captured live on 2026-09-06 from
// air-quality-api.open-meteo.com/v1/air-quality with these four coordinates and
// `&current=european_aqi,us_aqi,pm2_5,pm10&timezone=auto`. Left as the bare top-level
// ARRAY the upstream actually returns for a multi-coordinate request.
const COORDS = [
  { lat: 51.51, lon: -0.13 },
  { lat: 27.72, lon: 85.32 },
  { lat: 60.23, lon: 24.6 },
  { lat: -43.95, lon: -176.55 },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("aqiScaleFor", () => {
  it("gives US readers the scale they know", () => {
    expect(aqiScaleFor("US")).toBe("us");
    expect(aqiScaleFor("us")).toBe("us");
    expect(aqiScaleFor("PR")).toBe("us"); // Puerto Rico is in the registry
  });

  it("gives everywhere else the European index, which has global CAMS coverage", () => {
    expect(aqiScaleFor("GB")).toBe("european");
    expect(aqiScaleFor("FI")).toBe("european");
    expect(aqiScaleFor("NZ")).toBe("european");
  });
});

describe("readAqi", () => {
  const both: AirQuality = { key: "51.51,-0.13", europeanAqi: 38, usAqi: 43, pm25: 7.1 };

  it("reads the same air on two scales and never conflates them", () => {
    // 40 is the top of EAQI "Fair" and the middle of US "Good". A number without its
    // scale is not a fact, which is why every band names its own.
    const gb = readAqi({ ...both, europeanAqi: 40, usAqi: 40 }, "GB");
    const us = readAqi({ ...both, europeanAqi: 40, usAqi: 40 }, "US");
    expect(gb).toMatchObject({ scale: "european", scaleLabel: "EAQI", label: "Fair" });
    expect(us).toMatchObject({ scale: "us", scaleLabel: "US AQI", label: "Good" });
  });

  it("uses each publisher's own band wording", () => {
    expect(readAqi({ ...both, europeanAqi: 10 }, "GB")?.label).toBe("Good");
    expect(readAqi({ ...both, europeanAqi: 55 }, "GB")?.label).toBe("Moderate");
    expect(readAqi({ ...both, europeanAqi: 140 }, "GB")?.label).toBe("Extremely poor");
    expect(readAqi({ ...both, usAqi: 120 }, "US")?.label).toBe("Unhealthy for sensitive groups");
    expect(readAqi({ ...both, usAqi: 400 }, "US")?.label).toBe("Hazardous");
  });

  it("falls back to the other index, and the label still says which one it read", () => {
    const noUs: AirQuality = { key: "k", europeanAqi: 38 };
    const band = readAqi(noUs, "US");
    expect(band).toMatchObject({ scale: "european", scaleLabel: "EAQI", value: 38 });
  });

  it("returns null rather than a default when neither index came back", () => {
    expect(readAqi({ key: "k", pm25: 7.1 }, "GB")).toBeNull();
    expect(readAqi(undefined, "GB")).toBeNull();
  });
});

describe("airQualityUrl", () => {
  it("asks for both indices and both particulate sizes", () => {
    const url = airQualityUrl(COORDS);
    for (const field of AIR_FIELDS) expect(url).toContain(field);
  });

  it("sends coordinates already rounded to the shared cache grid", () => {
    // Same COORD_DP as point weather, so one place is one key across both upstreams.
    expect(airQualityUrl([{ lat: 51.5074, lon: -0.1278 }])).toContain("latitude=51.51");
  });
});

describe("normalizeAirQuality", () => {
  const points = fixture as never as Parameters<typeof normalizeAirQuality>[0];

  it("aligns results to the coordinates asked for, by index", () => {
    const out = normalizeAirQuality(points, COORDS);
    expect(out).toHaveLength(4);
    // Keyed by OUR coordinate, not the model's snapped grid cell — the response's own
    // latitude for point 0 is 51.5, ours is 51.51, and the key has to match the weather.
    expect(out[0].key).toBe("51.51,-0.13");
  });

  it("carries both indices from one response", () => {
    const out = normalizeAirQuality(points, COORDS);
    for (const p of out) {
      expect(Number.isFinite(p.europeanAqi as number)).toBe(true);
      expect(Number.isFinite(p.usAqi as number)).toBe(true);
    }
  });

  it("skips a point that told us nothing, rather than emitting an empty card", () => {
    // A row of undefineds renders as a blank air-quality card, which reads as "the air
    // is fine". Absent has to stay absent all the way to the page.
    const broken = [...(points as unknown[])];
    broken[1] = { current: { european_aqi: null, us_aqi: null, pm2_5: null, pm10: null } };
    broken[2] = { current: null };
    const out = normalizeAirQuality(broken as never, COORDS);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.key)).toEqual(["51.51,-0.13", "-43.95,-176.55"]);
  });

  it("keeps a partial point that still carries something real", () => {
    const partial = [{ current: { pm2_5: 7.1 } }];
    const out = normalizeAirQuality(partial as never, [COORDS[0]]);
    expect(out).toHaveLength(1);
    expect(out[0].pm25).toBe(7.1);
    expect("europeanAqi" in out[0]).toBe(false);
  });
});

describe("fetchAirQuality — dormant-safe", () => {
  it("declares a degraded outcome on a refused upstream, never a bare empty list", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    return fetchAirQuality(COORDS).then((res) => {
      expect(res).toHaveLength(0);
      expect(readOutcome(res)?.ok).toBe(false);
      expect(readOutcome(res)?.reason).toBe("http 503");
    });
  });

  it("never throws when the upstream host is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }));
    const res = await fetchAirQuality(COORDS);
    expect(res).toHaveLength(0);
    expect(readOutcome(res)?.ok).toBe(false);
  });

  it("does not call the upstream at all for an empty request", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await fetchAirQuality([]);
    expect(spy).not.toHaveBeenCalled();
    expect(readOutcome(res)?.ok).toBe(true);
  });
});
