import { afterEach, expect, test, vi } from "vitest";
// FMI R-index + RX and 14 USGS observatories, captured together on 2026-10-16 ~19:52Z
// while Kp was 4 and the aurora stood over Lapland.
import live from "@/tests/fixtures/geomag-stations-2026-10-16.json";
import {
  normalizeGeomagStations,
  normalizeFmiStations,
  normalizeUsgsStations,
  usgsDisturbance,
  usgsLevel,
  fmiLevel,
  fmiIso,
  usgsUrl,
  GEOMAG_STATIONS_SOURCE,
  USGS_OBSERVATORIES,
  STATION_MAX_AGE_MS,
  type FmiRFile,
  type FmiRxFile,
  type UsgsSeries,
} from "@/lib/signals/geomag-stations";
import { readCoverage } from "@/lib/signals/coverage";
import { readOutcome } from "@/lib/signals/outcome";

const NOW = Date.parse(live.capturedAt);
const input = () => ({
  fmiR: live.fmiR as FmiRFile,
  fmiRX: live.fmiRX as FmiRxFile,
  usgs: live.usgs as Record<string, UsgsSeries>,
  now: NOW,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("FMI: one pin per station at its own coordinates, with FMI's verdict and limits", () => {
  const out = normalizeFmiStations(live.fmiR as FmiRFile, live.fmiRX as FmiRxFile, NOW);
  expect(out).toHaveLength(11);
  const kev = out.find((f) => f.id === "fmi:KEV")!;
  expect(kev).toMatchObject({ lat: 69.76, lon: 27.01, title: "Kevo: High probability of auroras", ts: "2026-10-16T19:50:00Z" });
  expect(kev.props).toMatchObject({ rIndex: 608, limitLower: 55, limitHigher: 165, activityLevel: 2, stationCode: "KEV" });
  // RX joins on the station code: previous hour and the predicted maximum for the next.
  expect(typeof kev.props?.rxPreviousHour).toBe("number");
  expect(typeof kev.props?.rxNextHourMax).toBe("number");
  // FMI's own three levels, by its own limits.
  const levels = Object.fromEntries(out.map((f) => [f.props?.stationCode, f.props?.activityLevel]));
  expect(levels).toMatchObject({ KEV: 2, RAN: 2, OUJ: 1, HAN: 1, NUR: 0, TAR: 0 });
  // The verdict text and the level agree on every station.
  for (const f of out) {
    const word = String(f.props?.probability).split(" ")[0];
    expect({ Low: 0, Medium: 1, High: 2 }[word]).toBe(f.props?.activityLevel);
  }
});

test("USGS: the range of H over the last hour, levelled by the stated rule; a silent observatory is left out", () => {
  const out = normalizeUsgsStations(live.usgs as Record<string, UsgsSeries>, NOW);
  // FRD answered with no samples in that hour: no pin, never a zero.
  expect(out.map((f) => f.props?.stationCode)).not.toContain("FRD");
  expect(out).toHaveLength(13);
  const byCode = Object.fromEntries(out.map((f) => [String(f.props?.stationCode), f]));
  expect(byCode.BRW.props?.deltaHNt).toBe(568.4);
  expect(byCode.BRW.props?.activityLevel).toBe(2);
  expect(byCode.DED.props?.activityLevel).toBe(2);
  expect(byCode.CMO.props?.activityLevel).toBe(1);
  expect(byCode.BOU.props?.activityLevel).toBe(0);
  expect(byCode.GUA.props?.activityLevel).toBe(0);
  expect(byCode.CMO.title).toMatch(/^College, Alaska: active \(H moved \d+(\.\d)? nT in the last hour\)$/);
  expect(out.every((f) => f.lon >= -180 && f.lon <= 180)).toBe(true);
});

test("level rules: FMI by the station's limits, USGS by latitude band", () => {
  expect([fmiLevel(54, 55, 165), fmiLevel(55, 55, 165), fmiLevel(165, 55, 165)]).toEqual([0, 1, 2]);
  expect([usgsLevel(99, 64.9), usgsLevel(100, 64.9), usgsLevel(300, 64.9)]).toEqual([0, 1, 2]);
  expect([usgsLevel(39, 40), usgsLevel(40, 40), usgsLevel(120, 40)]).toEqual([0, 1, 2]);
});

test("a gappy hour or a stale station is not drawn", () => {
  const times = Array.from({ length: 20 }, (_, i) => new Date(NOW - i * 60_000).toISOString());
  const gappy: UsgsSeries = { times, values: [{ id: "H", values: times.map((_, i) => 100 + i) }] };
  expect(usgsDisturbance(gappy, NOW)).toBeUndefined();
  const stale: FmiRFile = {
    data: {
      KEV: {
        Time: new Date(NOW - STATION_MAX_AGE_MS - 60_000).toISOString(),
        "R-index": 600,
        "Geographic latitude": 69.76,
        "Geographic longitude": 27.01,
        "Limit value lower": 55,
        "Limit value higher": 165,
      },
    },
  };
  expect(normalizeFmiStations(stale, undefined, NOW)).toEqual([]);
});

test("the layer is FMI then USGS, uncapped, with a coverage record", () => {
  const out = normalizeGeomagStations(input());
  expect(out).toHaveLength(24);
  expect(out.every((f) => f.signalId === "geomag-stations")).toBe(true);
  expect(new Set(out.map((f) => f.id)).size).toBe(out.length);
  expect(readCoverage(out)).toMatchObject({ returned: 24, capped: false });
});

test("time helpers", () => {
  expect(fmiIso("2026-10-16 19:50:00+00:00")).toBe("2026-10-16T19:50:00Z");
  expect(fmiIso("2026-10-16T19:30:08+0000")).toBe("2026-10-16T19:30:08Z");
  expect(fmiIso("nope")).toBeUndefined();
  expect(usgsUrl("CMO", Date.parse("2026-10-16T19:52:31Z"))).toBe(
    "https://geomag.usgs.gov/ws/data/?id=CMO&elements=H&sampling_period=60&format=json&starttime=2026-10-16T18:52:00Z&endtime=2026-10-16T19:52:00Z",
  );
  expect(USGS_OBSERVATORIES).toHaveLength(14);
});

test("registers as a station layer: facility precision, Space weather group, both credits", () => {
  expect(GEOMAG_STATIONS_SOURCE.precision).toBe("facility");
  expect(GEOMAG_STATIONS_SOURCE.group).toBe("Space weather");
  expect(GEOMAG_STATIONS_SOURCE.attribution).toMatch(/Finnish Meteorological Institute.*CC BY 4\.0/);
  expect(GEOMAG_STATIONS_SOURCE.attribution).toMatch(/USGS/);
});

test("fetch: nothing answers → degraded and empty; one operator answers → its rows, declared partial", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
  const none = await GEOMAG_STATIONS_SOURCE.fetch();
  expect(none).toEqual([]);
  expect(readOutcome(none)?.ok).toBe(false);

  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("r_index_latest")) return { ok: true, status: 200, json: async () => live.fmiR };
      return { ok: false, status: 503, json: async () => ({}) };
    }),
  );
  const partial = await GEOMAG_STATIONS_SOURCE.fetch();
  vi.useRealTimers();
  expect(partial).toHaveLength(11);
  expect(readOutcome(partial)).toMatchObject({ ok: false, reason: "partial: USGS failed" });
});
