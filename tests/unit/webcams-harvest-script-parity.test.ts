import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  WINDY_PAGE_LIMIT,
  WINDY_MAX_OFFSET,
  LEAF_CAPACITY,
  MAX_DEPTH,
  WORLD,
} from "@/lib/webcams/harvest";
import { TILE_VERSION, TILE_COLUMNS } from "@/lib/webcams/tiles";

// scripts/harvest-webcams.mjs duplicates the planner's pure core, because it is a plain
// .mjs generator with no TypeScript import path into the app — the same situation
// scripts/gen-digitraffic-join.mjs is in with its copy of haversineKm.
//
// The duplication is only acceptable if it cannot rot silently. These assertions are
// what make that true: change a cap in lib/webcams/harvest.ts without changing the
// script and this goes red, naming the constant that drifted.
//
// The failure being guarded is not hypothetical. If the script's WINDY_MAX_OFFSET
// drifted above the TS module's, every page request past the ceiling would 400 and the
// harvest would quietly collect less while reporting success.

const SRC = readFileSync(path.join(process.cwd(), "scripts", "harvest-webcams.mjs"), "utf8");

/**
 * Read one `const NAME = <arithmetic>;` out of the script.
 *
 * The right-hand side may reference the caps declared above it (LEAF_CAPACITY is
 * `WINDY_MAX_OFFSET + WINDY_PAGE_LIMIT`), so those are bound before evaluating. The
 * grammar accepted is deliberately narrow — digits, identifiers and `+ - *` — so this
 * stays a parse of a literal declaration rather than running any script logic.
 */
function constInScript(name: string): number {
  const m = new RegExp(`^const ${name} = ([A-Za-z0-9_+\\-* ]+);`, "m").exec(SRC);
  if (!m) throw new Error(`scripts/harvest-webcams.mjs no longer declares ${name}`);
  const scope = { WINDY_PAGE_LIMIT, WINDY_MAX_OFFSET };
  return Function(
    ...Object.keys(scope),
    `"use strict"; return (${m[1]});`,
  )(...Object.values(scope)) as number;
}

describe("the harvest script's copy of the planner core", () => {
  it("uses the same measured tier caps as lib/webcams/harvest.ts", () => {
    expect(constInScript("WINDY_PAGE_LIMIT")).toBe(WINDY_PAGE_LIMIT);
    expect(constInScript("WINDY_MAX_OFFSET")).toBe(WINDY_MAX_OFFSET);
    expect(constInScript("MAX_DEPTH")).toBe(MAX_DEPTH);
  });

  it("derives leaf capacity the same way, rather than hard-coding 1050", () => {
    const script = /^const LEAF_CAPACITY = (.+);$/m.exec(SRC)?.[1];
    expect(script).toBe("WINDY_MAX_OFFSET + WINDY_PAGE_LIMIT");
    expect(constInScript("LEAF_CAPACITY")).toBe(LEAF_CAPACITY);
  });

  it("starts from the same world box", () => {
    const m = /^const WORLD = \[(.+)\];$/m.exec(SRC);
    expect(m).not.toBeNull();
    expect(m![1].split(",").map((n) => Number(n.trim()))).toEqual([...WORLD]);
  });

  it("keeps the quadrant order that leaf keys depend on", () => {
    // boxPath encodes a leaf's identity as its quadrant path, so the script and the TS
    // module must split in the same order or every committed tile is mislabelled.
    const order = [...SRC.matchAll(/\/\/ ([0-3]) (NE|NW|SE|SW)$/gm)].map((m) => `${m[1]}${m[2]}`);
    expect(order).toEqual(["0NE", "1NW", "2SE", "3SW"]);
  });

  it("never lets the script page past the offset ceiling", () => {
    // The bound itself, not just the constant feeding it.
    expect(SRC).toContain("for (let o = 0; o < total && o <= WINDY_MAX_OFFSET; o += WINDY_PAGE_LIMIT)");
  });
});

describe("the harvest script's copy of the tile codec", () => {
  it("writes the version lib/webcams/tiles.ts will accept", () => {
    // decodeTile REFUSES any other version rather than parsing positionally, so a
    // script writing v2 tiles against a v1 reader empties the layer. That is the safe
    // direction, but it is still an outage, and this catches it before it ships.
    expect(constInScript("TILE_VERSION")).toBe(TILE_VERSION);
  });

  it("emits columns in the order the reader indexes them", () => {
    // Rows are read BY INDEX. A column inserted in the writer and not the reader moves
    // every later field along by one: `available` would be read out of `city` and the
    // coordinate out of the title. Nothing would throw — every pin would just be wrong.
    const body = /function encodeRow\(w\) \{([\s\S]*?)\n\}/.exec(SRC)?.[1] ?? "";
    const returned = /return \[([\s\S]*?)\n  \];/.exec(body)?.[1] ?? "";
    expect(returned, "encodeRow must return a positional array").not.toBe("");

    // One entry per column, in order.
    const entries = returned
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//"));
    expect(entries).toHaveLength(TILE_COLUMNS.length);

    // And the fields that are read by index downstream are where the reader expects.
    expect(entries[TILE_COLUMNS.indexOf("lat")]).toContain("round5(lat)");
    expect(entries[TILE_COLUMNS.indexOf("lon")]).toContain("round5(lon)");
    expect(entries[TILE_COLUMNS.indexOf("available")]).toContain("active");
  });

  it("agrees with the reader on which column holds availability", () => {
    // The cycle's active-share statistic reads this column positionally.
    const m = /activeRows \+= rows\.filter\(\(r\) => r\[(\d+)\] === 1\)/.exec(SRC);
    expect(m, "the active-share stat must read a positional column").not.toBeNull();
    expect(Number(m![1])).toBe(TILE_COLUMNS.indexOf("available"));
  });

  it("does not store a URL it can rebuild", () => {
    const body = /function encodeRow\(w\) \{([\s\S]*?)\n\}/.exec(SRC)?.[1] ?? "";
    const returned = /return \[([\s\S]*?)\n  \];/.exec(body)?.[1] ?? "";
    expect(returned).not.toContain("windy.com");
  });
});
