import { expect, test } from "vitest";
import { baseLabel, qualifierOf, resolveLabels } from "@/lib/console/sources/labels";
import { SOURCE_CATALOG } from "@/lib/sources/catalog";

test("the base label drops a trailing parenthetical", () => {
  expect(baseLabel("Humanitarian emergencies (ReliefWeb)")).toBe("Humanitarian emergencies");
  expect(baseLabel("Space weather (NOAA Kp/storms)")).toBe("Space weather");
  expect(baseLabel("Wildfires")).toBe("Wildfires");
});

test("the base label keeps the em-dash half, which is the distinguishing one", () => {
  expect(baseLabel("Air quality — stations (OpenAQ)")).toBe("Air quality · stations");
});

test("the qualifier is the parenthetical, or null", () => {
  expect(qualifierOf("Earthquakes (EMSC)")).toBe("EMSC");
  expect(qualifierOf("Wildfires")).toBeNull();
});

test("an uncontested label keeps its short base name", () => {
  const out = resolveLabels(["Space weather (NOAA Kp/storms)", "Wildfires"]);
  expect(out.get("Space weather (NOAA Kp/storms)")).toBe("Space weather");
  expect(out.get("Wildfires")).toBe("Wildfires");
});

test("a contested label gets its qualifier back, and only it does", () => {
  const out = resolveLabels(["Earthquakes", "Earthquakes (EMSC)"]);
  // The one that can say something about itself does; the bare one stays bare
  // rather than both growing a suffix.
  expect(out.get("Earthquakes")).toBe("Earthquakes");
  expect(out.get("Earthquakes (EMSC)")).toBe("Earthquakes · EMSC");
});

// The reason qualifiers cannot simply be dropped everywhere.
test("resolved labels are unique across the whole catalog", () => {
  const out = resolveLabels(SOURCE_CATALOG.map((s) => s.label));
  const seen = new Map<string, string>();
  for (const s of SOURCE_CATALOG) {
    const short = out.get(s.label)!;
    const prev = seen.get(short);
    expect(prev, `"${short}" would be used by both ${prev} and ${s.id}`).toBeUndefined();
    seen.set(short, s.id);
  }
});

// A budget, not a product rule: the two-column grid was sized against it. If a
// new source blows past this, re-measure the grid rather than relax the number.
test("no resolved label exceeds the width budget the two-column grid was sized for", () => {
  const out = resolveLabels(SOURCE_CATALOG.map((s) => s.label));
  for (const s of SOURCE_CATALOG) {
    const short = out.get(s.label)!;
    expect(short.length, `"${short}" (${s.id}) is ${short.length} chars`).toBeLessThanOrEqual(28);
  }
});
