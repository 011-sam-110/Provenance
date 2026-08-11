import { describe, it, expect } from "vitest";
import { parseMacro, type MarketSection } from "@/lib/markets";
import { fredObservationsUrl, parseFredValue } from "@/lib/markets/fred";
import { resolveSection, foldSections } from "@/lib/markets/sections";

// --- format correctness per FRED series -------------------------------------
// Each case below mirrors one real series added to FRED_SERIES in route.ts, using
// the actual "units" FRED reports for it (verified live 2026-08-11): percent,
// year-over-year percent (via the pc1 transform), a raw count, and an annualised
// percent. A wrong implementation that, say, appended "%" to every series
// regardless of unit, or dropped the YoY suffix, would fail these.
describe("parseMacro — unit formatting per series", () => {
  it("formats plain percent-rate series (yields, spread, Fed Funds, unemployment)", () => {
    const out = parseMacro([
      { id: "DGS10", label: "10-Yr Treasury", value: 4.23, unit: "%", date: "2026-08-07" },
      { id: "DGS2", label: "2-Yr Treasury", value: 4.19, unit: "%", date: "2026-08-07" },
      { id: "DGS30", label: "30-Yr Treasury", value: 5.19, unit: "%", date: "2026-08-07" },
      { id: "DFF", label: "Fed Funds Rate", value: 4.33, unit: "%", date: "2026-08-10" },
      { id: "UNRATE", label: "US Unemployment", value: 4.1, unit: "%", date: "2026-07-01" },
    ]);
    expect(out.find((r) => r.id === "macro:DGS10")!.value).toBe("4.23%");
    expect(out.find((r) => r.id === "macro:DGS2")!.value).toBe("4.19%");
    expect(out.find((r) => r.id === "macro:DGS30")!.value).toBe("5.19%");
    expect(out.find((r) => r.id === "macro:DFF")!.value).toBe("4.33%");
    expect(out.find((r) => r.id === "macro:UNRATE")!.value).toBe("4.1%");
  });

  it("keeps the sign on the 10Y-2Y spread — a negative value means an inverted curve, not an error", () => {
    const out = parseMacro([{ id: "T10Y2Y", label: "10Y-2Y Spread", value: -0.34, unit: "%", date: "2026-08-07" }]);
    expect(out[0].value).toBe("-0.34%");
    expect(out[0].num).toBe(-0.34);
  });

  it("labels CPI/core CPI/PPI as year-over-year percent, never a bare index level", () => {
    // These come from FRED's own pc1 (Percent Change from Year Ago) transform, so
    // the raw value is already a % — a wrong implementation might instead pass
    // through the untransformed index (e.g. ~323) and this would catch it.
    const out = parseMacro([
      { id: "CPIAUCSL", label: "CPI (headline)", value: 3.46353, unit: "% YoY", date: "2026-06-01" },
      { id: "CPILFESL", label: "Core CPI", value: 2.56579, unit: "% YoY", date: "2026-06-01" },
      { id: "PPIACO", label: "PPI (all commodities)", value: 10.11014, unit: "% YoY", date: "2026-06-01" },
    ]);
    const cpi = out.find((r) => r.id === "macro:CPIAUCSL")!;
    const core = out.find((r) => r.id === "macro:CPILFESL")!;
    const ppi = out.find((r) => r.id === "macro:PPIACO")!;
    expect(cpi.value).toBe("3.46% YoY");
    expect(core.value).toBe("2.57% YoY"); // 2.56579 rounds to 2.57
    expect(ppi.value).toBe("10.11% YoY");
    // Every one of these is legitimately weeks old (monthly release) — disclosed,
    // never hidden or advanced to look current.
    expect(cpi.sub).toBe("as of 2026-06-01");
  });

  it("formats initial jobless claims as a raw weekly count, not a percent or thousands", () => {
    const out = parseMacro([{ id: "ICSA", label: "Initial Jobless Claims", value: 199000, unit: " claims/wk", date: "2026-08-01" }]);
    expect(out[0].value).toBe("199,000 claims/wk");
  });

  it("formats real GDP growth as an annualised percent, distinct from a $ level", () => {
    const out = parseMacro([{ id: "A191RL1Q225SBEA", label: "Real GDP Growth", value: 1.5, unit: "% ann.", date: "2026-04-01" }]);
    expect(out[0].value).toBe("1.5% ann.");
  });

  it("formats VIX with no unit suffix (an index level, not a rate)", () => {
    const out = parseMacro([{ id: "VIXCLS", label: "VIX (volatility)", value: 13.8, unit: "", date: "2026-08-10" }]);
    expect(out[0].value).toBe("13.8");
  });
});

// --- the "." missing-observation sentinel -----------------------------------
describe("parseFredValue — FRED's '.' missing-observation sentinel", () => {
  it("treats '.' as no data, not zero", () => {
    expect(parseFredValue(".")).toBeNull();
  });
  it("parses a real numeric string, including negative (10Y-2Y can invert)", () => {
    expect(parseFredValue("4.23")).toBe(4.23);
    expect(parseFredValue("-0.34")).toBe(-0.34);
    expect(parseFredValue("199000")).toBe(199000);
  });
  it("is null-safe for absent/blank/garbage input", () => {
    expect(parseFredValue(undefined)).toBeNull();
    expect(parseFredValue(null)).toBeNull();
    expect(parseFredValue("")).toBeNull();
    expect(parseFredValue("not-a-number")).toBeNull();
  });
  it("round-trips through parseMacro's own drop rule for a missing observation", () => {
    // Mirrors what macroSection() does: parseFredValue(".") → null → parseMacro
    // drops the row entirely rather than showing a fabricated 0.
    const out = parseMacro([{ id: "CPIAUCSL", label: "CPI", value: parseFredValue("."), unit: "% YoY", date: "2026-07-01" }]);
    expect(out).toHaveLength(0);
  });
});

// --- FRED URL construction ---------------------------------------------------
describe("fredObservationsUrl", () => {
  it("builds the latest-observation URL with the series id and key", () => {
    const url = fredObservationsUrl({ id: "DGS10", label: "10-Yr Treasury", unit: "%" }, "test-key");
    expect(url).toContain("series_id=DGS10");
    expect(url).toContain("api_key=test-key");
    expect(url).toContain("sort_order=desc");
    expect(url).toContain("limit=1");
    expect(url).not.toContain("units="); // no transform requested
  });

  it("adds the pc1 transform for a YoY series", () => {
    const url = fredObservationsUrl({ id: "CPIAUCSL", label: "CPI", unit: "% YoY", transform: "pc1" }, "test-key");
    expect(url).toContain("units=pc1");
  });
});

// --- per-section isolation ----------------------------------------------------
// A realistic wrong implementation here is the ORIGINAL bug: Promise.all + one
// try/catch, where a single rejection empties every section. These tests operate
// directly on the fold, which is what GET() now runs Promise.allSettled through.
describe("resolveSection / foldSections — one dead upstream can't blank the panel", () => {
  const cryptoOk: MarketSection = { key: "crypto", label: "Crypto", source: "CoinGecko · keyless", rows: [{ id: "c:BTC", name: "Bitcoin", value: "$60,000.00" }] };
  const fxOk: MarketSection = { key: "fx", label: "Currencies", source: "Frankfurter / ECB · keyless", rows: [{ id: "fx:EUR", name: "Euro", value: "0.88" }] };

  it("a fulfilled section passes through untouched, including a legitimate dormant/no-key section", () => {
    const dormant: MarketSection = { key: "equities", label: "Equities", source: "Finnhub", rows: [], dormant: true, note: "Add FINNHUB_API_KEY to enable." };
    const out = resolveSection({ status: "fulfilled", value: dormant }, { key: "equities", label: "Equities" }, undefined);
    expect(out).toBe(dormant); // untouched, not reinterpreted as a failure
  });

  it("a rejected section with a last-good snapshot serves it, but discloses it is stale, not fresh", () => {
    const out = resolveSection({ status: "rejected", reason: new Error("CoinGecko 500") }, { key: "crypto", label: "Crypto" }, cryptoOk);
    expect(out.rows).toEqual(cryptoOk.rows); // real data preserved
    expect(out.note).toMatch(/last successful snapshot/i);
    expect(out.note).not.toMatch(/add.*key/i); // never confused with the key-gating message

    // The note alone is NOT enough, and this assertion is the whole point of the
    // test. The first cut set `note` and nothing else; every renderer
    // (MarketsPanel, the markets widget, the markets detail view) gates its note
    // on a boolean flag, so the disclosure was computed, shipped in the JSON,
    // asserted by this very test — and then dropped by all three screens, leaving
    // carried-over prices looking live. `stale` is the flag they now read.
    expect(out.stale).toBe(true);
    // and it must NOT be `dormant`, which hides the rows entirely.
    expect(out.dormant).toBeFalsy();
  });

  it("a note is never orphaned: any section carrying a note is flagged for a renderer to show it", () => {
    // Guards the class of bug above rather than the one instance of it. Every
    // renderer shows `note` only when `dormant` or `stale` is set, so a section
    // with a note and neither flag is invisible prose.
    const cases: MarketSection[] = [
      resolveSection({ status: "rejected", reason: new Error("x") }, { key: "crypto", label: "Crypto" }, cryptoOk),
      resolveSection({ status: "rejected", reason: new Error("x") }, { key: "fx", label: "Currencies" }, undefined),
    ];
    for (const s of cases) {
      if (s.note) expect(Boolean(s.dormant || s.stale)).toBe(true);
    }
  });

  it("a rejected section with no last-good renders honestly empty, not fabricated or silently dropped", () => {
    const out = resolveSection({ status: "rejected", reason: new Error("timeout") }, { key: "fx", label: "Currencies" }, undefined);
    expect(out.rows).toEqual([]);
    expect(out.dormant).toBe(true); // flags "show the note", reusing the panel's existing slot
    expect(out.note).toMatch(/failed to refresh/i);
    expect(out.note).not.toMatch(/add.*key/i);
  });

  it("foldSections: one rejected section degrades ALONE — the other four stay exactly as their builders produced them", () => {
    const specs = [
      { key: "crypto", label: "Crypto" },
      { key: "fx", label: "Currencies" },
    ] as const;
    const results: PromiseSettledResult<MarketSection>[] = [
      { status: "rejected", reason: new Error("CoinGecko hiccup") }, // crypto dies
      { status: "fulfilled", value: fxOk }, // fx is fine
    ];
    const out = foldSections(specs, results, { crypto: cryptoOk }); // crypto has a last-good to fall back on
    expect(out).toHaveLength(2);
    expect(out[0].rows).toEqual(cryptoOk.rows); // degraded section still shows its last-good data
    expect(out[0].note).toMatch(/last successful snapshot/i);
    expect(out[1]).toBe(fxOk); // untouched — this is the "other four render live" guarantee
    expect(out[1].note).toBeUndefined();
  });

  it("foldSections: with nothing to fall back to, a failing section is empty but every other section is completely unaffected", () => {
    const specs = [
      { key: "crypto", label: "Crypto" },
      { key: "fx", label: "Currencies" },
    ] as const;
    const results: PromiseSettledResult<MarketSection>[] = [
      { status: "rejected", reason: new Error("CoinGecko down, no prior snapshot yet") },
      { status: "fulfilled", value: fxOk },
    ];
    const out = foldSections(specs, results, {}); // no last-good for crypto at all
    expect(out[0].rows).toEqual([]);
    expect(out[0].key).toBe("crypto");
    expect(out[1]).toBe(fxOk);
  });
});
