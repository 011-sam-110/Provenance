import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
  FADE,
  HIGHLIGHT_STATE_KEY,
  NEVER_FADE_SOURCES,
  OPACITY_PROPS,
  SOURCE_OWNERS,
  applySourceHighlight,
  ownerMatch,
  presentIds,
  wrapOpacity,
  type Expr,
  type HighlightMap,
} from "@/lib/map/sourceHighlight";

const root = join(__dirname, "..", "..");
const H = ["global-state", "srcHover"];
const IDLE = ["==", ["length", H], 0];
const MINE: Expr = ["in", ["get", "signalId"], H];

describe("wrapOpacity", () => {
  test("a number folds to a literal: unchanged when idle or lit, 15% otherwise", () => {
    expect(wrapOpacity(0.5, MINE)).toEqual(["case", IDLE, 0.5, MINE, 0.5, 0.075]);
    expect(wrapOpacity(1, MINE)).toEqual(["case", IDLE, 1, MINE, 1, FADE]);
  });

  test("a property the layer leaves at its default counts as 1", () => {
    expect(wrapOpacity(undefined, MINE)).toEqual(["case", IDLE, 1, MINE, 1, FADE]);
  });

  test("an interpolate over zoom keeps ['zoom'] and its stops, and wraps only the outputs", () => {
    // camera-dots' real curve (components/WorldMap.tsx).
    const curve = ["interpolate", ["linear"], ["zoom"], 0, 0.45, 3, 0.6, 6, 0.75, 10, 0.75, 12, 0];
    const out = wrapOpacity(curve, MINE) as unknown[];
    expect(out).not.toBe(curve);
    expect(out.slice(0, 3)).toEqual(["interpolate", ["linear"], ["zoom"]]);
    // The inputs (indexes 3, 5, 7, ...) are still the literal numbers.
    for (const i of [3, 5, 7, 9, 11]) expect(out[i]).toBe(curve[i]);
    // The outputs (4, 6, 8, ...) are the fade of each stop.
    for (const i of [4, 6, 8, 10, 12]) expect(out[i]).toEqual(["case", IDLE, curve[i], MINE, curve[i], +((curve[i] as number) * FADE).toFixed(4)]);
    // The curve is not wrapped as a whole.
    expect(out[0]).toBe("interpolate");
  });

  test("an exponential interpolate over zoom is treated the same way", () => {
    const out = wrapOpacity(["interpolate", ["exponential", 2], ["zoom"], 6, 0, 9, 0.5], MINE) as unknown[];
    expect(out.slice(0, 4)).toEqual(["interpolate", ["exponential", 2], ["zoom"], 6]);
    expect(out[5]).toBe(9);
    expect(out[4]).toEqual(["case", IDLE, 0, MINE, 0, 0]);
    expect(out[6]).toEqual(["case", IDLE, 0.5, MINE, 0.5, 0.075]);
  });

  test("a step over zoom wraps the outputs at 2, 4, 6 and never the inputs", () => {
    const step = ["step", ["zoom"], 0.2, 5, 0.6, 9, 1];
    const out = wrapOpacity(step, MINE) as unknown[];
    expect(out.slice(0, 2)).toEqual(["step", ["zoom"]]);
    expect(out[3]).toBe(5);
    expect(out[5]).toBe(9);
    expect(out[2]).toEqual(["case", IDLE, 0.2, MINE, 0.2, 0.03]);
    expect(out[4]).toEqual(["case", IDLE, 0.6, MINE, 0.6, 0.09]);
    expect(out[6]).toEqual(["case", IDLE, 1, MINE, 1, FADE]);
  });

  test("a data-driven expression is multiplied by 15% as a whole", () => {
    const base = ["case", ["get", "available"], 1, 0.45]; // camera-markers
    expect(wrapOpacity(base, MINE)).toEqual(["case", IDLE, base, MINE, base, ["*", FADE, base]]);
    // A feature-state hover is the same case (country-fill).
    const hover = ["case", ["boolean", ["feature-state", "hover"], false], 0.12, 0];
    expect(wrapOpacity(hover, MINE)).toEqual(["case", IDLE, hover, MINE, hover, ["*", FADE, hover]]);
  });

  test("an already wrapped value comes back as the same reference", () => {
    const once = wrapOpacity(0.5, MINE);
    expect(wrapOpacity(once, MINE)).toBe(once);
    const curve = wrapOpacity(["interpolate", ["linear"], ["zoom"], 0, 0.45, 12, 0], MINE);
    expect(wrapOpacity(curve, MINE)).toBe(curve);
  });

  test("a legacy function object is left alone", () => {
    const legacy = { stops: [[0, 0.2], [10, 1]] };
    expect(wrapOpacity(legacy, MINE)).toBe(legacy);
  });
});

describe("wrapOpacity is accepted by MapLibre's own style validator", () => {
  // The unit tests above pin the SHAPE. This one asks the real validator, because the
  // rule that matters ("zoom may only be input to a top-level step or interpolate") is
  // MapLibre's, and it rejects the layer rather than throwing a useful error.
  const validate = (paint: Record<string, unknown>) =>
    validateStyleMin({
      version: 8,
      state: { [HIGHLIGHT_STATE_KEY]: { default: [] } },
      sources: { s: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: [{ id: "a", type: "circle", source: "s", paint }],
    } as never);

  test("each real opacity shape in WorldMap passes once wrapped", () => {
    const shapes: unknown[] = [
      0.45,
      ["interpolate", ["linear"], ["zoom"], 0, 0.45, 3, 0.6, 6, 0.75, 10, 0.75, 12, 0],
      ["interpolate", ["linear"], ["zoom"], 6, 0, 9, 0.5],
      ["case", ["get", "available"], 1, 0.45],
      ["case", ["boolean", ["feature-state", "hover"], false], 0.12, 0],
      ["step", ["zoom"], 0.2, 5, 0.6],
    ];
    for (const shape of shapes) {
      expect(validate({ "circle-opacity": wrapOpacity(shape, MINE) }), JSON.stringify(shape)).toEqual([]);
    }
  });

  test("the validator does reject a wrapped whole curve, which is what the rule is for", () => {
    const curve = ["interpolate", ["linear"], ["zoom"], 0, 0.45, 12, 0];
    const wholeCurve = ["case", IDLE, curve, MINE, curve, ["*", FADE, curve]];
    expect(validate({ "circle-opacity": wholeCurve }).length).toBeGreaterThan(0);
  });
});

describe("ownerMatch", () => {
  test("the five signal sources match a feature's signalId against the lit ids", () => {
    for (const id of ["signals", "signal-lines", "signal-fills", "signal-country-shapes", "signal-area-marks"]) {
      expect(ownerMatch(id), id).toEqual(["in", ["get", "signalId"], H]);
    }
  });

  test("cameras split Live cams and Static cams by the feed property", () => {
    expect(ownerMatch("cameras")).toEqual([
      "any",
      ["all", ["in", "livecams", H], ["==", ["get", "feed"], "video"]],
      ["all", ["in", "staticcams", H], ["==", ["get", "feed"], "still"]],
    ]);
  });

  test("a whole-source owner matches its own rail key", () => {
    expect(ownerMatch("webcams")).toEqual(["in", "staticcams", H]);
    expect(ownerMatch("planes")).toEqual(["in", "planes", H]);
    expect(ownerMatch("trails")).toEqual(["in", "planes", H]);
    expect(ownerMatch("satellites")).toEqual(["in", "satellites", H]);
    expect(ownerMatch("country-polys")).toEqual(["in", "countries", H]);
    expect(ownerMatch("country-label-pts")).toEqual(["in", "countries", H]);
  });

  test("every source in the owner table has a match, and every never-fade source has none", () => {
    for (const id of Object.keys(SOURCE_OWNERS)) expect(ownerMatch(id), id).not.toBeNull();
    for (const id of NEVER_FADE_SOURCES) expect(ownerMatch(id), id).toBeNull();
    expect(ownerMatch("some-basemap-source")).toBeNull();
  });
});

describe("every map source is classed", () => {
  // The same guard as precision-marks.test.ts's WorldMap wiring: a source that nobody
  // classed would draw at full strength under a hover (or fade when it should not), and
  // every other test here would stay green.
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const idsIn = (src: string, re: RegExp) => [...src.matchAll(re)].map((m) => m[1]);

  const worldMap = idsIn(read("components/WorldMap.tsx"), /const\s+[A-Z_]+_SRC\s*=\s*"([^"]+)"/g);
  const aoi = idsIn(read("lib/map/aoi.ts"), /const\s+[A-Z_]+_SRC\s*=\s*"([^"]+)"/g);
  const buildings = idsIn(read("lib/map/buildings.ts"), /export const BUILDING_SRC\s*=\s*"([^"]+)"/g);

  test("the scan finds the sources it is meant to", () => {
    expect(worldMap.length).toBeGreaterThanOrEqual(19);
    expect(aoi).toHaveLength(3);
    expect(buildings).toEqual(["tn-buildings"]);
  });

  test("each is either in SOURCE_OWNERS or in NEVER_FADE_SOURCES, and never both", () => {
    for (const id of [...worldMap, ...aoi, ...buildings]) {
      const fades = id in SOURCE_OWNERS;
      const stays = NEVER_FADE_SOURCES.includes(id);
      expect(fades || stays, `${id} is not classed in lib/map/sourceHighlight.ts`).toBe(true);
      expect(fades && stays, `${id} is classed twice`).toBe(false);
    }
  });

  test("nothing in either table names a source the map no longer has", () => {
    const all = new Set([...worldMap, ...aoi, ...buildings]);
    for (const id of [...Object.keys(SOURCE_OWNERS), ...NEVER_FADE_SOURCES]) {
      expect(all.has(id), `${id} is classed but is not a map source`).toBe(true);
    }
  });
});

describe("applySourceHighlight", () => {
  type Layer = { id: string; type: string; source?: string };
  const camCurve = ["interpolate", ["linear"], ["zoom"], 0, 0.45, 3, 0.6, 6, 0.75, 10, 0.75, 12, 0];

  function fakeMap() {
    const calls: string[] = [];
    const layers: Layer[] = [
      { id: "signal-dots", type: "circle", source: "signals" },
      { id: "signal-icons", type: "symbol", source: "signals" },
      { id: "camera-dots", type: "circle", source: "cameras" },
      { id: "country-borders", type: "line", source: "country-polys" },
      { id: "user-pin-dots", type: "circle", source: "user-pins" },
      { id: "aoi-fill", type: "fill", source: "aoi-areas" },
      { id: "hillshade", type: "hillshade", source: "terrain-dem" },
      { id: "basemap-water", type: "fill", source: "carto" },
      { id: "background", type: "background" },
    ];
    const paint = new Map<string, unknown>([
      ["signal-dots.circle-opacity", 0.82],
      ["camera-dots.circle-opacity", camCurve],
      ["country-borders.line-opacity", 0.32],
      ["user-pin-dots.circle-opacity", 0.95],
      ["aoi-fill.fill-opacity", 0.2],
      ["basemap-water.fill-opacity", 1],
    ]);
    const map: HighlightMap = {
      setGlobalStateProperty(name, value) {
        calls.push(`state:${name}=${JSON.stringify(value)}`);
      },
      getStyle: () => ({ layers }),
      getPaintProperty: (id, prop) => paint.get(`${id}.${prop}`),
      setPaintProperty(id, prop, value) {
        calls.push(`paint:${id}.${prop}`);
        paint.set(`${id}.${prop}`, value);
      },
    };
    return { map, calls, paint };
  }

  test("sets the state before the first paint write", () => {
    const { map, calls } = fakeMap();
    applySourceHighlight(map, ["earthquakes"]);
    expect(calls[0]).toBe('state:srcHover=["earthquakes"]');
    expect(calls.slice(1).every((c) => c.startsWith("paint:"))).toBe(true);
    expect(calls.length).toBeGreaterThan(1);
  });

  test("wraps every opacity property of every fading layer, by layer type", () => {
    const { map, calls, paint } = fakeMap();
    const n = applySourceHighlight(map, []);
    expect(n).toBe(calls.filter((c) => c.startsWith("paint:")).length);
    for (const prop of OPACITY_PROPS.circle) expect(paint.get(`signal-dots.${prop}`)).toBeDefined();
    for (const prop of OPACITY_PROPS.symbol) expect(paint.get(`signal-icons.${prop}`)).toBeDefined();
    expect(JSON.stringify(paint.get("country-borders.line-opacity"))).toContain("global-state");
    // The camera curve keeps ["zoom"] at the top level.
    expect((paint.get("camera-dots.circle-opacity") as unknown[])[0]).toBe("interpolate");
  });

  test("never touches a never-fade layer, a basemap layer, or a type with no opacity prop", () => {
    const { map, calls } = fakeMap();
    applySourceHighlight(map, ["earthquakes"]);
    for (const id of ["user-pin-dots", "aoi-fill", "hillshade", "basemap-water", "background"]) {
      expect(calls.filter((c) => c.includes(id)), id).toEqual([]);
    }
  });

  test("a second call writes the state again and no paint property", () => {
    const { map, calls } = fakeMap();
    applySourceHighlight(map, ["earthquakes"]);
    calls.length = 0;
    expect(applySourceHighlight(map, ["wildfires"])).toBe(0);
    expect(calls).toEqual(['state:srcHover=["wildfires"]']);
  });

  test("a style torn down mid-swap does not throw", () => {
    const { map } = fakeMap();
    map.setPaintProperty = () => {
      throw new Error("Style is not done loading");
    };
    expect(() => applySourceHighlight(map, [])).not.toThrow();
    map.setGlobalStateProperty = () => {
      throw new Error("no style");
    };
    expect(applySourceHighlight(map, [])).toBe(0);
  });
});

describe("presentIds", () => {
  test("keeps the ids that have a mark, in order", () => {
    const has = (id: string) => id !== "aurora";
    expect(presentIds(["earthquakes", "aurora", "wildfires"], has)).toEqual(["earthquakes", "wildfires"]);
    expect(presentIds([], has)).toEqual([]);
    expect(presentIds(["aurora"], has)).toEqual([]);
  });
});
