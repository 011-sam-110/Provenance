import { describe, expect, test } from "vitest";
import { toSignalObjects } from "@/lib/map/signalObjects";
import type { SignalFeature, SignalSource } from "@/lib/signals/types";

// toSignalObjects is the ONE conversion behind both a switched-on layer (WorldMap's
// SignalFeed) and the Sources rail's preview of a switched-off one. A preview looks
// exactly like the real thing only while both go through this function, so the fields
// are pinned here one by one.

const source = {
  id: "demo",
  label: "Demo layer",
  group: "Natural hazards",
  color: "#112233",
  precision: "area",
  refreshMs: 60_000,
  attribution: "Demo Agency (CC BY 4.0)",
  sourceUrl: "https://demo.example/data",
} as unknown as SignalSource;

const full: SignalFeature = {
  id: "demo:1",
  lat: 12.5,
  lon: -45.25,
  title: "A thing",
  signalId: "demo",
  precision: "exact",
  countryIso3: "FRA",
  geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
  line: "dash",
  color: "#abcdef",
  props: { magnitude: 4.2 },
  link: "https://demo.example/1",
  ts: "2026-10-29T10:00:00Z",
};

describe("toSignalObjects", () => {
  test("gives every field a drawn signal carries", () => {
    const [o] = toSignalObjects([full], source);
    expect(o).toEqual({
      kind: "signal",
      id: "demo:1",
      lat: 12.5,
      lon: -45.25,
      label: "A thing",
      color: "#abcdef",
      typeLabel: "Demo layer",
      meta: {
        signalId: "demo",
        precision: "exact",
        countryIso3: "FRA",
        props: { magnitude: 4.2 },
        attribution: "Demo Agency (CC BY 4.0)",
        sourceLabel: "Demo layer",
        link: "https://demo.example/1",
        sourceUrl: "https://demo.example/data",
        ts: "2026-10-29T10:00:00Z",
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        line: "dash",
      },
    });
  });

  test("a feature with no colour takes its layer's", () => {
    const { color: _color, ...bare } = full;
    expect(toSignalObjects([bare], source)[0].color).toBe("#112233");
  });

  test("props default to an empty object", () => {
    const { props: _props, ...bare } = full;
    expect(toSignalObjects([bare], source)[0].meta?.props).toEqual({});
  });

  test("precision is the feature's own when valid, else the layer's", () => {
    expect(toSignalObjects([full], source)[0].meta?.precision).toBe("exact");
    const { precision: _p, ...bare } = full;
    expect(toSignalObjects([bare], source)[0].meta?.precision).toBe("area");
    expect(toSignalObjects([{ ...full, precision: "nonsense" as never }], source)[0].meta?.precision).toBe("area");
  });

  test("countryIso3, geometry and line are present only when the feature has them", () => {
    const point: SignalFeature = { id: "demo:2", lat: 1, lon: 2, title: "p", signalId: "demo" };
    const meta = toSignalObjects([point], source)[0].meta as Record<string, unknown>;
    expect("countryIso3" in meta).toBe(false);
    expect("geometry" in meta).toBe(false);
    expect("line" in meta).toBe(false);
    // ...and the always-present keys are still there, undefined where the feature has none.
    expect(Object.keys(meta)).toEqual(
      expect.arrayContaining(["signalId", "precision", "props", "attribution", "sourceLabel", "link", "sourceUrl", "ts"]),
    );
  });

  test("keeps the order of the rows, and an empty list gives an empty list", () => {
    const rows = [full, { ...full, id: "demo:3" }, { ...full, id: "demo:4" }];
    expect(toSignalObjects(rows, source).map((o) => o.id)).toEqual(["demo:1", "demo:3", "demo:4"]);
    expect(toSignalObjects([], source)).toEqual([]);
  });
});
