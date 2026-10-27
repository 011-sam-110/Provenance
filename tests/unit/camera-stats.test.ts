import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { CAMERA_REGIONS_ORDER, CONTINENT_BY_ISO2, continentOf } from "@/lib/cameras/continents";
import {
  STATS_STALE_MS,
  buildCameraStats,
  isStale,
  licenceIsStated,
  medianOf,
  refreshMix,
  type StatsCamera,
  type StatsInput,
} from "@/lib/cameras/stats";
import { OPERATOR_NAMES, operatorName } from "@/lib/sources/operators";
import { CAMERA_FEEDS } from "@/lib/sources/registry";
import { ADMITTED_FEEDS } from "@/lib/sources/discovered.data";
import type { PlayCheckSummary } from "@/lib/liveness/playcheck";

// The camera stats behind the top bar's strip (lib/cameras/stats.ts, /api/camera-stats):
// the maths, and the two tables it leans on (country -> continent, feed -> operator name).

const T0 = Date.UTC(2026, 9, 27, 4, 0, 0);

const cam = (source: string, country: string, live: boolean, refreshSeconds: number, license = "CC BY 4.0"): StatsCamera => ({
  source,
  country,
  live,
  refreshSeconds,
  license,
});

const PLAY: PlayCheckSummary = {
  listed: 3,
  checked: 2,
  rolling: 2,
  stalled: 0,
  error: 0,
  windowFrom: T0 - 3_600_000,
  windowTo: T0 - 600_000,
  ttffMedianMs: 1_700,
  ttffP90Ms: 3_000,
  cycleMs: 3 * 3_600_000,
  warm: false,
  byOperator: {},
};

function input(over: Partial<StatsInput> = {}): StatsInput {
  return {
    cams: [
      cam("caltrans", "US", true, 60, "Caltrans Terms of Use"),
      cam("caltrans", "US", true, 60, "Caltrans Terms of Use"),
      cam("caltrans", "US", false, 60, "Caltrans Terms of Use"),
      cam("tfl", "GB", false, 120, "OGL"),
      cam("tfl", "GB", false, 300, "OGL"),
      cam("nzta", "NZ", false, 600, "No licence stated by NZTA"),
      cam("hktd", "HK", false, 90),
      cam("odd", "ZZ", false, 400),
    ],
    registryAt: T0 - 4 * 60_000,
    health: [
      { key: "caltrans", ok: true },
      { key: "tfl", ok: true },
      { key: "nzta", ok: true },
      { key: "hktd", ok: false },
      { key: "ottawa", ok: true, dormant: true },
    ],
    feedCount: 51,
    play: PLAY,
    webcams: { count: 70_698, at: Date.UTC(2026, 8, 5, 22, 56) },
    names: { caltrans: "Caltrans CCTV", tfl: "Transport for London JamCams", nzta: "NZTA", hktd: "HK Transport Department" },
    now: T0,
    ...over,
  };
}

describe("buildCameraStats", () => {
  const s = buildCameraStats(input());

  test("video is what the play check let through; the rest are stills", () => {
    expect(s.road.total).toBe(8);
    expect(s.road.video).toBe(2);
    expect(s.road.stills).toBe(6);
  });

  test("countries are distinct codes, the unknown one included in the count", () => {
    expect(s.road.countries).toBe(5);
  });

  test("operators are the feeds that answered: not a failed feed, not a dormant one", () => {
    expect(s.road.operators).toBe(3);
    expect(s.road.feeds).toBe(51);
  });

  test("regions come in a fixed order, each with its video, stills and countries", () => {
    expect(s.road.regions.map((r) => r.region)).toEqual([...CAMERA_REGIONS_ORDER]);
    const by = Object.fromEntries(s.road.regions.map((r) => [r.region, r]));
    expect(by["North America"]).toMatchObject({ video: 2, stills: 1, countries: 1 });
    expect(by["North America"].byCountry).toEqual([{ country: "US", video: 2, stills: 1 }]);
    expect(by["Europe"]).toMatchObject({ video: 0, stills: 2, countries: 1 });
    expect(by["Asia"]).toMatchObject({ video: 0, stills: 1, countries: 1 });
    expect(by["Oceania"]).toMatchObject({ video: 0, stills: 1, countries: 1 });
    expect(by["Africa"]).toMatchObject({ video: 0, stills: 0, countries: 0, byCountry: [] });
    expect(by["South America"]).toMatchObject({ video: 0, stills: 0, countries: 0 });
  });

  test("a country the table does not know is counted in no region, and named", () => {
    expect(s.road.unplaced).toEqual(["ZZ"]);
    const placed = s.road.regions.reduce((n, r) => n + r.video + r.stills, 0);
    expect(placed).toBe(s.road.total - 1);
  });

  test("the refresh median and mix are over the stills only", () => {
    // Stills: 60, 120, 300, 600, 90, 400 -> sorted 60 90 120 300 400 600 -> (120 + 300) / 2.
    expect(s.refresh.medianSeconds).toBe(210);
    expect(s.refresh.mix).toEqual([
      { label: "1 min or less", count: 1 },
      { label: "2 min", count: 2 },
      { label: "3 to 5 min", count: 1 },
      { label: "6 to 9 min", count: 1 },
      { label: "10 min or more", count: 1 },
    ]);
  });

  test("per operator: name, the licence most of its cameras carry, cameras, video, refresh", () => {
    expect(s.operators.rows.map((r) => r.key)).toEqual(["caltrans", "tfl", "hktd", "nzta", "odd"]);
    expect(s.operators.rows[0]).toEqual({
      key: "caltrans",
      name: "Caltrans CCTV",
      license: "Caltrans Terms of Use",
      licenceStated: true,
      cameras: 3,
      video: 2,
      refreshSeconds: 60,
    });
    expect(s.operators.rows.find((r) => r.key === "nzta")?.licenceStated).toBe(false);
    expect(s.operators.rows.find((r) => r.key === "odd")?.name).toBe("odd");
    expect(s.operators.licenceStated).toBe(4);
    expect(s.operators.noLicence).toBe(1);
  });

  test("every figure carries its own time and source", () => {
    expect(s.road.at).toBe(T0 - 4 * 60_000);
    expect(s.refresh.at).toBe(s.road.at);
    expect(s.operators.at).toBe(s.road.at);
    expect(s.play.at).toBe(PLAY.windowTo);
    expect(s.webcams).toMatchObject({ count: 70_698, at: Date.UTC(2026, 8, 5, 22, 56) });
    for (const part of [s.road, s.refresh, s.play, s.webcams, s.operators]) expect(part.source.length).toBeGreaterThan(20);
    expect(s.play.source).toContain("every 3 h");
    expect(s.generatedAt).toBe(T0);
  });

  test("the play-check summary passes through untouched, warm flag included", () => {
    const warm = buildCameraStats(input({ play: { ...PLAY, warm: true } }));
    expect(warm.play).toMatchObject({ listed: 3, checked: 2, rolling: 2, warm: true, ttffMedianMs: 1_700 });
  });

  test("before the first refresh the road count has no time", () => {
    const cold = buildCameraStats(input({ cams: [], registryAt: null }));
    expect(cold.road).toMatchObject({ at: null, total: 0, video: 0, stills: 0, countries: 0 });
    expect(cold.refresh).toMatchObject({ medianSeconds: null });
  });
});

describe("the small pieces", () => {
  test("medianOf", () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([5])).toBe(5);
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(3); // 2.5 rounds up
  });

  test("refreshMix bucket edges, and no 6 to 9 min bucket when it holds nothing", () => {
    expect(refreshMix([60, 61, 120, 121, 300, 600, 3600])).toEqual([
      { label: "1 min or less", count: 1 },
      { label: "2 min", count: 2 },
      { label: "3 to 5 min", count: 2 },
      { label: "10 min or more", count: 2 },
    ]);
    expect(refreshMix([301, 599]).find((b) => b.label === "6 to 9 min")?.count).toBe(2);
  });

  test("stale: older than 15 min, or no time at all", () => {
    expect(STATS_STALE_MS).toBe(15 * 60_000);
    expect(isStale(T0 - STATS_STALE_MS, T0)).toBe(false);
    expect(isStale(T0 - STATS_STALE_MS - 1, T0)).toBe(true);
    expect(isStale(null, T0)).toBe(true);
  });

  test("licence text that says there is none, in the operators' own wording", () => {
    expect(licenceIsStated("No licence stated by CDOT for COtrip camera data")).toBe(false);
    expect(licenceIsStated("Bellingen Shire Council — no stated licence")).toBe(false);
    expect(licenceIsStated("BIHAMK — public road-camera viewer (no stated licence)")).toBe(false);
    expect(licenceIsStated("CC BY 4.0 (Fintraffic)")).toBe(true);
    expect(licenceIsStated("Crown copyright, Scottish Government (Traffic Scotland). Not an open licence")).toBe(true);
  });
});

describe("the tables", () => {
  const SOURCES_DIR = resolve(__dirname, "..", "..", "lib", "sources");

  test("every country an adapter or an admitted feed emits has a continent", () => {
    const codes = new Set<string>();
    for (const f of readdirSync(SOURCES_DIR)) {
      if (!f.endsWith(".ts") || f === "windy.ts") continue;
      for (const m of readFileSync(join(SOURCES_DIR, f), "utf8").matchAll(/country:\s*"([A-Z]{2})"/g)) codes.add(m[1]);
    }
    for (const feed of ADMITTED_FEEDS) codes.add(feed.country);
    expect(codes.size).toBeGreaterThanOrEqual(20);
    const missing = [...codes].filter((c) => continentOf(c) === null);
    expect(missing, `add these to CONTINENT_BY_ISO2 in lib/cameras/continents.ts: ${missing.join(", ")}`).toEqual([]);
  });

  test("the continent table names only regions the breakdown shows", () => {
    for (const r of Object.values(CONTINENT_BY_ISO2)) expect(CAMERA_REGIONS_ORDER).toContain(r);
    expect(continentOf("us")).toBe("North America");
  });

  test("every camera feed has its operator's name", () => {
    const missing = CAMERA_FEEDS.map((f) => f.key).filter((k) => !OPERATOR_NAMES[k]);
    expect(missing, `no operator name for: ${missing.join(", ")}`).toEqual([]);
    expect(operatorName("caltrans")).toBe("Caltrans CCTV");
    expect(operatorName("not-a-feed")).toBe("not-a-feed");
  });
});
