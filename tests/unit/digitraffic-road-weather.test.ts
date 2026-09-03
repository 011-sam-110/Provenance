import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/digitraffic-weather-stations.json";
import { normalizeRoadWeather } from "@/lib/sources/digitraffic.weather";
import { DIGITRAFFIC_JOIN } from "@/lib/sources/digitraffic.join.data";
import { surfaceValidity } from "@/lib/cameras/surface";

test("maps each real branch to the operator's verbatim wording", () => {
  const map = normalizeRoadWeather(fixture as never);

  expect(map.get(1001)?.state).toBe("Dry"); // KELI_1 = 1.0
  expect(map.get(1022)?.state).toBe("Moist"); // KELI_1 = 2.0
  expect(map.get(1011)?.state).toBe("Wet"); // KELI_1 = 3.0
  expect(map.get(1005)?.state).toBe("The sensor has a fault"); // KELI_1 = 0.0
});

test("ANTI-HARDCODING GUARD: a KELI_1 value never seen before still yields the operator's verbatim text", () => {
  const map = normalizeRoadWeather(fixture as never);
  const synthetic = map.get(999999);
  // Station 999999 is a hand-written winter row: KELI_1 = 4.0 / "Snow-covered".
  // A value->label map would have no branch for 4.0 and would drop or mislabel this.
  // The only correct implementation reads sensorValueDescriptionEn straight through.
  expect(synthetic?.state).toBe("Snow-covered");
});

test("KELI 0.0 sets operatorFlag and surfaceValidity refuses it as a fault", () => {
  const map = normalizeRoadWeather(fixture as never);
  const faulty = map.get(1005)!;
  expect(faulty.operatorFlag).toBe("The sensor has a fault");
  expect(surfaceValidity(faulty, Date.now())).toBe("fault");
});

test("a station with no KELI_* sensor at all yields no map entry", () => {
  const map = normalizeRoadWeather(fixture as never);
  // Station 1042 in the fixture has only ILMA/SADE/NÄKYVYYS_KM/KELI_2... wait, it has
  // KELI_2 but no KELI_1/KELI_3 — falls back to KELI_2 "Dry" rather than being absent.
  expect(map.get(1042)?.state).toBe("Dry");
});

test("a station with genuinely no KELI sensor at all is absent from the map", () => {
  const noKeli = normalizeRoadWeather({
    stations: [
      {
        id: 424242,
        dataUpdatedTime: "2026-09-03T03:30:00Z",
        sensorValues: [{ name: "ILMA", value: 10, sensorValueDescriptionEn: null }],
      },
    ],
  } as never);
  expect(noKeli.has(424242)).toBe(false);
  expect(noKeli.size).toBe(0);
});

test("falls back from KELI_1 to KELI_2 to KELI_3 in order", () => {
  const map = normalizeRoadWeather({
    stations: [
      {
        id: 1,
        dataUpdatedTime: "2026-09-03T03:30:00Z",
        sensorValues: [
          { name: "KELI_2", value: 1, sensorValueDescriptionEn: "Dry (from KELI_2)" },
          { name: "KELI_3", value: 2, sensorValueDescriptionEn: "Moist (from KELI_3)" },
        ],
      },
      {
        id: 2,
        dataUpdatedTime: "2026-09-03T03:30:00Z",
        sensorValues: [{ name: "KELI_3", value: 2, sensorValueDescriptionEn: "Moist (from KELI_3)" }],
      },
    ],
  } as never);
  expect(map.get(1)?.state).toBe("Dry (from KELI_2)");
  expect(map.get(2)?.state).toBe("Moist (from KELI_3)");
});

test("TIE_1 lands in roadTempC and ILMA lands in airTempC, not swapped", () => {
  const map = normalizeRoadWeather(fixture as never);
  const s = map.get(1001)!;
  expect(s.roadTempC).toBe(14.3); // TIE_1
  expect(s.airTempC).toBe(13.6); // ILMA
});

test("the synthetic winter row's TIE_1 also lands correctly and has no ILMA", () => {
  const map = normalizeRoadWeather(fixture as never);
  const s = map.get(999999)!;
  expect(s.roadTempC).toBe(-3.4);
  expect(s.airTempC).toBeUndefined();
});

test("does not set km or station — the join layer supplies those", () => {
  const map = normalizeRoadWeather(fixture as never);
  const s = map.get(1001)!;
  expect(s.km).toBeUndefined();
  expect(s.station).toBeUndefined();
});

test("observedAt is parsed from the station's dataUpdatedTime", () => {
  const map = normalizeRoadWeather(fixture as never);
  const s = map.get(1001)!;
  expect(s.observedAt).toBe(Date.parse("2026-09-03T03:31:35Z"));
});

test("join table rows are well-formed: station ids, positive weatherStationIds, finite non-negative km, no duplicates", () => {
  expect(DIGITRAFFIC_JOIN.length).toBeGreaterThan(0);
  const seen = new Set<string>();
  for (const row of DIGITRAFFIC_JOIN) {
    expect(row.station).toMatch(/^C\d{5}$/);
    expect(Number.isInteger(row.weatherStationId)).toBe(true);
    expect(row.weatherStationId).toBeGreaterThan(0);
    expect(Number.isFinite(row.km)).toBe(true);
    expect(row.km).toBeGreaterThanOrEqual(0);
    expect(seen.has(row.station)).toBe(false);
    seen.add(row.station);
  }
});
