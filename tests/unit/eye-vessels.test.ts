import { describe, expect, it } from "vitest";
import london from "@/tests/fixtures/eye-ais-london.json";
import {
  BOX_GRID,
  EYE_VESSEL_CAP,
  MAX_SPAN,
  VIEW_PAD,
  boxAround,
  clampBox,
  eyeVesselsBody,
  inBox,
  inFrame,
  nearestFirst,
  needsReload,
  parseBox,
  snapBox,
  viewRadius,
  type Box,
} from "@/lib/eye/vessels";
import { toVessel, type AisFeatureLike } from "@/lib/eye/traffic";
import { vesselFeature, type AisVessel } from "@/lib/signals/ais";

describe("parseBox", () => {
  it("reads four numbers, west to north", () => {
    expect(parseBox("-0.2,51.4,0.1,51.6")).toEqual([-0.2, 51.4, 0.1, 51.6]);
    expect(parseBox(" 1 , 2 , 3 , 4 ")).toEqual([1, 2, 3, 4]);
    expect(parseBox("-180,-90,180,90")).toEqual([-180, -90, 180, 90]);
  });

  it("refuses anything else", () => {
    expect(parseBox(null)).toBeNull();
    expect(parseBox("")).toBeNull();
    expect(parseBox("1,2,3")).toBeNull();
    expect(parseBox("1,2,3,4,5")).toBeNull();
    expect(parseBox("1,2,3,x")).toBeNull();
    expect(parseBox("1,2,NaN,4")).toBeNull();
    expect(parseBox("1,2,Infinity,4")).toBeNull();
    // An empty part is not a zero.
    expect(parseBox("0,,1,2")).toBeNull();
    expect(parseBox(",,,")).toBeNull();
  });

  it("refuses a box that is empty, upside down, or wraps the antimeridian", () => {
    expect(parseBox("1,2,1,4")).toBeNull();
    expect(parseBox("3,2,1,4")).toBeNull();
    expect(parseBox("1,4,3,2")).toBeNull();
    expect(parseBox("179,10,-179,11")).toBeNull();
  });

  it("refuses a latitude past 90 or a longitude past 180", () => {
    expect(parseBox("0,-91,1,0")).toBeNull();
    expect(parseBox("0,0,1,90.5")).toBeNull();
    expect(parseBox("-181,0,0,1")).toBeNull();
    expect(parseBox("0,0,180.1,1")).toBeNull();
  });
});

describe("snapBox", () => {
  it("grows the box outward to the 0.01 degree grid", () => {
    expect(snapBox([-0.1234, 51.4561, 0.0412, 51.5999])).toEqual([-0.13, 51.45, 0.05, 51.6]);
    for (const n of snapBox([24.912345, 60.1234, 25.0111, 60.2222])) {
      expect(Math.round(n * 100) / 100).toBe(n);
    }
  });

  it("never shrinks the box", () => {
    const b: Box = [24.9101, 60.1501, 24.9899, 60.1899];
    const s = snapBox(b);
    expect(s[0]).toBeLessThanOrEqual(b[0]);
    expect(s[1]).toBeLessThanOrEqual(b[1]);
    expect(s[2]).toBeGreaterThanOrEqual(b[2]);
    expect(s[3]).toBeGreaterThanOrEqual(b[3]);
  });

  it("leaves a box already on the grid alone, so asking again for an answer's box cannot grow it", () => {
    const once = snapBox([-0.1234, 51.4561, 0.0412, 51.5999]);
    expect(snapBox(once)).toEqual(once);
    // 0.29 * 100 is 28.999999999999996: the float noise must not cost a cell.
    expect(snapBox([0.29, 0.57, 0.58, 1.15])).toEqual([0.29, 0.57, 0.58, 1.15]);
  });

  it("stays on the globe", () => {
    expect(snapBox([-180, -90, 180, 90])).toEqual([-180, -90, 180, 90]);
    expect(snapBox([179.999, 89.999, 180, 90])).toEqual([179.99, 89.99, 180, 90]);
  });

  it("gives two visitors at the same place the same URL", () => {
    const a = snapBox([-0.1201, 51.4501, 0.0101, 51.5499]).join(",");
    const b = snapBox([-0.1299, 51.4599, 0.0199, 51.5401]).join(",");
    expect(a).toBe(b);
  });
});

describe("clampBox", () => {
  it("leaves a small box as it came", () => {
    const b: Box = [24.9, 60.1, 25.1, 60.3];
    expect(clampBox(b)).toEqual({ box: b, clamped: false });
    // Exactly the limit is not over it.
    expect(clampBox([0, 0, 2, 1])).toEqual({ box: [0, 0, 2, 1], clamped: false });
  });

  it("cuts a wide box to the limit about its centre and says so", () => {
    const { box, clamped } = clampBox([-5, 48, 7, 56]);
    expect(clamped).toBe(true);
    expect(box[2] - box[0]).toBeCloseTo(MAX_SPAN.lon, 9);
    expect(box[3] - box[1]).toBeCloseTo(MAX_SPAN.lat, 9);
    // Centre (1, 52) kept.
    expect((box[0] + box[2]) / 2).toBeCloseTo(1, 9);
    expect((box[1] + box[3]) / 2).toBeCloseTo(52, 9);
  });

  it("limits one axis at a time", () => {
    const wide = clampBox([0, 50, 5, 50.4]);
    expect(wide.clamped).toBe(true);
    expect(wide.box[1]).toBe(50);
    expect(wide.box[3]).toBe(50.4);
    expect(wide.box[2] - wide.box[0]).toBeCloseTo(2, 9);
    expect((wide.box[0] + wide.box[2]) / 2).toBeCloseTo(2.5, 9);
    const tall = clampBox([10, 40, 10.5, 45]);
    expect(tall.clamped).toBe(true);
    expect(tall.box[0]).toBe(10);
    expect(tall.box[2]).toBe(10.5);
    expect(tall.box[3] - tall.box[1]).toBeCloseTo(1, 9);
  });

  it("lands a cut box on the grid and stays on the globe", () => {
    const { box } = clampBox(snapBox([-0.50123, 51.01234, 0.40321, 52.99999]));
    for (const n of box) expect(Math.abs(n * 100 - Math.round(n * 100))).toBeLessThan(1e-9);
    const edge = clampBox([178, 80, 180, 90]);
    expect(edge.box[2]).toBeLessThanOrEqual(180);
    expect(edge.box[3]).toBeLessThanOrEqual(90);
    const world = clampBox([-180, -90, 180, 90]);
    expect(world.clamped).toBe(true);
    expect(world.box).toEqual([-1, -0.5, 1, 0.5]);
  });

  it("is idempotent: the box an answer carries is the box that would be asked for again", () => {
    const first = clampBox(snapBox([-3.1234, 49.5678, 4.4321, 53.1234])).box;
    const again = clampBox(snapBox(first));
    expect(again.box).toEqual(first);
    expect(again.clamped).toBe(false);
  });
});

describe("viewRadius and boxAround", () => {
  const centre = { lat: 51.5, lon: -0.1 };
  const k = Math.cos((centre.lat * Math.PI) / 180);
  /** Corner offsets in ground degrees (x east, y north) turned by `bearing`, as latitudes and longitudes. */
  const corners = (bearing: number, offsets: [number, number][]) => {
    const a = (bearing * Math.PI) / 180;
    return offsets.map(([x, y]) => ({
      lat: centre.lat + x * Math.sin(a) + y * Math.cos(a),
      lon: centre.lon + (x * Math.cos(a) - y * Math.sin(a)) / k,
    }));
  };
  // A wide, tilted view: the two far corners reach farther than the two near ones.
  const TILTED: [number, number][] = [[-0.13, 0.11], [0.13, 0.11], [0.06, -0.04], [-0.06, -0.04]];

  it("is the farthest corner's reach, padded, as the same ground distance in latitude and longitude", () => {
    const r = viewRadius(centre, corners(0, TILTED));
    const far = Math.hypot(0.13, 0.11);
    expect(r.lat).toBeCloseTo(far * VIEW_PAD, 12);
    expect(r.lon).toBeCloseTo((far * VIEW_PAD) / k, 12);
  });

  it("does not depend on the order of the corners", () => {
    const c = corners(0, TILTED);
    expect(viewRadius(centre, [...c].reverse())).toEqual(viewRadius(centre, c));
  });

  it("does not depend on the bearing: a turn in place asks for the same box, whichever way the view points", () => {
    const r0 = viewRadius(centre, corners(0, TILTED));
    const loaded = boxAround(centre, r0);
    for (let bearing = 0; bearing < 360; bearing += 7.5) {
      const r = viewRadius(centre, corners(bearing, TILTED));
      expect(r.lat).toBeCloseTo(r0.lat, 9);
      expect(r.lon).toBeCloseTo(r0.lon, 9);
      expect(needsReload(loaded, centre, r)).toBe(false);
    }
  });

  it("takes the short way round the antimeridian", () => {
    const r = viewRadius({ lat: 0, lon: 179.95 }, [{ lat: 0, lon: -179.95 }]);
    expect(r.lon).toBeCloseTo(0.1 * VIEW_PAD, 9);
  });

  it("asks for a snapped box that holds the view", () => {
    const box = boxAround(centre, { lat: 0.05, lon: 0.1 });
    expect(box).toEqual([-0.2, 51.45, 0, 51.55]);
    expect(inBox(51.5, -0.1, box)).toBe(true);
  });

  it("is capped to the widest answer", () => {
    const box = boxAround(centre, { lat: 3, lon: 6 });
    expect(box[2] - box[0]).toBeCloseTo(MAX_SPAN.lon, 9);
    expect(box[3] - box[1]).toBeCloseTo(MAX_SPAN.lat, 9);
    expect(inBox(centre.lat, centre.lon, box)).toBe(true);
  });

  it("still asks for a box when the view has no size yet, and keeps the globe's edges", () => {
    const box = boxAround(centre, { lat: 0, lon: 0 });
    expect(box[2] - box[0]).toBeGreaterThanOrEqual(BOX_GRID);
    expect(box[3] - box[1]).toBeGreaterThanOrEqual(BOX_GRID);
    expect(parseBox(box.join(","))).not.toBeNull();
    // A centre carried into a copy of the world is brought back.
    const copy = boxAround({ lat: 10, lon: 540.5 }, { lat: 0.1, lon: 0.1 });
    expect(copy[0]).toBeCloseTo(-179.6, 9);
    expect(parseBox(copy.join(","))).not.toBeNull();
    const pole = boxAround({ lat: 89.99, lon: 0 }, { lat: 0.5, lon: 0.5 });
    expect(pole[3]).toBeLessThanOrEqual(90);
  });
});

describe("needsReload", () => {
  const centre = { lat: 51.5, lon: -0.1 };
  const radius = { lat: 0.05, lon: 0.1 };
  const loaded = boxAround(centre, { lat: 0.06, lon: 0.12 });

  it("asks when nothing is loaded", () => {
    expect(needsReload(null, centre, radius)).toBe(true);
  });

  it("does not ask while the view is inside what is loaded", () => {
    expect(needsReload(loaded, centre, radius)).toBe(false);
    expect(needsReload(loaded, { lat: 51.505, lon: -0.1 }, radius)).toBe(false);
  });

  it("asks once a pan takes the view out", () => {
    expect(needsReload(loaded, { lat: 51.5, lon: -0.1 + 0.06 }, radius)).toBe(true);
    expect(needsReload(loaded, { lat: 51.5 + 0.03, lon: -0.1 }, radius)).toBe(true);
  });

  it("asks once a zoom out takes the view out", () => {
    expect(needsReload(loaded, centre, { lat: 0.2, lon: 0.4 })).toBe(true);
  });

  it("holds still on a clamped view, for the box the answer carried", () => {
    const wide = { lat: 3, lon: 6 };
    const asked = boxAround(centre, wide);
    // The server cuts and snaps what it is sent; the answer's box is the same box.
    const answered = clampBox(snapBox(asked)).box;
    expect(answered).toEqual(asked);
    expect(needsReload(answered, centre, wide)).toBe(false);
  });
});

describe("inBox and inFrame", () => {
  it("counts the edges in", () => {
    const b: Box = [0, 50, 1, 51];
    expect(inBox(50, 0, b)).toBe(true);
    expect(inBox(51, 1, b)).toBe(true);
    expect(inBox(51.0001, 0.5, b)).toBe(false);
    expect(inBox(50.5, -0.0001, b)).toBe(false);
  });

  it("inFrame is the canvas", () => {
    expect(inFrame(0, 0, 800, 600)).toBe(true);
    expect(inFrame(800, 600, 800, 600)).toBe(true);
    expect(inFrame(400, 300, 800, 600)).toBe(true);
    expect(inFrame(-1, 300, 800, 600)).toBe(false);
    expect(inFrame(400, 601, 800, 600)).toBe(false);
    expect(inFrame(Number.NaN, 10, 800, 600)).toBe(false);
  });
});

describe("nearestFirst", () => {
  it("orders by flat distance and does not change the list it was given", () => {
    const items = [
      { id: "far", lat: 51.9, lon: 0 },
      { id: "near", lat: 51.5, lon: 0.001 },
      { id: "mid", lat: 51.6, lon: 0 },
    ];
    const out = nearestFirst(items, { lat: 51.5, lon: 0 });
    expect(out.map((x) => x.id)).toEqual(["near", "mid", "far"]);
    expect(items.map((x) => x.id)).toEqual(["far", "near", "mid"]);
  });

  it("shortens a degree of longitude by the cosine of the latitude", () => {
    // At 60 N a degree of longitude is half a degree of latitude.
    const items = [
      { id: "north", lat: 60.6, lon: 10 },
      { id: "east", lat: 60, lon: 11 },
    ];
    expect(nearestFirst(items, { lat: 60, lon: 10 }).map((x) => x.id)).toEqual(["east", "north"]);
  });

  it("keeps the given order for a tie", () => {
    const items = [{ id: "a", lat: 1, lon: 1 }, { id: "b", lat: 1, lon: 1 }];
    expect(nearestFirst(items, { lat: 0, lon: 0 }).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("eyeVesselsBody", () => {
  const NOW = Date.parse("2026-10-28T23:00:00Z");
  const box: Box = [-0.2, 51.45, 0, 51.55];
  const v = (mmsi: number, lat: number, lon: number, extra: Partial<AisVessel> = {}): AisVessel => ({
    MMSI: mmsi, ShipName: `SHIP ${mmsi}`, latitude: lat, longitude: lon, Sog: 0, time_utc: "2026-10-28 22:59:00.000 +0000 UTC", ...extra,
  });
  const ask = (vessels: AisVessel[], over: Partial<Parameters<typeof eyeVesselsBody>[0]> = {}) =>
    eyeVesselsBody({ box, clamped: false, vessels, state: "live", digitraffic: "ok", barentswatch: "off", now: NOW, ...over });

  it("keeps the vessels inside the box and nothing else", () => {
    const body = ask([v(1, 51.5, -0.1), v(2, 51.5, 0.5), v(3, 52.5, -0.1), v(4, 51.45, -0.2)]);
    expect(body.features.map((f) => f.id).sort()).toEqual(["ais:1", "ais:4"]);
    expect(body.count).toBe(2);
  });

  it("skips a row with no usable position or no MMSI", () => {
    const body = ask([v(1, 51.5, -0.1), { MMSI: 2, latitude: 51.5, longitude: null }, { latitude: 51.5, longitude: -0.1 }, { MMSI: 5, latitude: 51.5 }]);
    expect(body.features.map((f) => f.id)).toEqual(["ais:1"]);
  });

  it("serves the feature /api/signals/ais serves, so toVessel reads it unchanged", () => {
    const one = v(7, 51.5, -0.1, { Sog: 4.4, Cog: 28, shipType: "passenger", destination: "LONDON" });
    const body = ask([one]);
    expect(body.features[0]).toEqual(vesselFeature(one));
    const vessel = toVessel(body.features[0] as unknown as AisFeatureLike)!;
    expect(vessel).toMatchObject({ id: "ais:7", name: "SHIP 7", knots: 4.4, moving: true, type: "passenger", source: "AISStream" });
  });

  it("orders by distance from the middle of the box", () => {
    const body = ask([v(1, 51.54, -0.19), v(2, 51.5, -0.1), v(3, 51.52, -0.12)]);
    expect(body.features.map((f) => f.id)).toEqual(["ais:2", "ais:3", "ais:1"]);
  });

  it("caps at 500, keeps the nearest, and says so in the coverage note", () => {
    const many: AisVessel[] = [];
    for (let i = 0; i < 620; i++) many.push(v(1000 + i, 51.5 + (i % 40) * 0.001, -0.1 - Math.floor(i / 40) * 0.003));
    const body = ask(many);
    expect(EYE_VESSEL_CAP).toBe(500);
    expect(body.count).toBe(500);
    expect(body.features).toHaveLength(500);
    expect(body.coverage).toMatchObject({ capped: true, cap: 500, available: 620, returned: 500, noun: "vessels" });
    expect(body.coverage.note).toContain("Showing 500 of 620 vessels");
    expect(body.coverage.note).toContain("the 500 nearest the middle of the view");
    // The nearest are kept: the farthest in the box is not among them.
    const centre = { lat: 51.5, lon: -0.1 };
    const dist = (f: { lat: number; lon: number }) => Math.hypot(f.lat - centre.lat, (f.lon - centre.lon) * Math.cos((51.5 * Math.PI) / 180));
    const kept = body.features.map(dist);
    const all = many.map((m) => dist({ lat: m.latitude!, lon: m.longitude! })).sort((a, b) => a - b);
    expect(Math.max(...kept)).toBeCloseTo(all[499], 9);
  });

  it("has no note when nothing was cut", () => {
    const body = ask([v(1, 51.5, -0.1)]);
    expect(body.coverage.capped).toBe(false);
    expect(body.coverage.note).toBeUndefined();
  });

  it("carries the box, whether it was cut, the time, the stream and each feed", () => {
    const body = ask([], { clamped: true, state: "warming", barentswatch: "ok" });
    expect(body).toMatchObject({ box, clamped: true, observedAt: NOW, stream: "warming", feeds: { digitraffic: "ok", barentswatch: "ok" }, count: 0, features: [] });
    expect(body.ok).toBe(true);
  });

  it("is ok unless nothing answered at all", () => {
    expect(ask([], { state: "live", digitraffic: "down", barentswatch: "off" }).ok).toBe(true);
    expect(ask([], { state: "warming", digitraffic: "down", barentswatch: "off" }).ok).toBe(true);
    expect(ask([], { state: "off", digitraffic: "ok" }).ok).toBe(true);
    expect(ask([], { state: "down", digitraffic: "ok" }).ok).toBe(true);
    expect(ask([], { state: "down", digitraffic: "down", barentswatch: "ok" }).ok).toBe(true);
    expect(ask([], { state: "off", digitraffic: "down", barentswatch: "off" }).ok).toBe(false);
    expect(ask([], { state: "down", digitraffic: "down", barentswatch: "off" }).ok).toBe(false);
    expect(ask([], { state: "down", digitraffic: "down", barentswatch: "down" }).ok).toBe(false);
  });

  it("serves the London capture: the Thames in a box, newest-agnostic, with the three feeds' shapes", () => {
    const features = (london as { features: (AisFeatureLike & { props: { mmsi: number; vessel: string; speedKt?: number } })[] }).features;
    // Rebuild vessels from the capture's own features, then ask for the Thames at the Tower.
    const vessels: AisVessel[] = features.map((f) => ({
      MMSI: f.props.mmsi, ShipName: f.props.vessel, latitude: f.lat, longitude: f.lon, Sog: f.props.speedKt ?? null, time_utc: f.ts,
    }));
    const tower: Box = [-0.12, 51.48, -0.03, 51.52];
    const body = ask(vessels, { box: tower });
    expect(body.count).toBeGreaterThan(0);
    expect(body.count).toBe(vessels.filter((m) => inBox(m.latitude!, m.longitude!, tower)).length);
    for (const f of body.features) expect(inBox(f.lat, f.lon, tower)).toBe(true);
  });
});
