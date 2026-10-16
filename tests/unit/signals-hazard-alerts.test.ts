import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import cems from "@/tests/fixtures/hazards/cems-activations.json";
import hansElevated from "@/tests/fixtures/hazards/hans-elevated.json";
import hansVolcanoes from "@/tests/fixtures/hazards/hans-getVolcano.json";
import jmaWarnings from "@/tests/fixtures/hazards/jma-volcano-warning.json";
import jmaVolcanoes from "@/tests/fixtures/hazards/jma-volcano_list.json";
import { CEMS_ACTIVATIONS_SOURCE, normalizeCems, parseWktPoint } from "@/lib/signals/cems-activations";
import { TSUNAMI_SOURCE, normalizeTsunamiAtom, tsunamiLayerFrom } from "@/lib/signals/tsunami";
import { VOLCANO_ALERTS_SOURCE, hansCoords, normalizeHans, normalizeJmaVolcano, volcanoLayerFrom } from "@/lib/signals/volcano-alerts";
import { readOutcome } from "@/lib/signals/outcome";
import { readCoverage } from "@/lib/signals/coverage";

// Live captures of 2026-10-16, ~20:10 UTC.
const text = (f: string) => readFileSync(resolve(__dirname, "../fixtures/hazards", f), "utf8");
const NOW = Date.parse("2026-10-16T20:10:00Z");

describe("Copernicus EMS activations", () => {
  const rows = normalizeCems(cems as never, NOW);

  test("open activations and those of the last 30 days, newest page of 50", () => {
    // 50 activations back to June: Panama (open) and Crete (closed 4 Oct, within 30 days).
    expect(rows.map((f) => f.id)).toEqual(["cems:EMSR934", "cems:EMSR933"]);
    expect(readCoverage(rows)).toMatchObject({ capped: false, availableExact: true });
  });

  test("Panama: centroid, link to its maps, the GDACS event it answers", () => {
    const p = rows[0]!;
    expect(p.lat).toBeCloseTo(8.0067, 3);
    expect(p.lon).toBeCloseTo(-80.6708, 3);
    expect(p.title).toBe("EMSR934: Earthquake in Los Santos, Panama");
    expect(p.link).toBe("https://mapping.emergency.copernicus.eu/activations/EMSR934");
    expect(p.ts).toBe("2026-10-09T23:19:00.000Z");
    expect(p.props).toMatchObject({ category: "Earthquake", countries: "Panama", status: "open", gdacs: "EQ1570339" });
    expect(CEMS_ACTIVATIONS_SOURCE.precision).toBe("area");
  });

  test("WKT points, and a full page still inside the window is stated as capped", () => {
    expect(parseWktPoint("POINT (24.97 35.22)")).toEqual({ lat: 35.22, lon: 24.97 });
    expect(parseWktPoint("POLYGON ((0 0))")).toBeNull();
    const full = { results: Array.from({ length: 50 }, (_, i) => ({ code: `E${i}`, centroid: "POINT (1 1)", activationTime: "2026-10-16T00:00:00", closed: false })) };
    expect(readCoverage(normalizeCems(full, NOW))).toMatchObject({ capped: true });
  });
});

describe("tsunami messages", () => {
  test("PTWC: the Kamchatka information statement, within its 24 hours", () => {
    const [m] = normalizeTsunamiAtom(text("tsunami-PHEB.xml"), "PTWC", NOW);
    expect(m).toMatchObject({ lat: 51.86, lon: 157.428, ts: "2026-10-16T03:46:40.000Z", signalId: "tsunami-alerts", color: "#2563eb" });
    expect(m!.title).toBe("Tsunami information (PTWC): NEAR THE EAST COAST OF KAMCHATKA RUSSIA");
    expect(m!.props?.category).toBe("Information");
    expect(m!.props?.earthquake).toBe("7.0(Mwp)");
    expect(m!.link).toBe("https://www.tsunami.gov/events/PHEB/2026/10/16/26289000/1/WEGM42/WEGM42.txt");
  });

  test("NTWC: its note says there is no danger, and the note is kept", () => {
    const [m] = normalizeTsunamiAtom(text("tsunami-PAAQ.xml"), "NTWC", NOW);
    expect(String(m!.props?.note)).toContain("There is no tsunami danger for the U.S. West Coast");
  });

  test("a bulletin older than 24 hours is not shown", () => {
    expect(normalizeTsunamiAtom(text("tsunami-PHEB.xml"), "PTWC", NOW + 25 * 3_600_000)).toEqual([]);
  });

  test("a warning is red", () => {
    const xml = text("tsunami-PHEB.xml").replace("<strong>Category:</strong> Information", "<strong>Category:</strong> Warning");
    expect(normalizeTsunamiAtom(xml, "PTWC", NOW)[0]!.color).toBe("#dc2626");
  });

  test("one centre failing keeps the other's bulletins and says so", () => {
    const ptwc = normalizeTsunamiAtom(text("tsunami-PHEB.xml"), "PTWC", NOW);
    const out = tsunamiLayerFrom([{ centre: "PTWC", ok: true, rows: ptwc }, { centre: "NTWC", ok: false, rows: [], reason: "http 503" }], 1);
    expect(out).toHaveLength(1);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "partial: NTWC (http 503) failed" });
    expect(TSUNAMI_SOURCE.id).toBe("tsunami-alerts");
  });
});

describe("volcano alert levels", () => {
  const coords = new Map(Object.entries(hansVolcanoes).map(([k, v]) => [k, hansCoords(v)!]));

  test("USGS: every volcano above NORMAL, at its summit, coloured by the ground-hazard level", () => {
    const rows = normalizeHans(hansElevated as never, coords);
    expect(rows).toHaveLength(4);
    const sitkin = rows.find((f) => f.id === "volcano:usgs:311120")!;
    expect(sitkin).toMatchObject({ lat: 52.0765, lon: -176.1109, color: "#f97316", ts: "2026-10-16T19:14:32.000Z" });
    expect(sitkin.title).toBe("Great Sitkin — WATCH / ORANGE");
    expect(sitkin.props).toMatchObject({ "aviation colour": "ORANGE", agency: "USGS" });
    expect(normalizeHans(hansElevated as never, new Map())).toEqual([]); // no summit, no pin
  });

  test("JMA: warnings above normal, in English, at the summit from JMA's own list", () => {
    const rows = normalizeJmaVolcano(jmaWarnings as never, jmaVolcanoes as never);
    // 14 warnings in the file; Kuchinoerabujima (Level 1) and Beyonesu Rocks (be aware) are normal.
    expect(rows).toHaveLength(12);
    const saku = rows.find((f) => f.id === "volcano:jma:506")!;
    expect(saku.title).toBe("Sakurajima — Level 3: do not approach the volcano");
    expect(saku).toMatchObject({ lat: 31.593, lon: 130.657, color: "#f97316" });
    expect(saku.props?.change).toBe("lowered");
    const ioto = rows.find((f) => f.id === "volcano:jma:329")!;
    expect(ioto.props?.["alert level"]).toBe("Danger near the crater (no alert levels at this volcano)");
    expect(rows.some((f) => f.id === "volcano:jma:509")).toBe(false); // Kuchinoerabujima, Level 1
  });

  test("one agency failing keeps the other's alerts", () => {
    const out = volcanoLayerFrom([{ agency: "USGS", ok: false, rows: [], reason: "timeout" }, { agency: "JMA", ok: true, rows: [] }], 1);
    expect(readOutcome(out)).toMatchObject({ ok: false, reason: "partial: USGS (timeout) failed" });
    expect(VOLCANO_ALERTS_SOURCE.precision).toBe("facility");
  });
});
