import { describe, it, expect } from "vitest";
import { toCsv, toGeoJson, exportFilename } from "@/lib/export";

describe("toCsv", () => {
  it("writes a header + rows and quotes values with commas/quotes/newlines", () => {
    const csv = toCsv([
      { sym: "BTC", value: "$60,000", note: 'he said "hi"' },
      { sym: "ETH", value: "$3,000", note: "line1\nline2" },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("sym,value,note");
    expect(lines[1]).toBe('BTC,"$60,000","he said ""hi"""');
    expect(lines[2]).toBe('ETH,"$3,000","line1\nline2"');
  });

  it("respects an explicit column order and empty for missing/null", () => {
    expect(toCsv([{ a: 1, b: null }], ["b", "a"])).toBe("b,a\r\n,1");
    expect(toCsv([])).toBe("");
  });
});

describe("toGeoJson", () => {
  it("builds a FeatureCollection of points and drops invalid coords", () => {
    const gj = JSON.parse(
      toGeoJson([
        { lat: 50.4, lon: 30.5, properties: { name: "Kyiv" } },
        { lat: Number.NaN, lon: 1, properties: { name: "bad" } },
      ]),
    );
    expect(gj.type).toBe("FeatureCollection");
    expect(gj.features).toHaveLength(1);
    expect(gj.features[0].geometry.coordinates).toEqual([30.5, 50.4]); // [lon,lat]
    expect(gj.features[0].properties.name).toBe("Kyiv");
  });
});

describe("exportFilename", () => {
  it("is UTC-stamped and filesystem-safe", () => {
    expect(exportFilename("markets", Date.parse("2026-07-08T04:59:12Z"))).toBe(
      "opendata-markets-2026-07-08T04-59Z",
    );
  });
});
