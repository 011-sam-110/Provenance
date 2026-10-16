import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import geonet from "@/tests/fixtures/quakes/geonet.json";
import ga from "@/tests/fixtures/quakes/ga.json";
import jma from "@/tests/fixtures/quakes/jma-list.json";
import bmkgFelt from "@/tests/fixtures/quakes/bmkg-felt.json";
import bmkgM5 from "@/tests/fixtures/quakes/bmkg-m5.json";
import {
  GEOFON_FDSN,
  INGV_FDSN,
  NRCAN_FDSN,
  normalizeBmkg,
  normalizeFdsnText,
  normalizeGa,
  normalizeGeonet,
  normalizeIgn,
  normalizeJmaQuakes,
  parseJmaCoordinate,
  utcIso,
} from "@/lib/signals/quakeCatalogues";
import {
  EARTHQUAKES_SOURCE,
  QUAKE_CATALOGUES,
  mergeQuakeReads,
  quakeLayerFrom,
  quakeRank,
  type CatalogueRead,
} from "@/lib/signals/earthquakes";
import { readOutcome } from "@/lib/signals/outcome";
import { readCoverage } from "@/lib/signals/coverage";
import type { SignalFeature } from "@/lib/signals/types";

// Fixtures are live captures from 2026-10-16 between 19:36 and 19:37 UTC, trimmed
// (GeoNet to 30 events, Geoscience Australia to 20 including its placeholder and
// hidden rows, JMA to 25 bulletins including a revised one and intensity flashes).
const text = (f: string) => readFileSync(resolve(__dirname, "../fixtures/quakes", f), "utf8");
const NOW = Date.parse("2026-10-16T19:40:00Z");

const ids = (rows: SignalFeature[]) => rows.map((r) => r.id);

describe("the catalogue parsers", () => {
  test("GeoNet: GeoJSON with publicID, locality and a link to its event page", () => {
    const out = normalizeGeonet(geonet as never);
    // 30 captured, 4 of them withdrawn by GeoNet (quality "deleted").
    expect(out).toHaveLength(26);
    const [a] = out;
    expect(a!.id).toBe("geonet:2026p780530");
    expect(a!.lat).toBeCloseTo(-40.448, 3);
    expect(a!.lon).toBeCloseTo(175.886, 3);
    expect(a!.props?.magnitude).toBe(1.7);
    expect(a!.props?.place).toBe("20 km east of Palmerston North");
    expect(a!.ts).toBe("2026-10-16T19:06:50.885Z");
    expect(a!.link).toBe("https://www.geonet.org.nz/earthquake/2026p780530");
    expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["earthquakes"]));
  });

  test("GeoNet: a deleted event is skipped", () => {
    const one = { features: [{ geometry: { coordinates: [175, -40] }, properties: { publicID: "x", time: "2026-10-16T00:00:00Z", quality: "deleted" } }] };
    expect(normalizeGeonet(one)).toHaveLength(0);
  });

  test("INGV: FDSN text with naive UTC times and 6 fraction digits", () => {
    const out = normalizeFdsnText(text("ingv.txt"), INGV_FDSN);
    expect(out.length).toBe(49);
    const a = out[0]!;
    expect(a.id).toBe("ingv:47554912");
    expect(a.ts).toBe("2026-10-16T18:53:20.680Z");
    expect(a.props?.place).toBe("2 km W Dronero (CN)");
    expect(a.props?.depth).toBe("5.4 km");
    expect(a.props?.magType).toBe("ML");
    expect(a.link).toBe("https://terremoti.ingv.it/en/event/47554912");
  });

  test("GEOFON: the same parser, global M4+", () => {
    const out = normalizeFdsnText(text("geofon.txt"), GEOFON_FDSN);
    expect(out.length).toBe(18);
    const a = out[0]!;
    expect(a.id).toBe("geofon:gfz2026uhgx");
    expect(a.props?.magnitude).toBe(5.3);
    expect(a.props?.place).toBe("Auckland Islands, New Zealand Region");
    expect(a.link).toBe("https://geofon.gfz.de/eqinfo/event.php?id=gfz2026uhgx");
  });

  test("NRCan: the short 8-column variant; a blast is typed as an explosion, the English half of the name is kept", () => {
    const out = normalizeFdsnText(text("nrcan.txt"), NRCAN_FDSN);
    expect(out.length).toBe(8);
    const blast = out.find((f) => f.id === "nrcan:ca2026ungx")!;
    expect(blast.props?.type).toBe("explosion");
    expect(blast.props?.place).toBe("Blast, 5 km S of Chicoutimi - Jonquière, QC, felt");
    const canmore = out.find((f) => f.id === "nrcan:ca2026umtw")!;
    expect(canmore.props?.type).toBe("earthquake");
    expect(canmore.props?.place).toBe("35 km N of Canmore, AB, felt");
    expect(canmore.link).toBe("https://www.earthquakescanada.nrcan.gc.ca/recent/2026/20261016.1046/index-en.php");
  });

  test("an FDSN event typed as something other than an earthquake keeps that type", () => {
    const t = "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType\n" +
      "1|2026-10-16T10:00:00|45|10|0|||||ML|1.2||Cava|quarry blast\n";
    expect(normalizeFdsnText(t, INGV_FDSN)[0]!.props?.type).toBe("quarry blast");
    expect(normalizeFdsnText("garbage", INGV_FDSN)).toEqual([]);
  });

  test("Geoscience Australia: origin_time, not the local epicentral_time; placeholder and hidden rows dropped", () => {
    const out = normalizeGa(ga as never);
    const raw = (ga as { features: { properties: Record<string, unknown> }[] }).features;
    const hidden = raw.filter((f) => f.properties.display_flag !== "Y").length;
    expect(hidden).toBeGreaterThan(0);
    expect(out.length).toBe(raw.length - hidden);
    expect(out.every((f) => f.ts! < "2100")).toBe(true);
    const beacon = out.find((f) => f.id === "ga:ga2026ubtcns")!;
    expect(beacon.ts).toBe("2026-10-10T11:27:39.956Z"); // epicentral_time says 19:27, local WA time
    expect(beacon.props?.place).toBe("11 km SW of Beacon, WA");
    expect(beacon.link).toBe("https://earthquakes.ga.gov.au/event/ga2026ubtcns");
  });

  test("JMA: ISO 6709 coordinates, depth in metres", () => {
    expect(parseJmaCoordinate("+32.3+130.4-10000/")).toEqual({ lat: 32.3, lon: 130.4, depthKm: 10 });
    expect(parseJmaCoordinate("+07.5-080.8/")).toEqual({ lat: 7.5, lon: -80.8, depthKm: null });
    expect(parseJmaCoordinate("")).toBeNull();
  });

  test("JMA: one row per event, the newest bulletin with a hypocentre wins, flashes without one are skipped", () => {
    const out = normalizeJmaQuakes(jma as never);
    const eids = new Set((jma as { eid: string; cod: string }[]).filter((b) => b.cod).map((b) => b.eid));
    expect(out.length).toBe(eids.size);
    const kum = out.find((f) => f.id === "jma:20261016181738")!;
    expect(kum.ts).toBe("2026-10-16T09:17:00.000Z"); // 18:17 JST
    expect(kum.props?.magnitude).toBe(2.5);
    expect(kum.props?.place).toBe("Amakusa and Ashikita Region, Kumamoto Prefecture");
    // A revised far-away quake: 8.0 first, 7.6 in the later bulletin.
    expect(out.find((f) => f.id === "jma:20261010025608")!.props?.magnitude).toBe(7.6);
  });

  test("BMKG: two lists, UTC times, 'lat,lon'; one quake in both lists is one row", () => {
    const out = normalizeBmkg(bmkgFelt as never, bmkgM5 as never);
    expect(out.length).toBeGreaterThan(20);
    expect(new Set(ids(out)).size).toBe(out.length);
    const a = normalizeBmkg(bmkgFelt as never)[0]!;
    expect(a.ts).toBe("2026-10-16T14:22:04.000Z");
    expect(a.lat).toBe(-6.76);
    expect(a.lon).toBe(106.63);
    expect(a.props?.depth).toBe("18.0 km");
    expect(normalizeBmkg(bmkgFelt as never, bmkgFelt as never)).toHaveLength(normalizeBmkg(bmkgFelt as never).length);
  });

  test("IGN: magnitude and place from the Spanish sentence, the time as UTC", () => {
    const out = normalizeIgn(text("ign-sismologia.xml"));
    expect(out.length).toBe(15);
    const a = out[0]!;
    expect(a.id).toBe("ign:es2026uhlqp");
    expect(a.ts).toBe("2026-10-16T15:03:49.000Z");
    expect(a.props?.magnitude).toBe(2.7);
    expect(a.props?.place).toBe("E ST JEAN PIED DE PORT.FRA");
    expect(a.lat).toBe(43.1855);
    expect(a.link?.startsWith("https://www.ign.es/")).toBe(true);
  });

  test("utcIso reads a naive time as UTC and keeps an explicit offset", () => {
    expect(utcIso("2026-10-16T10:00:00")).toBe("2026-10-16T10:00:00.000Z");
    expect(utcIso("2026-10-16T18:17:00+09:00")).toBe("2026-10-16T09:17:00.000Z");
    expect(utcIso("nope")).toBeUndefined();
  });
});

// ── The merge ────────────────────────────────────────────────────────────────

const q = (id: string, over: Partial<SignalFeature> & { mag?: number; type?: string } = {}): SignalFeature => ({
  id,
  lat: over.lat ?? -41,
  lon: over.lon ?? 174,
  title: id,
  signalId: "earthquakes",
  ts: over.ts ?? "2026-10-16T12:00:00.000Z",
  link: `https://example.org/${id}`,
  props: { magnitude: over.mag ?? 3.1, place: "x", type: over.type ?? "earthquake" },
});
const read = (key: string, rows: SignalFeature[], ok = true, reason?: string): CatalogueRead => ({ key, ok, rows, reason });

describe("mergeQuakeReads", () => {
  test("one quake listed by three catalogues is one row, the national agency's inside its country", () => {
    const out = mergeQuakeReads(
      [read("emsc", [q("emsc:1", { mag: 3.0 })]), read("usgs", [q("usgs:1", { mag: 3.3 })]), read("geonet", [q("geonet:1")])],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("geonet:1");
    expect(out[0]!.props?.catalogue).toBe("GeoNet");
    expect(out[0]!.props?.reportedBy).toBe("GeoNet (M3.1), USGS (M3.3), EMSC (M3.0)");
    expect(out[0]!.props).not.toHaveProperty("type");
  });

  test("outside its home a national agency ranks below USGS and GEOFON", () => {
    const chile = { lat: -20, lon: -70 };
    const out = mergeQuakeReads(
      [read("ga", [q("ga:1", chile)]), read("geofon", [q("geofon:1", chile)]), read("usgs", [q("usgs:1", chile)])],
      NOW,
    );
    expect(out[0]!.id).toBe("usgs:1");
    expect(out[0]!.props?.reportedBy).toBe("USGS (M3.1), GFZ GEOFON (M3.1), Geoscience Australia (M3.1)");
  });

  test("an event any catalogue types as a blast is dropped, even when another lists it as a quake", () => {
    const out = mergeQuakeReads([read("usgs", [q("usgs:b", { type: "explosion", lat: 45, lon: -120 })]), read("emsc", [q("emsc:b", { lat: 45, lon: -120 })])], NOW);
    expect(out).toEqual([]);
  });

  test("rows outside the 24-hour window are dropped, whatever the catalogue's own span", () => {
    const old = q("ga:old", { ts: "2026-10-14T00:00:00Z" });
    const fresh = q("ga:new", { ts: "2026-10-16T19:00:00Z" });
    expect(ids(mergeQuakeReads([read("ga", [old, fresh])], NOW))).toEqual(["ga:new"]);
  });

  test("JMA's rows abroad are not used: its far-away bulletins carry a time that is not the origin", () => {
    const abroad = q("jma:k", { lat: 50, lon: 158.1 });
    const home = q("jma:j", { lat: 32.3, lon: 130.4 });
    expect(ids(mergeQuakeReads([read("jma", [abroad, home])], NOW))).toEqual(["jma:j"]);
  });

  test("an unknown catalogue key contributes nothing", () => {
    expect(mergeQuakeReads([read("nope", [q("x:1")])], NOW)).toEqual([]);
  });

  test("newest first", () => {
    const out = mergeQuakeReads([read("usgs", [q("usgs:a", { ts: "2026-10-16T10:00:00Z" }), q("usgs:b", { ts: "2026-10-16T11:00:00Z", lat: 10 })])], NOW);
    expect(ids(out)).toEqual(["usgs:b", "usgs:a"]);
  });

  test("ranks: 0 at home, the catalogue's away rank elsewhere", () => {
    const geonet = QUAKE_CATALOGUES.find((c) => c.key === "geonet")!;
    const usgs = QUAKE_CATALOGUES.find((c) => c.key === "usgs")!;
    expect(quakeRank(geonet, { lat: -41, lon: 174 })).toBe(0);
    expect(quakeRank(geonet, { lat: 35, lon: 139 })).toBe(3);
    expect(quakeRank(usgs, { lat: 61, lon: -150 })).toBe(0); // Alaska
    expect(quakeRank(usgs, { lat: 35, lon: 139 })).toBe(1);
  });
});

describe("the live captures merged", () => {
  const reads: CatalogueRead[] = [
    read("geonet", normalizeGeonet(geonet as never)),
    read("ingv", normalizeFdsnText(text("ingv.txt"), INGV_FDSN)),
    read("jma", normalizeJmaQuakes(jma as never)),
    read("ga", normalizeGa(ga as never)),
    read("nrcan", normalizeFdsnText(text("nrcan.txt"), NRCAN_FDSN)),
    read("bmkg", normalizeBmkg(bmkgFelt as never, bmkgM5 as never)),
    read("ign", normalizeIgn(text("ign-sismologia.xml"))),
    read("geofon", normalizeFdsnText(text("geofon.txt"), GEOFON_FDSN)),
  ];

  test("every row is inside the window, unique, and names its catalogue", () => {
    const out = mergeQuakeReads(reads, NOW);
    expect(out.length).toBeGreaterThan(50);
    expect(new Set(ids(out)).size).toBe(out.length);
    for (const f of out) {
      expect(Date.parse(f.ts!)).toBeGreaterThanOrEqual(NOW - 24 * 3_600_000);
      expect(typeof f.props?.catalogue).toBe("string");
      expect(String(f.props?.reportedBy)).toContain(String(f.props?.catalogue));
    }
    // The NRCan blast is not on the layer.
    expect(ids(out)).not.toContain("nrcan:ca2026ungx");
  });

  test("an M5.3 off the Auckland Islands, listed by three catalogues, is one dot shown as GeoNet's", () => {
    const out = mergeQuakeReads(reads, NOW);
    const row = out.find((f) => String(f.props?.reportedBy).includes("GFZ GEOFON (M5.3)"))!;
    expect(row.props?.catalogue).toBe("GeoNet");
    expect(row.props?.reportedBy).toBe("GeoNet (M4.9), GFZ GEOFON (M5.3), Geoscience Australia (M5.3)");
  });

  test("the Kamchatka M6.9 is one dot from three catalogues", () => {
    const out = mergeQuakeReads(reads, NOW);
    const rows = out.filter((f) => /Kamchatka/i.test(String(f.props?.place)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.props?.reportedBy).toBe("GFZ GEOFON (M6.9), INGV (M6.8), Geoscience Australia (M6.8)");
  });
});

describe("quakeLayerFrom — the outcome", () => {
  test("all answered: observed, with the window stated as coverage", () => {
    const out = quakeLayerFrom([read("usgs", [q("usgs:1")]), read("emsc", [])], NOW);
    expect(readOutcome(out)).toMatchObject({ ok: true, at: NOW });
    expect(readCoverage(out)?.rule).toMatch(/past 24 hours from 2 of 2 catalogues/);
  });

  test("one failed: the others' rows are kept and the layer says which failed", () => {
    const out = quakeLayerFrom([read("usgs", [q("usgs:1")]), read("geonet", [], false, "http 503")], NOW);
    expect(out).toHaveLength(1);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "partial: GeoNet failed (http 503)" });
  });

  test("all failed: nothing, and a failure, not a quiet day", () => {
    const out = quakeLayerFrom([read("usgs", [], false, "timeout"), read("emsc", [], false, "http 500")], NOW);
    expect(out).toHaveLength(0);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "timeout" });
  });

  test("the layer reads every catalogue, credits each, and keeps its id", () => {
    expect(EARTHQUAKES_SOURCE.id).toBe("earthquakes");
    expect(QUAKE_CATALOGUES.map((c) => c.key)).toEqual(["geonet", "ingv", "jma", "ga", "nrcan", "bmkg", "ign", "usgs", "geofon", "emsc"]);
    for (const credit of ["USGS", "EMSC", "GeoNet", "INGV", "GEOFON", "Geoscience Australia", "Japan Meteorological Agency", "Natural Resources Canada", "BMKG", "Instituto Geográfico Nacional"]) {
      expect(EARTHQUAKES_SOURCE.attribution).toContain(credit);
    }
  });
});
