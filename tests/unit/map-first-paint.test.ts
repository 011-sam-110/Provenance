import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BASEMAPS, DEFAULT_BASEMAP } from "@/lib/basemaps";
import { mapViewStore } from "@/lib/mapView";

/**
 * What the console map costs before the visitor has asked for anything.
 *
 * THE COMPARISON THIS FILE COMES FROM. Measured 2026-09-05 against
 * simplifaisoul/osiris, which runs the SAME MapLibre 5.24 on the same machine and
 * drops zero frames on the same scripted zoom gesture while this map dropped seven,
 * worst gap 533 ms (re-measured preview-against-preview, 2026-09-05). It does not win by being lighter overall — it parses a 7.9 MB
 * camera JSON at load and its canvas appears LATER than ours on throttled mobile.
 * It wins on what it declines to do at rest: no terrain, no hillshade, no DEM
 * source, no opening rotation, and buildings only once the user turns them on.
 *
 * Of the 4.3 MB of tiles this map fetched during one z8 zoom-in, 2.4 MB in 23
 * requests was Terrarium DEM from `elevation-tiles-prod.s3.amazonaws.com` — S3
 * direct, no CDN, HTTP/1.1, 410–610 ms TTFB per 60 KB tile from the UK, browser-
 * queued six at a time. None of it was asked for.
 *
 * These are the parts of that decision that survive in a node environment. The
 * frame numbers themselves cannot be asserted here (vitest has no DOM and no GPU),
 * so they are re-measured against a deployment; what is pinned here is the shape
 * that made them: the defaults, and the fact that the basemap warm-up is DERIVED
 * from the registry rather than typed out again.
 *
 * THE ROTATION IS PINNED ELSEWHERE. This file used to assert that WorldMap had no
 * spin loop; `tests/unit/console-globe-still.test.ts` arrived on main in #159 doing
 * the same job properly — it strips comments before searching, names the one rAF
 * that is allowed to remain, and bans `setCenter` outright. Two guards over one fact
 * is how one of them ends up quietly asserting nothing, so this one gave way.
 */

const src = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");

describe("the map opens cheap", () => {
  it("starts with terrain and 3D buildings OFF", () => {
    // Both were ON, unpersisted, on every cold load — so every visitor paid for
    // relief shading and an extrusion layer whether or not they ever descended to a
    // zoom where either is visible. The rail toggles stay; only the default moves.
    const view = mapViewStore.get();
    expect(view.terrain).toBe(false);
    expect(view.buildings).toBe(false);
  });
});

describe("the basemap warm-up", () => {
  const layout = src("app/(console)/layout.tsx");

  /**
   * The basemap chain used to start after hydration AND after the dynamic import of
   * WorldMap resolved: canvas at 0.67 s, style at 1.0 s, TileJSON + sprite + glyphs
   * after that, first tiles at 2.3 s. `preconnect` + `preload` in the console
   * layout start it with the HTML instead.
   *
   * DERIVED, NOT TYPED. DEFAULT_BASEMAP is `streets` (OpenFreeMap Liberty), not the
   * positron everyone assumes, and the skin↔basemap sync in ConsoleShell only ever
   * swaps between `dark` and `positron` — so it does not fire on a first load and
   * `streets` really is the first style fetched. A hand-typed URL here would warm
   * the wrong style the day that constant moves, and nothing would fail: the preload
   * would simply go unused and the real style would be fetched late, exactly as it
   * is today.
   */
  it("reads the URL to warm out of the basemap registry", () => {
    expect(layout).toMatch(/DEFAULT_BASEMAP/);
    expect(layout).not.toMatch(/https:\/\/tiles\./);
  });

  it("the default basemap is a style URL a browser can be told to fetch", () => {
    // The raster entries (`satellite`, `topo`) carry an inline StyleSpecification
    // rather than a URL, and there is nothing to preload for those. This is what
    // makes the layout's `typeof style === "string"` guard a real branch.
    expect(typeof BASEMAPS[DEFAULT_BASEMAP].style).toBe("string");
  });
});
