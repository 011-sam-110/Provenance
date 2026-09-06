/**
 * Unit tests for the adsb.lol aircraft provider (lib/sources/adsb.ts) — the sole
 * source behind /api/planes: a worldwide pull by ICAO type designator, capped as a
 * spatial sample and carrying an honest coverage record.
 *
 * FIXTURE PROVENANCE: every row in ADSB_FIXTURE was captured live from
 * `https://api.adsb.lol/v2/lat/51.5/lon/-0.1/dist/250` on 2026-08-13 (481 rows in
 * that response, all positioned) and pasted verbatim apart from dropping receiver
 * telemetry fields the adapter never reads (rssi, messages, nic/rc/sil, mlat…).
 * The `/v2/type/` endpoint returns the same row shape (probed 2026-09-06; it only
 * leaves `desc` empty). Nothing here is invented: the awkward cases are awkward
 * because the network really returns them that way — notably the on-ground row,
 * which carries `true_heading` but NO `track`.
 */

import { describe, expect, it } from "vitest";
import {
  adsbRowToWorldObject,
  dedupeById,
  normalizeAdsbRows,
  pullToObjects,
  TYPE_BATCHES,
  typeBatchUrl,
  type AdsbRow,
  type PullResult,
} from "@/lib/sources/adsb";
import { BIZJET_TYPES } from "@/lib/planes/bizjet";
import { readCoverage, coverageCountLabel, coverageNote } from "@/lib/signals/coverage";

// --- live-captured fixture --------------------------------------------------

const ADSB_FIXTURE: AdsbRow[] = [
  // Embraer 175 climbing — has every optional field populated.
  {
    hex: "48548c",
    flight: "KLM93C  ",
    r: "PH-EXK",
    t: "E75L",
    alt_baro: 25425,
    alt_geom: 26850,
    gs: 478.9,
    track: 82.68,
    baro_rate: 1344,
    squawk: "7623",
    category: "A3",
    lat: 51.930744,
    lon: -6.520857,
  },
  // Light aircraft, low and slow.
  {
    hex: "407d0c",
    flight: "GCMEL   ",
    r: "G-CMEL",
    t: "NNJA",
    alt_baro: 1525,
    alt_geom: 1950,
    gs: 87.5,
    track: 120.96,
    squawk: "7000",
    category: "A1",
    lat: 51.58786,
    lon: -3.831556,
  },
  // Air-ambulance helicopter. The whole point of preferring the broadcast
  // category: altitude 1,450 ft + 119 kt would NOT trip the heuristic's
  // helicopter branch (speed is over its 70 m/s threshold).
  {
    hex: "40793d",
    flight: "HLE70   ",
    r: "G-DAAS",
    t: "EC45",
    alt_baro: 1450,
    alt_geom: 1875,
    gs: 119.5,
    track: 80.85,
    baro_rate: 64,
    squawk: "0020",
    category: "A7",
    lat: 50.775787,
    lon: -3.075801,
  },
  // A350 at cruise.
  {
    hex: "39d2b2",
    flight: "AFR064  ",
    r: "F-HUVS",
    t: "A359",
    alt_baro: 38000,
    alt_geom: 39800,
    gs: 473.3,
    track: 299.49,
    baro_rate: 0,
    squawk: "0653",
    category: "A5",
    lat: 50.108917,
    lon: -5.416766,
  },
  // ATR-72 taxiing: alt_baro is the STRING "ground", and there is no `track` key
  // at all — only `true_heading`, which this adapter deliberately does not read.
  {
    hex: "4caead",
    flight: "EAI31Q  ",
    r: "EI-HNA",
    t: "AT76",
    alt_baro: "ground",
    gs: 36.5,
    squawk: "7635",
    category: "A2",
    lat: 50.735367,
    lon: -3.406987,
  },
];

const byHex = (hex: string) => {
  const row = ADSB_FIXTURE.find((r) => r.hex === hex);
  if (!row) throw new Error(`fixture missing ${hex}`);
  const obj = adsbRowToWorldObject(row);
  if (!obj) throw new Error(`fixture row ${hex} did not map`);
  return obj;
};

// --- unit conversions -------------------------------------------------------

describe("adsbRowToWorldObject — units", () => {
  it("converts geometric altitude from feet to kilometres", () => {
    // 26,850 ft * 0.0003048 = 8.18388 km
    expect(byHex("48548c").altKm).toBeCloseTo(8.18388, 4);
  });

  it("prefers geometric altitude over barometric when both are present", () => {
    // alt_geom 1950 ft, not alt_baro 1525 ft.
    expect(byHex("407d0c").altKm).toBeCloseTo(1950 * 0.0003048, 5);
  });

  it("converts ground speed from knots to metres per second", () => {
    // 478.9 kt * 0.514444 = 246.367 m/s
    const meta = byHex("48548c").meta as { velocityMs: number };
    expect(meta.velocityMs).toBeCloseTo(246.367, 2);
  });

  it("converts vertical rate from feet/minute to metres per second", () => {
    // 1,344 ft/min * 0.00508 = 6.82752 m/s
    const meta = byHex("48548c").meta as { verticalRateMs: number };
    expect(meta.verticalRateMs).toBeCloseTo(6.82752, 4);
  });

  it("carries heading straight through from track", () => {
    expect(byHex("48548c").heading).toBeCloseTo(82.68, 2);
  });
});

// --- the "ground" string ----------------------------------------------------

describe("adsbRowToWorldObject — on-ground rows", () => {
  it('treats the literal alt_baro "ground" as on-ground at zero altitude', () => {
    const obj = byHex("4caead");
    const meta = obj.meta as { onGround: boolean };
    expect(meta.onGround).toBe(true);
    expect(obj.altKm).toBe(0);
  });

  it("defaults heading to 0 when the row has no track field", () => {
    // This row really does omit `track` and carry only `true_heading`.
    expect(byHex("4caead").heading).toBe(0);
  });

  it("classifies an on-ground aircraft as ground even though its category is A2", () => {
    const meta = byHex("4caead").meta as { category: string };
    expect(meta.category).toBe("ground");
  });
});

// --- classification off the broadcast category ------------------------------

describe("adsbRowToWorldObject — classification", () => {
  it("uses the broadcast ADS-B category rather than the altitude/speed guess", () => {
    // 1,450 ft at 119.5 kt (61.5 m/s). The heuristic's helicopter branch needs
    // altKm < 1.5 AND velocity < 70 m/s — 61.5 m/s passes, so this one would also
    // land on helicopter by luck. The assertion that matters is the A7 mapping
    // itself, which is a transmitted fact rather than an inference.
    const meta = byHex("40793d").meta as { category: string };
    expect(meta.category).toBe("helicopter");
  });

  it("maps A3 and A5 to airliner", () => {
    expect((byHex("48548c").meta as { category: string }).category).toBe("airliner");
    expect((byHex("39d2b2").meta as { category: string }).category).toBe("airliner");
  });

  it("maps A1 to light", () => {
    expect((byHex("407d0c").meta as { category: string }).category).toBe("light");
  });
});

// --- honesty: no invented fields -------------------------------------------

describe("adsbRowToWorldObject — honesty", () => {
  it("leaves country empty rather than inferring it from the hex block or registration", () => {
    // PH-EXK is plainly Dutch and 48548c is a Dutch ICAO block, but adsb.lol does
    // not broadcast origin country. Inferring it would be a derivation wearing an
    // observation's clothes, which is the exact failure this codebase avoids.
    const meta = byHex("48548c").meta as { country: string };
    expect(meta.country).toBe("");
  });

  it("carries the type code and registration this feed does supply", () => {
    const meta = byHex("48548c").meta as { typeCode?: string; registration?: string };
    expect(meta.typeCode).toBe("E75L");
    expect(meta.registration).toBe("PH-EXK");
  });

  it("omits typeCode and registration entirely when the row has none", () => {
    const obj = adsbRowToWorldObject({ hex: "abc123", lat: 1, lon: 2 });
    expect(obj).not.toBeNull();
    expect(obj!.meta as Record<string, unknown>).not.toHaveProperty("typeCode");
    expect(obj!.meta as Record<string, unknown>).not.toHaveProperty("registration");
  });

  it("trims the trailing padding adsb.lol puts on callsigns", () => {
    expect(byHex("48548c").label).toBe("KLM93C");
  });
});

// --- rejection of unusable rows --------------------------------------------

describe("normalizeAdsbRows — rejection", () => {
  it("drops rows with no position", () => {
    expect(adsbRowToWorldObject({ hex: "aaa111" })).toBeNull();
    expect(adsbRowToWorldObject({ hex: "aaa111", lat: 51.5 })).toBeNull();
  });

  it("drops rows with no hex, since the id would collide", () => {
    expect(adsbRowToWorldObject({ lat: 51.5, lon: -0.1 })).toBeNull();
    expect(adsbRowToWorldObject({ hex: "   ", lat: 51.5, lon: -0.1 })).toBeNull();
  });

  it("drops out-of-range coordinates", () => {
    expect(adsbRowToWorldObject({ hex: "a", lat: 91, lon: 0 })).toBeNull();
    expect(adsbRowToWorldObject({ hex: "a", lat: 0, lon: 181 })).toBeNull();
  });

  it("keeps every usable row in the live fixture", () => {
    expect(normalizeAdsbRows(ADSB_FIXTURE)).toHaveLength(ADSB_FIXTURE.length);
  });

  it("survives a response with no ac array at all", () => {
    expect(normalizeAdsbRows([])).toEqual([]);
  });
});

// --- dedupe across overlapping cells ---------------------------------------

describe("dedupeById", () => {
  it("collapses the same aircraft reported by two overlapping cells", () => {
    const objs = normalizeAdsbRows([...ADSB_FIXTURE, ...ADSB_FIXTURE]);
    expect(objs).toHaveLength(ADSB_FIXTURE.length * 2);
    expect(dedupeById(objs)).toHaveLength(ADSB_FIXTURE.length);
  });

  it("keeps the first occurrence", () => {
    const a = normalizeAdsbRows([ADSB_FIXTURE[0]])[0];
    const b = { ...a, label: "SECOND" };
    expect(dedupeById([a, b])[0].label).toBe(a.label);
  });
});

// --- the coverage record ----------------------------------------------------

/** n seeded aircraft, positioned by `at(i)` (default: all over London). */
const seeded = (n: number, at: (i: number) => [number, number] = () => [51.5, -0.1]) =>
  Array.from({ length: n }, (_, i) => {
    const [lat, lon] = at(i);
    return { ...normalizeAdsbRows([ADSB_FIXTURE[0]])[0], id: `plane:seed${i}`, lat, lon };
  });

const pull = (
  n: number,
  succeeded = TYPE_BATCHES.length,
  attempted = TYPE_BATCHES.length,
  extra: Partial<PullResult> = {},
): PullResult => ({
  objects: seeded(n),
  batchesPlanned: TYPE_BATCHES.length,
  batchesAttempted: attempted,
  batchesSucceeded: succeeded,
  mainlineSucceeded: succeeded > 0,
  typesPlanned: TYPE_BATCHES.reduce((t, b) => t + b.length, 0),
  ...extra,
});

describe("pullToObjects — coverage honesty", () => {
  it("never claims an exact total, because a receiver network is a lower bound", () => {
    const cov = readCoverage(pullToObjects(pull(120), 3000));
    expect(cov?.availableExact).toBe(false);
  });

  it("declares capped even under the render cap, so the count never prints bare", () => {
    // coverageCountLabel and coverageNote both return early on !capped, so a
    // false here would publish "120" with no caveat — read as "that is all of them".
    const objs = pullToObjects(pull(120), 3000);
    const cov = readCoverage(objs);
    expect(cov?.capped).toBe(true);
    expect(coverageCountLabel(cov)).toBe("120 of 120+");
    expect(coverageNote(cov)).toBeTruthy();
  });

  it("applies the render cap and reports what it hid", () => {
    const objs = pullToObjects(pull(4200), 3000);
    expect(objs).toHaveLength(3000);
    const cov = readCoverage(objs);
    expect(cov?.returned).toBe(3000);
    expect(cov?.available).toBe(4200);
    expect(cov?.cap).toBe(3000);
  });

  it("caps as a spatial sample, never a prefix: a region at the end of the list survives", () => {
    // 3,000 aircraft over London followed by 1,200 over Sydney. The old prefix cap
    // kept London whole and dropped Sydney entirely — the two-clumps bug on the globe.
    const result = { ...pull(0), objects: seeded(4200, (i) => (i < 3000 ? [51.5, -0.1] : [-33.9, 151.2])) };
    const objs = pullToObjects(result, 3000);
    expect(objs).toHaveLength(3000);
    const sydney = objs.filter((o) => o.lat < 0).length;
    // Proportional share is 1,200 × 3,000 / 4,200 ≈ 857.
    expect(sydney).toBeGreaterThanOrEqual(850);
    expect(sydney).toBeLessThanOrEqual(865);
  });

  it("does not stamp an upstreamLimit unless a response was saturated", () => {
    expect(readCoverage(pullToObjects(pull(120), 3000))?.upstreamLimit).toBeUndefined();
    expect(readCoverage(pullToObjects(pull(120, 4, 4, { upstreamLimit: 3 }), 3000))?.upstreamLimit).toBe(3);
  });

  it("says in words that this is a sample of listed types, not a global count", () => {
    const rule = readCoverage(pullToObjects(pull(4200), 3000))?.rule ?? "";
    expect(rule).toContain("lower bound, not a global count");
    expect(rule).toMatch(/spatial sample/i);
    expect(rule).toMatch(/type designators/i);
    expect(rule).toMatch(/without a type code/i);
  });

  it("discloses batches that were asked and refused", () => {
    const full = readCoverage(pullToObjects(pull(120), 3000))?.rule ?? "";
    const refused = readCoverage(pullToObjects(pull(120, 3), 3000))?.rule ?? "";
    expect(full).not.toContain("did not answer");
    expect(refused).toContain("1 did not answer");
    expect(refused).toContain(`3 of ${TYPE_BATCHES.length}`);
  });

  it("counts against the PLANNED batches, so a truncated pull cannot read as complete", () => {
    const rule = readCoverage(pullToObjects(pull(400, 2, 2), 3000))?.rule ?? "";
    expect(rule).toContain(`2 of ${TYPE_BATCHES.length}`);
    expect(rule).toContain("2 not reached within the time budget");
  });

  it("separates batches never asked from batches that refused", () => {
    const rule = readCoverage(pullToObjects(pull(400, 2, 3), 3000))?.rule ?? "";
    expect(rule).toContain("1 not reached within the time budget");
    expect(rule).toContain("1 did not answer");
  });
});

// --- the type lists ---------------------------------------------------------

describe("TYPE_BATCHES", () => {
  const all = TYPE_BATCHES.flat();

  it("holds only ICAO type designators: two to four upper-case alphanumerics", () => {
    for (const t of all) expect(t, t).toMatch(/^[A-Z0-9]{2,4}$/);
  });

  it("lists every type once across all batches, so dedupe is a guard and not a dependency", () => {
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps each batch small enough for one URL: at most 75 types, under 400 characters", () => {
    for (const b of TYPE_BATCHES) {
      expect(b.length).toBeLessThanOrEqual(75);
      expect(typeBatchUrl(b).length).toBeLessThanOrEqual(400);
    }
  });

  it("puts the mainline fleet first, so a truncated pull still holds the global backbone", () => {
    expect(TYPE_BATCHES).toHaveLength(4);
    expect(TYPE_BATCHES[0]).toContain("B738");
    expect(TYPE_BATCHES[0]).toContain("A320");
    expect(TYPE_BATCHES[0]).toContain("A21N");
  });

  it("asks for every valid business-jet type the bizjet detector knows, or that detector is blind", () => {
    const union = new Set(all);
    const valid = [...BIZJET_TYPES].filter((t) => /^[A-Z0-9]{2,4}$/.test(t));
    expect(valid.length).toBeGreaterThan(50);
    for (const t of valid) expect(union.has(t), t).toBe(true);
  });

  it("builds the documented comma-separated type URL", () => {
    expect(typeBatchUrl(["A320", "B738"])).toBe("https://api.adsb.lol/v2/type/A320,B738");
  });
});
