import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import nhcLive from "@/tests/fixtures/tc/nhc-current.json";
import jmaSpec from "@/tests/fixtures/tc/jma-TC2636-specifications.json";
import {
  NON_SAFFIR_COLOR,
  cmaActiveIds,
  joinAgencyReadings,
  jtwcCategory,
  jtwcCoord,
  jtwcFeature,
  parseCmaView,
  parseJmaTyphoon,
  parseJtwcRss,
  parseJtwcTcw,
  unwrapJsonp,
} from "@/lib/signals/cycloneAgencies";
import { kmlPolygons, kmzToKml, ringAnchor, zipEntries } from "@/lib/signals/kmz";
import { TROPICAL_CYCLONES_SOURCE, cycloneLayerFrom, normalizeCyclones } from "@/lib/signals/tropical-cyclones";
import { CYCLONE_FORECASTS_SOURCE, coneFeature, forecastLayerFrom, outlookFeatures } from "@/lib/signals/cyclone-forecasts";
import { readOutcome } from "@/lib/signals/outcome";

// Live captures of 2026-10-16, 19:58-20:05 UTC: NHC with Trudy and Simon, JTWC with
// 29W Champi (West Pacific) and 01P (South Pacific), JMA and CMA on Champi, Trudy's
// 5-day cone and the East Pacific outlook. That day the layer, reading NHC alone,
// showed 2 of the 4 warned systems on Earth.
const fx = (f: string) => resolve(__dirname, "../fixtures/tc", f);
const text = (f: string) => readFileSync(fx(f), "utf8");
const bytes = (f: string) => {
  const b = readFileSync(fx(f));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("JTWC", () => {
  const listings = parseJtwcRss(text("jtwc.rss"));

  test("the RSS lists the warned systems in JTWC's own basins, not the East Pacific ones NHC covers", () => {
    expect(listings.map((l) => l.file)).toEqual(["wp2926", "sh0127"]);
    expect(listings[0]).toEqual({ file: "wp2926", classification: "Tropical Storm", atcf: "29W", name: "Champi", warning: 9 });
    expect(listings[1]!.atcf).toBe("01P");
  });

  test("a .tcw gives the storm now: valid time, position and 1-minute wind", () => {
    const fix = parseJtwcTcw(text("wp2926.tcw"))!;
    expect(fix).toMatchObject({ validTime: "2026-10-16T12:00:00.000Z", atcf: "29W", name: "CHAMPI", warning: 9, lat: 11.4, lon: 151.4, windKt: 60, dir: 275, speedKt: 13 });
    const sh = parseJtwcTcw(text("sh0127.tcw"))!;
    expect(sh).toMatchObject({ lat: -10.8, lon: -163.3, windKt: 35 });
    expect(parseJtwcTcw("nothing")).toBeNull();
    expect(jtwcCoord("1633W")).toBe(-163.3);
    expect(jtwcCoord("108S")).toBe(-10.8);
  });

  test("labels by basin, colours by Saffir-Simpson (JTWC winds are 1-minute)", () => {
    expect(jtwcCategory("wp2926", 60).label).toBe("tropical storm");
    expect(jtwcCategory("wp2926", 100).label).toBe("typhoon (Cat 3 strength)");
    expect(jtwcCategory("wp2926", 135).label).toBe("super typhoon (Cat 4 strength)");
    expect(jtwcCategory("sh0127", 70).label).toBe("tropical cyclone (Cat 1 strength)");
    expect(jtwcCategory("io0126", 25).label).toBe("tropical depression");
  });

  test("a storm feature names the storm, or its id when JTWC has only a number for it", () => {
    const champi = jtwcFeature(listings[0]!, parseJtwcTcw(text("wp2926.tcw"))!);
    expect(champi).toMatchObject({ id: "cyclone:jtwc:wp2926", lat: 11.4, lon: 151.4, title: "Champi (29W) — tropical storm", precision: "exact" });
    expect(champi.props?.windKt).toBe(60);
    const one = jtwcFeature(listings[1]!, parseJtwcTcw(text("sh0127.tcw"))!);
    expect(one.props?.storm).toBe("01P");
  });
});

describe("JMA and CMA", () => {
  test("JMA: the analysis part of specifications.json, 10-minute wind", () => {
    const s = parseJmaTyphoon(jmaSpec as never)!;
    expect(s).toMatchObject({ agency: "JMA", name: "Champi", lat: 11.9, lon: 150.2, windKt: 65, averaging: "10-min", pressureHpa: 980, classification: "TY", validTime: "2026-10-16T18:00:00Z" });
  });

  test("CMA: JSONP, the active list, and the newest point (longitude first, m/s)", () => {
    const list = unwrapJsonp(text("cma-list_default.js"));
    expect(cmaActiveIds(list)).toEqual([{ id: 3359119, name: "CHAMPI" }]);
    const s = parseCmaView(unwrapJsonp(text("cma-view_3359119.js")), 3359119)!;
    expect(s.agency).toBe("CMA");
    expect(s.name).toBe("CHAMPI");
    expect(s.averaging).toBe("2-min");
    expect(s.lon).toBeGreaterThan(140); // the West Pacific, so the lon/lat order was read right
    expect(s.lat).toBeGreaterThan(5);
    expect(unwrapJsonp("garbage")).toBeNull();
  });

  test("their readings join the JTWC storm as labelled fields and never change its colour", () => {
    const champi = jtwcFeature(parseJtwcRss(text("jtwc.rss"))[0]!, parseJtwcTcw(text("wp2926.tcw"))!);
    const jma = parseJmaTyphoon(jmaSpec as never)!;
    const cma = parseCmaView(unwrapJsonp(text("cma-view_3359119.js")), 3359119)!;
    const [joined, ...rest] = joinAgencyReadings([champi], [jma, cma]);
    expect(rest).toEqual([]);
    expect(joined!.color).toBe(champi.color);
    expect(joined!.props?.["JMA 10-min wind"]).toBe("65 kt");
    expect(joined!.props?.["JMA class"]).toBe("TY");
    expect(joined!.props?.["CMA 2-min wind"]).toMatch(/kt$/);
  });

  test("with JTWC down, a JMA storm is still plotted, neutral and labelled with its averaging", () => {
    const jma = parseJmaTyphoon(jmaSpec as never)!;
    const [only] = joinAgencyReadings([], [jma]);
    expect(only).toMatchObject({ id: "cyclone:jma:CHAMPI", color: NON_SAFFIR_COLOR, lat: 11.9, lon: 150.2 });
    expect(only!.props?.category).toBe("TY (JMA scale, not Saffir-Simpson)");
    expect(only!.props).not.toHaveProperty("windKt"); // never on the 1-minute bar
  });
});

describe("NHC cones and outlook areas (the cyclone-forecasts layer)", () => {
  test("a KMZ is read through its central directory", async () => {
    expect(zipEntries(bytes("gtwo_pac.kmz")).map((e) => e.name)).toContain("gtwo_pac.kml");
    const kml = await kmzToKml(bytes("EP212026_013Aadv_CONE.kmz"));
    expect(kml).toContain("Forecast Track Uncertainty");
  });

  test("Trudy's cone is one closed polygon anchored inside itself", async () => {
    const kml = (await kmzToKml(bytes("EP212026_013Aadv_CONE.kmz")))!;
    const cone = coneFeature(kml, { id: "ep212026", name: "Trudy", color: "#b91c1c", advisory: "NHC advisory 013a" })!;
    expect(cone.precision).toBe("area");
    expect(cone.geometry?.type).toBe("Polygon");
    const ring = (cone.geometry as { coordinates: [number, number][][] }).coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(cone.lat).toBeGreaterThan(13);
    expect(cone.lat).toBeLessThan(25);
    expect(cone.lon).toBeLessThan(-100);
  });

  test("the East Pacific outlook: one area with NHC's 2-day and 7-day chances", async () => {
    const kml = (await kmzToKml(bytes("gtwo_pac.kmz")))!;
    const out = outlookFeatures(kml, "pac");
    expect(out.length).toBeGreaterThanOrEqual(1);
    const a = out[0]!;
    expect(a.id).toBe("cyclone-outlook:pac:1");
    expect(a.props?.["chance in 2 days"]).toBe("0% (Low)");
    expect(a.props?.["chance in 7 days"]).toBe("60% (Medium)");
    expect(a.color).toBe("#f97316");
    expect(a.ts).toBe("2026-10-16T17:34:38.000Z");
    expect(a.precision).toBe("area");
  });

  test("a cone or a basin that fails is a partial answer; all failing is a failure", () => {
    const cone = { what: "Trudy cone", ok: true, rows: [{ id: "x", lat: 0, lon: 0, title: "x", signalId: "cyclone-forecasts" }] };
    expect(readOutcome(forecastLayerFrom([cone, { what: "atl outlook", ok: true, rows: [] }], 1))).toMatchObject({ ok: true });
    const part = forecastLayerFrom([cone, { what: "pac outlook", ok: false, rows: [], reason: "http 503" }], 1);
    expect(part).toHaveLength(1);
    expect(readOutcome(part)).toMatchObject({ ok: false, reason: "partial: pac outlook (http 503) failed" });
    const none = forecastLayerFrom([{ what: "NHC storms", ok: false, rows: [], reason: "timeout" }, { what: "atl outlook", ok: false, rows: [], reason: "timeout" }], 1);
    expect(readOutcome(none)).toMatchObject({ ok: false, reason: "timeout" });
  });

  test("its own layer, of areas, so a forecast is never listed as a storm", () => {
    expect(CYCLONE_FORECASTS_SOURCE.id).toBe("cyclone-forecasts");
    expect(CYCLONE_FORECASTS_SOURCE.precision).toBe("area");
  });

  test("kmlPolygons ignores a placemark with no polygon and closes an open ring", () => {
    const kml = `<kml><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark>
      <Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,1</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`;
    const [p] = kmlPolygons(kml);
    expect(p!.ring).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
    expect(ringAnchor(p!.ring)).toEqual({ lat: 0.5, lon: 0.5 });
  });
});

describe("the layer", () => {
  const nhc = { ok: true, rows: normalizeCyclones(nhcLive as never) };
  const jtwcRows = parseJtwcRss(text("jtwc.rss")).map((l) => jtwcFeature(l, parseJtwcTcw(text(`${l.file}.tcw`))!));

  test("the live day: NHC's two storms plus JTWC's two is all four warned systems", () => {
    const out = cycloneLayerFrom({ nhc, jtwc: { ok: true, rows: jtwcRows }, agencies: [] }, 1);
    expect(out.map((f) => f.id)).toEqual(["cyclone:ep212026", "cyclone:ep202026", "cyclone:jtwc:wp2926", "cyclone:jtwc:sh0127"]);
    expect(readOutcome(out)).toMatchObject({ ok: true });
  });

  test("JTWC failing keeps NHC's storms and says so", () => {
    const out = cycloneLayerFrom({ nhc, jtwc: { ok: false, rows: [], reason: "http 503" }, agencies: [] }, 1);
    expect(out).toHaveLength(2);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "partial: JTWC (http 503) failed" });
  });

  test("both failing is a failure, not a quiet ocean", () => {
    const out = cycloneLayerFrom(
      { nhc: { ok: false, rows: [], reason: "timeout" }, jtwc: { ok: false, rows: [], reason: "http 500" }, agencies: [] },
      1,
    );
    expect(out).toHaveLength(0);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "timeout" });
  });

  test("the label and credit name every agency the layer reads", () => {
    expect(TROPICAL_CYCLONES_SOURCE.label).toBe("Tropical cyclones (NHC + JTWC)");
    for (const c of ["NOAA NHC", "JTWC", "Japan Meteorological Agency", "China Meteorological Administration"]) {
      expect(TROPICAL_CYCLONES_SOURCE.attribution).toContain(c);
    }
  });

  test("an NHC storm links its public advisory", () => {
    const trudy = nhc.rows.find((f) => f.id === "cyclone:ep212026")!;
    expect(trudy.link).toBe("https://www.nhc.noaa.gov/text/MIATCPEP1.shtml");
  });
});
