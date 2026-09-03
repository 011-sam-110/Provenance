import { expect, test } from "vitest";
import { buildSourceSections, SECTIONS } from "@/lib/console/sources/sections";
import { SOURCE_CATALOG, type CatalogSource } from "@/lib/sources/catalog";

test("every source in the catalog lands in exactly one section", () => {
  const sections = buildSourceSections();
  const seen = new Map<string, string>();
  for (const sec of sections) {
    for (const row of sec.rows) {
      const prev = seen.get(row.id);
      expect(prev, `${row.id} appears in both ${prev} and ${sec.id}`).toBeUndefined();
      seen.set(row.id, sec.id);
    }
  }
  expect(seen.size).toBe(SOURCE_CATALOG.length);
  for (const s of SOURCE_CATALOG) expect(seen.has(s.id), `${s.id} is in no section`).toBe(true);
});

// The reason the rail can be read at a glance: six headings, not sixteen.
test("the declared sections are the six, in reading order", () => {
  expect(SECTIONS.map((s) => s.id)).toEqual([
    "ground",
    "air-space",
    "hazards",
    "infrastructure",
    "security",
    "human",
  ]);
});

test("no declared section is empty against today's catalog", () => {
  const sections = buildSourceSections();
  for (const sec of SECTIONS) {
    const built = sections.find((s) => s.id === sec.id);
    expect(built, `${sec.id} rendered no section`).toBeDefined();
    expect(built!.rows.length, `${sec.id} is empty`).toBeGreaterThan(0);
  }
});

// THIS IS THE GUARD THAT MATTERS, and it is deliberately not a count.
//
// Pinning per-section counts would go red every time anyone adds a signal, which
// fights the repo's own convention that a new layer needs no edit to the rail.
// This goes red only when a NEW GROUP appears — which is exactly the moment a
// person has to decide where it belongs.
test("every group in the catalog is mapped to a section", () => {
  const unmapped = [...new Set(SOURCE_CATALOG.map((s) => s.group))].filter(
    (g) => !SECTIONS.some((sec) => sec.groups.includes(g)),
  );
  expect(unmapped, `unmapped groups: ${unmapped.join(", ")} — map them or accept "Other"`).toEqual(
    [],
  );
});

test("an unmapped group falls into a visible Other section rather than vanishing", () => {
  const invented: CatalogSource = {
    id: "zz-invented",
    kind: "signal",
    label: "Invented layer",
    group: "Nowhere",
    color: "#000000",
    attribution: "none",
    refreshMs: 1000,
  };
  const sections = buildSourceSections([...SOURCE_CATALOG, invented]);
  const other = sections.find((s) => s.id === "other");
  expect(other, "an unmapped group produced no Other section").toBeDefined();
  expect(other!.rows.map((r) => r.id)).toEqual(["zz-invented"]);
});

test("Other is absent when every group is mapped", () => {
  expect(buildSourceSections().some((s) => s.id === "other")).toBe(false);
});

test("rows carry the resolved display label, not the raw catalog label", () => {
  const rows = buildSourceSections().flatMap((s) => s.rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Uncontested: the parenthetical goes.
  expect(byId.get("reliefweb")?.label).toBe("Humanitarian emergencies");
  // Contested with USGS earthquakes: this one keeps its qualifier.
  expect(byId.get("emsc-quakes")?.label).toBe("Earthquakes · EMSC");
  expect(byId.get("earthquakes")?.label).toBe("Earthquakes");
});

// The popover has to say where the data comes from, so the row cannot drop it.
test("rows keep the attribution and the registry group for the popover", () => {
  const rows = buildSourceSections().flatMap((s) => s.rows);
  for (const r of rows) {
    const src = SOURCE_CATALOG.find((s) => s.id === r.id)!;
    expect(r.attribution).toBe(src.attribution);
    expect(r.group).toBe(src.group);
    expect(r.color).toBe(src.color);
  }
});

test("rows within a section keep catalog order", () => {
  const order = new Map(SOURCE_CATALOG.map((s, i) => [s.id, i]));
  for (const sec of buildSourceSections()) {
    const idx = sec.rows.map((r) => order.get(r.id)!);
    expect(idx, `${sec.id} is out of catalog order`).toEqual([...idx].sort((a, b) => a - b));
  }
});
