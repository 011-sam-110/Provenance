import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  latestCandidateCsv,
  parseCsv,
  parseUcdpCsv,
  normalizeUcdp,
  ucdpPrecision,
  ucdpCountry,
} from "@/lib/signals/ucdp";
import {
  parseAlertFeed,
  alertFields,
  classifyAlert,
  namedCity,
  postAlerts,
  normalizeEmbassyAlerts,
} from "@/lib/signals/embassy-alerts";
import { EMBASSY_POSTS } from "@/lib/signals/embassy-posts.data";
import {
  parseFcdoSearch,
  fcdoUpdateFromContent,
  parseGacIndex,
  classifyAdvice,
  normalizeAdvice,
} from "@/lib/signals/travel-advice";
import { composeConflict, composeProtests, joinOutcome, CONFLICT_SOURCE, PROTESTS_SOURCE } from "@/lib/signals/conflict";
import { httpGetOptions, fallbackWorth } from "@/lib/signals/httpGet";

// Every fixture here is a real capture of 2026-10-16, trimmed to a few items: the UCDP
// v26.0.8 candidate release, four U.S. Embassy alert feeds, the GOV.UK travel-advice
// search and three of its content items, and the Global Affairs Canada index.

const fx = (name: string) => readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");
const NOW = Date.parse("2026-10-16T21:00:00Z");
const post = (host: string) => EMBASSY_POSTS.find((p) => p.host === host)!;

describe("UCDP GED candidate events", () => {
  const events = parseUcdpCsv(fx("ucdp-ged-candidate.csv"));
  const features = normalizeUcdp(events, "v26.0.8");

  it("finds the newest monthly file on the downloads page, not the quarterly one", () => {
    const html =
      '<a href="candidateged/GEDEvent_v26_0_7.csv">a</a> <a href="candidateged/GEDEvent_v26_01_26_06.csv">q</a>' +
      ' <a href="/downloads/candidateged/GEDEvent_v26_0_8.csv">b</a> <a href="candidateged/GEDEvent_v25_0_12.csv">c</a>';
    expect(latestCandidateCsv(html)).toEqual({
      url: "https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_8.csv",
      version: "v26.0.8",
    });
    expect(latestCandidateCsv("nothing here")).toBeUndefined();
  });

  it("parses quoted CSV cells with commas, doubled quotes and line breaks", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"two\nlines",z\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["two\nlines", "z"],
    ]);
  });

  it("reads every captured row and keeps UCDP's own id", () => {
    expect(events).toHaveLength(17);
    expect(features).toHaveLength(17);
    expect(features[0]!.id).toBe("ucdp:637360");
    expect(features[0]!.title).toBe("One-sided violence against civilians — Hirat town, Afghanistan");
    expect(features[0]!.ts).toBe("2026-08-10T00:00:00Z");
    expect(features[0]!.props?.release).toBe("UCDP GED Candidate v26.0.8");
  });

  it("states UCDP's precision rather than pinning everything", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(ucdpPrecision)).toEqual(["exact", "area", "area", "area", "area", "country", "area"]);
    const ukraine = features.find((f) => f.id === "ucdp:640738")!;
    expect(ukraine.precision).toBe("country");
    expect(ukraine.countryIso3).toBe("UKR");
    expect(ukraine.title).toBe("State-based armed conflict — Ukraine"); // the country is said once
    expect(ukraine.props?.deaths).toBe(5017);
  });

  it("labels rows UCDP has not finished checking as provisional", () => {
    const provisional = features.filter((f) => String(f.props?.status).startsWith("Provisional"));
    expect(provisional.length).toBeGreaterThan(0);
    expect(features.find((f) => f.id === "ucdp:637360")!.props?.status).toBe("Coded by UCDP");
  });

  it("reads UCDP's bracketed historical country names", () => {
    expect(ucdpCountry("Yemen (North Yemen)")?.iso3).toBe("YEM");
    expect(ucdpCountry("DR Congo (Zaire)")?.iso3).toBe("COD");
    expect(ucdpCountry("Russia (Soviet Union)")?.iso3).toBe("RUS");
    expect(ucdpCountry("Myanmar (Burma)")?.iso3).toBe("MMR");
    expect(ucdpCountry("United States of America")?.iso3).toBe("USA");
  });
});

describe("U.S. Embassy alerts", () => {
  it("reads the Location and Event lines of an alert body", () => {
    const f = alertFields("Location: Tirana, Albania Date/Time: Ongoing Event: Demonstrations in Tirana. Actions to Take: Avoid");
    expect(f).toEqual({ location: "Tirana, Albania", event: "Demonstrations in Tirana." });
    expect(alertFields("no fields at all")).toEqual({ location: undefined, event: undefined });
  });

  it("classifies by the alert's own words, and never counts a Worldwide Caution", () => {
    expect(classifyAlert("Demonstration Alert: Planned Protests in Bogota")).toBe("protest");
    expect(classifyAlert("Security Alert: U.S. Embassy Port-au-Prince", "Gunfire was reported near the Embassy")).toBe("conflict");
    expect(classifyAlert("Security Alert: Vigilance during demonstrations")).toBe("protest");
    expect(classifyAlert("Security Alert: Consular Services Suspended")).toBeUndefined();
    expect(classifyAlert("Security Alert – Worldwide Caution", "terrorist attacks")).toBeUndefined();
    // An air strike is not a labour strike.
    expect(classifyAlert("Security Alert", "reports of air strikes near the border")).toBe("conflict");
    expect(classifyAlert("Weather Alert: Hurricane")).toBeUndefined();
  });

  it("places an alert on the first city it names, and only on one it names", () => {
    const al = post("al.usembassy.gov");
    expect(namedCity("Tirana, Shkoder, Durres, Vlora, Korca, Kukes, and Elbasan, Albania", al.cities)?.[0]).toBe("Tirana");
    const mx = post("mx.usembassy.gov");
    expect(namedCity("Paseo de la Reforma, Mexico City, Mexico", mx.cities)?.[0]).toBe("Mexico City");
    expect(namedCity("Bogota", post("co.usembassy.gov").cities)?.[0]).toBe("Bogotá"); // accents folded
    expect(namedCity("Ethiopia", post("et.usembassy.gov").cities)).toBeUndefined();
  });

  it("turns a week of Tirana updates into one marker that counts them", () => {
    const al = post("al.usembassy.gov");
    const alerts = postAlerts(al, parseAlertFeed(fx("embassy-alerts-al.rss.xml")), NOW);
    const out = normalizeEmbassyAlerts(alerts, "protest", "protests", "#7c3aed");
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Demonstration alert — Tirana, Albania");
    expect(out[0]!.precision).toBe("area");
    expect(out[0]!.props?.alertsThisWeek).toBe(3);
    expect(out[0]!.link).toMatch(/^https:\/\/al\.usembassy\.gov\//);
    expect(String(out[0]!.props?.meaning)).toMatch(/NOT a report that anything happened/);
  });

  it("keeps an alert that names no city at country level, never on the capital", () => {
    const et = post("et.usembassy.gov");
    const alerts = postAlerts(et, parseAlertFeed(fx("embassy-alerts-et.rss.xml")), NOW);
    const conflict = normalizeEmbassyAlerts(alerts, "conflict", "conflict", "#b91c1c");
    expect(conflict).toHaveLength(1);
    expect(conflict[0]!.precision).toBe("country");
    expect(conflict[0]!.countryIso3).toBe("ETH");
    // The holiday-crowds security alert is about neither layer.
    expect(alerts.some((a) => a.item.title.includes("Meskel"))).toBe(false);
  });

  it("drops weather alerts, old alerts and Worldwide Cautions", () => {
    const mx = postAlerts(post("mx.usembassy.gov"), parseAlertFeed(fx("embassy-alerts-mx.rss.xml")), NOW);
    expect(mx.map((a) => a.city?.[0]).sort()).toEqual(["Guadalajara", "Mexico City"]);
    const ly = postAlerts(post("ly.usembassy.gov"), parseAlertFeed(fx("embassy-alerts-ly.rss.xml")), NOW);
    expect(ly).toEqual([]); // September's demonstration is outside the week; the caution never counts
  });

  it("lets the headers of a usembassy.gov response through", () => {
    // Each response carries a ~16 KB Content-Security-Policy header; at Node's default
    // limit every feed failed with UND_ERR_HEADERS_OVERFLOW.
    expect(httpGetOptions({ maxHeaderSize: 65_536 }).maxHeaderSize).toBe(65_536);
    expect(httpGetOptions({ family: 4 }).family).toBe(4);
    // fetch is tried first; only that exact failure falls back to node:https, so a
    // stubbed fetch in a test never reaches the real network.
    const overflow = Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_HEADERS_OVERFLOW" } });
    expect(fallbackWorth(overflow, ["UND_ERR_HEADERS_OVERFLOW"])).toBe(true);
    expect(fallbackWorth(new Error("network refused (test)"), ["UND_ERR_HEADERS_OVERFLOW"])).toBe(false);
  });

  it("has a post table with the capital first and real coordinates", () => {
    expect(EMBASSY_POSTS.length).toBeGreaterThan(150);
    expect(post("uk.usembassy.gov").iso2).toBe("GB");
    for (const p of EMBASSY_POSTS) {
      for (const c of p.cities) {
        expect(Math.abs(c[1]), `${p.host} ${c[0]}`).toBeLessThanOrEqual(90);
        expect(Math.abs(c[2]), `${p.host} ${c[0]}`).toBeLessThanOrEqual(180);
      }
    }
    expect(post("al.usembassy.gov").cities[0]![0]).toBe("Tirana");
  });
});

describe("official travel advice", () => {
  const fcdo = ["ethiopia", "belgium", "kenya"].map(
    (slug) => fcdoUpdateFromContent(slug, JSON.parse(fx(`fcdo-travel-advice-${slug}.json`)))!,
  );
  const gac = parseGacIndex(JSON.parse(fx("gac-travel-advice.json")));

  it("reads the FCDO search newest first", () => {
    const s = parseFcdoSearch(JSON.parse(fx("fcdo-travel-advice-search.json")));
    expect(s.length).toBe(12);
    expect(s[0]!.slug).toBe("ethiopia");
    for (let i = 1; i < s.length; i++) expect(s[i]!.at).toBeLessThanOrEqual(s[i - 1]!.at);
  });

  it("reads an FCDO change line with its country", () => {
    expect(fcdo[0]).toMatchObject({ iso2: "ET", issuer: "FCDO" });
    expect(fcdo[0]!.text).toMatch(/fighting in the Tigray region/);
    expect(fcdo[0]!.url).toBe("https://www.gov.uk/foreign-travel-advice/ethiopia");
  });

  it("skips GAC editorial changes", () => {
    expect(gac.map((u) => u.iso2).sort()).toEqual(["AL", "ET", "MU", "MX", "PA", "SO"]);
  });

  it("counts a change only when its own words name conflict or protest", () => {
    expect(classifyAdvice("New information about fighting in the Tigray region")).toEqual({ conflict: true, protest: false });
    expect(classifyAdvice("Updated information about national strike action")).toEqual({ conflict: false, protest: true });
    expect(classifyAdvice("Natural disasters and climate section – added information on El Niño")).toEqual({ conflict: false, protest: false });
    expect(classifyAdvice("reports of air strikes")).toEqual({ conflict: true, protest: false });
  });

  it("makes one country-level warning per country, naming who issued it", () => {
    const conflict = normalizeAdvice([...fcdo, ...gac], "conflict", "conflict", "#b45309", NOW);
    expect(conflict.map((f) => f.id)).toEqual(["advice:conflict:ETH"]);
    expect(conflict[0]!.precision).toBe("country");
    expect(conflict[0]!.title).toBe("Official travel warning — Ethiopia (FCDO)");
    const protests = normalizeAdvice([...fcdo, ...gac], "protest", "protests", "#a78bfa", NOW);
    expect(protests.map((f) => f.id).sort()).toEqual(["advice:protests:ALB", "advice:protests:BEL"]);
  });

  it("forgets a warning after a week", () => {
    const later = NOW + 8 * 86_400_000;
    expect(normalizeAdvice([...fcdo, ...gac], "conflict", "conflict", "#b45309", later)).toEqual([]);
  });
});

describe("the two layers", () => {
  const ucdp = { features: normalizeUcdp(parseUcdpCsv(fx("ucdp-ged-candidate.csv")), "v26.0.8"), ok: true, at: NOW };
  const alerts = [
    ...postAlerts(post("al.usembassy.gov"), parseAlertFeed(fx("embassy-alerts-al.rss.xml")), NOW),
    ...postAlerts(post("et.usembassy.gov"), parseAlertFeed(fx("embassy-alerts-et.rss.xml")), NOW),
  ];
  const embassy = { alerts, held: 177, failed: 0, total: 177 };
  const advice = {
    updates: [fcdoUpdateFromContent("ethiopia", JSON.parse(fx("fcdo-travel-advice-ethiopia.json")))!],
    failed: [],
    at: NOW,
  };

  it("conflict = UCDP events + security alerts + advice, each saying its source", () => {
    const { features, ok } = composeConflict(ucdp, embassy, advice, NOW);
    expect(ok).toBe(true);
    expect(new Set(features.map((f) => f.props?.source))).toEqual(
      new Set(["UCDP", "U.S. Embassy alert", "Official travel advice"]),
    );
    expect(features.every((f) => f.signalId === "conflict")).toBe(true);
  });

  it("protests = demonstration alerts, and no UCDP event", () => {
    const { features } = composeProtests(embassy, advice, NOW);
    expect(features.map((f) => f.title)).toEqual(["Demonstration alert — Tirana, Albania"]);
  });

  it("a source that fails makes the read degraded while the others still draw", () => {
    const failed = { ...ucdp, features: [], ok: false, reason: "ucdp: csv http 503" };
    const out = composeConflict(failed, embassy, advice, NOW);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("ucdp: csv http 503");
    expect(out.features.length).toBeGreaterThan(0);
    expect(composeProtests({ alerts: [], held: 0, failed: 177, total: 177 }, advice, NOW).ok).toBe(false);
    expect(joinOutcome([{ name: "a", ok: true }])).toEqual({ ok: true });
  });

  it("keeps the layer ids, and credits every upstream", () => {
    expect(CONFLICT_SOURCE.id).toBe("conflict");
    expect(PROTESTS_SOURCE.id).toBe("protests");
    for (const s of ["UCDP", "Department of State", "FCDO", "Global Affairs Canada", "GeoNames"]) {
      expect(CONFLICT_SOURCE.attribution).toContain(s);
    }
    expect(PROTESTS_SOURCE.attribution).not.toContain("UCDP");
    expect(CONFLICT_SOURCE.metric?.field).toBe("deaths");
  });
});
