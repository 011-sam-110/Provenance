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
  expect(out.map((f) => f.title)).toEqual([
    "Denmark",                              // 10 articles
    "Hiroshima, Hiroshima, Japan",          // 10
    "France",                               // 8
    "Italy",                                // 8
    "Taipei, T'ai-pei, Taiwan",             // 8
    "Australia",                            // 6
    "Las Vegas, Nevada, United States",     // 4
    "Entebbe, Wakiso, Uganda",              // 3
    "Jerusalem, Israel (general), Israel",  // 2
    "Kuala Lumpur, Kuala Lumpur, Malaysia", // 2
  ]);
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
  expect(ranchi.props?.topEvent).toBe("Demonstration or rally"); // CAMEO 141, the best-covered
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
  expect(CONFLICT_SOURCE.metric).toEqual({ field: "articles", domain: [1, 100], unit: " articles" });
  expect(PROTESTS_SOURCE.metric).toEqual({ field: "articles", domain: [1, 100], unit: " articles" });

  const [top] = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict);
  expect(typeof top.props?.articles).toBe("number");
  expect(Number.isFinite(top.props?.articles as number)).toBe(true);
  // Article volume must never ride on `magnitude` — it would distort the radius.
  expect(top.props?.magnitude).toBeUndefined();

  expect(rowMetric(top, CONFLICT_SOURCE.metric)).toEqual({
    value: 10,
    domain: [1, 100],
    label: "10 articles",
  });
});

test("each marker carries a verifiable source article and an honest precision note", () => {
  const out = normalizeGdeltEvents(EVENTS, GDELT_LAYERS.conflict);
  expect(out.every((f) => f.link === undefined || /^https?:\/\//.test(f.link))).toBe(true);

  const denmark = out.find((f) => f.title === "Denmark")!;
  expect(denmark.props?.precision).toBe("country"); // ActionGeo_Type 1 — a whole-country centroid
  expect(denmark.props?.cameoCode).toBe("193");
  expect(denmark.props?.topEvent).toBe("Fighting with small arms");
  expect(denmark.props?.window).toBe("last 4h");
  expect(typeof denmark.props?.tone).toBe("number");

  const vegas = out.find((f) => f.title.startsWith("Las Vegas"))!;
  expect(vegas.props?.precision).toBe("city"); // ActionGeo_Type 3
  expect(vegas.id).toBe("gdelt:conflict:36.175:-115.137");
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
