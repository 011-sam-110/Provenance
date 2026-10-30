import { describe, expect, it } from "vitest";
import {
  CLOCK_AIRPORTS,
  DEFAULT_CLOCK_CODES,
  MAX_CLOCKS,
  addName,
  chooseClockFit,
  clockAirport,
  clockLabel,
  clockLocalTime,
  coerceClockCodes,
  goToName,
  offsetLabel,
  orderWestToEast,
  removeName,
  sameClockSet,
  searchClocks,
  utcOffsetMinutes,
  type ClockAirport,
  type ClockFitInput,
} from "@/lib/console/clockZones";

const JAN = new Date("2026-01-15T12:00:00Z");
const JUL = new Date("2026-07-15T12:00:00Z");

const air = (code: string): ClockAirport => {
  const a = clockAirport(code);
  if (!a) throw new Error(`no airport ${code}`);
  return a;
};
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

describe("the airport list", () => {
  it("has 113 rows with unique three-letter codes", () => {
    expect(CLOCK_AIRPORTS).toHaveLength(113);
    const codes = CLOCK_AIRPORTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(113);
    for (const c of codes) expect(c).toMatch(/^[A-Z]{3}$/);
  });

  it("uses only time zones this runtime knows, and sane coordinates", () => {
    for (const a of CLOCK_AIRPORTS) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: a.zone }), a.code).not.toThrow();
      expect(a.lat).toBeGreaterThanOrEqual(-90);
      expect(a.lat).toBeLessThanOrEqual(90);
      expect(a.lon).toBeGreaterThanOrEqual(-180);
      expect(a.lon).toBeLessThanOrEqual(180);
    }
  });

  it("holds every default code", () => {
    for (const c of DEFAULT_CLOCK_CODES) expect(clockAirport(c), c).toBeDefined();
    expect([...DEFAULT_CLOCK_CODES]).toEqual(["LAX", "JFK", "LHR", "DXB", "SIN", "HND", "SYD"]);
  });

  it("has no em or en dash in any string (they reach the screen)", () => {
    for (const a of CLOCK_AIRPORTS) {
      const all = [a.code, a.airport, a.city, a.country, a.short ?? "", a.zone, ...(a.aka ?? [])].join("|");
      expect(all, a.code).not.toMatch(/[—–]/);
    }
  });

  it("agrees with its longitude: a swapped sign or lat/lon would fail here", () => {
    for (const a of CLOCK_AIRPORTS) {
      const hours = utcOffsetMinutes(a.zone, JAN) / 60;
      expect(Math.abs(wrap180(hours * 15 - a.lon)), a.code).toBeLessThanOrEqual(50);
    }
  });

  it("covers these distinct offsets on 15 January 2026 (a removed row drops one)", () => {
    const offsets = [...new Set(CLOCK_AIRPORTS.map((a) => utcOffsetMinutes(a.zone, JAN)))].sort((a, b) => a - b);
    expect(offsets).toEqual([
      -660, -600, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270, 300,
      330, 345, 360, 390, 420, 480, 540, 570, 600, 630, 660, 720, 780, 825, 840,
    ]);
  });
});

describe("utcOffsetMinutes", () => {
  it("reads whole, half and quarter hours, and follows daylight saving", () => {
    expect(utcOffsetMinutes("Asia/Kathmandu", JAN)).toBe(345);
    expect(utcOffsetMinutes("Europe/London", JAN)).toBe(0);
    expect(utcOffsetMinutes("Europe/London", JUL)).toBe(60);
    expect(utcOffsetMinutes("America/St_Johns", JAN)).toBe(-210);
    expect(utcOffsetMinutes("Asia/Tokyo", JAN)).toBe(540);
  });

  it("throws on a zone it does not know", () => {
    expect(() => utcOffsetMinutes("Mars/Olympus_Mons", JAN)).toThrow();
  });
});

describe("offsetLabel", () => {
  it("writes the offset the way the picker shows it", () => {
    expect(offsetLabel(540)).toBe("UTC+9");
    expect(offsetLabel(-180)).toBe("UTC−3");
    expect(offsetLabel(345)).toBe("UTC+5:45");
    expect(offsetLabel(0)).toBe("UTC+0");
    expect(offsetLabel(-210)).toBe("UTC−3:30");
  });
});

describe("clockLocalTime", () => {
  it("is a 24 hour HH:MM and an hour of day", () => {
    expect(clockLocalTime("Europe/London", JAN)).toEqual({ time: "12:00", hour: 12 });
    expect(clockLocalTime("Asia/Tokyo", JAN)).toEqual({ time: "21:00", hour: 21 });
    expect(clockLocalTime("Asia/Kathmandu", JAN).time).toBe("17:45");
  });
});

describe("orderWestToEast", () => {
  it("puts the defaults LAX to SYD in January", () => {
    const order = orderWestToEast(DEFAULT_CLOCK_CODES.map(air), JAN).map((a) => a.code);
    expect(order).toEqual(["LAX", "JFK", "LHR", "DXB", "SIN", "HND", "SYD"]);
  });

  it("does not care what order it is given", () => {
    const shuffled = ["SYD", "LHR", "LAX", "HND", "JFK", "SIN", "DXB"].map(air);
    expect(orderWestToEast(shuffled, JUL).map((a) => a.code)).toEqual(["LAX", "JFK", "LHR", "DXB", "SIN", "HND", "SYD"]);
  });

  it("breaks an offset tie by longitude: SFO is further west than LAX", () => {
    const order = orderWestToEast([air("LAX"), air("SFO")], JAN).map((a) => a.code);
    expect(order).toEqual(["SFO", "LAX"]);
  });

  it("follows daylight saving: London and Accra swap places between January and July", () => {
    // January both are +0 and longitude decides (London is a little further west). In July
    // London is +1 and Accra is still +0, so Accra moves in front.
    expect(orderWestToEast([air("ACC"), air("LHR")], JAN).map((a) => a.code)).toEqual(["LHR", "ACC"]);
    expect(orderWestToEast([air("ACC"), air("LHR")], JUL).map((a) => a.code)).toEqual(["ACC", "LHR"]);
  });

  it("drops an airport whose zone this runtime cannot resolve", () => {
    const broken: ClockAirport = { ...air("LHR"), code: "ZZZ", zone: "Mars/Olympus_Mons" };
    expect(orderWestToEast([air("LAX"), broken], JAN).map((a) => a.code)).toEqual(["LAX"]);
  });

  it("does not mutate its input", () => {
    const input = [air("SYD"), air("LAX")];
    orderWestToEast(input, JAN);
    expect(input.map((a) => a.code)).toEqual(["SYD", "LAX"]);
  });
});

describe("labels and names", () => {
  it("gives London in all three tiers", () => {
    const lhr = air("LHR");
    expect(clockLabel(lhr, "full")).toBe("LHR · United Kingdom");
    expect(clockLabel(lhr, "short")).toBe("LHR · UK");
    expect(clockLabel(lhr, "code")).toBe("LHR");
  });

  it("falls back to the full country where the list has no short form", () => {
    expect(clockLabel(air("SIN"), "short")).toBe("SIN · Singapore");
    expect(clockLabel(air("HND"), "short")).toBe("HND · Japan");
  });

  it("names the actions", () => {
    expect(goToName(air("LHR"))).toBe("Go to LHR, London Heathrow");
    expect(removeName(air("LHR"))).toBe("Remove LHR, London Heathrow");
    expect(addName(air("GRU"))).toBe("Add GRU, São Paulo Guarulhos");
  });
});

describe("searchClocks", () => {
  const codes = (q: string, chosen: string[] = []) => searchClocks(q, chosen, JAN).map((a) => a.code);

  it("puts an exact code first", () => {
    expect(codes("lhr")[0]).toBe("LHR");
    expect(codes("LHR")[0]).toBe("LHR");
  });

  it("finds London by country, short form and alias", () => {
    expect(codes("united kingdom")).toEqual(["LHR"]);
    expect(codes("uk")[0]).toBe("LHR");
    expect(codes("britain")[0]).toBe("LHR");
  });

  it("lists a country prefix west to east: bra is exactly Brazil and Bratislava", () => {
    expect(codes("bra")).toEqual(["RBR", "MAO", "GRU", "FEN", "BTS"]);
  });

  it("ignores accents on both sides", () => {
    expect(codes("sao")[0]).toBe("GRU");
    expect(codes("são")[0]).toBe("GRU");
    expect(codes("cancun")[0]).toBe("CUN");
    expect(codes("zurich")[0]).toBe("ZRH");
  });

  it("knows a country by its other name", () => {
    expect(codes("turkey")).toEqual(["IST"]);
    expect(codes("holland")).toEqual(["AMS"]);
  });

  it("matches all 14 American airports on usa, and nothing else", () => {
    const us = CLOCK_AIRPORTS.filter((a) => a.country === "United States").map((a) => a.code);
    expect(us).toHaveLength(14);
    expect([...codes("usa")].sort()).toEqual([...us].sort());
  });

  it("matches inside an airport name, with hyphens and slashes read as spaces", () => {
    expect(codes("fort worth")).toContain("DFW");
    expect(codes("tacoma")).toContain("SEA");
  });

  it("is empty for nothing and for nonsense", () => {
    expect(codes("")).toEqual([]);
    expect(codes("   ")).toEqual([]);
    expect(codes("zzz")).toEqual([]);
  });

  it("keeps the chosen ones and flags them added", () => {
    const hits = searchClocks("lhr", ["LHR"], JAN);
    expect(hits[0].code).toBe("LHR");
    expect(hits[0].added).toBe(true);
    expect(searchClocks("lhr", [], JAN)[0].added).toBe(false);
  });
});

describe("coerceClockCodes", () => {
  it("falls back to the defaults for anything that is not a usable array", () => {
    for (const bad of [null, undefined, "x", {}, 7, []]) {
      expect(coerceClockCodes(bad)).toEqual([...DEFAULT_CLOCK_CODES]);
    }
  });

  it("uppercases, drops unknown codes and keeps the first of a repeat", () => {
    expect(coerceClockCodes(["lhr", "LHR", "ZZZ", 4, null])).toEqual(["LHR"]);
    expect(coerceClockCodes(["jfk", "lax", "jfk"])).toEqual(["JFK", "LAX"]);
  });

  it("falls back when nothing valid is left", () => {
    expect(coerceClockCodes(["ZZZ", "QQQ"])).toEqual([...DEFAULT_CLOCK_CODES]);
  });

  it("keeps the first eight of nine valid codes", () => {
    const nine = CLOCK_AIRPORTS.slice(0, 9).map((a) => a.code);
    expect(coerceClockCodes(nine)).toEqual(nine.slice(0, MAX_CLOCKS));
    expect(MAX_CLOCKS).toBe(8);
  });

  it("hands back a copy, never the frozen default", () => {
    const out = coerceClockCodes(null);
    expect(out).not.toBe(DEFAULT_CLOCK_CODES);
    expect(() => out.push("GRU")).not.toThrow();
  });
});

describe("sameClockSet", () => {
  it("ignores order, not membership", () => {
    expect(sameClockSet(["LAX", "JFK"], ["JFK", "LAX"])).toBe(true);
    expect(sameClockSet(["LAX", "JFK"], ["JFK", "GRU"])).toBe(false);
    expect(sameClockSet(["LAX"], ["LAX", "JFK"])).toBe(false);
  });
});

describe("chooseClockFit", () => {
  // The numbers the planner measured for 7 clocks: codes 588, short 865, full 1129.
  const base: ClockFitInput = {
    avail: 2000,
    widths: { full: 1129, short: 865, code: 588 },
    codeWidths: [70, 70, 70, 70, 70, 70, 70],
    pillChrome: 98,
    gear: 32,
    gearMore: 52,
  };
  const at = (avail: number, over: Partial<ClockFitInput> = {}) => chooseClockFit({ ...base, ...over, avail });

  it("takes the full labels when there is room for the gear on both sides", () => {
    expect(at(1129 + 64)).toEqual({ tier: "full", shown: 7, shift: 0 });
    expect(at(1366 - 16)).toEqual({ tier: "full", shown: 7, shift: 0 });
  });

  it("slides the pill left rather than dropping a tier when only one gear fits", () => {
    // full needs 1193 centred; with 1170 it overshoots by 23, so shift ceil(23 / 2) = 12.
    expect(at(1170)).toEqual({ tier: "full", shown: 7, shift: 12 });
    // short: between short + gear and short + 2 * gear, once full no longer fits at all.
    const avail = 865 + 32 + 10;
    expect(at(avail)).toEqual({ tier: "short", shown: 7, shift: Math.ceil((865 + 64 - avail) / 2) });
  });

  it("uses short when full cannot fit even off centre", () => {
    expect(at(1100)).toEqual({ tier: "short", shown: 7, shift: 0 });
  });

  it("uses codes when short cannot fit", () => {
    expect(at(700)).toEqual({ tier: "code", shown: 7, shift: 0 });
    expect(at(588 + 32 + 4)).toEqual({ tier: "code", shown: 7, shift: Math.ceil((588 + 64 - (588 + 36)) / 2) });
  });

  it("drops clocks from the east end, with the wider gear, when even codes do not fit", () => {
    // 7 codes need 588 + 32 = 620; at 560 we must drop. With n shown the pill is 98 + 70n.
    const fit = at(560);
    expect(fit.tier).toBe("code");
    expect(fit.shown).toBeLessThan(7);
    expect(fit.shown).toBeGreaterThanOrEqual(1);
    const w = 98 + 70 * fit.shown;
    expect(w + 52).toBeLessThanOrEqual(560);
    // and it is the most that fits: one more clock would not.
    expect(98 + 70 * (fit.shown + 1) + 52).toBeGreaterThan(560);
  });

  it("never shows fewer than one clock", () => {
    expect(at(10)).toEqual({ tier: "code", shown: 1, shift: 0 });
    expect(at(0, { codeWidths: [70], widths: { full: 200, short: 150, code: 98 + 70 } }).shown).toBe(1);
  });
});
