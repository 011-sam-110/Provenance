// What the question reader DOES with its filters, and what the chips say after.
//
// The rule under test: a chip is on the screen only while its filter has an effect,
// and a removed chip removes that effect. No React here (the repo has no component
// tests), so the rules live in pure functions and thin stores, and this file drives
// those.

import { describe, it, expect, beforeEach } from "vitest";
import { parseAsk } from "@/lib/shell/ask";
import { askContext } from "@/lib/shell/askContext";
import { passesPrecision, precisionFilterStore } from "@/lib/shell/precisionFilter";
import { coerceSavedScope, placeScope, scopeStore, withinScope, WORLD_SCOPE, aoiScope } from "@/lib/shell/scope";
import { filterToScope } from "@/lib/scopeFilter";
import { partsOfGeometry, placeFromCountry, placeFromGeocode, zoomForSpan } from "@/lib/shell/askPlace";
import { appliedChips, applyAsk, askLayersStore, readApplied, removeApplied } from "@/lib/shell/askApplied";
import { timeWindowStore } from "@/lib/shell/timeWindow";
import { signalsStore } from "@/lib/signals/store";
import { MAP_SIGNALS } from "@/lib/signals/registry";

const CTX = askContext();

// A square with a square hole, and a second square far away: a country with an
// enclave and an island.
const MAINLAND: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const HOLE: [number, number][] = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
const ISLAND: [number, number][] = [[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]];
const COUNTRY: GeoJSON.MultiPolygon = { type: "MultiPolygon", coordinates: [[MAINLAND, HOLE], [ISLAND]] };

describe("passesPrecision", () => {
  it("lets every level through with no rule", () => {
    for (const level of ["exact", "facility", "area", "country", undefined]) {
      expect(passesPrecision(level, null)).toBe(true);
    }
  });
  it("'only' keeps one level", () => {
    const only = { mode: "only", level: "exact" } as const;
    expect(passesPrecision("exact", only)).toBe(true);
    expect(passesPrecision("facility", only)).toBe(false);
    expect(passesPrecision("country", only)).toBe(false);
  });
  it("'without' removes one level", () => {
    const without = { mode: "without", level: "country" } as const;
    expect(passesPrecision("country", without)).toBe(false);
    expect(passesPrecision("exact", without)).toBe(true);
    expect(passesPrecision("area", without)).toBe(true);
  });
  it("an item with no level is not shown as a level it did not state", () => {
    expect(passesPrecision(undefined, { mode: "only", level: "exact" })).toBe(false);
    expect(passesPrecision("nonsense", { mode: "only", level: "exact" })).toBe(false);
    // "No country figures" does not hide an item that is not known to be one.
    expect(passesPrecision(undefined, { mode: "without", level: "country" })).toBe(true);
  });
});

describe("a place scope", () => {
  const parts = partsOfGeometry(COUNTRY)!;
  const scope = placeScope("Testland", parts);

  it("is an area scope that says where it came from", () => {
    expect(scope.mode).toBe("aoi");
    expect(scope.origin).toBe("place");
    expect(scope.label).toBe("Testland");
    expect(scope.bbox).toEqual([0, 0, 22, 22]);
  });
  it("admits a point in any part", () => {
    expect(withinScope(2, 2, scope)).toBe(true); // lat, lon: mainland
    expect(withinScope(21, 21, scope)).toBe(true); // the island
  });
  it("refuses a point between the parts and a point in a hole", () => {
    expect(withinScope(15, 15, scope)).toBe(false); // inside the bbox, outside each part
    expect(withinScope(5, 5, scope)).toBe(false); // the enclave
    expect(withinScope(50, 50, scope)).toBe(false);
  });
  it("crops a list through the shared scope filter", () => {
    const items = [{ lat: 2, lon: 2 }, { lat: 5, lon: 5 }, { lat: 21, lon: 21 }, { lat: 40, lon: 40 }];
    expect(filterToScope(items, scope, (o) => o)).toEqual([{ lat: 2, lon: 2 }, { lat: 21, lon: 21 }]);
  });
  it("does not survive a reload: the time and precision of the same question do not", () => {
    expect(coerceSavedScope(JSON.parse(JSON.stringify(scope)))).toEqual(WORLD_SCOPE);
  });
  it("leaves a drawn area as it was", () => {
    const drawn = aoiScope([[0, 0], [1, 0], [1, 1]], "Drawn area");
    expect(coerceSavedScope(JSON.parse(JSON.stringify(drawn))).mode).toBe("aoi");
    expect(drawn.origin).toBeUndefined();
  });
  it("with no usable part is World, not an empty map", () => {
    expect(placeScope("Nowhere", [])).toEqual(WORLD_SCOPE);
  });
});

describe("resolving a place", () => {
  it("reads the parts of a polygon and of a multi polygon", () => {
    expect(partsOfGeometry({ type: "Polygon", coordinates: [MAINLAND] })).toHaveLength(1);
    expect(partsOfGeometry(COUNTRY)).toHaveLength(2);
    expect(partsOfGeometry({ type: "Point", coordinates: [0, 0] })).toBeNull();
  });
  it("a country is its outline, and the view goes to its largest part", () => {
    const p = placeFromCountry("Testland", COUNTRY)!;
    expect(p.shape).toBe("country");
    expect(p.parts).toHaveLength(2);
    expect(p.center).toEqual({ lat: 5, lon: 5 });
    expect(p.note).toMatch(/border of Testland/);
  });
  it("a geocoded place with an extent is a box around it", () => {
    const p = placeFromGeocode({ name: "Madrid, Spain", lat: 40.4, lon: -3.7, bbox: [-3.9, 40.3, -3.5, 40.6] })!;
    expect(p.shape).toBe("box");
    expect(p.label).toBe("Madrid, Spain");
    const scope = placeScope(p.label, p.parts);
    expect(withinScope(40.4, -3.7, scope)).toBe(true);
    expect(withinScope(41.4, 2.2, scope)).toBe(false); // Barcelona
    expect(p.note).toMatch(/box around Madrid, Spain/);
  });
  it("a geocoded place with no extent is a circle, and the note says its radius", () => {
    const p = placeFromGeocode({ name: "Some hamlet", lat: 10, lon: 10 })!;
    expect(p.shape).toBe("circle");
    expect(p.note).toMatch(/25 km/);
    const scope = placeScope(p.label, p.parts);
    expect(withinScope(10.1, 10.1, scope)).toBe(true);
    expect(withinScope(11, 11, scope)).toBe(false);
  });
  it("a geocoded country uses the outline when the caller has it", () => {
    const p = placeFromGeocode(
      { name: "Testland", lat: 5, lon: 5, type: "country", countryCode: "TL", bbox: [0, 0, 22, 22] },
      (iso2) => (iso2 === "TL" ? COUNTRY : undefined),
    )!;
    expect(p.shape).toBe("country");
  });
  it("an extent across the date line is refused, not turned inside out", () => {
    expect(placeFromGeocode({ name: "Seam", lat: 0, lon: 179.9, bbox: [170, -5, -170, 5] })).toBeNull();
  });
  it("frames a wide place from far and a small place from near", () => {
    expect(zoomForSpan(150)).toBeLessThan(zoomForSpan(12));
    expect(zoomForSpan(12)).toBeLessThan(zoomForSpan(0.3));
  });
});

const labelOf = (id: string) => MAP_SIGNALS.find((s) => s.id === id)?.label;

describe("appliedChips: a chip only for a filter that has an effect", () => {
  const none = {
    askLayerIds: [] as string[],
    signalsOn: {} as Record<string, boolean>,
    layerLabel: labelOf,
    scope: WORLD_SCOPE,
    timeWindow: "all" as const,
    precision: null,
  };

  it("shows nothing when nothing is filtered", () => {
    expect(appliedChips(none)).toEqual([]);
  });
  it("shows no layer chip for a layer that is off", () => {
    expect(appliedChips({ ...none, askLayerIds: ["wildfires"] })).toEqual([]);
    const on = appliedChips({ ...none, askLayerIds: ["wildfires"], signalsOn: { wildfires: true } });
    expect(on.map((c) => [c.kind, c.label])).toEqual([["layer", "Wildfires"]]);
  });
  it("shows no layer chip for a layer the reader did not turn on", () => {
    expect(appliedChips({ ...none, signalsOn: { wildfires: true } })).toEqual([]);
  });
  it("shows no layer chip for an id that is not a map layer", () => {
    expect(appliedChips({ ...none, askLayerIds: ["nope"], signalsOn: { nope: true } })).toEqual([]);
  });
  it("shows the time chip for each window but 'all'", () => {
    expect(appliedChips({ ...none, timeWindow: "24h" }).map((c) => c.label)).toEqual(["Last 24 hours"]);
    expect(appliedChips({ ...none, timeWindow: "all" })).toEqual([]);
  });
  it("the time chip says that items with no time stay", () => {
    expect(appliedChips({ ...none, timeWindow: "7d" })[0].note).toMatch(/no time stay/);
  });
  it("shows a place chip for a place scope and not for a drawn area", () => {
    const place = placeScope("Spain", [[MAINLAND]]);
    expect(appliedChips({ ...none, scope: place }).map((c) => [c.kind, c.label])).toEqual([["place", "Spain"]]);
    expect(appliedChips({ ...none, scope: aoiScope([[0, 0], [1, 0], [1, 1]], "Drawn area") })).toEqual([]);
  });
  it("shows the precision chip", () => {
    const chips = appliedChips({ ...none, precision: { mode: "without", level: "country" } });
    expect(chips.map((c) => [c.kind, c.label])).toEqual([["precision", "No country figures"]]);
  });
  it("gives each chip its own key", () => {
    const chips = appliedChips({
      askLayerIds: ["wildfires", "earthquakes"],
      signalsOn: { wildfires: true, earthquakes: true },
      layerLabel: labelOf,
      scope: placeScope("Spain", [[MAINLAND]]),
      timeWindow: "24h",
      precision: { mode: "only", level: "exact" },
    });
    expect(chips.map((c) => c.kind)).toEqual(["layer", "layer", "place", "time", "precision"]);
    expect(new Set(chips.map((c) => c.key)).size).toBe(5);
  });
});

describe("apply, then remove each chip", () => {
  beforeEach(() => {
    for (const s of MAP_SIGNALS) signalsStore.set(s.id, false);
    askLayersStore.clear();
    scopeStore.set(WORLD_SCOPE);
    timeWindowStore.set("all");
    precisionFilterStore.set(null);
  });

  const spain = placeFromCountry("Spain", { type: "Polygon", coordinates: [MAINLAND] })!;

  it("sets each store that the question names", () => {
    const { filters } = parseAsk("fires in Spain last 24h exact only", CTX);
    applyAsk(filters, spain);
    expect(signalsStore.isOn("wildfires")).toBe(true);
    expect(timeWindowStore.get()).toBe("24h");
    expect(precisionFilterStore.get()).toEqual({ mode: "only", level: "exact" });
    expect(scopeStore.get().origin).toBe("place");
    expect(readApplied().map((c) => c.label)).toEqual(["Wildfires", "Spain", "Last 24 hours", "Exact points only"]);
  });

  it("each removed chip removes its filter and no other", () => {
    applyAsk(parseAsk("fires in Spain last 24h exact only", CTX).filters, spain);
    const kinds = () => readApplied().map((c) => c.kind);

    removeApplied(readApplied().find((c) => c.kind === "time")!);
    expect(timeWindowStore.get()).toBe("all");
    expect(kinds()).toEqual(["layer", "place", "precision"]);

    removeApplied(readApplied().find((c) => c.kind === "precision")!);
    expect(precisionFilterStore.get()).toBeNull();
    expect(kinds()).toEqual(["layer", "place"]);

    removeApplied(readApplied().find((c) => c.kind === "place")!);
    expect(scopeStore.get()).toEqual(WORLD_SCOPE);
    expect(kinds()).toEqual(["layer"]);

    removeApplied(readApplied().find((c) => c.kind === "layer")!);
    expect(signalsStore.isOn("wildfires")).toBe(false);
    expect(readApplied()).toEqual([]);
  });

  it("a question with no place does not touch the scope", () => {
    const drawn = aoiScope([[0, 0], [1, 0], [1, 1]], "Drawn area");
    scopeStore.set(drawn);
    applyAsk(parseAsk("quakes past week", CTX).filters, null);
    expect(scopeStore.get()).toBe(drawn);
    expect(timeWindowStore.get()).toBe("7d");
  });

  it("a removed place chip gives back the area that was drawn before it", () => {
    const drawn = aoiScope([[0, 0], [1, 0], [1, 1]], "Drawn area");
    scopeStore.set(drawn);
    applyAsk(parseAsk("fires in Spain", CTX).filters, spain);
    expect(scopeStore.get().label).toBe("Spain");
    removeApplied(readApplied().find((c) => c.kind === "place")!);
    expect(scopeStore.get()).toBe(drawn);
  });

  it("a place that was not found is not applied, and the other filters are", () => {
    applyAsk(parseAsk("fires in Atlantis last 24h", CTX).filters, null);
    expect(scopeStore.get()).toEqual(WORLD_SCOPE);
    expect(readApplied().map((c) => c.kind)).toEqual(["layer", "time"]);
  });

  it("a second question adds to the first, and each filter stays on a chip", () => {
    applyAsk(parseAsk("fires last 24h", CTX).filters, null);
    applyAsk(parseAsk("quakes no country figures", CTX).filters, null);
    expect(readApplied().map((c) => c.label)).toEqual(["Wildfires", "Earthquakes", "Last 24 hours", "No country figures"]);
  });

  it("a layer turned off in the Sources rail loses its chip", () => {
    applyAsk(parseAsk("fires", CTX).filters, null);
    signalsStore.set("wildfires", false);
    expect(readApplied()).toEqual([]);
  });
});
