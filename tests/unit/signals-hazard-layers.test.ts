import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fetchGdacsSearch, gdacsSearchUrl, gdacsToLayerFeatures, type GdacsFeature } from "@/lib/signals/gdacs";
import { attachCemsToGdacs, cemsToFeatures, parseWktPoint, type CemsActivation } from "@/lib/signals/copernicus-ems";
import { nwsAlertsToFeatures, nwsGaugesToFeatures } from "@/lib/signals/nws";
import { FLOODS_SOURCE } from "@/lib/signals/floods";
import {
  dropGdacsCoveredByEffis,
  normalizeEffisBurntAreas,
  normalizeWfigs,
  US_ISO3,
  WILDFIRES_SOURCE,
} from "@/lib/signals/wildfires";
import {
  dedupeVolcanoes,
  eonetAsBackground,
  jmaToFeature,
  normalizeUsgsElevated,
  parseJmaCoordinate,
  parseJmaFeed,
  VOLCANOES_SOURCE,
} from "@/lib/signals/volcanoes";
import { convectiveDayStart, parseSpcReports, SEVERE_STORMS_SOURCE } from "@/lib/signals/severe-storms";
import { fromOutcome, withInputsOutcome, type InputResult } from "@/lib/signals/multiInput";
import { degradedWith, observed, readOutcome } from "@/lib/signals/outcome";
import { resolvePrecision } from "@/lib/signals/precision";
import type { SignalFeature } from "@/lib/signals/types";

// Fixtures captured live from provenance-1 on 2026-10-16 between 19:45 and 20:10 UTC.
const fx = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8");
const json = <T>(name: string) => JSON.parse(fx(name)) as T;

const gdacsFl = json<{ features: GdacsFeature[] }>("gdacs-search-fl.json");
const gdacsWf = json<{ features: GdacsFeature[] }>("gdacs-search-wf.json");
const gdacsVo = json<{ features: GdacsFeature[] }>("gdacs-search-vo.json");
const cems = json<{ results: CemsActivation[] }>("cems-activations.json").results;
const NOW = Date.parse("2026-10-16T20:00:00Z");

describe("GDACS SEARCH on a per-hazard layer", () => {
  it("reads floods as standard [lon, lat]: the pins EONET transposed land in their countries", () => {
    const out = gdacsToLayerFeatures(gdacsFl.features, { signalId: "floods", idPrefix: "floods:gdacs", sourceLabel: "GDACS (GloFAS)" });
    const nepal = out.find((f) => f.id === "floods:gdacs:1104225")!;
    const libya = out.find((f) => f.id === "floods:gdacs:1104231")!;
    // Prod (EONET) had Nepal at 84.6 N and Libya at 13.1 N 32.9 E (in Sudan).
    expect(nepal.lat).toBeCloseTo(28.0, 0);
    expect(nepal.lon).toBeCloseTo(84.6, 0);
    expect(libya.lat).toBeCloseTo(32.9, 0);
    expect(libya.lon).toBeCloseTo(13.2, 0);
    expect(out.every((f) => f.signalId === "floods" && resolvePrecision(f, FLOODS_SOURCE) === "area")).toBe(true);
    expect(nepal.props?.source).toBe("GDACS (GloFAS)");
  });

  it("keeps the latest episode of an event once", () => {
    const f = gdacsFl.features[0];
    const older = { ...f, properties: { ...f.properties, episodeid: 1, name: "old episode" } };
    const out = gdacsToLayerFeatures([older, f], { signalId: "floods", idPrefix: "floods:gdacs", sourceLabel: "x" });
    expect(out.filter((x) => x.id === `floods:gdacs:${f.properties?.eventid}`)).toHaveLength(1);
    expect(out.some((x) => x.title === "old episode")).toBe(false);
  });

  it("drops US fire events where WFIGS is the primary", () => {
    const us = { ...gdacsWf.features[0], properties: { ...gdacsWf.features[0].properties, eventid: 9_999_999, iso3: "USA" } };
    const out = gdacsToLayerFeatures([...gdacsWf.features, us], {
      signalId: "wildfires",
      idPrefix: "wildfires:gdacs",
      sourceLabel: "GDACS (JRC GWIS)",
      excludeIso3: US_ISO3,
    });
    expect(out.map((f) => f.id)).not.toContain("wildfires:gdacs:9999999");
    expect(out.length).toBe(gdacsWf.features.length);
    // A GDACS fire point stands for an affected area, on a layer whose default is exact.
    expect(out.every((f) => resolvePrecision(f, WILDFIRES_SOURCE) === "area")).toBe(true);
  });

  it("a volcano point is the volcano", () => {
    const out = gdacsToLayerFeatures(gdacsVo.features, { signalId: "volcanoes", idPrefix: "volcanoes:gdacs", sourceLabel: "x" });
    expect(out.length).toBe(gdacsVo.features.length);
    expect(out.every((f) => resolvePrecision(f, VOLCANOES_SOURCE) === "exact")).toBe(true);
  });

  it("pages by 100 and stops on a short page or a 204", async () => {
    const u = new URL(gdacsSearchUrl("FL", 60, NOW, 2));
    expect(u.searchParams.get("eventlist")).toBe("FL");
    expect(u.searchParams.get("fromDate")).toBe("2026-08-17");
    expect(u.searchParams.get("toDate")).toBe("2026-10-16");
    expect(u.searchParams.get("pagenumber")).toBe("2");
    const page = (n: number) => ({ features: Array.from({ length: n }, () => gdacsFl.features[0]) });
    const short: string[] = [];
    expect(await fetchGdacsSearch("FL", 60, NOW, async (url) => (short.push(url), short.length === 1 ? page(100) : page(44)))).toHaveLength(144);
    expect(short).toHaveLength(2);
    const ended: string[] = [];
    expect(await fetchGdacsSearch("FL", 60, NOW, async (url) => (ended.push(url), ended.length === 1 ? page(100) : null))).toHaveLength(100);
    expect(ended).toHaveLength(2);
  });
});

describe("NIFC WFIGS", () => {
  const out = normalizeWfigs(json("wfigs-incidents.json"));

  it("keeps wildfires and drops a prescribed burn", () => {
    expect(out.map((f) => f.props?.incidentId)).toEqual(["2026-ORPRD-000445", "2026-WAOWF-260406"]);
    expect(out.some((f) => /RX/.test(f.title))).toBe(false);
  });

  it("names the fire, its size and containment, at its point of origin", () => {
    const f = out[0];
    expect(f.title).toBe("0445 CROSSWHITE Fire (OR) — 342,923 acres, 100% contained");
    expect(f.lon).toBeCloseTo(-120.199, 3);
    expect(f.lat).toBeCloseTo(44.803, 3);
    expect(resolvePrecision(f, WILDFIRES_SOURCE)).toBe("exact");
    expect(f.ts).toBe(new Date(1790983597947).toISOString());
  });
});

describe("EFFIS burnt areas on the wildfires layer", () => {
  const effis = normalizeEffisBurntAreas(json("effis-burnt-areas.json"));

  it("draws each burnt area as its polygon, named by commune", () => {
    expect(effis.map((f) => f.title)).toEqual([
      "Burnt area — Casteltermini, Agrigento (IT), 42 ha",
      "Burnt area — Dima, Bizkaia (ES), 5 ha",
    ]);
    expect(effis[0].geometry?.type).toBe("Polygon");
    expect(effis[0].lat).toBeCloseTo(37.55, 1); // Sicily: [lon, lat] read the right way round
    expect(effis[0].lon).toBeCloseTo(13.55, 1);
    expect(resolvePrecision(effis[0], WILDFIRES_SOURCE)).toBe("area");
    expect(effis[0].ts).toBe("2026-10-09T12:12:00.000Z");
  });

  it("a GDACS fire event within 15 km of a burnt area is the same fire", () => {
    const near: SignalFeature = { id: "g:near", lat: effis[0].lat + 0.05, lon: effis[0].lon, title: "x", signalId: "wildfires" };
    const far: SignalFeature = { id: "g:far", lat: 45, lon: 7, title: "x", signalId: "wildfires" };
    expect(dropGdacsCoveredByEffis([near, far], effis).map((f) => f.id)).toEqual(["g:far"]);
    expect(dropGdacsCoveredByEffis([near], [])).toHaveLength(1);
  });
});

describe("Copernicus EMS activations", () => {
  it("reads a WKT centroid as lon then lat", () => {
    expect(parseWktPoint("POINT (-80.67 8.0067)")).toEqual({ lon: -80.67, lat: 8.0067 });
    expect(parseWktPoint("POLYGON ((0 0, 1 1))")).toBeNull();
  });

  it("keeps one category, open or recent, as an area with its portal link", () => {
    const floods = cemsToFeatures(cems, { category: "Flood", signalId: "floods", color: "#0ea5e9", maxAgeDays: 60, now: NOW });
    expect(floods.map((f) => f.props?.activation).sort()).toEqual(["EMSR927", "EMSR933"]);
    expect(floods.every((f) => f.precision === "area")).toBe(true);
    expect(floods[0].link).toMatch(/^https:\/\/mapping\.emergency\.copernicus\.eu\/activations\/EMSR9\d\d\/$/);
    // Ten days later the closed Crete flood (event 2026-10-01) is outside a 14-day window.
    const later = cemsToFeatures(cems, { category: "Flood", signalId: "floods", color: "#0ea5e9", maxAgeDays: 14, now: NOW + 10 * 86_400_000 });
    expect(later.map((f) => f.props?.activation)).not.toContain("EMSR933");
  });

  it("attaches an activation to the GDACS event it mapped instead of pinning it twice", () => {
    const gdacs: SignalFeature[] = [
      { id: "floods:gdacs:1104124", lat: 28, lon: 85, title: "Flood in Nepal", signalId: "floods", props: { gdacsEventId: "1104124" } },
    ];
    const act = cemsToFeatures(cems, { category: "Flood", signalId: "floods", color: "#0ea5e9", maxAgeDays: 60, now: NOW });
    const out = attachCemsToGdacs(gdacs, act);
    expect(out).toHaveLength(2); // Nepal (with EMSR927 attached) + Crete on its own
    expect(out[0].props?.copernicusEms).toBe("EMSR927");
    expect(gdacs[0].props?.copernicusEms).toBeUndefined(); // the input is not mutated
  });
});

describe("NWS", () => {
  const alerts = json<{ features: never[] }>("nws-alerts.json");

  it("splits warnings between floods and severe storms, as polygons", () => {
    const floods = nwsAlertsToFeatures(alerts, "floods");
    const storms = nwsAlertsToFeatures(alerts, "severeStorms");
    expect(floods.map((f) => f.props?.warning)).toEqual(["Flood Warning"]);
    expect(storms.map((f) => f.props?.warning)).toEqual(["Severe Thunderstorm Warning"]);
    for (const f of [...floods, ...storms]) {
      expect(f.geometry?.type).toBe("Polygon");
      expect(f.precision).toBe("area");
    }
    expect(floods[0].title).toBe("Flood Warning — Cleveland, OK; McClain, OK");
    expect(floods[0].lat).toBeGreaterThan(34);
    expect(floods[0].lat).toBeLessThan(36);
    expect(floods[0].ts).toBe("2026-10-16T19:36:00.000Z");
  });

  it("skips a warning that names zones but carries no polygon", () => {
    const zoneOnly = { features: [{ geometry: null, properties: { id: "z", event: "Flood Warning", areaDesc: "Somewhere" } }] };
    expect(nwsAlertsToFeatures(zoneOnly, "floods")).toEqual([]);
  });

  it("pins a gauge in flood at the gauge, with its stage", () => {
    const out = nwsGaugesToFeatures(json("nws-river-gauges.json"));
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      id: "floods:gauge:ABAG1",
      title: "Alabaha River at GA Highway 203 near Blackshear — minor flooding",
      precision: "facility",
      link: "https://water.noaa.gov/gauges/abag1",
      ts: "2026-10-16T18:30:00.000Z",
    });
    expect(out[0].props).toMatchObject({ observed: "9.08 ft", floodStage: "9 ft" });
  });
});

describe("volcano alerts", () => {
  it("USGS: colour code and alert level, sent time in UTC", () => {
    const out = normalizeUsgsElevated(json("usgs-volcanoes-elevated.json"));
    expect(out.map((f) => f.title)).toEqual([
      "Kilauea — ORANGE / WATCH",
      "Great Sitkin — ORANGE / WATCH",
      "Shishaldin — YELLOW / ADVISORY",
      "Ahyi Seamount — YELLOW / ADVISORY",
    ]);
    expect(out[0].ts).toBe("2026-10-16T19:54:02.000Z");
    expect(out[0].link).toMatch(/^https:\/\/volcanoes\.usgs\.gov\/hans2\/view\/notice\//);
  });

  it("JMA: the newest forecast per volcano, at level 2 or more", () => {
    const vs = parseJmaFeed(fx("jma-eqvol.xml"));
    const names = vs.map((v) => v.name);
    for (const n of ["阿蘇山", "桜島", "薩摩硫黄島", "諏訪之瀬島"]) expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
    expect(vs.find((v) => v.name === "桜島")?.level).toBe(3);
    expect(vs.find((v) => v.name === "阿蘇山")?.level).toBe(2);
  });

  it("JMA: coordinates are degrees and decimal minutes", () => {
    const at = parseJmaCoordinate(fx("jma-vfvo53.xml"))!; // 阿蘇山: +3253.07+13106.23
    expect(at.lat).toBeCloseTo(32 + 53.07 / 60, 4);
    expect(at.lon).toBeCloseTo(131 + 6.23 / 60, 4);
    const f = jmaToFeature({ name: "桜島", level: 3, updated: "2026-10-16T20:00:00Z", xmlUrl: "https://x" }, at);
    expect(f.title).toBe("桜島 — JMA alert level 3 (do not approach the volcano)");
  });

  it("the same volcano from two sources is drawn once, by the higher priority", () => {
    const mk = (id: string, lat: number, lon: number): SignalFeature => ({ id, lat, lon, title: id, signalId: "volcanoes" });
    const out = dedupeVolcanoes([
      [mk("usgs:sitkin", 52.0765, -176.1109)],
      [],
      [mk("gdacs:sitkin", 52.08, -176.13), mk("gdacs:kanlaon", 10.41, 123.13)],
      [mk("eonet:kanlaon", 10.412, 123.132), mk("eonet:etna", 37.75, 14.99)],
    ]);
    expect(out.map((f) => f.id)).toEqual(["usgs:sitkin", "gdacs:kanlaon", "eonet:etna"]);
  });

  it("an EONET listing is a dimmed background, dated as listed, not as current", () => {
    const [f] = eonetAsBackground([{ id: "eonet:E", lat: 1, lon: 2, title: "Sangay", signalId: "volcanoes", ts: "2026-06-15T00:00:00Z" }]);
    expect(f.color).toBe("#a8a29e");
    expect(f.props?.listedSince).toBe("2026-06-15T00:00:00Z");
    expect(String(f.props?.status)).toMatch(/not a current alert/);
  });
});

describe("SPC storm reports", () => {
  it("the convective day starts at 12:00 UTC", () => {
    expect(new Date(convectiveDayStart(Date.parse("2026-10-16T20:00:00Z"))).toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect(new Date(convectiveDayStart(Date.parse("2026-10-17T03:00:00Z"))).toISOString()).toBe("2026-10-16T12:00:00.000Z");
  });

  it("reads all three blocks; a time before 1200 is the next calendar day", () => {
    const csv = [
      "Time,F_Scale,Location,County,State,Lat,Lon,Comments",
      "2215,EF1,3 N Moore,Cleveland,OK,35.38,-97.48,Damage survey, roof off. (OUN)",
      "Time,Speed,Location,County,State,Lat,Lon,Comments",
      "0130,65,Pitcairn,Allegheny,PA,40.4,-79.78,Tree down. (PBZ)",
      "Time,Size,Location,County,State,Lat,Lon,Comments",
      "1905,175,2 W Amarillo,Potter,TX,35.2,-101.9,Golf ball hail. (AMA)",
    ].join("\n");
    const out = parseSpcReports(csv, Date.parse("2026-10-16T12:00:00Z"));
    expect(out.map((f) => f.title)).toEqual([
      "Tornado report (EF1) — 3 N Moore, OK",
      "Wind damage report (65 mph) — Pitcairn, PA",
      "Hail report (1.75 in) — 2 W Amarillo, TX",
    ]);
    expect(out.map((f) => f.ts)).toEqual(["2026-10-16T22:15:00.000Z", "2026-10-17T01:30:00.000Z", "2026-10-16T19:05:00.000Z"]);
    expect(out[0].props?.remarks).toBe("Damage survey, roof off. (OUN)"); // the comment keeps its comma
  });

  it("parses a captured day (2026-10-15, two wind reports)", () => {
    const out = parseSpcReports(fx("spc-reports-20261015.csv"), Date.parse("2026-10-15T12:00:00Z"));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ lat: 32.66, lon: -97.91, ts: "2026-10-15T23:01:00.000Z" });
    expect(out[0].title).toBe("Wind damage report — 9 SE Millsap, TX");
  });
});

describe("one layer, several inputs", () => {
  const f = (id: string): SignalFeature => ({ id, lat: 0, lon: 0, title: id, signalId: "floods" });
  const ok = (key: string): InputResult => ({ key, ok: true, features: [f(key)], at: NOW });

  it("every input read → observed", () => {
    const out = withInputsOutcome([ok("a"), ok("b")], [f("a"), f("b")], NOW);
    expect(readOutcome(out)).toMatchObject({ ok: true, at: NOW });
  });

  it("one input failed → the rest stay, and the reason names it", () => {
    const bad: InputResult = { key: "NWS gauges", ok: false, features: [], at: null, reason: "http 503" };
    const out = withInputsOutcome([ok("GDACS"), bad], [f("GDACS")], NOW);
    expect(out).toHaveLength(1);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "partial: NWS gauges failed (http 503)" });
  });

  it("every input failed with nothing held → degraded and empty", () => {
    const bad: InputResult = { key: "GDACS", ok: false, features: [], at: null, reason: "timeout" };
    const out = withInputsOutcome([bad], [], NOW);
    expect(out).toEqual([]);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("an input that declares its own outcome keeps it", () => {
    expect(fromOutcome("EONET", observed([f("x")], NOW))).toMatchObject({ ok: true, at: NOW });
    expect(fromOutcome("EONET", degradedWith([f("x")], "http 503", NOW - 5))).toMatchObject({ ok: false, at: NOW - 5, reason: "http 503" });
    expect(fromOutcome("EONET", [f("x")])).toMatchObject({ ok: false, reason: "not declared" });
  });
});

describe("the layers end to end, against the captured fixtures", () => {
  const route = (u: string): Response => {
    const body = (s: string, type = "application/json") => new Response(s, { status: 200, headers: { "content-type": type } });
    if (u.includes("gdacs.org") && u.includes("eventlist=FL")) return u.includes("pagenumber=1") ? body(fx("gdacs-search-fl.json")) : new Response(null, { status: 204 });
    if (u.includes("gdacs.org") && u.includes("eventlist=WF")) return u.includes("pagenumber=1") ? body(fx("gdacs-search-wf.json")) : new Response(null, { status: 204 });
    if (u.includes("gdacs.org") && u.includes("eventlist=VO")) return u.includes("pagenumber=1") ? body(fx("gdacs-search-vo.json")) : new Response(null, { status: 204 });
    if (u.startsWith("https://api.weather.gov/alerts/active")) return body(fx("nws-alerts.json"));
    if (u.includes("riv_gauges")) return body(fx("nws-river-gauges.json"));
    if (u.includes("public-activations-info")) return body(fx("cems-activations.json"));
    if (u.includes("WFIGS_Incident_Locations_Current")) return body(fx("wfigs-incidents.json"));
    if (u.includes("maps.effis.emergency.copernicus.eu")) return body(fx("effis-burnt-areas.json"));
    if (u.includes("volcanoApi/elevated")) return body(fx("usgs-volcanoes-elevated.json"));
    if (u.endsWith("/feed/eqvol.xml")) return body(fx("jma-eqvol.xml"), "application/xml");
    if (u.includes("data.jma.go.jp/developer/xml/data/")) return body(fx("jma-vfvo53.xml"), "application/xml");
    if (u.includes("spc.noaa.gov/climo/reports/")) return body(fx("spc-reports-20261015.csv"), "text/csv");
    if (u.includes("eonet.gsfc.nasa.gov")) return body(fx("eonet-events.json"));
    return new Response("", { status: 404 });
  };

  it("floods: GDACS + NWS + gauges + Copernicus, every input read", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => route(String(input))) as typeof fetch;
    try {
      const out = await FLOODS_SOURCE.fetch();
      expect(readOutcome(out)?.ok).toBe(true);
      const bySource = new Set(out.map((f) => String(f.props?.source)));
      for (const s of ["GDACS (GloFAS)", "NOAA NWS", "NOAA NWS river gauges", "Copernicus EMS Rapid Mapping"]) expect(bySource).toContain(s);
      expect(out.every((f) => f.signalId === "floods")).toBe(true);
      expect(new Set(out.map((f) => f.id)).size).toBe(out.length);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("wildfires: WFIGS wildfires only, GDACS abroad", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => route(String(input))) as typeof fetch;
    try {
      const out = await WILDFIRES_SOURCE.fetch();
      expect(readOutcome(out)?.ok).toBe(true);
      expect(out.filter((f) => f.props?.source === "NIFC WFIGS")).toHaveLength(2);
      expect(out.filter((f) => f.props?.source === "GDACS (JRC GWIS)")).toHaveLength(gdacsWf.features.length);
      expect(out.filter((f) => f.props?.source === "EFFIS burnt areas")).toHaveLength(2);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("volcanoes and severe storms answer from every input", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => route(String(input))) as typeof fetch;
    try {
      const v = await VOLCANOES_SOURCE.fetch();
      expect(readOutcome(v)?.ok).toBe(true);
      expect(v.some((f) => f.props?.source === "Japan Meteorological Agency")).toBe(true);
      expect(v.some((f) => String(f.props?.source).startsWith("USGS"))).toBe(true);
      const s = await SEVERE_STORMS_SOURCE.fetch();
      expect(readOutcome(s)?.ok).toBe(true);
      expect(s.some((f) => f.props?.source === "NOAA NWS")).toBe(true);
      expect(SEVERE_STORMS_SOURCE.metric).toEqual({ field: "windKt", domain: [35, 140], unit: " kts" });
    } finally {
      globalThis.fetch = real;
    }
  });
});
