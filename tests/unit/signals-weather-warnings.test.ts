import { describe, expect, test } from "vitest";
import nws from "@/tests/fixtures/hazards/nws-alerts.json";
import eccc from "@/tests/fixtures/hazards/eccc-alerts.json";
import { US_COUNTY_CENTROIDS } from "@/lib/signals/us-county-centroids.data";
import {
  WEATHER_WARNINGS_SOURCE,
  countyAnchor,
  normalizeEccc,
  normalizeNws,
  polygonOf,
  weatherLayerFrom,
} from "@/lib/signals/weather-warnings";
import { readOutcome } from "@/lib/signals/outcome";
import { readCoverage } from "@/lib/signals/coverage";

// Live captures of 2026-10-16 ~20:10 UTC, trimmed: NWS to 16 alerts (6 with their own
// polygon, 8 Severe zone-only alerts of which 2 are marine, 2 Minor zone-only), ECCC to 12.
const NOW = Date.parse("2026-10-16T20:15:00Z");

describe("NWS", () => {
  const { rows, total, skipped } = normalizeNws(nws as never, US_COUNTY_CENTROIDS, NOW);

  test("polygon alerts drawn as polygons; Severe zone-only alerts placed at their counties; the rest counted", () => {
    expect(total).toBe(16);
    expect(rows).toHaveLength(12);
    expect(skipped).toBe(4); // 2 marine (no county) + 2 Minor zone-only
    expect(rows.filter((f) => f.geometry)).toHaveLength(6);
  });

  test("a severe thunderstorm warning keeps NWS's polygon, coloured as Severe", () => {
    const w = rows.find((f) => f.props?.event === "Severe Thunderstorm Warning")!;
    expect(w.geometry?.type).toBe("Polygon");
    expect(w.color).toBe("#dc2626");
    expect(w.props).toMatchObject({ severity: "Severe", placed: "NWS polygon", agency: "NWS" });
    expect(w.link).toMatch(/^https:\/\/api\.weather\.gov\/alerts\//);
  });

  test("a zone-only high wind warning sits at the centre of the counties it names", () => {
    const both = rows.find((f) => f.id.endsWith("aea043.001.1"))!; // SAME 006065 (Riverside) + 006071 (San Bernardino)
    const a = US_COUNTY_CENTROIDS["06065"]!;
    const b = US_COUNTY_CENTROIDS["06071"]!;
    expect(both.lat).toBeCloseTo((a[0] + b[0]) / 2, 3);
    expect(both.lon).toBeCloseTo((a[1] + b[1]) / 2, 3);
    expect(both.geometry).toBeUndefined();
    expect(both.props?.placed).toBe("centre of 2 counties named");
  });

  test("an ended alert and a cancellation are not drawn", () => {
    const later = normalizeNws(nws as never, US_COUNTY_CENTROIDS, Date.parse("2026-10-19T00:00:00Z"));
    expect(later.rows).toHaveLength(0);
    const cancel = { features: [{ id: "x", geometry: null, properties: { id: "x", messageType: "Cancel", severity: "Severe", geocode: { SAME: ["006065"] } } }] };
    expect(normalizeNws(cancel, US_COUNTY_CENTROIDS, NOW).rows).toHaveLength(0);
  });

  test("countyAnchor reads SAME codes as county FIPS and ignores marine zones", () => {
    expect(countyAnchor(["073530"], US_COUNTY_CENTROIDS)).toBeNull();
    expect(countyAnchor(["006037"], US_COUNTY_CENTROIDS)).toMatchObject({ n: 1 });
    expect(Object.keys(US_COUNTY_CENTROIDS).length).toBeGreaterThan(3200);
  });
});

describe("ECCC", () => {
  const rows = normalizeEccc(eccc as never, NOW);

  test("every current alert with its polygon; an ended one dropped", () => {
    expect(rows).toHaveLength(11);
    expect(rows.some((f) => String(f.title).includes("Naujaat"))).toBe(false); // wind warning, ended
    const sps = rows.find((f) => String(f.title).includes("Chilcotin"))!;
    expect(sps.geometry?.type).toBe("Polygon");
    expect(sps.props).toMatchObject({ type: "statement", agency: "ECCC" });
    expect(sps.color).toBe("#94a3b8");
  });
});

describe("the layer", () => {
  test("one service failing keeps the other's warnings, says so, and states what was not drawn", () => {
    const n = normalizeNws(nws as never, US_COUNTY_CENTROIDS, NOW);
    const out = weatherLayerFrom(
      [{ service: "NWS", ok: true, rows: n.rows, skipped: n.skipped }, { service: "ECCC", ok: false, rows: [], reason: "http 502" }],
      1,
    );
    expect(out).toHaveLength(12);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "partial: ECCC (http 502) failed" });
    expect(readCoverage(out)?.rule).toContain("4 other NWS alerts");
  });

  test("both failing is a failure", () => {
    const out = weatherLayerFrom([{ service: "NWS", ok: false, rows: [], reason: "timeout" }, { service: "ECCC", ok: false, rows: [], reason: "timeout" }], 1);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "timeout" });
  });

  test("polygonOf cleans rings and anchors a MultiPolygon on its largest ring", () => {
    const sq = (x: number, n = 4) => [[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]].slice(0, n + 1);
    const p = polygonOf({ type: "MultiPolygon", coordinates: [[sq(0)], [[...sq(10, 3), [10.5, 0.5], [10, 0]]]] })!;
    expect(p.geometry.type).toBe("MultiPolygon");
    expect(polygonOf({ type: "Point", coordinates: [1, 2] })).toBeNull();
    expect(WEATHER_WARNINGS_SOURCE.group).toBe("Weather");
  });
});
