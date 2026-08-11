import { expect, test, describe } from "vitest";
import { readCoverage, coverageCountLabel, coverageNote } from "@/lib/signals/coverage";
import { normalizeFirms, FIRMS_CAP } from "@/lib/signals/fire-firms";
import { normalizeCrime, capCrime, CRIME_CAP } from "@/lib/signals/crime";
import { parseGpsjamCsv, gpsjamCellsToFeatures, type H3Lib } from "@/lib/signals/gpsjam";
import { normalizeGdeltEvents, GDELT_LAYERS, type GdeltEvent } from "@/lib/signals/gdelt";
import { normalizeAurora } from "@/lib/signals/aurora";
import { normalizeAis, AIS_CAP } from "@/lib/signals/ais";
import { normalizeAirStations, OPENAQ_CAP } from "@/lib/signals/airquality-stations";
import { normalizeEmsc, EMSC_REQUEST_LIMIT } from "@/lib/signals/emsc";
import { normalizeLaunches, LAUNCHES_PAGE_LIMIT } from "@/lib/signals/launches";
import { normalizeUsgs } from "@/lib/signals/usgs";
import { projectSignal } from "@/lib/console/signals/signalCard";
import { WORLD_SCOPE } from "@/lib/shell/scope";

// Every adapter that truncates must SAY it truncated. One test per capped layer,
// each driving the real normaliser with more rows than its cap allows, so a cap
// that quietly loses its coverage record fails here rather than shipping a number
// that reads like a measurement.

/** The cap constants the adapters actually use, pinned so a silent bump is loud. */
test("the declared caps are what the adapters ship", () => {
  expect(FIRMS_CAP).toBe(1500);
  expect(CRIME_CAP).toBe(1500);
  expect(AIS_CAP).toBe(1200);
  expect(OPENAQ_CAP).toBe(1000);
  expect(EMSC_REQUEST_LIMIT).toBe(500);
  expect(LAUNCHES_PAGE_LIMIT).toBe(30);
});

describe("fire-active (NASA FIRMS)", () => {
  // 40 detections, cap 5 — the same shape as 41k detections capped at 1,500.
  const rows = Array.from({ length: 40 }, (_, i) =>
    `${(10 + i * 0.1).toFixed(4)},${(20 + i * 0.1).toFixed(4)},310.5,0.4,0.4,2026-08-10,${100 + i},N,n,2.0NRT,295.1,${i + 1}.5,N`,
  );
  const csv = ["latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight", ...rows].join("\n");

  test("publishes the detections it dropped", () => {
    const out = normalizeFirms(csv, 5);
    const c = readCoverage(out)!;
    expect(c).toMatchObject({ returned: 5, available: 40, capped: true, cap: 5, availableExact: true });
    expect(coverageCountLabel(c)).toBe("5 of 40");
    expect(coverageNote(c)).toContain("hides 35");
    expect(coverageNote(c)).toContain("fire radiative power");
  });

  test("an uncapped day reports itself complete", () => {
    expect(readCoverage(normalizeFirms(csv))).toMatchObject({ returned: 40, available: 40, capped: false });
  });
});

describe("crime (data.police.uk)", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: 1000 + i,
    category: "burglary",
    month: "2026-06",
    location: { latitude: `51.${500 + i}`, longitude: "-0.1278", street: { name: `Street ${i}` } },
  }));

  test("names the positional cut, because merged city data is NOT ranked", () => {
    const out = capCrime(normalizeCrime(rows), 8);
    const c = readCoverage(out)!;
    expect(c).toMatchObject({ returned: 8, available: 30, capped: true, cap: 8 });
    expect(coverageCountLabel(c)).toBe("8 of 30");
    // The honesty that matters here: this cap is arbitrary, not a "top 8".
    expect(c.rule).toContain("not a ranking");
    expect(coverageNote(c)).toContain("hides 22");
  });
});

describe("gpsJamming (gpsjam.org H3 cells)", () => {
  const csv = [
    "hex,count_good_aircraft,count_bad_aircraft",
    ...Array.from({ length: 25 }, (_, i) => `8${i}283082e73ffff,${100 - i},${50 + i}`),
  ].join("\n");

  const h3: H3Lib = {
    cellToBoundary: () => [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]],
    cellToLatLng: () => [51.5, -0.12],
  };

  test("the cap on CELLS survives the conversion to features", () => {
    const cells = parseGpsjamCsv(csv, { cap: 6 });
    expect(cells).toHaveLength(6);
    const features = gpsjamCellsToFeatures(cells, h3, "2026-08-09");
    const c = readCoverage(features)!;
    expect(c).toMatchObject({ returned: 6, available: 25, capped: true, cap: 6 });
    expect(coverageCountLabel(c)).toBe("6 of 25");
  });

  test("an H3 index that fails to convert shrinks `returned`, not `available`", () => {
    const cells = parseGpsjamCsv(csv, { cap: 6 });
    let n = 0;
    const flaky: H3Lib = {
      cellToBoundary: () => {
        if (n++ === 0) throw new Error("bad index");
        return [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
      },
      cellToLatLng: () => [51.5, -0.12],
    };
    const c = readCoverage(gpsjamCellsToFeatures(cells, flaky))!;
    expect(c.returned).toBe(5);
    expect(c.available).toBe(25);
    expect(c.capped).toBe(true);
  });
});

describe("conflict / protests (GDELT)", () => {
  const events: GdeltEvent[] = Array.from({ length: 20 }, (_, i) => ({
    id: `e${i}`,
    eventCode: "190",
    rootCode: "19",
    quadClass: "4",
    numMentions: 10,
    numArticles: 21 - i, // ≥ MIN_ARTICLES(2) for all 20, so none is filtered out
    avgTone: -5,
    geoType: "3",
    place: `Place ${i}`,
    lat: 10 + i,
    lon: 20 + i,
    sourceUrl: `https://example.test/${i}`,
    ts: "2026-08-10T10:00:00.000Z",
  }));

  test("a busy window declares the places it could not draw", () => {
    const out = normalizeGdeltEvents(events, GDELT_LAYERS.conflict, 4);
    expect(out).toHaveLength(4);
    const c = readCoverage(out)!;
    expect(c).toMatchObject({ returned: 4, available: 20, capped: true, cap: 4, noun: "places" });
    expect(coverageCountLabel(c)).toBe("4 of 20");
    // The cap keeps the best-covered places, so say so — the dropped ones are real.
    expect(out.map((f) => f.title)).toEqual(["Place 0", "Place 1", "Place 2", "Place 3"]);
  });

  test("a quiet window is reported complete rather than silent", () => {
    expect(readCoverage(normalizeGdeltEvents(events, GDELT_LAYERS.conflict, 300))).toMatchObject({
      returned: 20,
      capped: false,
    });
  });
});

describe("aurora (NOAA OVATION)", () => {
  const grid = {
    "Forecast Time": "2026-08-10T12:00:00Z",
    coordinates: Array.from({ length: 30 }, (_, i) => [i * 12, 60 + (i % 8), 10 + i] as [number, number, number]),
  };

  test("the storm backstop, when it bites, is declared", () => {
    const c = readCoverage(normalizeAurora(grid, { cap: 5 }))!;
    expect(c).toMatchObject({ returned: 5, capped: true, cap: 5, noun: "grid cells" });
    expect(c.available).toBeGreaterThan(5);
  });

  test("a normal run does not claim a cap it never hit", () => {
    expect(readCoverage(normalizeAurora(grid))).toMatchObject({ capped: false });
  });
});

describe("ais (AISStream chokepoints)", () => {
  test("a saturated collection window is a LOWER BOUND, never a vessel count", () => {
    const vessels = Array.from({ length: AIS_CAP }, (_, i) => ({
      MMSI: 100000 + i,
      ShipName: `Ship ${i}`,
      latitude: 25 + (i % 10) * 0.01,
      longitude: 56 + (i % 10) * 0.01,
      Sog: 8,
    }));
    const c = readCoverage(normalizeAis(vessels))!;
    expect(c.capped).toBe(true);
    expect(c.availableExact).toBe(false);
    expect(c.upstreamLimit).toBe(AIS_CAP);
    expect(coverageCountLabel(c)).toBe("1,200 of 1,200+");
  });

  test("a quiet chokepoint snapshot is complete and says so", () => {
    const c = readCoverage(normalizeAis([{ MMSI: 1, ShipName: "A", latitude: 25, longitude: 56, Sog: 0 }]))!;
    expect(c).toMatchObject({ returned: 1, available: 1, capped: false, availableExact: true });
  });
});

describe("air-quality-stations (OpenAQ)", () => {
  test("a full page means '1,000 of 1,000+', not '1,000 stations worldwide'", () => {
    const results = Array.from({ length: OPENAQ_CAP }, (_, i) => ({
      locationsId: i + 1,
      sensorsId: i + 1,
      value: 12.5,
      coordinates: { latitude: 10 + (i % 80) * 0.5, longitude: 20 + (i % 100) * 0.5 },
      datetime: { utc: "2026-08-10T09:00:00Z" },
    }));
    const c = readCoverage(normalizeAirStations({ results }))!;
    expect(c.capped).toBe(true);
    expect(c.availableExact).toBe(false);
    expect(coverageCountLabel(c)).toBe("1,000 of 1,000+");
  });

  test("hygiene-dropped rows do not hide the fact the PAGE was full", () => {
    // 1,000 rows back, but 200 are error sentinels — the page was still saturated.
    const results = Array.from({ length: OPENAQ_CAP }, (_, i) => ({
      locationsId: i + 1,
      sensorsId: i + 1,
      value: i < 200 ? -9999 : 12.5,
      coordinates: { latitude: 10 + (i % 80) * 0.5, longitude: 20 + (i % 100) * 0.5 },
      datetime: { utc: "2026-08-10T09:00:00Z" },
    }));
    const c = readCoverage(normalizeAirStations({ results }))!;
    expect(c.returned).toBe(800);
    expect(c.capped).toBe(true);
    expect(c.availableExact).toBe(false);
    // The provable floor is the saturated PAGE (1,000), not the 800 that survived
    // hygiene — so the label must not understate what exists upstream.
    expect(coverageCountLabel(c)).toBe("800 of 1,000+");
  });
});

describe("emsc-quakes (EMSC FDSN)", () => {
  const quake = (i: number) => ({
    id: `q${i}`,
    geometry: { coordinates: [10 + i * 0.01, 40 + i * 0.01, 5] },
    properties: { mag: 3.2, depth: 5, time: "2026-08-10T08:00:00Z", flynn_region: "GREECE", unid: `u${i}` },
  });

  test("a full FDSN page admits the catalogue holds more", () => {
    const c = readCoverage(
      normalizeEmsc({ features: Array.from({ length: EMSC_REQUEST_LIMIT }, (_, i) => quake(i)) }),
    )!;
    expect(c.capped).toBe(true);
    expect(c.availableExact).toBe(false);
    expect(c.upstreamLimit).toBe(EMSC_REQUEST_LIMIT);
    expect(coverageCountLabel(c)).toBe("500 of 500+");
  });

  test("a short page is a real, complete measurement", () => {
    const c = readCoverage(normalizeEmsc({ features: [quake(1), quake(2)] }))!;
    expect(c).toMatchObject({ returned: 2, available: 2, capped: false, availableExact: true });
    expect(coverageCountLabel(c)).toBe("2");
  });
});

describe("launches (Launch Library 2)", () => {
  const launch = (i: number) => ({
    id: `l${i}`,
    name: `Mission ${i}`,
    net: "2026-08-12T10:00:00Z",
    pad: { name: "LC-39A", latitude: "28.56", longitude: "-80.57" },
  });

  test("LL2's own total is preferred — an EXACT 'N of M'", () => {
    const c = readCoverage(
      normalizeLaunches({ results: Array.from({ length: 30 }, (_, i) => launch(i)), count: 87 }),
    )!;
    expect(c).toMatchObject({ returned: 30, available: 87, capped: true, availableExact: true });
    expect(coverageCountLabel(c)).toBe("30 of 87");
  });

  test("without a total, a full page falls back to a lower bound", () => {
    const c = readCoverage(normalizeLaunches({ results: Array.from({ length: 30 }, (_, i) => launch(i)) }))!;
    expect(c.availableExact).toBe(false);
    expect(coverageCountLabel(c)).toBe("30 of 30+");
  });
});

describe("uncapped layers stay uncapped", () => {
  test("USGS declares a measured-complete payload, not a bare count", () => {
    const out = normalizeUsgs({
      features: [
        {
          id: "nc1",
          properties: { mag: 4.2, place: "Nevada", time: 1_760_000_000_000, type: "earthquake" },
          geometry: { coordinates: [-118, 38, 7] },
        },
      ],
    });
    expect(out).toHaveLength(1);

    // The summary feed takes no `limit=` and we apply no render cap, so "you are
    // seeing all of it" is a measurement here, not an assertion — which is exactly
    // the case markCoverage() exists to record. `available` is re-derived from the
    // array by withCoverage(), so the record cannot overstate what the payload holds.
    const c = readCoverage(out)!;
    expect(c).toMatchObject({
      returned: 1,
      available: 1,
      availableExact: true,
      capped: false,
      rule: "all earthquakes in the past 24 hours",
    });
    // Uncapped stays uncapped: no invented denominator, no truncation note.
    expect(coverageCountLabel(c)).toBe("1");
    expect(coverageNote(c)).toBeUndefined();
  });
});

describe("the monitor card presents the cap", () => {
  const world = WORLD_SCOPE;
  const features = Array.from({ length: 40 }, (_, i) => ({
    id: `f${i}`,
    lat: 51.5,
    lon: -0.12,
    title: `Fire ${i}`,
    signalId: "fire-active",
    props: { magnitude: 40 - i },
  }));

  test("a capped feed's headline count carries its denominator", () => {
    const csvRows = Array.from({ length: 40 }, (_, i) =>
      `${(10 + i * 0.1).toFixed(4)},${(20 + i * 0.1).toFixed(4)},310.5,0.4,0.4,2026-08-10,${100 + i},N,n,2.0NRT,295.1,${i + 1}.5,N`,
    );
    const capped = normalizeFirms(
      ["latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight", ...csvRows].join("\n"),
      5,
    );
    const p = projectSignal(capped, world, {});
    expect(p.total).toBe(5);
    expect(p.totalLabel).toBe("5 of 40"); // NOT "5"
    expect(p.capNote).toContain("hides 35");
    expect(p.coverage?.capped).toBe(true);
  });

  test("coverage can be handed in explicitly, because JSON drops the side channel", () => {
    const overTheWire = JSON.parse(JSON.stringify(features)) as typeof features;
    const p = projectSignal(overTheWire, world, {}, undefined, {
      returned: 40,
      available: 41203,
      availableExact: true,
      capped: true,
      cap: 1500,
      noun: "fire detections",
    });
    expect(p.totalLabel).toBe("40 of 41,203");
    expect(p.capNote).toContain("41,203 fire detections");
  });

  test("an undeclared feed prints a bare, grouped count and no note", () => {
    const p = projectSignal(features, world, {});
    expect(p.totalLabel).toBe("40");
    expect(p.capNote).toBeUndefined();
    expect(p.coverage).toBeUndefined();
  });
});
