import { expect, test } from "vitest";
// Live-captured OpenAQ PM2.5 readings, including real sensor-error rows (-1, -9999, 0)
// and synthetic null-coord / negative-value edge rows.
import fixture from "@/tests/fixtures/openaq-pm25.json";
import { normalizeAirStations, pm25Band, OPENAQ_MAX_AGE_MS } from "@/lib/signals/airquality-stations";

// The fixture was captured on 2026-06-27; its newest rows are 09:00 UTC. Read it as of 10:00.
const AT = Date.parse("2026-06-27T10:00:00Z");

test("plots valid PM2.5 stations and rejects error sentinels", () => {
  const out = normalizeAirStations(fixture as never, AT);
  // Only rows with a real positive value AND valid coordinates survive.
  expect(out.length).toBeGreaterThan(0);
  expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["air-quality-stations"]));
  // No zero/negative/sentinel readings leak through.
  for (const f of out) {
    const v = parseFloat(String(f.props?.pm25));
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(2000);
    expect(f.lat).toBeGreaterThanOrEqual(-90);
    expect(f.lat).toBeLessThanOrEqual(90);
  }
  // The null-coord row and the -999 row are dropped.
  expect(out.every((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))).toBe(true);
});

test("PM2.5 bands map to the EPA colour ramp", () => {
  expect(pm25Band(8)).toEqual({ label: "good", color: "#16a34a" });
  expect(pm25Band(25)).toEqual({ label: "moderate", color: "#eab308" });
  expect(pm25Band(45)).toEqual({ label: "unhealthy (sensitive)", color: "#f59e0b" });
  expect(pm25Band(100)).toEqual({ label: "unhealthy", color: "#dc2626" });
  expect(pm25Band(200)).toEqual({ label: "very unhealthy", color: "#7e22ce" });
  expect(pm25Band(400)).toEqual({ label: "hazardous", color: "#7f1d1d" });
});

test("worse air gives a bigger marker", () => {
  const out = normalizeAirStations(fixture as never, AT);
  const sorted = [...out].sort(
    (a, b) => parseFloat(String(a.props?.pm25)) - parseFloat(String(b.props?.pm25)),
  );
  if (sorted.length >= 2) {
    const lo = Number(sorted[0].props?.magnitude);
    const hi = Number(sorted[sorted.length - 1].props?.magnitude);
    expect(hi).toBeGreaterThanOrEqual(lo);
  }
});

test("bands follow EPA's 2024 PM2.5 breakpoints, not the pre-2024 ones", () => {
  expect(pm25Band(9).label).toBe("good");
  expect(pm25Band(10).label).toBe("moderate"); // "good" on the old table (<= 12)
  expect(pm25Band(125.4).label).toBe("unhealthy");
  expect(pm25Band(130).label).toBe("very unhealthy"); // "unhealthy" on the old table
  expect(pm25Band(225.4).label).toBe("very unhealthy");
  expect(pm25Band(230).label).toBe("hazardous");
});

test("a reading older than 3 hours is not plotted as current air", () => {
  // Prod 2026-10-16: 621 of 910 pins were older than 3 h, 328 older than a year.
  const row = (utc: string | undefined, id: number) => ({
    locationsId: id,
    sensorsId: id,
    value: 20,
    coordinates: { latitude: 51.5, longitude: -0.1 },
    datetime: utc === undefined ? undefined : { utc },
  });
  const now = Date.parse("2026-10-16T18:00:00Z");
  const out = normalizeAirStations(
    {
      results: [
        row("2026-10-16T17:00:00Z", 1), // 1 h old: kept
        row(new Date(now - OPENAQ_MAX_AGE_MS).toISOString(), 2), // exactly 3 h: kept
        row("2026-10-16T14:59:00Z", 3), // just past 3 h: dropped
        row("2021-08-09T11:00:00Z", 4), // the Beijing pin from 2021: dropped
        row("2026-10-16T19:00:00Z", 5), // an hour in the future: dropped
        row(undefined, 6), // no time: dropped
      ],
    },
    now,
  );
  expect(out.map((f) => f.id)).toEqual(["openaq:1:1", "openaq:2:2"]);
  expect(out[0].props?.pm25Ugm3).toBe(20);
});
