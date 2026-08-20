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
  expect(looksBlank("")).toBe(true);
  expect(looksBlank("data:image/jpeg;base64,AAAA")).toBe(true);
  expect(looksBlank("https://example.invalid/x.png")).toBe(true);
});

test("looksBlank treats a tiny PNG payload as the cleared-buffer case", () => {
  expect(looksBlank("data:image/png;base64," + "A".repeat(100))).toBe(true);
  expect(looksBlank("data:image/png;base64," + "A".repeat(5000))).toBe(false);
});

test("captureFilename is sortable and carries no path-hostile characters", () => {
  expect(captureFilename(NOW)).toBe("provenance-view-20260820T143512Z.png");
  expect(captureFilename(NOW)).not.toMatch(/[:\\/]/);
});
