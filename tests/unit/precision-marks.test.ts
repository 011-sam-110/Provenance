import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import unhcrFixture from "@/tests/fixtures/unhcr-displacement.json";
import type { WorldObject } from "@/lib/world";
import type { SignalMetric, SignalPrecision } from "@/lib/signals/types";
import { MAP_SIGNALS } from "@/lib/signals/registry";
import { withResolvedPrecision } from "@/lib/signals/precision";
import { DISPLACEMENT_SOURCE, normalizeDisplacement } from "@/lib/signals/displacement";
import { centroidByName } from "@/lib/signals/country-centroids.data";
import { buildSignalObject } from "@/lib/widgets/signalObject";
import { toSignalFC, toSignalFillFC } from "@/lib/map/features";
import { toSignalObjects } from "@/lib/map/signalObjects";
import { PIN_HIT_LAYERS, resolveMapClickTarget } from "@/lib/map/hitTest";
import {
  EMPTY_MARK_CONTEXT,
  MARK_LEGEND,
  SIGNAL_MARKS,
  buildCountryOutlines,
  figureInk,
  formatFigure,
  markOf,
  marksPresent,
  pinSignals,
  toSignalAnchorFC,
  toSignalCountryFC,
  type MarkContext,
} from "@/lib/map/precisionMarks";

// THE RULE UNDER TEST: an area or a country figure is never drawn as a pin. A pin
// says "this thing is here", and a country total on a centroid is not here.

const root = process.cwd();
const countryFile = JSON.parse(
  readFileSync(join(root, "public", "geo", "countries-110m.geojson"), "utf8"),
) as GeoJSON.FeatureCollection;
const OUTLINES = buildCountryOutlines(countryFile);

const METRICS: Record<string, SignalMetric | undefined> = Object.fromEntries(
  MAP_SIGNALS.map((s) => [s.id, s.metric]),
);

/** The context WorldMap builds: the real outline file, the real metrics, the real name table. */
const ctx: MarkContext = {
  countryOutline: (iso3) => OUTLINES.get(iso3),
  metricOf: (signalId) => METRICS[signalId],
  iso3OfName: (name) => centroidByName(name)?.iso3,
};

function sig(over: {
  id?: string;
  signalId?: string;
  precision?: SignalPrecision;
  countryIso3?: string;
  props?: Record<string, unknown>;
  geometry?: unknown;
  color?: string;
  lat?: number;
  lon?: number;
}): WorldObject {
  return {
    kind: "signal",
    id: over.id ?? "x:1",
    lat: over.lat ?? 10,
    lon: over.lon ?? 20,
    label: "A mark",
    color: over.color ?? "#ea580c",
    meta: {
      signalId: over.signalId ?? "displacement",
      ...(over.precision ? { precision: over.precision } : {}),
      ...(over.countryIso3 ? { countryIso3: over.countryIso3 } : {}),
      props: over.props ?? {},
      ...(over.geometry ? { geometry: over.geometry } : {}),
    },
  };
}

describe("the country outline file", () => {
  test("has 177 outlines, and none for Bahrain, Malta or Singapore", () => {
    expect(OUTLINES.size).toBe(177);
    for (const iso3 of ["BHR", "MLT", "SGP"]) expect(OUTLINES.has(iso3), iso3).toBe(false);
    for (const iso3 of ["AFG", "FRA", "USA"]) expect(OUTLINES.has(iso3), iso3).toBe(true);
  });
});

describe("markOf", () => {
  test("an exact point and a named facility keep the pin", () => {
    expect(markOf(sig({ precision: "exact" }), ctx)).toBe("pin");
    expect(markOf(sig({ precision: "facility" }), ctx)).toBe("pin");
  });

  test("an area with no polygon is a soft disc", () => {
    expect(markOf(sig({ precision: "area" }), ctx)).toBe("disc");
  });

  test("an area with its own polygon is that shape", () => {
    const hex = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    expect(markOf(sig({ precision: "area", geometry: hex }), ctx)).toBe("shape");
  });

  test("a country figure is the shaded country when the file has its outline", () => {
    expect(markOf(sig({ precision: "country", countryIso3: "AFG" }), ctx)).toBe("country");
  });

  test("a country figure with no outline in the file is a dashed ring", () => {
    expect(markOf(sig({ precision: "country", countryIso3: "BHR" }), ctx)).toBe("ring");
    expect(markOf(sig({ precision: "country", countryIso3: "MLT" }), ctx)).toBe("ring");
    expect(markOf(sig({ precision: "country", countryIso3: "SGP" }), ctx)).toBe("ring");
  });

  test("a country figure with no country code and no country name is a dashed ring", () => {
    expect(markOf(sig({ precision: "country" }), ctx)).toBe("ring");
  });

  test("a country figure from a payload without the code is shaded by its country NAME", () => {
    // What a browser or a CDN holds from before the adapters sent `countryIso3`.
    expect(markOf(sig({ precision: "country", props: { country: "Afghanistan" } }), ctx)).toBe("country");
    expect(markOf(sig({ precision: "country", props: { country: "Bahrain" } }), ctx)).toBe("ring");
    expect(markOf(sig({ precision: "country", props: { country: "Not A Country" } }), ctx)).toBe("ring");
  });

  test("before the outline file loads, a country figure is a ring and still not a pin", () => {
    expect(markOf(sig({ precision: "country", countryIso3: "AFG" }), EMPTY_MARK_CONTEXT)).toBe("ring");
  });

  test("a line stays the line it is, whatever its level", () => {
    const line = { type: "LineString", coordinates: [[0, 0], [1, 1]] };
    expect(markOf(sig({ precision: "facility", geometry: line }), ctx)).toBe("pin");
  });

  test("a road notice's line is its own pattern, and only a line gets one", () => {
    const line = { type: "LineString", coordinates: [[0, 0], [1, 1]] };
    for (const style of ["dash", "dot", "bar"] as const) {
      const s = sig({ precision: "exact", geometry: line });
      expect(markOf({ ...s, meta: { ...s.meta, line: style } }, ctx)).toBe(style);
      // A notice TfL gave no line for is TfL's own point.
      const p = sig({ precision: "exact" });
      expect(markOf({ ...p, meta: { ...p.meta, line: style } }, ctx)).toBe("pin");
    }
    const s = sig({ precision: "exact", geometry: line });
    expect(markOf({ ...s, meta: { ...s.meta, line: "zigzag" } }, ctx)).toBe("pin");
  });

  test("an object with no level is a pin: guessing 'area' would hide a real point", () => {
    expect(markOf(sig({}), ctx)).toBe("pin");
  });
});

describe("never a pin for an area or a country", () => {
  test("no combination of level, code and outline gives an area or a country a pin", () => {
    const codes = [undefined, "AFG", "BHR", "ZZZ"];
    for (const precision of ["area", "country"] as const) {
      for (const countryIso3 of codes) {
        for (const c of [ctx, EMPTY_MARK_CONTEXT]) {
          const s = sig({ precision, countryIso3 });
          expect(markOf(s, c), `${precision} ${countryIso3}`).not.toBe("pin");
          // ...and the pin source, which is what the pin layers draw, does not hold it.
          expect(toSignalFC(pinSignals([s], c)).features).toHaveLength(0);
        }
      }
    }
  });

  test("every registered map layer: an area or country layer never reaches the pin source", () => {
    expect(MAP_SIGNALS.length).toBeGreaterThan(30);
    for (const source of MAP_SIGNALS) {
      const [feature] = withResolvedPrecision(
        [{ id: `${source.id}:t`, lat: 5, lon: 5, title: "T", signalId: source.id }],
        source,
      );
      const obj = buildSignalObject(feature, source.label);
      const pins = toSignalFC(pinSignals([obj], ctx)).features.length;
      const anchors = toSignalAnchorFC([obj], ctx).features.length;
      if (source.precision === "area" || source.precision === "country") {
        expect(pins, `${source.id} must not draw a pin`).toBe(0);
        expect(anchors, `${source.id} must draw an anchor mark`).toBe(1);
      } else {
        expect(pins, `${source.id} keeps its pin`).toBe(1);
        expect(anchors, `${source.id} draws no anchor mark`).toBe(0);
      }
    }
  });

  test("a real layer end to end: UNHCR displacement draws countries and rings, no pin", () => {
    const features = withResolvedPrecision(normalizeDisplacement(unhcrFixture as never), DISPLACEMENT_SOURCE);
    const objs = features.map((f) => buildSignalObject(f, DISPLACEMENT_SOURCE.label));
    expect(objs.length).toBeGreaterThan(0);
    expect(toSignalFC(pinSignals(objs, ctx)).features).toHaveLength(0);

    const anchors = toSignalAnchorFC(objs, ctx).features;
    expect(anchors).toHaveLength(objs.length);
    expect(new Set(anchors.map((f) => f.properties?.mark))).toEqual(new Set(["country"]));

    // Afghanistan: its own outline, and the UNHCR total as the figure.
    const shapes = toSignalCountryFC(objs, ctx).features;
    const afg = shapes.find((f) => f.properties?.id === "displacement:AFG");
    expect(afg?.geometry).toBe(OUTLINES.get("AFG"));
    expect(anchors.find((f) => f.properties?.id === "displacement:AFG")?.properties?.figure).toBe("3.2M");
  });
});

describe("the figure on a mark", () => {
  test("a layer with a metric prints the value of that metric", () => {
    const [f] = toSignalAnchorFC(
      [sig({ signalId: "displacement", precision: "country", countryIso3: "AFG", props: { displacedCount: 3_220_946 } })],
      ctx,
    ).features;
    expect(f.properties?.figure).toBe("3.2M");
    expect(f.properties?.weight).toBe(3_220_946);
  });

  test("a percent metric keeps its sign", () => {
    const [f] = toSignalAnchorFC(
      [sig({ signalId: "aurora", precision: "area", props: { probabilityPct: 22 } })],
      ctx,
    ).features;
    expect(f.properties?.mark).toBe("disc");
    expect(f.properties?.figure).toBe("22%");
  });

  test("a country layer with no metric prints how many features the country has, once", () => {
    // ReliefWeb publishes one feature for each emergency and declares no metric.
    expect(METRICS.reliefweb).toBeUndefined();
    const objs = [
      sig({ id: "reliefweb:1", signalId: "reliefweb", precision: "country", countryIso3: "SDN" }),
      sig({ id: "reliefweb:2", signalId: "reliefweb", precision: "country", countryIso3: "SDN" }),
      sig({ id: "reliefweb:3", signalId: "reliefweb", precision: "country", countryIso3: "TCD" }),
    ];
    const anchors = toSignalAnchorFC(objs, ctx).features;
    expect(anchors.map((f) => [f.properties?.id, f.properties?.figure])).toEqual([
      ["reliefweb:1", "2"],
      ["reliefweb:3", "1"],
    ]);
    expect(toSignalCountryFC(objs, ctx).features).toHaveLength(2);
  });

  test("an area layer with no metric prints nothing: one disc for each record", () => {
    expect(METRICS.crime).toBeUndefined();
    const anchors = toSignalAnchorFC(
      [sig({ id: "c:1", signalId: "crime", precision: "area" }), sig({ id: "c:2", signalId: "crime", precision: "area" })],
      ctx,
    ).features;
    expect(anchors.map((f) => f.properties?.figure)).toEqual(["", ""]);
  });

  test("formatFigure is short enough to print on a country", () => {
    expect(formatFigure(3_220_274)).toBe("3.2M");
    expect(formatFigure(10_000_000)).toBe("10M");
    expect(formatFigure(45_210)).toBe("45K");
    expect(formatFigure(1_300)).toBe("1.3K");
    expect(formatFigure(412)).toBe("412");
    expect(formatFigure(2.46)).toBe("2.5");
    expect(formatFigure(Number.NaN)).toBe("");
  });

  test("the ink of a figure is a darker tone of its layer colour", () => {
    expect(figureInk("#fbbf24")).toBe("#7e6012");
    expect(figureInk("#0e7490")).toBe("#073a48");
    expect(figureInk("not-a-colour")).toBe("#0f172a");
    expect(figureInk(undefined)).toBe("#0f172a");
  });
});

describe("the legend", () => {
  test("names every mark, and lists only the marks on the map", () => {
    for (const mark of SIGNAL_MARKS) {
      expect(MARK_LEGEND[mark].name.length).toBeGreaterThan(2);
      expect(MARK_LEGEND[mark].meaning.length).toBeGreaterThan(10);
    }
    expect(marksPresent([], ctx)).toEqual([]);
    expect(
      marksPresent(
        [
          sig({ precision: "country", countryIso3: "BHR" }),
          sig({ precision: "exact" }),
          sig({ precision: "country", countryIso3: "AFG" }),
        ],
        ctx,
      ),
    ).toEqual(["pin", "country", "ring"]);
  });
});

describe("clicks", () => {
  test("a disc, a ring and the target on a figure are click targets; the country shading is not", () => {
    for (const id of ["signal-area-discs", "signal-area-rings", "signal-area-hit"]) {
      expect(PIN_HIT_LAYERS, id).toContain(id);
    }
    expect(PIN_HIT_LAYERS).not.toContain("signal-country-fill");
  });

  test("a click on the shading still opens the country; a click on the figure opens the signal", () => {
    const country = { layer: "country-fill" };
    expect(resolveMapClickTarget([{ layer: "signal-country-fill", signalId: "displacement" }, country])).toBe("country");
    expect(resolveMapClickTarget([{ layer: "signal-area-hit", signalId: "displacement" }, country])).toBe("pin");
  });
});

describe("WorldMap wiring", () => {
  // The pure functions above are only the rule if the map uses them. This reads the
  // component's source: every feed into the pin source must pass through pinSignals,
  // or one edit puts every country figure back on a pin with all tests above green.
  const src = readFileSync(join(root, "components", "WorldMap.tsx"), "utf8");

  test("the pin source is only ever fed through pinSignals", () => {
    const calls = src.match(/toSignalFC\(([^)]*)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) expect(call, call).toMatch(/^toSignalFC\(pinSignals\(/);
  });

  test("the layer ids in the map match the ids the click arbiter knows", () => {
    // The ids moved out of WorldMap into lib/map/signalLayerIds.ts (values unchanged) so the
    // God's eye view can name them too: the map must still import them from there.
    const ids = readFileSync(join(root, "lib", "map", "signalLayerIds.ts"), "utf8");
    expect(src).toContain('from "@/lib/map/signalLayerIds"');
    for (const id of ["signal-area-discs", "signal-area-rings", "signal-area-hit", "signal-country-fill"]) {
      expect(ids, id).toContain(`"${id}"`);
    }
    // And the map still names each of them, by their constants.
    for (const name of ["SIGNAL_DISC_LAYER", "SIGNAL_RING_LAYER", "SIGNAL_ANCHOR_HIT", "SIGNAL_COUNTRY_FILL"]) {
      expect(src, name).toContain(name);
    }
  });
});

describe("the diamond pin and the hatched area (war sources, 2026-10-30)", () => {
  const hex = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
  const withMeta = (s: WorldObject, extra: Record<string, unknown>): WorldObject => ({ ...s, meta: { ...s.meta, ...extra } });

  test("a diamond is a pin drawn as a diamond, and it still reaches the pin source", () => {
    const d = withMeta(sig({ precision: "exact" }), { shape: "diamond" });
    expect(markOf(d, ctx)).toBe("diamond");
    const [f] = toSignalFC(pinSignals([d], ctx)).features;
    expect(f.properties?.shape).toBe("diamond");
    expect(toSignalFC(pinSignals([sig({ precision: "exact" })], ctx)).features[0].properties?.shape).toBe("round");
  });

  test("only a pin can be a diamond: an area or a country with shape 'diamond' is never a pin", () => {
    for (const precision of ["area", "country"] as const) {
      const d = withMeta(sig({ precision, countryIso3: "AFG" }), { shape: "diamond" });
      expect(markOf(d, ctx), precision).not.toBe("diamond");
      expect(markOf(d, ctx), precision).not.toBe("pin");
      expect(toSignalFC(pinSignals([d], ctx)).features).toHaveLength(0);
    }
  });

  test("a hatched polygon is its own mark, and only a polygon can be hatched", () => {
    const h = withMeta(sig({ precision: "area", geometry: hex }), { fill: "hatch" });
    expect(markOf(h, ctx)).toBe("hatch");
    expect(toSignalFillFC([h]).features[0].properties?.fill).toBe("hatch");
    expect(toSignalFillFC([sig({ precision: "area", geometry: hex })]).features[0].properties?.fill).toBe("flat");
    // On anything but a polygon the field is ignored.
    expect(markOf(withMeta(sig({ precision: "area" }), { fill: "hatch" }), ctx)).toBe("disc");
    expect(markOf(withMeta(sig({ precision: "exact" }), { fill: "hatch" }), ctx)).toBe("pin");
  });

  test("toSignalObjects carries both fields from the feature to the map object", () => {
    const source = MAP_SIGNALS[0];
    const [obj] = toSignalObjects(
      [{ id: "x:1", lat: 1, lon: 1, title: "T", signalId: source.id, shape: "diamond", fill: "hatch" }],
      source,
    );
    expect(obj.meta?.shape).toBe("diamond");
    expect(obj.meta?.fill).toBe("hatch");
    const [plain] = toSignalObjects([{ id: "x:2", lat: 1, lon: 1, title: "T", signalId: source.id }], source);
    expect(plain.meta).not.toHaveProperty("shape");
    expect(plain.meta).not.toHaveProperty("fill");
  });

  test("the legend names both, and lists them only when they are on the map", () => {
    expect(SIGNAL_MARKS).toContain("diamond");
    expect(SIGNAL_MARKS).toContain("hatch");
    const marks = marksPresent(
      [withMeta(sig({ precision: "exact" }), { shape: "diamond" }), withMeta(sig({ precision: "area", geometry: hex }), { fill: "hatch" })],
      ctx,
    );
    expect(marks).toEqual(["diamond", "hatch"]);
  });

  test("WorldMap draws them: lines over an untinted fill, a diamond over a transparent circle", () => {
    const src = readFileSync(join(root, "components", "WorldMap.tsx"), "utf8");
    // The fill leaves a hatched area untinted, and stays its click target.
    expect(src).toContain('"fill-opacity": ["case", ["==", ["get", "fill"], "hatch"], 0, 0.28]');
    expect(src).toMatch(/id: SIGNAL_FILL_HATCH,[\s\S]{0,200}filter: \["==", \["get", "fill"\], "hatch"\]/);
    expect(src).toContain('"fill-pattern": ["concat", HATCH_IMAGE_PREFIX, ["get", "color"]]');
    // The circle of a diamond is transparent and still under the click handler.
    expect(src).toContain('"circle-opacity": ["case", ["==", ["get", "shape"], "diamond"], 0, 0.82]');
    expect(src).toMatch(/id: SIGNAL_DIAMOND_LAYER,[\s\S]{0,200}filter: \["==", \["get", "shape"\], "diamond"\]/);
    // Both images are drawn when the style asks for them.
    expect(src).toContain("addHatchImage(map, e.id)");
    expect(src).toContain("addDiamondImage(map, e.id)");
    // Neither new layer is a source of its own: the fade and the glow (sourceHighlight) cover them.
    expect(src).toMatch(/id: SIGNAL_FILL_HATCH,\s*type: "fill",\s*source: SIGNAL_FILL_SRC/);
    expect(src).toMatch(/id: SIGNAL_DIAMOND_LAYER,\s*type: "symbol",\s*source: SIGNAL_SRC/);
  });
});
