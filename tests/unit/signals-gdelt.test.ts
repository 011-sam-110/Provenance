import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseGdeltExport,
  normalizeGdeltEvents,
  cameoLabel,
  geoPrecision,
  parseLastUpdate,
  shiftStamp,
  describeTiming,
  dateFromSqlDate,
  aggregateGdeltByCountry,
  countryFromPlace,
  meanLon,
  GDELT_LAYERS,
  CONFLICT_SOURCE,
  PROTESTS_SOURCE,
} from "@/lib/signals/gdelt";
import { rowMetric } from "@/lib/console/signals/signalCard";

// A REAL slice of GDELT's 15-minute Event export (33 verbatim 61-column rows,
// captured 2026-08-10 from the window ending 20260810104500). Nothing synthetic:
// the duplicate groups, the ungeocoded rows and the single-article rows below are
// all artefacts GDELT genuinely emits.
const TSV = readFileSync(join(process.cwd(), "tests/fixtures/gdelt-events.export.tsv"), "utf8");
const EVENTS = parseGdeltExport(TSV);

test("parses the export and drops rows GDELT could not geocode", () => {
  // 33 rows in, 3 of them ActionGeo_Type 0 with empty coordinates.
  expect(TSV.split("\n").filter(Boolean)).toHaveLength(33);
  expect(EVENTS).toHaveLength(30);
  expect(EVENTS.every((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon))).toBe(true);
  expect(EVENTS.every((e) => e.geoType !== "0")).toBe(true);
  expect(EVENTS.some((e) => e.lat === 0 && e.lon === 0)).toBe(false);

  const jerusalem = EVENTS.find((e) => e.place.startsWith("Jerusalem"))!;
  expect(jerusalem.rootCode).toBe("19");
  expect(jerusalem.quadClass).toBe("4");
  expect(jerusalem.lat).toBeCloseTo(31.7667, 4);
  expect(jerusalem.lon).toBeCloseTo(35.2333, 4);
  expect(jerusalem.sourceUrl).toMatch(/^https:\/\/kaieteurnewsonline\.com\//);
  expect(jerusalem.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(Number.isNaN(Date.parse(jerusalem.ts!))).toBe(false);
});

test("a short or malformed line is skipped rather than throwing", () => {
  expect(parseGdeltExport("")).toEqual([]);
  expect(parseGdeltExport("not\ta\tgdelt\trow")).toEqual([]);
  // CRLF endings must not leak into the last column (the source URL).
  const crlf = TSV.split("\n").filter(Boolean).slice(0, 1).join("\r\n") + "\r\n";
  expect(parseGdeltExport(crlf)[0].sourceUrl.endsWith("/")).toBe(true);
});

test("conflict keeps CAMEO roots 18/19/20 at QuadClass 4 and ranks places by article volume", () => {
  const out = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict);

  // Protest rows (root 14) and off-theme roots (01/04/05/08/09/11) are excluded.
  expect(out.every((f) => f.signalId === "conflict")).toBe(true);
  expect(out.every((f) => f.color === "#b91c1c")).toBe(true);
  // Every surviving place has a TYPED actor. The five places the typed-actor
  // guard removes from this fixture are listed in the test below, with what each
  // article actually was — they are not collateral, they are the point.
  expect(out.map((f) => f.title)).toEqual([
    "Denmark",                              // 10 articles, actor CRM/GANG
    "France",                               // 8, actor GOV/MINISTRY
    "Australia",                            // 6, actor COP
    "Las Vegas, Nevada, United States",     // 4, actor CRM
    "Jerusalem, Israel (general), Israel",  // 2, actor CVL
  ]);
});

test("the typed-actor guard drops rows where GDELT invented an actor from a place name", () => {
  const withGuard = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict);
  const without = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict, 300, 2, false);

  // Turning the guard OFF restores exactly the five places — proving the guard is
  // what removes them, not some incidental change to parsing or bucketing.
  const dropped = without.map((f) => f.title).filter((t) => !withGuard.some((f) => f.title === t));
  expect(dropped.sort()).toEqual([
    "Entebbe, Wakiso, Uganda",              // CAMEO 190: Uganda unveils a STATUE commemorating the 1976 raid
    "Hiroshima, Hiroshima, Japan",          // CAMEO 190: an article about buying a paper-crane ornament
    "Italy",                                // CAMEO 190: a new Italian RESTAURANT opening in Birmingham
    "Kuala Lumpur, Kuala Lumpur, Malaysia", // CAMEO 181: a real ransom case — an honest cost of the guard
    "Taipei, T'ai-pei, Taiwan",             // CAMEO 191: Taiwan building drones against a FUTURE invasion
  ]);

  // Each one carries an actor GDELT inferred from a place name, with no type.
  for (const e of EVENTS.filter((e) => e.place.startsWith("Entebbe") || e.place === "Italy")) {
    expect(e.actorTypes).toEqual([]);
  }
});

test("actor-pair duplicates collapse to the best-covered row, not a summed pile", () => {
  const out = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict);

  // GDELT emitted the same Jerusalem story 4x (one row per actor pair): two rows
  // at 2 articles and two at 1. The 1-article rows fall under the floor and the
  // remaining pair collapses — so Jerusalem is 2 articles, NOT 4.
  const jerusalem = out.find((f) => f.title.startsWith("Jerusalem"))!;
  expect(jerusalem.props?.articles).toBe(2);
  expect(jerusalem.props?.events).toBe(1);

  // Australia: same URL twice at 2 and 6 articles → the 6 survives, alone.
  const australia = out.find((f) => f.title === "Australia")!;
  expect(australia.props?.articles).toBe(6);
  expect(australia.props?.events).toBe(1);

  // France: rows in two different 15-minute files, same story → still one event.
  expect(out.find((f) => f.title === "France")!.props?.articles).toBe(8);
});

test("two distinct stories in one place aggregate into a single ranked marker", () => {
  const out = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.protests);

  expect(out.map((f) => f.title)).toEqual([
    "Ranchi, Jharkhand, India",             // 12 articles across 2 stories
    "Delhi, Delhi, India",                  // 10
    "New Delhi, Delhi, India",              // 10
    "Kashmir, North-West Frontier, Pakistan", // 5
  ]);

  // Ranchi carries a 10-article oneindia story and a 2-article dunyanews story.
  const ranchi = out[0];
  expect(ranchi.props?.articles).toBe(12);
  expect(ranchi.props?.events).toBe(2);
  expect(ranchi.props?.codedAs).toBe("Demonstration or rally (CAMEO 141)"); // the best-covered
  expect(ranchi.link).toContain("oneindia.com");
  expect(ranchi.signalId).toBe("protests");
  expect(ranchi.color).toBe("#7c3aed");

  // Delhi (28.6667) and New Delhi (28.6) are ~7 km apart and must stay separate.
  expect(out[1].lat).not.toBeCloseTo(out[2].lat, 2);
});

test("protests are NOT constrained to QuadClass 4 (CAMEO codes 14x are QuadClass 3)", () => {
  expect(GDELT_LAYERS.protests.quadClass).toBeUndefined();
  expect(GDELT_LAYERS.conflict.quadClass).toBe("4");
  const out = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.protests);
  expect(out.length).toBeGreaterThan(0);
});

test("the article floor drops single-document CAMEO codings", () => {
  // Tel Aviv appears only as a 1-article row, so it never reaches the map...
  const out = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict);
  expect(out.some((f) => f.title.startsWith("Tel Aviv"))).toBe(false);
  // ...but the floor is a parameter, not a hidden constant.
  const loose = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict, 300, 1);
  expect(loose.some((f) => f.title.startsWith("Tel Aviv"))).toBe(true);
});

test("the cap bounds the output regardless of event count", () => {
  const out = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict, 3);
  expect(out).toHaveLength(3);
  expect(out[0].title).toBe("Denmark"); // the best-covered place survives the cap
});

test("declares article volume as the real metric and resolves it per feature", () => {
  expect(CONFLICT_SOURCE.metric).toEqual({ field: "articles", domain: [1, 400], unit: " articles" });
  expect(PROTESTS_SOURCE.metric).toEqual({ field: "articles", domain: [1, 400], unit: " articles" });

  const [top] = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict);
  expect(typeof top.props?.articles).toBe("number");
  expect(Number.isFinite(top.props?.articles as number)).toBe(true);
  // Article volume must never ride on `magnitude` — it would distort the radius.
  expect(top.props?.magnitude).toBeUndefined();

  expect(rowMetric(top, CONFLICT_SOURCE.metric)).toEqual({
    value: 10,
    domain: [1, 400],
    label: "10 articles",
  });
});

test("each marker carries a verifiable source article and an honest precision note", () => {
  const out = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict);
  expect(out.every((f) => f.link === undefined || /^https?:\/\//.test(f.link))).toBe(true);

  const denmark = out.find((f) => f.title === "Denmark")!;
  expect(denmark.props?.pinPrecision).toBe("country"); // ActionGeo_Type 1 — a whole-country centroid
  expect(typeof denmark.props?.tone).toBe("number");

  // The CAMEO label is ATTRIBUTED, never asserted. This is the Bristol fix: the
  // dossier must not read as a finding of fact about what happened at the pin.
  expect(denmark.props?.codedAs).toBe("Fighting with small arms (CAMEO 193)");
  expect(denmark.props?.coding).toMatch(/not a verified incident/i);
  expect(denmark.props?.codedFrom).toMatch(/^\d+ articles? · \d+ publishers?$/);

  // Timing separates OUR ingest window from the event's own date, and never
  // claims the event happened in the last four hours.
  expect(String(denmark.props?.timing)).toMatch(/^Reported in the last 4h/);
  expect(denmark.props?.window).toBeUndefined();

  const vegas = out.find((f) => f.title.startsWith("Las Vegas"))!;
  expect(vegas.props?.pinPrecision).toBe("city"); // ActionGeo_Type 3
  expect(vegas.id).toBe("gdelt:conflict:36.175:-115.137");
});

test("no marker states a CAMEO label as a bare fact", () => {
  const all = [
    ...normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict),
    ...normalizeGdeltEvents(EVENTS, GDELT_LAYERS.protests),
  ];
  expect(all.length).toBeGreaterThan(0);
  for (const f of all) {
    // The old assertive field is gone entirely, in both layers.
    expect(f.props?.topEvent).toBeUndefined();
    // Whatever CAMEO says is carried under a key that names it as a coding, and
    // sits beside an explicit statement that it is unverified.
    expect(typeof f.props?.codedAs).toBe("string");
    expect(f.props?.coding).toMatch(/machine-coded .* by GDELT/i);
    // The title is the PLACE. It never becomes the alleged act.
    expect(f.title).toBe(f.props?.place);
  }
});

test("cameoLabel names the codes, rolls 4-digit leaves up, and never invents one", () => {
  expect(cameoLabel("141")).toBe("Demonstration or rally");
  expect(cameoLabel("195")).toBe("Aerial weapons employed");
  expect(cameoLabel("1823")).toBe("Physical assault"); // leaf rolls up to base 182
  expect(cameoLabel("196")).toBe("Ceasefire violation");
  expect(cameoLabel("199")).toBe("Armed clash"); // unknown base → root 19 label
  expect(cameoLabel("")).toBe("Unclassified");
});

test("geoPrecision maps GDELT's ActionGeo_Type scale", () => {
  expect(geoPrecision("1")).toBe("country");
  expect(geoPrecision("2")).toBe("state");
  expect(geoPrecision("3")).toBe("city");
  expect(geoPrecision("4")).toBe("city");
  expect(geoPrecision("5")).toBe("state");
  expect(geoPrecision("0")).toBe("unknown");
});

test("the 15-minute window is addressed by stamp arithmetic, not guesswork", () => {
  const body = [
    "65303 63e54b08b0a79bcfbc9fbbfd3ca00197 http://data.gdeltproject.org/gdeltv2/20260810103000.export.CSV.zip",
    "79860 0dc33313c0e653cd4fc26165956bc6d8 http://data.gdeltproject.org/gdeltv2/20260810103000.mentions.CSV.zip",
  ].join("\n");
  expect(parseLastUpdate(body)).toBe("20260810103000");
  expect(parseLastUpdate("nothing useful here")).toBeUndefined();

  expect(shiftStamp("20260810103000", 0)).toBe("20260810103000");
  expect(shiftStamp("20260810103000", 2)).toBe("20260810100000");
  expect(shiftStamp("20260810003000", 4)).toBe("20260809233000"); // across midnight UTC
  expect(shiftStamp("20260301000000", 1)).toBe("20260228234500"); // across a month boundary
});

// ---------------------------------------------------------------------------
// The extent bug. Slicing a ZIP member from its payload start to END OF FILE
// hands the decoder the payload plus the data descriptor plus the central
// directory. Node 24 tolerates it; Vercel's runtime rejects it with
// "TypeError: Trailing junk found after the end of the compressed stream", and
// all sixteen slots threw -> the layer served an empty world in production while
// returning 300 conflict points locally. A real export measured 117 trailing
// bytes past the payload.
// ---------------------------------------------------------------------------
import { describe as describeZ, it as itZ, expect as expectZ } from "vitest";
import { zipMemberExtent } from "@/lib/signals/gdelt";

function localHeader(opts: { name: string; extra: number; compressedSize: number; payload: number; trailing: Uint8Array }) {
  const head = 30 + opts.name.length + opts.extra;
  const buf = new Uint8Array(head + opts.payload + opts.trailing.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint32(18, opts.compressedSize, true);
  view.setUint16(26, opts.name.length, true);
  view.setUint16(28, opts.extra, true);
  buf.set(new TextEncoder().encode(opts.name), 30);
  buf.set(opts.trailing, head + opts.payload);
  return buf.buffer;
}

describeZ("zipMemberExtent", () => {
  itZ("stops at the declared compressed size, not at end of file", () => {
    const trailing = new Uint8Array([0x50, 0x4b, 0x01, 0x02, 9, 9, 9, 9]); // central directory
    const buf = localHeader({ name: "x.csv", extra: 4, compressedSize: 100, payload: 100, trailing });
    const { start, end } = zipMemberExtent(buf);
    expectZ(start).toBe(30 + 5 + 4);
    expectZ(end).toBe(start + 100);
    expectZ(end).toBeLessThan(buf.byteLength);
  });

  itZ("finds the data descriptor when the header declares no size (streamed archive)", () => {
    const trailing = new Uint8Array([0x50, 0x4b, 0x07, 0x08, 1, 2, 3, 4]); // PK\x07\x08
    const buf = localHeader({ name: "x.csv", extra: 0, compressedSize: 0, payload: 64, trailing });
    const { start, end } = zipMemberExtent(buf);
    expectZ(end).toBe(start + 64);
  });

  itZ("falls back to the central directory when there is no descriptor either", () => {
    const trailing = new Uint8Array([0x50, 0x4b, 0x01, 0x02, 0, 0, 0, 0]);
    const buf = localHeader({ name: "x.csv", extra: 0, compressedSize: 0, payload: 40, trailing });
    expectZ(zipMemberExtent(buf).end).toBe(30 + 5 + 40);
  });

  itZ("refuses anything that is not a zip", () => {
    expectZ(() => zipMemberExtent(new Uint8Array([1, 2, 3, 4, 5]).buffer)).toThrow(/not a zip/);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION — the Bristol miscoding, 2026-08-13
//
// Sampo, reading the live console: "your site is telling me that there has been
// use of military force in Bristol in the last 4 hours based on an article about
// Perez Hilton livestreaming his breakdown on TikTok."
//
// He was right. These ten rows are the VERBATIM GDELT export rows for that one
// article, captured from the slots that were live at the time. Four of them are
// QuadClass-4 armed-conflict codings, seeding pins on three cities in two
// countries, all from a story about a TikTok moderation failure. The mechanism:
// the article referenced the Christchurch attack, GDELT promoted the city name
// to a national actor (NZL) WITHOUT an actor type, coded the violence vocabulary
// as CAMEO 190, and geocoded the action to unrelated places.
// ---------------------------------------------------------------------------

const BRISTOL_TSV = readFileSync(
  join(process.cwd(), "tests/fixtures/gdelt-bristol-miscoding.export.tsv"),
  "utf8",
);
const BRISTOL_EVENTS = parseGdeltExport(BRISTOL_TSV);

test("the Bristol row passed every guard the layer had before this fix", () => {
  const bristol = BRISTOL_EVENTS.find(
    (e) => e.place.startsWith("Bristol") && e.eventCode === "190",
  )!;
  expect(bristol).toBeDefined();

  // It is not malformed and it is not a null-island artefact. It cleared the
  // root-code, QuadClass, article-floor and geocode guards on the merits.
  expect(bristol.rootCode).toBe("19");
  expect(bristol.quadClass).toBe("4");
  expect(bristol.numArticles).toBeGreaterThanOrEqual(2);
  expect(bristol.geoType).toBe("4"); // GDELT's most precise geo class
  expect(bristol.lat).toBeCloseTo(51.45, 2);
  expect(bristol.lon).toBeCloseTo(-2.58333, 4);
  expect(bristol.sourceUrl).toContain("perez-hilton-self-harm-livestream");

  // Five articles, ONE publisher. The article floor reads that as corroborated.
  expect(bristol.numArticles).toBe(5);
  expect(bristol.numSources).toBe(1);

  // And here is the tell the layer was not reading: an actor invented from a
  // place name, with no type attached.
  expect(bristol.actorTypes).toEqual([]);
});

test("one celebrity story no longer seeds armed-conflict pins across three cities", () => {
  // Before the fix: four QuadClass-4 rows from this single article reached the
  // conflict layer, pinning Bristol, New York and Westchester FL.
  const unguarded = normalizeGdeltEvents(BRISTOL_EVENTS, GDELT_LAYERS.conflict, 300, 2, false);
  expect(unguarded.map((f) => f.title).sort()).toEqual([
    "Bristol, Bristol, City of, United Kingdom",
    "New York, United States",
    "Westchester, Florida, United States",
  ]);
  expect(unguarded.find((f) => f.title.startsWith("Bristol"))!.props?.codedAs)
    .toBe("Use of military force (CAMEO 190)");

  // After: every one of them is gone, from both layers.
  expect(normalizeGdeltEvents(BRISTOL_EVENTS, GDELT_LAYERS.conflict)).toEqual([]);
  expect(normalizeGdeltEvents(BRISTOL_EVENTS, GDELT_LAYERS.protests)).toEqual([]);
});

test("describeTiming never claims an event occurred inside the ingest window", () => {
  // Same day: still only ever a claim about REPORTING.
  expect(describeTiming("2026-08-13T20:30:00Z", "2026-08-13"))
    .toBe("Reported in the last 4h · event dated today");
  // Backdated — 22 rows in the live window were, eleven of them by a year.
  expect(describeTiming("2026-08-13T20:30:00Z", "2025-08-13"))
    .toBe("Reported in the last 4h · event dated 2025-08-13");
  // Missing pieces degrade honestly rather than inventing a window.
  expect(describeTiming("2026-08-13T20:30:00Z", undefined)).toBe("Reported in the last 4h");
  expect(describeTiming(undefined, "2026-08-13")).toBe("Event dated 2026-08-13");
  expect(describeTiming(undefined, undefined)).toBe("Timing unknown");
  // The word "happened" is never used, and neither is a bare "last 4h".
  expect(describeTiming("2026-08-13T20:30:00Z", "2026-08-13")).not.toMatch(/happened|occurred/i);
});

test("dateFromSqlDate reads SQLDATE and rejects anything else", () => {
  expect(dateFromSqlDate("20260813")).toBe("2026-08-13");
  expect(dateFromSqlDate("")).toBeUndefined();
  expect(dateFromSqlDate("2026081")).toBeUndefined();
  expect(dateFromSqlDate("notadate")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// COUNTRY AGGREGATION — the layer that actually ships.
//
// Per-place pins were retired after an audit of the top 30 live markers against
// their source articles: most were court reporting about past events, metaphor,
// or unrelated news. GDELT is sound in bulk and unreliable per record, so the
// layer renders the only claim the feed supports — how much conflict-coded
// reporting mentions each COUNTRY.
// ---------------------------------------------------------------------------

test("countryFromPlace takes the country off the end of an ActionGeo name", () => {
  expect(countryFromPlace("Bristol, Bristol, City of, United Kingdom")).toBe("United Kingdom");
  expect(countryFromPlace("Denmark")).toBe("Denmark");
  expect(countryFromPlace("Gaza, Israel (general), Israel")).toBe("Israel");
  expect(countryFromPlace("")).toBe("");
  expect(countryFromPlace("  ,  ")).toBe("");
});

test("meanLon averages across the antimeridian instead of through the Atlantic", () => {
  // A country straddling 180: the arithmetic mean of 179 and -179 is 0, which is
  // the Gulf of Guinea. The circular mean is 180.
  expect(Math.abs(meanLon([179, -179]))).toBeCloseTo(180, 6);
  expect(meanLon([10, 20])).toBeCloseTo(15, 6);
  expect(meanLon([-5, 5])).toBeCloseTo(0, 6);
  expect(meanLon([])).toBe(0);
});

test("the layer emits one marker per country, totalled by article volume", () => {
  const out = aggregateGdeltByCountry(EVENTS, GDELT_LAYERS.conflict);

  // Five surviving places collapse into four countries: the two US places
  // (Las Vegas 4 + Jerusalem is Israel) stay separate, Denmark/France/Australia
  // are already whole countries.
  expect(out.every((f) => f.signalId === "conflict")).toBe(true);
  expect(new Set(out.map((f) => f.title)).size).toBe(out.length); // no duplicate countries
  // Denmark 10 · France 8 · Australia 6 · United States 4 (Las Vegas) · Israel 2 (Jerusalem)
  expect(out.map((f) => f.title)).toEqual(["Denmark", "France", "Australia", "United States", "Israel"]);

  // Ranked by total article volume, descending.
  const vols = out.map((f) => Number(f.props?.articles));
  expect([...vols].sort((a, b) => b - a)).toEqual(vols);
});

test("a country marker states a country total, never an incident", () => {
  const [top] = aggregateGdeltByCountry(EVENTS, GDELT_LAYERS.conflict);

  expect(top.props?.country).toBe("Denmark");
  expect(typeof top.props?.articles).toBe("number");
  expect(top.props?.locationsRolledUp).toBeGreaterThanOrEqual(1);

  // The CAMEO label survives ONLY as the best-covered coding, attributed.
  expect(String(top.props?.topCoding)).toMatch(/\(CAMEO \d+\)$/);
  expect(top.props?.codedAs).toBeUndefined();  // the per-place field is gone
  expect(top.props?.topEvent).toBeUndefined(); // and so is the original assertion

  // And the marker says outright what it is and where it sits.
  expect(String(top.props?.coding)).toMatch(/REPORTING VOLUME, not confirmed incidents/);
  expect(String(top.props?.coding)).toMatch(/national centroid/);

  // magnitude drives the radius here, unlike the per-place layer.
  expect(typeof top.props?.magnitude).toBe("number");
});

test("aggregation carries the typed-actor guard, so Bristol stays gone", () => {
  expect(aggregateGdeltByCountry(BRISTOL_EVENTS, GDELT_LAYERS.conflict)).toEqual([]);
  expect(aggregateGdeltByCountry(BRISTOL_EVENTS, GDELT_LAYERS.protests)).toEqual([]);

  // Without the guard the article would have contributed to THREE countries'
  // totals — which is the aggregate-scale version of the same bug, and is why
  // the guard is applied before aggregating, not instead of it.
  const unguarded = aggregateGdeltByCountry(BRISTOL_EVENTS, GDELT_LAYERS.conflict, 300, 2, false);
  expect(unguarded.map((f) => f.title).sort()).toEqual(["United Kingdom", "United States"]);
});

test("a country-level row anchors on GDELT's own national point, not a mean", () => {
  // Denmark's row is ActionGeo_Type 1 — GDELT already gives the national point,
  // so we use it rather than averaging city coordinates into a field somewhere.
  const denmark = aggregateGdeltByCountry(EVENTS, GDELT_LAYERS.conflict)
    .find((f) => f.title === "Denmark")!;
  const src = EVENTS.find((e) => e.place === "Denmark" && e.geoType === "1")!;
  expect(denmark.lat).toBeCloseTo(src.lat, 4);
  expect(denmark.lon).toBeCloseTo(src.lon, 4);
});
