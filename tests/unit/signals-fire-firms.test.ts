import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalizeFirms,
  fireColor,
  parseFirmsCsv,
  mergeFirmsResults,
  FIRE_FIRMS_SOURCE,
  FIRMS_CAP,
  FIRMS_FILES,
  FIRMS_WINDOW_MS,
  type FirmsFileResult,
} from "@/lib/signals/fire-firms";
import { readOutcome } from "@/lib/signals/outcome";

const csv = readFileSync(new URL("../fixtures/firms-fires.csv", import.meta.url), "utf-8");

test("parses FIRMS CSV, skips bad coords, sorts by FRP, respects the cap", () => {
  const out = normalizeFirms(csv);
  expect(out).toHaveLength(6); // 6 valid rows; the empty lat/lon row is skipped
  expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["fire-active"]));
  // Sorted by intensity (FRP) — the 183.89 MW detection leads.
  expect(out[0].props?.frp).toBe("183.9 MW");
  expect(out[0].color).toBe(fireColor(183.89)); // #7f1d1d
  expect(out[0].props?.confidence).toBe("low"); // VIIRS "l"
  expect(out[0].ts).toBe("2026-06-27T05:21:00.000Z"); // acq_date + acq_time 521

  const cap2 = normalizeFirms(csv, 2);
  expect(cap2).toHaveLength(2);
});

test("confidence flags and the FRP colour ramp", () => {
  const out = normalizeFirms(csv);
  expect(out.some((f) => f.props?.confidence === "high")).toBe(true); // the "h" row
  expect(fireColor(120)).toBe("#7f1d1d");
  expect(fireColor(60)).toBe("#b91c1c");
  expect(fireColor(25)).toBe("#dc2626");
  expect(fireColor(8)).toBe("#ea580c");
  expect(fireColor(1)).toBe("#f97316");
});

// --- keyless 24 h files (2026-10-16) -----------------------------------------
// Captured from SUOMI_VIIRS_C2_Global_24h.csv on 2026-10-16 ~19:40 UTC: the first two
// rows (10-15 01:07), two from the middle, the two most intense, the last two.
const viirs24h = readFileSync(new URL("../fixtures/firms-viirs-snpp-24h.csv", import.meta.url), "utf-8");
const AT = Date.parse("2026-10-16T19:40:00Z");

test("the keyless 24 h file parses with the same columns as the old API", () => {
  const dets = parseFirmsCsv(viirs24h);
  expect(dets).toHaveLength(8);
  expect(dets[0]).toMatchObject({ satellite: "N", daynight: "night", confidence: "nominal" });
  expect(dets[0].at).toBe(Date.parse("2026-10-15T01:07:00Z"));
});

test("the '24h' file spans ~42 h, so only the last 24 h are kept", () => {
  const out = normalizeFirms(viirs24h, FIRMS_CAP, { now: AT });
  // Every 10-15 row (01:07 to 18:21) is older than 24 h at 10-16 19:40; the four 10-16 rows stay.
  expect(out).toHaveLength(4);
  expect(out.every((f) => Date.parse(f.ts!) >= AT - FIRMS_WINDOW_MS)).toBe(true);
  expect(out[0].props?.frp).toBe("543.7 MW");
});

test("the source reads the keyless file and needs no key", async () => {
  const prev = process.env.FIRMS_MAP_KEY;
  delete process.env.FIRMS_MAP_KEY;
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(viirs24h, { status: 200, headers: { "last-modified": "Fri, 16 Oct 2026 18:49:12 GMT" } });
  }) as typeof fetch;
  try {
    const out = await FIRE_FIRMS_SOURCE.fetch();
    expect(urls.length).toBe(FIRMS_FILES.length);
    expect(urls.every((u) => u.startsWith("https://firms.modaps.eosdis.nasa.gov/data/active_fire/"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/area/"))).toBe(false);
    expect(readOutcome(out)?.ok).toBe(true);
  } finally {
    globalThis.fetch = realFetch;
    if (prev != null) process.env.FIRMS_MAP_KEY = prev;
  }
});

test("one file failing keeps the others and says which failed", () => {
  const good: FirmsFileResult = { key: "VIIRS S-NPP", ok: true, dets: parseFirmsCsv(viirs24h), at: AT };
  const bad: FirmsFileResult = { key: "VIIRS NOAA-20", ok: false, dets: [], at: null, reason: "http 503" };
  const out = mergeFirmsResults([good, bad], AT);
  expect(out).toHaveLength(4);
  const o = readOutcome(out)!;
  expect(o.ok).toBe(false);
  expect(o.reason).toBe("partial: VIIRS NOAA-20 failed (http 503)");

  const none = mergeFirmsResults([{ ...bad, key: "VIIRS S-NPP", reason: "http 400" }], AT);
  expect(none).toHaveLength(0);
  expect(readOutcome(none)).toMatchObject({ ok: false, reason: "http 400" });
});
