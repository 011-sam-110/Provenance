import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseDeaHotspots,
  parseHmsText,
  parseInpeCsv,
  inpeNewestFiles,
  deaHotspotsUrl,
  hmsFileUrl,
  DEA_SOURCE,
  HMS_SOURCE,
  INPE_SOURCE,
} from "@/lib/signals/fire-geo";
import {
  mergeFirmsResults,
  parseFirmsCsv,
  rankFireActive,
  GEO_FIRE_CAP,
  FIRMS_CAP,
  type FireDetection,
} from "@/lib/signals/fire-firms";
import { readCoverage } from "@/lib/signals/coverage";
import { readOutcome } from "@/lib/signals/outcome";

// Fixtures captured live on 2026-10-16 ~19:45 UTC from provenance-1:
//   dea-hotspots.json       DEA WFS, three Himawari-9 (BRIGHT AHI) rows
//   hms-fire-points.txt     hms_fire20261016.txt: four GOES rows, two VIIRS rows, one FRP -999
//   inpe-focos-10min.csv    focos_10min_20261016_1940.csv: three GOES-19 rows, two MSG-03 rows
const dea = JSON.parse(readFileSync(new URL("../fixtures/dea-hotspots.json", import.meta.url), "utf-8"));
const hms = readFileSync(new URL("../fixtures/hms-fire-points.txt", import.meta.url), "utf-8");
const inpe = readFileSync(new URL("../fixtures/inpe-focos-10min.csv", import.meta.url), "utf-8");

test("DEA: Himawari rows only, with FRP, confidence and the stated accuracy", () => {
  const relay = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [131.5, -18.1] },
    properties: { product: "AFIMG", satellite: "SUOMI NPP", sensor: "VIIRS", power: 9, datetime: "2026-10-16T19:00:00Z" },
  };
  const out = parseDeaHotspots({ features: [...dea.features, relay] });
  expect(out).toHaveLength(dea.features.length); // the VIIRS relay row is dropped: FIRMS has it
  expect(out.every((d) => d.source === DEA_SOURCE)).toBe(true);
  expect(out[0].satellite).toMatch(/HIMAWARI-9 \(AHI\)/);
  expect(out[0].frp).not.toBeNull();
  expect(out[0].at).not.toBeNull();
  expect(Math.abs(out[0].lat)).toBeLessThanOrEqual(90);
  expect(out[0].lon).toBeGreaterThan(90); // [lon, lat] read the right way round: Australasia
});

test("DEA: the query asks for rows newer than the lookback", () => {
  const u = new URL(deaHotspotsUrl(Date.parse("2026-10-16T16:45:00Z")));
  expect(u.host).toBe("hotspots.dea.ga.gov.au");
  // Time only: the product filter made GeoServer take 32-63 s; the parser drops the rest.
  expect(u.searchParams.get("CQL_FILTER")).toBe("datetime>'2026-10-16T16:45:00Z'");
});

test("HMS: GOES rows only, LONGITUDE first, -999 FRP read as none", () => {
  const out = parseHmsText(hms);
  expect(out).toHaveLength(5); // 4 GOES + the -999 GOES row; the 2 VIIRS rows are dropped
  expect(out[0]).toMatchObject({ lon: -83.798332, lat: 32.681667, frp: 2.29, source: HMS_SOURCE });
  expect(out[0].satellite).toBe("GOES-East (ABI)");
  expect(out[0].at).toBe(Date.parse("2026-10-16T02:01:00Z")); // day 289 of 2026
  expect(out[4].frp).toBeNull();
  expect(out[2].frp).toBeCloseTo(796.65, 2);
});

test("HMS: the daily file URL", () => {
  expect(hmsFileUrl(Date.parse("2026-10-16T19:00:00Z"))).toBe(
    "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Fire_Points/Text/2026/10/hms_fire20261016.txt",
  );
});

test("INPE: geostationary rows only (GOES-19, MSG-03), no FRP, UTC times", () => {
  const withPolar = `${inpe.trim()}\n  -9.100000, -55.200000,NPP-375,2026-10-16 17:02:00\n`;
  const out = parseInpeCsv(withPolar);
  expect(out).toHaveLength(5);
  expect(out.map((d) => d.satellite)).toEqual([
    "GOES-19 (ABI)",
    "GOES-19 (ABI)",
    "GOES-19 (ABI)",
    "MSG-03 (SEVIRI)",
    "MSG-03 (SEVIRI)",
  ]);
  expect(out.every((d) => d.frp === null && d.source === INPE_SOURCE)).toBe(true);
  expect(out[0].at).toBe(Date.parse("2026-10-16T19:20:00Z"));
});

test("INPE: the newest files from the directory listing, oldest first", () => {
  const html = ["0000", "1930", "1940", "1910", "1920", "1900", "1850", "1940"]
    .map((t) => `<a href="focos_10min_20261016_${t}.csv">focos_10min_20261016_${t}.csv</a>`)
    .join("\n");
  expect(inpeNewestFiles(html, 3)).toEqual([
    "focos_10min_20261016_1920.csv",
    "focos_10min_20261016_1930.csv",
    "focos_10min_20261016_1940.csv",
  ]);
});

test("geostationary rows get their own share: newest first, one per 2 km cell", () => {
  const now = Date.parse("2026-10-16T19:45:00Z");
  const polar: FireDetection[] = Array.from({ length: 10 }, (_, i) => ({
    lat: 10 + i,
    lon: 20,
    frp: 100 + i,
    confidence: "high",
    at: now - 3_600_000,
    when: "x" + i,
    brightness: "—",
    satellite: "Suomi NPP (VIIRS)",
    daynight: "day",
  }));
  // The same GOES fire seen in three scans, and one other fire.
  const geo: FireDetection[] = [0, 10, 20].map((m) => ({
    lat: -6.3401,
    lon: -43.3501,
    frp: null,
    confidence: "—",
    at: now - m * 60_000,
    when: "t" + m,
    brightness: "—",
    satellite: "GOES-19 (ABI)",
    daynight: "—",
    source: INPE_SOURCE,
  }));
  geo.push({ ...geo[0], lat: 6.02, lon: -57.3, at: now - 5 * 60_000, when: "other" });
  const out = rankFireActive(polar, geo, 4, 1);
  expect(out).toHaveLength(5); // 4 polar by FRP + 1 geostationary
  expect(out.slice(0, 4).map((f) => f.props?.frp)).toEqual(["109.0 MW", "108.0 MW", "107.0 MW", "106.0 MW"]);
  expect(out[4].ts).toBe(new Date(now).toISOString()); // the newest scan stands for its cell
  expect(out[4].props?.frp).toBe("not published");
  expect(out[4].props?.source).toBe(INPE_SOURCE);
  const c = readCoverage(out)!;
  // 10 polar + 2 geostationary cells (the three scans of one fire count once).
  expect(c).toMatchObject({ available: 12, returned: 5, capped: true, cap: 5 });
  expect(c.rule).toMatch(/newest geostationary/);
  expect(GEO_FIRE_CAP).toBe(500);
  expect(FIRMS_CAP).toBe(1500);
});

test("the merge windows each family: polar 24 h, geostationary 3 h", () => {
  const now = Date.parse("2026-10-16T19:45:00Z");
  const geo = parseInpeCsv(inpe); // 19:15 to 19:20, inside 3 h
  const stale = geo.map((d) => ({ ...d, at: now - 4 * 3_600_000, when: d.when + "-old", lat: d.lat + 1 }));
  const polar = parseFirmsCsv(readFileSync(new URL("../fixtures/firms-viirs-snpp-24h.csv", import.meta.url), "utf-8"));
  const out = mergeFirmsResults(
    [
      { key: "VIIRS S-NPP", ok: true, dets: polar, at: now },
      { key: "GOES-19 (INPE)", family: "geo", ok: true, dets: [...geo, ...stale], at: now },
    ],
    now,
  );
  expect(out.filter((f) => f.props?.source === INPE_SOURCE)).toHaveLength(geo.length);
  expect(out.filter((f) => f.props?.source === "NASA FIRMS").length).toBe(4);
  expect(readOutcome(out)?.ok).toBe(true);
});
