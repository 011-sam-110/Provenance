import { describe, it, expect } from "vitest";
import {
  loadWebcamCatalogue,
  shouldFlush,
  MANIFEST_URL,
  tileUrl,
  FLUSH_EVERY_TILES,
  FLUSH_MS,
  type LoadProgress,
} from "@/lib/webcams/tileLoad";
import { TILE_VERSION, encodeRow, type TileWebcam } from "@/lib/webcams/tiles";
import type { Box } from "@/lib/webcams/harvest";

const cam = (id: number, lat: number, lon: number): TileWebcam => ({
  id: `windy:${id}`,
  title: `Cam ${id}`,
  lat,
  lon,
  country: "GB",
  region: "England",
  city: "London",
  categories: ["City"],
  available: true,
  detailUrl: `https://www.windy.com/webcams/${id}`,
});

function fakeWorld(tiles: { k: string; box: Box; cams: TileWebcam[] }[], worldTotal = 100) {
  const manifest = {
    version: 1,
    generatedAt: "now",
    worldTotal,
    harvested: tiles.reduce((s, t) => s + t.cams.length, 0),
    leaves: tiles.length,
    tiles: tiles.map((t) => ({ k: t.k, box: t.box, n: t.cams.length, at: 1 })),
  };
  const fetched: string[] = [];
  const fetchJson = async (url: string) => {
    fetched.push(url);
    if (url === MANIFEST_URL) return manifest;
    const t = tiles.find((x) => tileUrl(x.k) === url);
    if (!t) throw new Error("404");
    return { v: TILE_VERSION, k: t.k, box: t.box, at: 1, w: t.cams.map(encodeRow) };
  };
  return { manifest, fetchJson, fetched };
}

describe("shouldFlush", () => {
  it("waits for a batch rather than re-rendering per tile", () => {
    // The failure this prevents is 196 React renders, each rebuilding a
    // FeatureCollection that grows towards 70,698 features.
    expect(shouldFlush(1, 0, false)).toBe(false);
    expect(shouldFlush(FLUSH_EVERY_TILES, 0, false)).toBe(true);
  });

  it("flushes on time even when tiles are trickling in", () => {
    expect(shouldFlush(1, FLUSH_MS, false)).toBe(true);
  });

  it("never emits an empty flush", () => {
    expect(shouldFlush(0, FLUSH_MS * 10, false)).toBe(false);
    expect(shouldFlush(0, 0, true)).toBe(false);
  });

  it("always flushes whatever is left at the end", () => {
    expect(shouldFlush(1, 0, true)).toBe(true);
  });
});

describe("loadWebcamCatalogue", () => {
  it("loads every tile and reports the world total", async () => {
    const { fetchJson } = fakeWorld(
      [
        { k: "r0", box: [90, 180, 0, 0], cams: [cam(1, 10, 10), cam(2, 20, 20)] },
        { k: "r3", box: [0, 0, -90, -180], cams: [cam(3, -10, -10)] },
      ],
      70_686,
    );
    const seen: LoadProgress[] = [];
    const final = await loadWebcamCatalogue({ fetchJson, onProgress: (p) => seen.push(p) });

    expect(final!.webcams).toHaveLength(3);
    expect(final!.tilesLoaded).toBe(2);
    expect(final!.worldTotal).toBe(70_686);
    expect(final!.done).toBe(true);
    expect(seen.at(-1)!.done).toBe(true);
  });

  it("deduplicates a webcam that sits on a shared tile edge", async () => {
    const shared = cam(7, 0, 0);
    const { fetchJson } = fakeWorld([
      { k: "r0", box: [90, 180, 0, 0], cams: [shared, cam(1, 10, 10)] },
      { k: "r1", box: [90, 0, 0, -180], cams: [shared] },
    ]);
    const final = await loadWebcamCatalogue({ fetchJson, onProgress: () => {} });
    expect(final!.webcams.map((w) => w.id).sort()).toEqual(["windy:1", "windy:7"]);
  });

  it("KEEPS the other tiles when one 404s", async () => {
    // A hole in coverage must not empty the layer. The manifest still counts the
    // missing tile, so the gap shows up in tilesLoaded rather than vanishing.
    const world = fakeWorld([
      { k: "r0", box: [90, 180, 0, 0], cams: [cam(1, 10, 10)] },
      { k: "gone", box: [0, 0, -90, -180], cams: [cam(2, -10, -10)] },
    ]);
    const fetchJson = async (url: string) => {
      if (url === tileUrl("gone")) throw new Error("404");
      return world.fetchJson(url);
    };
    const final = await loadWebcamCatalogue({ fetchJson, onProgress: () => {} });
    expect(final!.webcams).toHaveLength(1);
    expect(final!.tilesLoaded).toBe(2);
    expect(final!.tilesTotal).toBe(2);
  });

  it("returns null when the manifest is missing, so the caller can fall back", async () => {
    // This is the "not harvested into this deployment" case. Returning null rather than
    // an empty result is what lets WebcamsFeed fall back to /api/webcams instead of
    // showing a layer with nothing in it.
    const fetchJson = async () => {
      throw new Error("404");
    };
    expect(await loadWebcamCatalogue({ fetchJson, onProgress: () => {} })).toBeNull();
  });

  it("returns null on a manifest that is not a manifest", async () => {
    for (const junk of [null, {}, { tiles: "no" }, 42]) {
      const fetchJson = async () => junk;
      expect(await loadWebcamCatalogue({ fetchJson, onProgress: () => {} })).toBeNull();
    }
  });

  it("stops fetching once the consumer is gone", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      k: `t${i}`,
      box: [90, 180, 0, 0] as Box,
      cams: [cam(i, 1, 1)],
    }));
    const world = fakeWorld(many);
    let live = true;
    const fetchJson = async (url: string) => {
      const r = await world.fetchJson(url);
      if (world.fetched.length > 8) live = false;
      return r;
    };
    await loadWebcamCatalogue({ fetchJson, onProgress: () => {}, alive: () => live });
    // Bounded by concurrency overshoot, nowhere near all 40.
    expect(world.fetched.length).toBeLessThan(20);
  });

  it("fetches only the tiles a viewport touches", async () => {
    const world = fakeWorld([
      { k: "near", box: [20, 20, 10, 10], cams: [cam(1, 15, 15)] },
      { k: "far", box: [-40, -40, -50, -50], cams: [cam(2, -45, -45)] },
    ]);
    const final = await loadWebcamCatalogue({
      fetchJson: world.fetchJson,
      onProgress: () => {},
      viewport: [25, 25, 5, 5],
    });
    expect(world.fetched).toContain(tileUrl("near"));
    expect(world.fetched).not.toContain(tileUrl("far"));
    expect(final!.webcams).toHaveLength(1);
  });

  it("skips tiles the manifest says are empty", async () => {
    const world = fakeWorld([
      { k: "full", box: [90, 180, 0, 0], cams: [cam(1, 10, 10)] },
      { k: "empty", box: [0, 0, -90, -180], cams: [] },
    ]);
    await loadWebcamCatalogue({ fetchJson: world.fetchJson, onProgress: () => {} });
    expect(world.fetched).not.toContain(tileUrl("empty"));
  });

  it("emits far fewer times than there are tiles", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      k: `t${i}`,
      box: [90, 180, 0, 0] as Box,
      cams: [cam(i, 1, 1)],
    }));
    const { fetchJson } = fakeWorld(many);
    let emits = 0;
    // A fixed clock removes the time-based flush, leaving only the count-based one, so
    // this asserts the batching itself rather than how fast the test machine is.
    await loadWebcamCatalogue({ fetchJson, onProgress: () => emits++, now: () => 0 });
    expect(emits).toBeLessThanOrEqual(100 / FLUSH_EVERY_TILES + 2);
  });
});
