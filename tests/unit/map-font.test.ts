import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASEMAPS, MAP_LABEL_FONT, usesOwnLabels, type BasemapKey } from "@/lib/basemaps";

// ---------------------------------------------------------------------------
// The fontstack guard, and why a test is the only thing that can hold it.
//
// Our symbol layers resolve their glyphs against whichever basemap style is
// active, so they depend on a font server we do not own. Two are now in play and
// they do not overlap much. Measured live on 2026-09-03:
//
//   CARTO        Open Sans Regular 200 | Noto Sans Regular 200 | Noto Sans Bold 404
//   OpenFreeMap  Open Sans Regular 404 | Noto Sans Regular 200 | Noto Sans Bold 200
//
// A symbol layer whose fontstack 404s does not throw, does not warn, and does not
// fail a build. It draws the icon and drops the text, on that basemap only. So the
// only way this stays correct is a test that pins the value and refuses the old one.
// ---------------------------------------------------------------------------

const worldMapSrc = readFileSync(join(process.cwd(), "components", "WorldMap.tsx"), "utf8");

describe("MAP_LABEL_FONT", () => {
  test("is the one stack both glyph servers serve", () => {
    expect(MAP_LABEL_FONT).toEqual(["Noto Sans Regular"]);
  });

  test("stays a SINGLE element, because OpenFreeMap has no composite-stack fallback", () => {
    // A comma-joined stack is requested as one path segment. OpenFreeMap 404s
    // "Open Sans Regular,Noto Sans Regular" outright rather than falling through to
    // the second name, so a multi-element array is not a safety net here - it is a
    // second way to get no labels at all.
    expect(MAP_LABEL_FONT).toHaveLength(1);
  });

  test("WorldMap asks for it and never for a hardcoded font", () => {
    expect(worldMapSrc.match(/"text-font": \[\.\.\.MAP_LABEL_FONT\]/g)).not.toBeNull();
    // The literal that used to be here, and that OpenFreeMap answers 404 for.
    expect(worldMapSrc).not.toMatch(/Open Sans/);
    // Any other hardcoded stack would fail the same way, silently.
    expect(worldMapSrc).not.toMatch(/"text-font": \[\s*"/);
  });

  test("every style in the registry declares a glyphs endpoint or delegates to one", () => {
    // An inline style with no `glyphs` drops every symbol layer we add, silently.
    for (const key of Object.keys(BASEMAPS) as BasemapKey[]) {
      const style = BASEMAPS[key].style;
      if (typeof style === "string") continue; // remote styles carry their own
      expect(style.glyphs, `${key} has no glyphs endpoint`).toBeTruthy();
    }
  });
});

describe("usesOwnLabels", () => {
  test("is true for exactly the vector basemaps", () => {
    for (const key of Object.keys(BASEMAPS) as BasemapKey[]) {
      expect(usesOwnLabels(key)).toBe(BASEMAPS[key].vector);
    }
  });

  test("WorldMap reads the registry rather than naming a basemap", () => {
    // It used to be `isRasterBasemap = (b) => b !== "positron"`, which was right only
    // while positron was the single vector entry. Naming a key here is the bug.
    expect(worldMapSrc).not.toMatch(/isRasterBasemap/);
    expect(worldMapSrc).not.toMatch(/!==\s*"positron"/);
    expect(worldMapSrc).toMatch(/usesOwnLabels\(/);
  });
});
