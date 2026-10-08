import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import usgsFixture from "@/tests/fixtures/usgs-quakes.json";
import unhcrFixture from "@/tests/fixtures/unhcr-displacement.json";
import gdacsFixture from "@/tests/fixtures/gdacs-events.json";
import eonetFixture from "@/tests/fixtures/eonet-events.json";
import { SIGNALS } from "@/lib/signals/registry";
import type { SignalFeature, SignalPrecision, SignalSource } from "@/lib/signals/types";
import {
  PRECISION_WORDING,
  SIGNAL_PRECISIONS,
  isSignalPrecision,
  precisionOfObject,
  resolvePrecision,
  withResolvedPrecision,
} from "@/lib/signals/precision";
import { EARTHQUAKES_SOURCE, normalizeUsgs } from "@/lib/signals/usgs";
import { PORTS_SOURCE, normalizePorts } from "@/lib/signals/ports";
import { MAJOR_PORTS } from "@/lib/signals/ports.data";
import { UKRAINE_ALERTS_SOURCE, normalizeUkraineAlerts } from "@/lib/signals/ukraine-alerts";
import { DISPLACEMENT_SOURCE, normalizeDisplacement } from "@/lib/signals/displacement";
import { GDACS_SOURCE, normalizeGdacs } from "@/lib/signals/gdacs";
import { CATEGORIES, WILDFIRES_SOURCE, eonetToFeatures, type EonetEvent } from "@/lib/signals/eonet";
import { HEADLINE_PLACES_SOURCE, buildHeadlinePlaceFeatures } from "@/lib/signals/headline-places";
import type { NewsItem } from "@/lib/news";

// The precision level says how precise the PLACE of a signal feature is. The rule it
// serves: a place name, and a country figure most of all, is never to be read as a
// precise point. Each test below runs a REAL adapter over its committed fixture and
// resolves the level the way the /api/signals route does, so a layer that changes
// what it claims goes red here.

/** The levels of a layer's features, resolved as the route resolves them. */
const levels = (features: SignalFeature[], source: SignalSource): SignalPrecision[] =>
  features.map((f) => resolvePrecision(f, source));

describe("one real layer for each level", () => {
  test("exact: a USGS epicentre", () => {
    const out = normalizeUsgs(usgsFixture as never);
    expect(out.length).toBeGreaterThan(0);
    expect(new Set(levels(out, EARTHQUAKES_SOURCE))).toEqual(new Set(["exact"]));
  });

  test("facility: a named port", () => {
    const out = normalizePorts(MAJOR_PORTS);
    expect(out.length).toBeGreaterThan(0);
    expect(new Set(levels(out, PORTS_SOURCE))).toEqual(new Set(["facility"]));
  });

  test("area: a Ukrainian oblast under an alert", () => {
    const payload = JSON.parse(
      readFileSync(join(process.cwd(), "tests", "fixtures", "ukraine-alerts.states.json"), "utf8"),
    ) as unknown;
    const { features } = normalizeUkraineAlerts(payload, Date.parse("2026-09-08T12:00:00Z"));
    expect(features.length).toBeGreaterThan(0);
    expect(new Set(levels(features, UKRAINE_ALERTS_SOURCE))).toEqual(new Set(["area"]));
  });

  test("country: a UNHCR total for a country of asylum", () => {
    const out = normalizeDisplacement(unhcrFixture as never);
    expect(out.length).toBeGreaterThan(0);
    expect(new Set(levels(out, DISPLACEMENT_SOURCE))).toEqual(new Set(["country"]));
  });
});

describe("a layer that mixes levels sets the level on the feature", () => {
  test("GDACS: a quake and a cyclone are exact, a flood and a drought are areas", () => {
    const out = normalizeGdacs(gdacsFixture as never);
    const byHazard = new Map(out.map((f) => [String(f.props?.hazard), resolvePrecision(f, GDACS_SOURCE)]));
    expect(byHazard.get("Earthquake")).toBe("exact");
    expect(byHazard.get("Tropical cyclone")).toBe("exact");
    expect(byHazard.get("Flood")).toBe("area");
    expect(byHazard.get("Drought")).toBe("area");
  });

  test("EONET: a wildfire reported as a polygon is an area, one reported as a point is exact", () => {
    const events = (eonetFixture as { events: EonetEvent[] }).events;
    const fires = eonetToFeatures(events, CATEGORIES.wildfires, Date.parse("2026-06-26T00:00:00Z"));
    const byId = new Map(fires.map((f) => [f.id, resolvePrecision(f, WILDFIRES_SOURCE)]));
    expect(byId.get("eonet:EONET_W1")).toBe("exact");
    expect(byId.get("eonet:EONET_WP")).toBe("area");
  });

  test("headline places: a country name is a country, a city name is an area", () => {
    const item = (title: string): NewsItem => ({ title, source: "Test", url: "https://example.org/a", ts: 1 }) as NewsItem;
    const out = buildHeadlinePlaceFeatures([item("Talks open in Paris"), item("Ukraine's president speaks")]);
    const byTitle = new Map(out.map((f) => [f.title, resolvePrecision(f, HEADLINE_PLACES_SOURCE)]));
    expect(byTitle.get("Paris")).toBe("area");
    expect(byTitle.get("Ukraine")).toBe("country");
  });
});

describe("every registered layer", () => {
  test("declares one of the four levels", () => {
    expect(SIGNALS.length).toBeGreaterThan(30);
    for (const s of SIGNALS) {
      // The message names the layer, so a red run says which one lost its level.
      expect(isSignalPrecision(s.precision), `${s.id} has no valid precision`).toBe(true);
      expect(isSignalPrecision(resolvePrecision({}, s)), `${s.id} does not resolve`).toBe(true);
    }
  });

  test("a per-country figure is declared a country, on every layer that publishes one", () => {
    // The layers the rule exists for. Each draws ONE feature per country on a centroid.
    // A layer that leaves this list must leave it on purpose.
    const perCountry = [
      "conflict",
      "protests",
      "displacement",
      "internet-outages",
      "cyber-c2",
      "cyber-ransomware",
      "reliefweb",
      "instability",
    ];
    const declared = new Map(SIGNALS.map((s) => [s.id, s.precision]));
    for (const id of perCountry) {
      expect(declared.get(id), `${id} must be country-level`).toBe("country");
    }
  });
});

describe("resolvePrecision and withResolvedPrecision", () => {
  const layer = { precision: "country" as const };

  test("a feature's own level wins, and the layer default fills the gap", () => {
    expect(resolvePrecision({ precision: "exact" }, layer)).toBe("exact");
    expect(resolvePrecision({}, layer)).toBe("country");
  });

  test("a level that is not one of the four falls back to the layer default", () => {
    expect(resolvePrecision({ precision: "street" as never }, layer)).toBe("country");
  });

  test("the route helper writes the level on every feature and changes no input", () => {
    const a: SignalFeature = { id: "a", lat: 0, lon: 0, title: "A", signalId: "x" };
    const b: SignalFeature = { id: "b", lat: 0, lon: 0, title: "B", signalId: "x", precision: "area" };
    const input = [a, b];
    const out = withResolvedPrecision(input, layer);
    expect(out.map((f) => f.precision)).toEqual(["country", "area"]);
    expect(out).not.toBe(input);
    expect(a.precision).toBeUndefined();
    expect(out[1]).toBe(b); // already carries its level, so it is not copied
  });
});

describe("the detail panel's line", () => {
  test("every level has its own line", () => {
    const lines = SIGNAL_PRECISIONS.map((p) => PRECISION_WORDING[p].line);
    expect(new Set(lines).size).toBe(4);
    for (const line of lines) expect(line.length).toBeGreaterThan(20);
  });

  test("the country line says that the point is not an event", () => {
    expect(PRECISION_WORDING.country.line).toBe("Country-level figure. Not an event at this point.");
  });

  test("the panel reads the object's level, then the layer default, then nothing", () => {
    const layerDefault = (id: string) => SIGNALS.find((s) => s.id === id)?.precision;
    expect(precisionOfObject({ precision: "area", signalId: "displacement" }, layerDefault)).toBe("area");
    expect(precisionOfObject({ signalId: "displacement" }, layerDefault)).toBe("country");
    expect(precisionOfObject({ precision: "nonsense", signalId: "earthquakes" }, layerDefault)).toBe("exact");
    expect(precisionOfObject({ signalId: "no-such-layer" }, layerDefault)).toBeUndefined();
    expect(precisionOfObject({}, layerDefault)).toBeUndefined();
  });
});
