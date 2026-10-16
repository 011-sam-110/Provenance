import { expect, test } from "vitest";
import { normalizePorts, portRegion, portStatProps, PORTS_SOURCE } from "@/lib/signals/ports";
import { MAJOR_PORTS } from "@/lib/signals/ports.data";
import { EUROSTAT_THS_T, PLSCI, PLSCI_QUARTER, USACE_TONNAGE } from "@/lib/signals/ports.stats.data";
import { rowMetric } from "@/lib/console/signals/signalCard";

test("normalizes the curated major-ports list to namespaced point features", () => {
  const out = normalizePorts(MAJOR_PORTS);
  expect(out.length).toBe(MAJOR_PORTS.length);
  expect(out.length).toBeGreaterThan(60);
  expect(out.every((f) => f.signalId === "ports")).toBe(true);
  expect(out.every((f) => f.geometry === undefined)).toBe(true); // points only

  const shanghai = out.find((f) => f.title === "Shanghai");
  expect(shanghai?.id).toBe("port:shanghai");
  expect(shanghai?.props?.country).toBe("CN");
  expect(shanghai?.lat).toBeCloseTo(31.23, 2);
  expect(shanghai?.props?.region).toBe("East Asia");
});

test("claims no rank (the file order is not a throughput order) and every port has a known region", () => {
  const out = normalizePorts(MAJOR_PORTS);
  // The file is regional after ~#30, so a rank from the array index would be false.
  expect(out.every((f) => f.props?.rank === undefined)).toBe(true);
  // No port falls through the region map into "Other".
  expect(out.every((f) => f.props?.region && f.props.region !== "Other")).toBe(true);
});

test("portRegion buckets known maritime nations and falls back honestly", () => {
  expect(portRegion("NL")).toBe("Europe");
  expect(portRegion("us")).toBe("North America"); // case-insensitive
  expect(portRegion("PA")).toBe("Latin America");
  expect(portRegion("ZZ")).toBe("Other");
  expect(portRegion(undefined)).toBe("Other");
});

test("drops records with out-of-range coordinates", () => {
  const out = normalizePorts([
    { name: "Good", country: "XX", lat: 10, lon: 20 },
    { name: "Bad", country: "XX", lat: 200, lon: 20 },
  ]);
  expect(out).toHaveLength(1);
  expect(out[0].title).toBe("Good");
});

test("port ids are unique", () => {
  const out = normalizePorts(MAJOR_PORTS);
  expect(new Set(out.map((f) => f.id)).size).toBe(out.length);
});

// --- official figures (ports.stats.data.ts, harvested by scripts/harvest-port-stats.mjs) ---

test("every port has a unique UN/LOCODE and a connectivity figure", () => {
  const codes = MAJOR_PORTS.map((p) => p.locode);
  expect(codes.every((c) => typeof c === "string" && /^[A-Z]{5}$/.test(c))).toBe(true);
  expect(new Set(codes).size).toBe(codes.length);
  // The LOCODE's country prefix is the port's country (HK and TW are their own codes).
  expect(MAJOR_PORTS.every((p) => p.locode!.slice(0, 2) === p.country)).toBe(true);
  expect(MAJOR_PORTS.every((p) => PLSCI[p.locode!] != null)).toBe(true);
});

test("ports rank by UNCTAD connectivity, a published number, through the declared metric", () => {
  const out = normalizePorts(MAJOR_PORTS);
  const shanghai = out.find((f) => f.title === "Shanghai")!;
  expect(PORTS_SOURCE.metric).toEqual({ field: "connectivity", domain: [0, 2500] });
  expect(rowMetric(shanghai, PORTS_SOURCE.metric)?.value).toBe(PLSCI.CNSHA.value);
  expect(shanghai.props?.locode).toBe("CNSHA");
  expect(shanghai.props?.connectivityQuarter).toBe(PLSCI_QUARTER);
});

test("EU ports carry Eurostat tonnage and US ports USACE tonnage; others neither", () => {
  const out = normalizePorts(MAJOR_PORTS);
  const by = (t: string) => out.find((f) => f.title === t)!;
  expect(String(by("Rotterdam").props?.goodsHandled)).toMatch(/thousand tonnes in \d{4}-Q\d \(Eurostat\)$/);
  expect(String(by("Houston").props?.tonnage)).toMatch(/^309\.5 million short tons in 2023, US rank 1 \(USACE\)$/);
  expect(String(by("Seattle / Tacoma").props?.tonnage)).toMatch(/Tacoma, WA \+ Seattle, WA|Seattle, WA \+ Tacoma, WA/);
  expect(by("Singapore").props?.goodsHandled).toBeUndefined();
  expect(by("Singapore").props?.tonnage).toBeUndefined();
  // Eurostat also reports candidate countries' ports (Mersin, TR).
  expect(Object.keys(EUROSTAT_THS_T).every((c) => ["NL", "BE", "DE", "ES", "GR", "IT", "FR", "PL", "SE", "TR"].includes(c.slice(0, 2)))).toBe(true);
  expect(Object.keys(USACE_TONNAGE).every((c) => c.startsWith("US"))).toBe(true);
});

test("portStatProps states the year-on-year connectivity change from the two quarters", () => {
  const props = portStatProps("XXAAA", {
    plsci: { XXAAA: { value: 110, yearAgo: 100 } },
    eurostat: {},
    usace: {},
  });
  expect(props).toMatchObject({ connectivity: 110, connectivityChange: "+10.0% on a year earlier" });
  expect(portStatProps(undefined)).toEqual({});
});
