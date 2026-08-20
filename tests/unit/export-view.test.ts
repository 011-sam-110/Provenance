import { expect, test } from "vitest";
import { buildLayers, mapFreshState } from "@/lib/export/view";
import { captureFilename, looksBlank } from "@/lib/map/capture";
import { toSitrepMarkdown } from "@/lib/export/sitrep";

const NOW = Date.UTC(2026, 7, 20, 14, 35, 12);
const MIN = 60_000;

test("a layer that has never fetched is dormant, not down — we do not invent failures", () => {
  expect(mapFreshState(undefined, 5 * MIN, NOW)).toBe("dormant");
});

test("freshness maps onto the report's vocabulary without losing a distinction", () => {
  const ok = (age: number, count: number) => ({ lastUpdate: NOW - age, ok: true, count });
  expect(mapFreshState(ok(MIN, 4), 5 * MIN, NOW)).toBe("live");
  expect(mapFreshState(ok(MIN, 0), 5 * MIN, NOW)).toBe("empty"); // answered, nothing to show
  expect(mapFreshState(ok(11 * MIN, 4), 5 * MIN, NOW)).toBe("lag");
  expect(mapFreshState(ok(31 * MIN, 4), 5 * MIN, NOW)).toBe("stale");
  expect(mapFreshState({ lastUpdate: NOW - MIN, ok: false, count: 0 }, 5 * MIN, NOW)).toBe("down");
});

const SOURCES = [
  { id: "earthquakes", label: "Earthquakes", refreshMs: 5 * MIN },
  { id: "floods", label: "Floods", refreshMs: 5 * MIN },
  { id: "aurora", label: "Aurora", refreshMs: 5 * MIN },
];

test("only layers that are switched on reach the report", () => {
  const layers = buildLayers({
    now: NOW,
    sources: SOURCES,
    on: { earthquakes: true, floods: false },
    counts: { earthquakes: 7 },
    fresh: { earthquakes: { lastUpdate: NOW - MIN, ok: true, count: 7 } },
  });
  expect(layers.map((l) => l.id)).toEqual(["earthquakes"]);
});

test("a layer that is ON but failing still reaches the report — that is the point", () => {
  const layers = buildLayers({
    now: NOW,
    sources: SOURCES,
    on: { earthquakes: true, floods: true },
    counts: { earthquakes: 7, floods: 3 },
    fresh: {
      earthquakes: { lastUpdate: NOW - MIN, ok: true, count: 7 },
      floods: { lastUpdate: NOW - MIN, ok: false, count: 0 },
    },
  });
  expect(layers.map((l) => l.id).sort()).toEqual(["earthquakes", "floods"]);
  const floods = layers.find((l) => l.id === "floods");
  expect(floods?.state).toBe("down");
  // A cached count from before the failure is NOT reported as current.
  expect(floods?.count).toBeNull();
});

test("a layer with no count pushed is not counted, rather than counted as zero", () => {
  const layers = buildLayers({
    now: NOW,
    sources: SOURCES,
    on: { aurora: true },
    counts: {},
    fresh: { aurora: { lastUpdate: NOW - MIN, ok: true, count: 0 } },
  });
  expect(layers[0].count).toBeNull();
});

test("a real zero count survives as zero", () => {
  const layers = buildLayers({
    now: NOW,
    sources: SOURCES,
    on: { aurora: true },
    counts: { aurora: 0 },
    fresh: { aurora: { lastUpdate: NOW - MIN, ok: true, count: 0 } },
  });
  expect(layers[0].count).toBe(0);
});

test("providers are resolved from the registry, so the report carries attribution", () => {
  const layers = buildLayers({
    now: NOW,
    sources: [{ id: "earthquakes", label: "Earthquakes", refreshMs: 5 * MIN }],
    on: { earthquakes: true },
    counts: { earthquakes: 7 },
    fresh: { earthquakes: { lastUpdate: NOW - MIN, ok: true, count: 7 } },
  });
  expect(layers[0].providers.length).toBeGreaterThan(0);
  expect(layers[0].providers[0].href).toMatch(/^https:\/\//);
});

test("end to end: a down layer lands under the coverage-gap heading of the document", () => {
  const layers = buildLayers({
    now: NOW,
    sources: SOURCES,
    on: { earthquakes: true, floods: true },
    counts: { earthquakes: 7 },
    fresh: {
      earthquakes: { lastUpdate: NOW - MIN, ok: true, count: 7 },
      floods: { lastUpdate: NOW - MIN, ok: false, count: 0 },
    },
  });
  const md = toSitrepMarkdown({
    generatedAt: NOW,
    product: { name: "Provenance", url: "https://example.invalid" },
    scope: { mode: "world", label: "World" },
    view: { center: [0, 0], zoom: 2 },
    layers,
  });
  const gap = md.slice(md.indexOf("## Layers that could not be seen"));
  expect(gap).toContain("Floods");
  expect(gap).toContain("not answering");
});

// --- capture ---------------------------------------------------------------

test("looksBlank rejects anything that is not a PNG data URL", () => {
  expect(looksBlank("", 23838)).toBe(true);
  expect(looksBlank("data:image/jpeg;base64,AAAA", 23838)).toBe(true);
  expect(looksBlank("https://example.invalid/x.png", 23838)).toBe(true);
});

// The numbers below are MEASURED, in the running app, on a 942x799 stage:
//   cleared WebGL buffer  23,838 chars
//   fresh blank canvas    23,838 chars  (byte-identical)
//   real captured frame 1,592,118 chars
// The first version of looksBlank used a flat 2 KB floor and would have passed
// the cleared buffer straight through to the user as a valid, blank download.
const BLANK_942x799 = 23_838;
const REAL_FRAME = 1_592_118;

test("a cleared buffer is caught — it is the same size as a blank canvas", () => {
  expect(looksBlank("data:image/png;base64," + "A".repeat(BLANK_942x799), BLANK_942x799)).toBe(true);
});

test("a real frame passes", () => {
  expect(looksBlank("data:image/png;base64," + "A".repeat(REAL_FRAME), BLANK_942x799)).toBe(false);
});

test("the blank baseline scales with the canvas, which a flat floor cannot", () => {
  // A payload comfortably over any fixed 2 KB floor is still blank for a big canvas.
  const big = 200_000;
  expect(looksBlank("data:image/png;base64," + "A".repeat(20_000), big)).toBe(true);
  // ...and the SAME payload is a real capture on a small one.
  expect(looksBlank("data:image/png;base64," + "A".repeat(20_000), 1_200)).toBe(false);
});

test("with no baseline available it falls back to a floor rather than failing open", () => {
  expect(looksBlank("data:image/png;base64," + "A".repeat(100), 0)).toBe(true);
  expect(looksBlank("data:image/png;base64," + "A".repeat(50_000), 0)).toBe(false);
});

test("captureFilename is sortable and carries no path-hostile characters", () => {
  expect(captureFilename(NOW)).toBe("provenance-view-20260820T143512Z.png");
  expect(captureFilename(NOW)).not.toMatch(/[:\\/]/);
});
