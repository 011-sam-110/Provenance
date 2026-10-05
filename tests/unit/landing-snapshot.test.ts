import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GLOBE_SNAPSHOT } from "@/lib/marketing/globe-snapshot.meta";

/**
 * The landing globe draws one committed file, `public/marketing/globe-snapshot.json`, and
 * the page prints that file's date from `globe-snapshot.meta.ts`. Both are written by
 * `scripts/gen-landing-snapshot.mjs` in one run. Nothing else connects them, so a hand-edit
 * of either one, or a merge that takes one side's JSON and the other side's date, would put
 * a date on the page that the dots beside it do not have.
 *
 * The rest of this file is the other half of the script's own refusals. The script will not
 * write an empty layer; this fails if one is committed anyway, because an empty layer does
 * not error in the browser. It draws a globe with nothing on it.
 *
 * A failure here is NOT a broken test. Run `node scripts/gen-landing-snapshot.mjs` and
 * commit both files it writes.
 */

const ROOT = process.cwd();
const SNAPSHOT_PATH = join(ROOT, "public", "marketing", "globe-snapshot.json");

/** The same ceiling the generator refuses to write past. Every visitor to `/` downloads this file. */
const MAX_BYTES = 1_000_000;

/** The layers `lib/marketing/landingGlobe.ts` looks up by id. `cables` is the one line layer. */
const LAYER_IDS = [
  "cameras",
  "planes",
  "earthquakes",
  "wildfires",
  "volcanoes",
  "airports",
  "ports",
  "nuclear",
  "launches",
  "gdacs",
  "cables",
];

type Point = [number, number];

interface SnapshotLayer {
  label: string;
  color: string;
  count_in_snapshot: number;
  points?: Point[];
  lines?: Point[][];
}

interface Snapshot {
  _note: string;
  takenAt: string;
  layers: Record<string, SnapshotLayer>;
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;

/** Every coordinate a layer holds, flattened, so one range check covers points and lines. */
function coordinates(layer: SnapshotLayer): Point[] {
  return layer.lines ? layer.lines.flat() : (layer.points ?? []);
}

describe("landing globe snapshot", () => {
  it("carries the date the page prints, as one ISO timestamp in both files", () => {
    // Round-tripping through Date is the ISO check: "2026-10-05" or a local-time string
    // parses, and comes back as something else.
    expect(new Date(GLOBE_SNAPSHOT.takenAt).toISOString()).toBe(GLOBE_SNAPSHOT.takenAt);
    expect(snapshot.takenAt).toBe(GLOBE_SNAPSHOT.takenAt);
  });

  it("holds exactly the layers the globe looks up", () => {
    // The reader finds a layer by id and draws nothing for one it cannot find, so a
    // missing or renamed layer is silent on the page.
    expect(Object.keys(snapshot.layers).sort()).toEqual([...LAYER_IDS].sort());
  });

  it("has no empty layer, and each count is the number of rows the file holds", () => {
    for (const id of LAYER_IDS) {
      const layer = snapshot.layers[id];
      expect(layer, `the ${id} layer is missing`).toBeDefined();
      expect(layer.color, `${id} has no colour to draw in`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(Number.isInteger(layer.count_in_snapshot), `${id}.count_in_snapshot is not a whole number`).toBe(true);

      if (id === "cables") {
        // The one layer whose count is NOT its array length, and deliberately: the count
        // is cables, the array is line segments, and one cable is usually several
        // segments. So the count is pinned from both sides instead. It cannot be zero,
        // and it cannot exceed the segments, because a cable with no drawable segment is
        // left out by the generator rather than counted.
        const lines = layer.lines ?? [];
        expect(layer.points, "cables carry lines, not points").toBeUndefined();
        expect(lines.length, "cables has no lines").toBeGreaterThan(0);
        expect(layer.count_in_snapshot).toBeGreaterThan(0);
        expect(layer.count_in_snapshot).toBeLessThanOrEqual(lines.length);
        // One vertex is not a line. The canvas would stroke nothing for it.
        expect(lines.filter((line) => line.length < 2)).toEqual([]);
        continue;
      }

      const points = layer.points ?? [];
      expect(layer.lines, `${id} is a point layer`).toBeUndefined();
      expect(points.length, `${id} has no points`).toBeGreaterThan(0);
      expect(layer.count_in_snapshot, `${id}.count_in_snapshot disagrees with its points`).toBe(points.length);
    }
  });

  it("keeps every coordinate on the planet, as [lon, lat]", () => {
    // Also catches the swap. A [lat, lon] pair passes for most of Europe and fails as soon
    // as a longitude past 90 lands in the latitude slot.
    // Whatever layers the file holds, not LAYER_IDS: a missing layer is the case above's
    // to report, and an unexpected one still has to be on the planet.
    for (const [id, layer] of Object.entries(snapshot.layers)) {
      const bad = coordinates(layer).filter(
        (p) =>
          !Array.isArray(p) ||
          p.length !== 2 ||
          !Number.isFinite(p[0]) ||
          !Number.isFinite(p[1]) ||
          p[0] < -180 ||
          p[0] > 180 ||
          p[1] < -90 ||
          p[1] > 90,
      );
      expect(bad.slice(0, 5), `${id} holds ${bad.length} coordinates outside lon -180..180, lat -90..90`).toEqual([]);
    }
  });

  it("stays under 1 MB, because every visitor to / downloads it", () => {
    expect(statSync(SNAPSHOT_PATH).size).toBeLessThan(MAX_BYTES);
  });
});
