import { describe, expect, test } from "vitest";
import fixture from "@/tests/fixtures/quake-twin.rows.json";
import {
  TWIN_MAX_KM,
  TWIN_MAX_MAG_DIFF,
  TWIN_MAX_SECONDS,
  clusterQuakes,
  quakeFacts,
  quakeGap,
  type QuakeEntry,
} from "@/lib/signals/quakeTwin";
import type { SignalFeature } from "@/lib/signals/types";

// Rows are VERBATIM from the two live layers of 2026-10-08 (see _about in the
// fixture), so the cases below are the shapes production actually serves: two
// catalogues listing the same event seconds apart, a US swarm, a Hawaiian pair that
// fits two entries. The rule used to answer "is this quake in the other layer?" in a
// panel; since 2026-10-16 it decides which rows of the one earthquakes layer are one
// event. The cases are the same measurements.
const USGS = fixture.usgs as unknown as SignalFeature[];
const EMSC = fixture.emsc as unknown as SignalFeature[];
const byId = (rows: SignalFeature[], id: string) => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`fixture lacks ${id}`);
  return r;
};
const usgs = (id: string) => byId(USGS, `usgs:${id}`);
const emsc = (id: string) => byId(EMSC, `emsc:${id}`);
const entry = (row: SignalFeature, catalogue: string, rank = 0): QuakeEntry => ({ row, catalogue, rank });
const ALL: QuakeEntry[] = [...USGS.map((r) => entry(r, "usgs", 1)), ...EMSC.map((r) => entry(r, "emsc", 4))];

/** The group that holds `id`, as ids, preferred first. */
const groupOf = (groups: QuakeEntry[][], id: string) => groups.find((g) => g.some((e) => e.row.id === id))!.map((e) => e.row.id);

describe("clusterQuakes — the same event in two catalogues", () => {
  const groups = clusterQuakes(ALL);

  test("every row comes out exactly once", () => {
    const ids = groups.flat().map((e) => e.row.id);
    expect(ids.length).toBe(ALL.length);
    expect(new Set(ids).size).toBe(ALL.length);
  });

  test("a USGS event and its EMSC entry, seconds and a few km apart, are one group, the preferred row first", () => {
    expect(groupOf(groups, "usgs:us6000u0ws")).toEqual(["usgs:us6000u0ws", "emsc:20261008_0000096"]);
    const gap = quakeGap(quakeFacts(usgs("us6000u0ws")), quakeFacts(emsc("20261008_0000096")))!;
    expect(gap.seconds).toBeLessThan(1);
    expect(gap.km).toBeLessThan(10);
    expect(gap.magDiff).toBe(0);
  });

  test("an event USGS lists as an explosion still groups: the match is about the event, not its label", () => {
    expect(usgs("nn00925437").props?.type).toBe("explosion");
    expect(groupOf(groups, "usgs:nn00925437")).toEqual(["usgs:nn00925437", "emsc:20261007_0000323"]);
  });

  test("a swarm does not cross-pair: two quakes 3.5 minutes apart each get their own twin", () => {
    expect(groupOf(groups, "usgs:tx2026tueaim")).toEqual(["usgs:tx2026tueaim", "emsc:20261008_0000024"]);
    expect(groupOf(groups, "usgs:tx2026tuedbl")).toEqual(["usgs:tx2026tuedbl", "emsc:20261008_0000028"]);
  });

  test("an entry two events could both claim goes to the closer one; the other keeps its own dot", () => {
    // EMSC 0000097 fits USGS hv75052082 (same second, same place) and also
    // hv75052077 (90 s earlier, 40 km away). Only the first is its twin.
    expect(groupOf(groups, "usgs:hv75052082")).toEqual(["usgs:hv75052082", "emsc:20261008_0000097"]);
    expect(groupOf(groups, "usgs:hv75052077")).toEqual(["usgs:hv75052077"]);
  });

  test("an event only one catalogue lists stays alone", () => {
    expect(groupOf(groups, "emsc:20261008_0000235")).toEqual(["emsc:20261008_0000235"]); // M3.3 off Western Australia
  });

  test("the input order does not decide the pairs", () => {
    const reversed = clusterQuakes([...ALL].reverse());
    for (const id of ["usgs:us6000u0ws", "usgs:tx2026tueaim", "usgs:tx2026tuedbl", "usgs:hv75052082", "usgs:hv75052077"]) {
      expect(new Set(groupOf(reversed, id))).toEqual(new Set(groupOf(groups, id)));
    }
  });
});

describe("clusterQuakes — what a group may hold", () => {
  const twin = emsc("20261008_0000096");
  const base = usgs("us6000u0ws");

  test("with two entries inside the rule it takes the closer one, not the first listed", () => {
    const farther = { ...twin, id: "emsc:farther", lat: twin.lat + 0.2, ts: new Date(Date.parse(twin.ts as string) + 60_000).toISOString() };
    for (const pool of [[farther, twin], [twin, farther]]) {
      const g = clusterQuakes([entry(base, "usgs", 1), ...pool.map((r) => entry(r, "emsc", 4))]);
      expect(groupOf(g, base.id)).toEqual([base.id, twin.id]);
    }
  });

  test("two rows of ONE catalogue are never one event, however close", () => {
    const copy = { ...twin, id: "emsc:copy" };
    const g = clusterQuakes([entry(twin, "emsc"), entry(copy, "emsc")]);
    expect(g).toHaveLength(2);
  });

  test("a chain is not a group: every two rows must fit, not just neighbours", () => {
    // B is 40 km from A and from C, but A and C are 80 km apart.
    const at = (id: string, dLat: number, cat: string) => entry({ ...twin, id, lat: twin.lat + dLat / 111.19 }, cat);
    const g = clusterQuakes([at("a", -40, "x"), at("b", 0, "y"), at("c", 40, "z")]);
    expect(g.map((x) => x.length).sort()).toEqual([1, 2]);
  });

  test("the preferred row is the lowest rank, whatever its input position", () => {
    const g = clusterQuakes([entry(twin, "emsc", 4), entry(base, "usgs", 1)]);
    expect(g[0]!.map((e) => e.catalogue)).toEqual(["usgs", "emsc"]);
  });

  test("a row with no readable time is its own group", () => {
    const g = clusterQuakes([entry({ ...base, ts: undefined }, "usgs"), entry(twin, "emsc")]);
    expect(g).toHaveLength(2);
  });
});

describe("quakeGap — the tolerances", () => {
  const twin = emsc("20261008_0000096");
  const base = quakeFacts(usgs("us6000u0ws"));
  const t0 = Date.parse(twin.ts as string);
  const at = (secs: number) => ({ ...base, ts: new Date(t0 + secs * 1000).toISOString() });
  const T = quakeFacts(twin);

  test("the time limit is TWIN_MAX_SECONDS, both sides", () => {
    expect(quakeGap(at(TWIN_MAX_SECONDS - 1), T)).not.toBeNull();
    expect(quakeGap(at(-(TWIN_MAX_SECONDS - 1)), T)).not.toBeNull();
    expect(quakeGap(at(TWIN_MAX_SECONDS + 5), T)).toBeNull();
  });

  test("the distance limit is TWIN_MAX_KM", () => {
    const moved = (km: number) => ({ ...T, lat: T.lat + km / 111.19, magnitude: base.magnitude });
    expect(quakeGap(moved(TWIN_MAX_KM - 2), T)).not.toBeNull();
    expect(quakeGap(moved(TWIN_MAX_KM + 2), T)).toBeNull();
  });

  test("the numbers themselves are pinned: changing the rule is a decision, and it needs a new measurement", () => {
    // Chosen from one live snapshot (see the header of lib/signals/quakeTwin.ts).
    expect([TWIN_MAX_SECONDS, TWIN_MAX_KM, TWIN_MAX_MAG_DIFF]).toEqual([120, 60, 0.8]);
  });

  test("longitude counts toward the distance: an entry 100 km east at the same moment is not the twin", () => {
    const east = { ...T, lon: T.lon + 100 / (111.19 * Math.cos((T.lat * Math.PI) / 180)) };
    expect(quakeGap({ ...base, ts: twin.ts as string }, east)).toBeNull();
  });

  test("the distance is measured across the antimeridian, not around the world", () => {
    const west = { ...T, lat: 0, lon: 179.9 };
    const east = { ...T, lat: 0, lon: -179.9 }; // 22 km away, on the other side of the 180th meridian
    expect(quakeGap(west, east)).not.toBeNull();
  });

  test("the magnitude limit is TWIN_MAX_MAG_DIFF", () => {
    const m = (d: number) => ({ ...base, ts: twin.ts as string, magnitude: (T.magnitude as number) + d });
    expect(quakeGap(m(TWIN_MAX_MAG_DIFF - 0.05), T)).not.toBeNull();
    expect(quakeGap(m(TWIN_MAX_MAG_DIFF + 0.1), T)).toBeNull();
  });

  test("a magnitude of 0 is 'unknown' (the adapters turn a missing one into 0), so it neither blocks nor decides", () => {
    expect(quakeGap({ ...base, magnitude: 0 }, T)).not.toBeNull();
    expect(quakeGap(base, { ...T, magnitude: 0 })!.magDiff).toBe(null);
  });

  test("an unreadable time or place cannot be compared", () => {
    expect(quakeGap({ ...base, ts: undefined }, T)).toBeNull();
    expect(quakeGap({ ...base, ts: "not a date" }, T)).toBeNull();
    expect(quakeGap({ ...base, lat: Number.NaN }, T)).toBeNull();
  });
});
