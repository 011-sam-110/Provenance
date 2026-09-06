import { describe, it, expect } from "vitest";
import {
  TILE_COLUMNS,
  TILE_VERSION,
  encodeRow,
  decodeRow,
  decodeTile,
  webcamUrl,
  boxesIntersect,
  tilesForViewport,
  manifestCoverage,
  mergeTiles,
  type TileRow,
  type TileWebcam,
  type ManifestTile,
} from "@/lib/webcams/tiles";
import type { Box } from "@/lib/webcams/harvest";

const sample: TileWebcam = {
  id: "windy:1359321680",
  title: "Petropavlovsk-Kamchatsky: Gorely volcano",
  lat: 53.03192,
  lon: 158.63709,
  country: "RU",
  region: "Kamchatka Krai",
  city: "Petropavlovsk-Kamchatsky",
  categories: ["Weather", "Mountain"],
  available: true,
  detailUrl: "https://www.windy.com/webcams/1359321680",
};

describe("the positional row codec", () => {
  it("round-trips a webcam", () => {
    expect(decodeRow(encodeRow(sample))).toEqual(sample);
  });

  it("stores the numeric id only and rebuilds the URL", () => {
    const row = encodeRow(sample);
    expect(row[0]).toBe(1359321680);
    expect(JSON.stringify(row)).not.toContain("windy.com");
    expect(decodeRow(row)!.detailUrl).toBe(webcamUrl(1359321680));
  });

  it("rounds coordinates to five decimals", () => {
    const row = encodeRow({ ...sample, lat: -3.7038000000000001, lon: 0.1234567891 });
    expect(row[2]).toBe(-3.7038);
    expect(row[3]).toBe(0.12346);
  });

  it("keeps a row's arity locked to the column list", () => {
    // A row one element short would shift every later column: `available` would be read
    // out of `city`, and `lon` out of `lat`. Every pin would move.
    expect(encodeRow(sample)).toHaveLength(TILE_COLUMNS.length);
  });

  it("DROPS a row with an unusable coordinate instead of defaulting it to 0,0", () => {
    const bad = encodeRow(sample);
    bad[2] = Number.NaN;
    expect(decodeRow(bad)).toBeNull();
    const offGlobe = encodeRow(sample);
    offGlobe[3] = 999;
    expect(decodeRow(offGlobe)).toBeNull();
  });

  it("carries availability through as a boolean", () => {
    expect(decodeRow(encodeRow({ ...sample, available: false }))!.available).toBe(false);
    expect(decodeRow(encodeRow({ ...sample, available: true }))!.available).toBe(true);
  });

  it("survives a webcam with no place fields", () => {
    const sparse: TileWebcam = {
      ...sample,
      country: undefined,
      region: undefined,
      city: undefined,
      categories: [],
    };
    const back = decodeRow(encodeRow(sparse))!;
    expect(back.country).toBeUndefined();
    expect(back.categories).toEqual([]);
  });
});

describe("decodeTile", () => {
  const tile = (over: Record<string, unknown> = {}) => ({
    v: TILE_VERSION,
    k: "r0",
    box: [90, 180, 0, 0] as Box,
    at: 1,
    w: [encodeRow(sample)],
    ...over,
  });

  it("reads a well-formed tile", () => {
    expect(decodeTile(tile())).toHaveLength(1);
  });

  it("REFUSES a tile from a different format version rather than parsing it positionally", () => {
    // This is the guard that matters. Columns are read by index, so a tile written
    // under a different column order would decode silently into wrong values — every
    // marker at the wrong coordinate, with no error anywhere.
    expect(decodeTile(tile({ v: TILE_VERSION + 1 }))).toEqual([]);
    expect(decodeTile(tile({ v: undefined }))).toEqual([]);
  });

  it("never throws on junk", () => {
    for (const junk of [null, undefined, 42, "tile", {}, { v: TILE_VERSION }, { v: TILE_VERSION, w: "no" }]) {
      expect(() => decodeTile(junk)).not.toThrow();
      expect(decodeTile(junk)).toEqual([]);
    }
  });

  it("skips a bad row without losing the good ones", () => {
    const short = [1, "x"] as unknown as TileRow;
    expect(decodeTile(tile({ w: [encodeRow(sample), short] }))).toHaveLength(1);
  });
});

describe("viewport selection", () => {
  const t = (k: string, box: Box, n = 10): ManifestTile => ({ k, box, n, at: 1 });

  it("returns only tiles that overlap the view", () => {
    const tiles = [
      t("near", [10, 10, 0, 0]),
      t("far", [-40, -40, -50, -50]),
      t("touching", [20, 20, 10, 10]),
    ];
    const picked = tilesForViewport(tiles, [15, 15, 5, 5]);
    expect(picked.map((x) => x.k).sort()).toEqual(["near", "touching"]);
  });

  it("orders nearest to the viewport centre first", () => {
    // View centre is (45, 45): "onCentre" sits on it, "mid" is 30 degrees out on each
    // axis, "corner" is 40. Distances are distinct so the order cannot be a tie broken
    // by key — an earlier version of this test picked two tiles that were equidistant
    // and asserted the tie-break, which proved nothing about the ordering.
    const tiles = [
      t("corner", [10, 10, 0, 0]),
      t("onCentre", [50, 50, 40, 40]),
      t("mid", [20, 20, 10, 10]),
    ];
    const picked = tilesForViewport(tiles, [90, 90, 0, 0]);
    expect(picked.map((x) => x.k)).toEqual(["onCentre", "mid", "corner"]);
  });

  it("skips empty tiles so the loader never fetches a file with nothing in it", () => {
    const picked = tilesForViewport([t("empty", [10, 10, 0, 0], 0)], [15, 15, 5, 5]);
    expect(picked).toEqual([]);
  });

  it("treats a shared edge as an intersection", () => {
    // Quadtree leaves share edges by construction, so an exclusive test would drop the
    // tile immediately north of the viewport and leave a seam of missing pins.
    expect(boxesIntersect([10, 10, 0, 0], [20, 10, 10, 0])).toBe(true);
  });
});

describe("honest counting", () => {
  it("never reports more than 100% when leaves share an edge", () => {
    expect(manifestCoverage({ harvested: 70_748, worldTotal: 70_686 })).toBe(1);
  });

  it("reports zero rather than NaN before anything is harvested", () => {
    expect(manifestCoverage({ harvested: 0, worldTotal: 0 })).toBe(0);
  });

  it("deduplicates a webcam that sits on a tile boundary", () => {
    const merged = mergeTiles([[sample], [sample], [{ ...sample, id: "windy:2" }]]);
    expect(merged).toHaveLength(2);
  });
});
