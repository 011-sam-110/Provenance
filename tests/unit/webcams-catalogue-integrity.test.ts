import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { decodeTile, manifestCoverage, type WebcamManifest } from "@/lib/webcams/tiles";
import { boxFromPath } from "@/lib/webcams/harvest";

// Reads the COMMITTED catalogue with the SHIPPED reader.
//
// Every other test in this area runs the codec against fixtures it built itself, which
// proves the codec is self-consistent and nothing about the 8.2 MB of data actually in
// the repo. The failure this catches is the one that would ship: tiles written by a
// generator that has drifted from the reader, or a tile whose key no longer describes
// where its webcams are. Both decode to an empty or wrongly-placed layer with no error.

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, "public", "webcams", "manifest.json");
const TILE_DIR = path.join(ROOT, "public", "webcams", "t");

const haveCatalogue = existsSync(MANIFEST) && existsSync(TILE_DIR);

describe.skipIf(!haveCatalogue)("the committed webcam catalogue", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as WebcamManifest;
  const files = readdirSync(TILE_DIR).filter((f) => f.endsWith(".json"));

  it("lists a tile for every file, and a file for every tile", () => {
    // A manifest row with no file is a 404 per viewport; a file with no row is data
    // nobody will ever fetch.
    const onDisk = new Set(files.map((f) => f.slice(0, -5)));
    const listed = new Set(manifest.tiles.map((t) => t.k));
    expect([...listed].filter((k) => !onDisk.has(k))).toEqual([]);
    expect([...onDisk].filter((k) => !listed.has(k))).toEqual([]);
  });

  it("decodes every tile with the shipped reader", () => {
    let rows = 0;
    const empty: string[] = [];
    for (const f of files) {
      const decoded = decodeTile(JSON.parse(readFileSync(path.join(TILE_DIR, f), "utf8")));
      if (decoded.length === 0) empty.push(f);
      rows += decoded.length;
    }
    // decodeTile returns [] for a version it does not recognise, so a generator that
    // drifted would show up here as every tile going empty at once.
    expect(empty).toEqual([]);
    expect(rows).toBeGreaterThan(60_000);
  });

  it("puts every webcam inside the box its own key describes", () => {
    // The key IS the location — a tile keyed r30122013 claims a specific patch of the
    // planet. If a row falls outside it, either the quadrant order drifted or a tile
    // was written under the wrong key, and every pin in it is somewhere it is not.
    for (const f of files) {
      const k = f.slice(0, -5);
      const box = boxFromPath(k);
      expect(box, `${k} is not a valid leaf key`).not.toBeNull();
      const [n, e, s, w] = box!;
      for (const cam of decodeTile(JSON.parse(readFileSync(path.join(TILE_DIR, f), "utf8")))) {
        // Inclusive: quadtree leaves share edges, so a webcam can sit exactly on one.
        expect(cam.lat, `${k} ${cam.id} latitude`).toBeGreaterThanOrEqual(s);
        expect(cam.lat, `${k} ${cam.id} latitude`).toBeLessThanOrEqual(n);
        expect(cam.lon, `${k} ${cam.id} longitude`).toBeGreaterThanOrEqual(w);
        expect(cam.lon, `${k} ${cam.id} longitude`).toBeLessThanOrEqual(e);
      }
    }
  });

  it("agrees with itself on how many webcams it holds", () => {
    const counted = files.reduce(
      (sum, f) => sum + decodeTile(JSON.parse(readFileSync(path.join(TILE_DIR, f), "utf8"))).length,
      0,
    );
    expect(counted).toBe(manifest.harvested);
  });

  it("reports coverage without claiming more than exists", () => {
    expect(manifest.worldTotal).toBeGreaterThan(0);
    expect(manifestCoverage(manifest)).toBeGreaterThan(0.9);
    expect(manifestCoverage(manifest)).toBeLessThanOrEqual(1);
  });

  it("stores no image URL, because free-tier image tokens expire in 15 minutes", () => {
    const sample = readFileSync(path.join(TILE_DIR, files[0]), "utf8");
    expect(sample).not.toContain("imgproxy");
    expect(sample).not.toContain("token=");
  });
});
