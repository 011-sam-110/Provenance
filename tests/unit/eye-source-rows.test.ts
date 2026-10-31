import { describe, expect, it } from "vitest";
import { RAIL_SOURCES } from "@/lib/console/sources/railSources";
import { SECTIONS, buildSourceSections } from "@/lib/console/sources/sections";
import type { CatalogSource } from "@/lib/sources/catalog";
import { eyeLeftOut, eyeSourceRows, leftOutCounts, precisionOf } from "@/lib/eye/sourceRows";
import { EYE_OWN_IDS } from "@/lib/eye/sources";
import { MAP_SIGNALS } from "@/lib/signals/registry";

/**
 * The rows of the God's eye view's Sources tray are the console's own rail rows, minus the
 * ones this view cannot draw. The rule is by PROPERTY (a row with no map layer, a layer whose
 * places are whole countries), so none of the numbers here is typed: each is computed from
 * the rail, and a new layer joins the tray or stays out by what it declares.
 */

const railRows = buildSourceSections(RAIL_SOURCES).flatMap((s) => s.rows);
const rows = eyeSourceRows();
const left = eyeLeftOut();

describe("the rows", () => {
  it("are the rail's rows minus any with no map layer and minus any country-level layer", () => {
    const expected = railRows.filter((r) => !r.widgetOnly && precisionOf(r.id) !== "country").map((r) => r.id);
    expect(rows.map((r) => r.id).sort()).toEqual([...expected].sort());
    expect(rows.length + left.length).toBe(railRows.length);
    expect(railRows.length).toBeGreaterThan(20);
  });

  it("start with this view's own seven, in order", () => {
    expect(rows.slice(0, EYE_OWN_IDS.length).map((r) => r.id)).toEqual([...EYE_OWN_IDS]);
    for (const r of rows.slice(0, EYE_OWN_IDS.length)) {
      expect(r.own).toBe(true);
      expect(r.section).toBe("view");
      expect(r.sectionTitle).toBe("This view");
    }
    for (const r of rows.slice(EYE_OWN_IDS.length)) expect(r.own).toBe(false);
  });

  it("keep the rail's section order for the rest, and name no section the rail lacks", () => {
    const order = SECTIONS.map((s) => s.id);
    const used = rows.slice(EYE_OWN_IDS.length).map((r) => r.section);
    const firstSeen = [...new Set(used)];
    expect(firstSeen).toEqual(order.filter((id) => firstSeen.includes(id)));
    for (const id of firstSeen) expect(order).toContain(id);
    // Rows stay together under their section: no section appears in two runs.
    expect(firstSeen.length).toBe(new Set(used).size);
  });

  it("each has a credit, a label and a colour", () => {
    for (const r of rows) {
      expect(r.credit.length, r.id).toBeGreaterThan(0);
      expect(r.label.length, r.id).toBeGreaterThan(0);
      expect(r.color, r.id).toMatch(/^#/);
    }
  });

  it("have each id once", () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("leave out the headlines widget and every country-wide layer, and no layer that is a point", () => {
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.has("news")).toBe(false);
    for (const s of MAP_SIGNALS) {
      if (s.precision === "country") expect(ids.has(s.id), s.id).toBe(false);
      else expect(ids.has(s.id), s.id).toBe(true);
    }
  });

  it("mark the console's two map layers (not signals) so the page can switch them in the right store", () => {
    const layers = rows.filter((r) => !r.own && r.layer).map((r) => r.id).sort();
    expect(layers).toEqual(["countries", "satellites"]);
    // Every other console row is a signal.
    for (const r of rows.filter((x) => !x.own && !x.layer)) expect(MAP_SIGNALS.some((s) => s.id === r.id), r.id).toBe(true);
  });

  it("carry each row's precision, from the signal or the core layer, and none for the borders", () => {
    const by = new Map(rows.map((r) => [r.id, r] as const));
    expect(by.get("crime")!.precision).toBe("area");
    expect(by.get("livecams")!.precision).toBe("exact");
    expect(by.get("countries")!.precision).toBeNull();
  });
});

describe("what is left out", () => {
  it("is every row with no map layer or a country-level one, with the reason", () => {
    for (const l of left) {
      const rail = railRows.find((r) => r.id === l.id)!;
      expect(l.label).toBe(rail.label);
      expect(l.reason).toBe(rail.widgetOnly ? "widget" : "country");
    }
    expect(left.some((l) => l.id === "news" && l.reason === "widget")).toBe(true);
  });

  it("is counted by reason, which the tray's foot says in words", () => {
    const c = leftOutCounts(left);
    expect(c.widget + c.country).toBe(left.length);
    expect(c.widget).toBe(left.filter((l) => l.reason === "widget").length);
  });
});

describe("a catalogue with a country-level signal in it", () => {
  const invented: CatalogSource = {
    id: "fixture-country",
    kind: "signal",
    label: "Fixture country figures",
    group: "Intel",
    color: "#112233",
    attribution: "Fixture",
    refreshMs: 1000,
  };
  const point: CatalogSource = { ...invented, id: "fixture-point", label: "Fixture points" };
  const precision = (id: string) => (id === "fixture-country" ? ("country" as const) : id === "fixture-point" ? ("exact" as const) : precisionOf(id));

  it("drops it, by what it declares and not by a list", () => {
    const withBoth = [...RAIL_SOURCES, invented, point];
    const ids = eyeSourceRows(withBoth, precision).map((r) => r.id);
    expect(ids).not.toContain("fixture-country");
    expect(ids).toContain("fixture-point");
    expect(eyeLeftOut(withBoth, precision).find((l) => l.id === "fixture-country")).toMatchObject({ reason: "country" });
  });
});
