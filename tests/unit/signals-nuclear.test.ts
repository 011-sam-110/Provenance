import { afterEach, expect, test } from "vitest";
import fixture from "@/tests/fixtures/overpass-nuclear.json";
import {
  normalizeOverpassNuclear,
  nuclearSnapshotFeatures,
  __resetNuclearCache,
  __nuclearRefreshSettled,
  NUCLEAR_SOURCE,
  LIVE_DATASET_LABEL,
  SNAPSHOT_DATASET_LABEL,
  type OverpassNuclearElement,
} from "@/lib/signals/nuclear";
import { NUCLEAR_SNAPSHOT, NUCLEAR_SNAPSHOT_DATE } from "@/lib/signals/nuclear.data";
import { rowMetric } from "@/lib/console/signals/signalCard";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  __resetNuclearCache();
});

/** Replace global fetch for one test. Nothing here reaches the network. */
function stubFetch(impl: () => Promise<Response>) {
  globalThis.fetch = (() => impl()) as unknown as typeof fetch;
}
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
/** Build N obviously-synthetic Overpass rows. Only ever used to prove the size
 *  guard and the live path — never rendered, never presented as real plants. */
function syntheticElements(n: number): OverpassNuclearElement[] {
  return Array.from({ length: n }, (_, i) => ({
    type: "way",
    id: 900000 + i,
    center: { lat: 10 + i * 0.01, lon: 20 + i * 0.01 },
    tags: { name: `TEST-SYNTHETIC plant ${i}`, "plant:output:electricity": "100 MW" },
  }));
}

test("normalizes Overpass nuclear plants, skipping unnamed elements", () => {
  const out = normalizeOverpassNuclear(fixture as never);
  // 4 elements in; the unnamed sentinel is skipped → 3 plants.
  expect(out).toHaveLength(3);
  expect(out.every((f) => f.signalId === "nuclear")).toBe(true);
  expect(out.some((f) => f.id === "nuclear:node/999999")).toBe(false);
});

test("uses node lat/lon and way center, surfacing output + operator", () => {
  const out = normalizeOverpassNuclear(fixture as never);
  const node = out.find((f) => f.id === "nuclear:node/8645134918");
  expect(node?.props?.output).toBe("57 MW");

  const way = out.find((f) => f.id === "nuclear:way/4800321");
  expect(way?.lat).toBeCloseTo(54.6352, 3); // from element.center
  expect(way?.lon).toBeCloseTo(-1.1813, 3);
  expect(way?.props?.output).toBe("1180 MW");
  expect(way?.props?.operator).toBe("EDF Energy");
  expect(way?.link).toBe("https://www.openstreetmap.org/way/4800321");
});

test("prefers OSM's English name where present, else the default name", () => {
  const out = normalizeOverpassNuclear(fixture as never);
  // node 8645134918 has name "RHF de l'Institut Laue Langevin" + name:en "High-flux Reactor".
  expect(out.find((f) => f.id === "nuclear:node/8645134918")?.title).toBe("High-flux Reactor");
  // node 6443114600 has no name:en → keeps its default name.
  expect(out.find((f) => f.id === "nuclear:node/6443114600")?.title).toBe("Indústrias Nucleares do Brasil");
});

test("adds a numeric outputMw prop that the declared metric resolves to a bar", () => {
  const out = normalizeOverpassNuclear(fixture as never);

  const way = out.find((f) => f.id === "nuclear:way/4800321");
  expect(way?.props?.outputMw).toBe(1180);
  expect(typeof way?.props?.outputMw).toBe("number");
  expect(Number.isFinite(way?.props?.outputMw)).toBe(true);

  const node = out.find((f) => f.id === "nuclear:node/8645134918");
  expect(node?.props?.outputMw).toBe(57);

  // The source's metric points at the real numeric field with a sane domain.
  expect(NUCLEAR_SOURCE.metric).toEqual({ field: "outputMw", domain: [0, 8000], unit: " MW" });

  // rowMetric reads the real scalar (not the radius proxy) and formats the label.
  const bar = rowMetric(way!, NUCLEAR_SOURCE.metric);
  expect(bar).toEqual({ value: 1180, domain: [0, 8000], label: "1180 MW" });

  // The unnamed / capacity-less plant carries no outputMw and no bar.
  const capacityless = out.find((f) => f.id === "nuclear:node/6443114600");
  expect(capacityless?.props?.outputMw).toBeUndefined();
  expect(rowMetric(capacityless!, NUCLEAR_SOURCE.metric)).toBeUndefined();
});

test("registers as an asset directory ranked by capacity, described by operator", () => {
  // OSM carries no country → the directory ranks by the MW metric and shows operator.
  expect(NUCLEAR_SOURCE.kind).toBe("asset");
  expect(NUCLEAR_SOURCE.directory?.detailKey).toBe("operator");
  expect(NUCLEAR_SOURCE.directory?.codeKey).toBeUndefined();
});

test("stamps provenance so a reader can tell live data from the snapshot", () => {
  const live = normalizeOverpassNuclear(fixture as never, LIVE_DATASET_LABEL);
  expect(live[0].props?.dataset).toBe(LIVE_DATASET_LABEL);
  expect(SNAPSHOT_DATASET_LABEL).toContain(NUCLEAR_SNAPSHOT_DATE);
  // Omitting the label leaves the prop off entirely — no invented provenance.
  expect(normalizeOverpassNuclear(fixture as never)[0].props?.dataset).toBeUndefined();
});

// --- the committed OSM extract ------------------------------------------------

test("the committed OSM snapshot is a real, complete, well-formed world", () => {
  const out = nuclearSnapshotFeatures();
  expect(NUCLEAR_SNAPSHOT.length).toBeGreaterThan(150);
  expect(out.length).toBe(NUCLEAR_SNAPSHOT.length); // every row is named + placed
  expect(out.every((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))).toBe(true);
  expect(out.every((f) => f.lat >= -90 && f.lat <= 90 && f.lon >= -180 && f.lon <= 180)).toBe(true);
  expect(new Set(out.map((f) => f.id)).size).toBe(out.length);
  expect(out.every((f) => f.props?.dataset === SNAPSHOT_DATASET_LABEL)).toBe(true);
  // Spot-check a plant that must be in any global nuclear set, with a real capacity.
  const kk = out.find((f) => f.title.includes("Kashiwazaki"));
  expect(kk).toBeDefined();
  expect(Number(kk?.props?.outputMw)).toBeGreaterThan(5000);
  // Enough plants carry a capacity for the directory's MW ranking to mean something.
  expect(out.filter((f) => typeof f.props?.outputMw === "number").length).toBeGreaterThan(100);
});

// --- fetch(): fast and never empty -------------------------------------------

/** fetch() → let the background refresh settle → fetch() again. */
async function fetchAfterRefresh() {
  await NUCLEAR_SOURCE.fetch();
  await __nuclearRefreshSettled();
  return NUCLEAR_SOURCE.fetch();
}

test("REGRESSION: a dead Overpass yields the snapshot, not an empty layer", async () => {
  stubFetch(() => Promise.reject(new Error("ECONNRESET")));
  const out = await fetchAfterRefresh();
  expect(out.length).toBeGreaterThan(150);
  expect(out.every((f) => f.props?.dataset === SNAPSHOT_DATASET_LABEL)).toBe(true);
});

test("REGRESSION: a 504-ing Overpass yields the snapshot, not an empty layer", async () => {
  stubFetch(() => Promise.resolve(new Response("gateway timeout", { status: 504 })));
  const out = await fetchAfterRefresh();
  expect(out.length).toBeGreaterThan(150);
  expect(out[0].props?.dataset).toBe(SNAPSHOT_DATASET_LABEL);
});

test("a REGIONAL Overpass mirror cannot replace the world with a handful of plants", async () => {
  // overpass.osm.ch really does answer this query in ~0.5s with 3 elements.
  stubFetch(() => Promise.resolve(jsonResponse({ elements: syntheticElements(3) })));
  const out = await fetchAfterRefresh();
  expect(out.length).toBeGreaterThan(150);
  expect(out[0].props?.dataset).toBe(SNAPSHOT_DATASET_LABEL);
});

test("a plausible live answer upgrades the layer on the next call, stamped as live", async () => {
  stubFetch(() => Promise.resolve(jsonResponse({ elements: syntheticElements(120) })));
  // First call answers from the snapshot immediately and starts the refresh…
  const first = await NUCLEAR_SOURCE.fetch();
  expect(first[0].props?.dataset).toBe(SNAPSHOT_DATASET_LABEL);
  // …which, once it lands, becomes the served set.
  await __nuclearRefreshSettled();
  const second = await NUCLEAR_SOURCE.fetch();
  expect(second).toHaveLength(120);
  expect(second.every((f) => f.props?.dataset === LIVE_DATASET_LABEL)).toBe(true);
});

test("REGRESSION: a hanging Overpass cannot delay the response at all", async () => {
  // The reported bug: Overpass answered in ~21.6s while the route died at ~11.9s.
  // Nothing now waits on Overpass, so a permanently hanging mirror costs 0ms.
  stubFetch(() => new Promise<Response>(() => {})); // never settles
  const t0 = Date.now();
  const out = await NUCLEAR_SOURCE.fetch();
  const elapsed = Date.now() - t0;
  expect(out.length).toBeGreaterThan(150);
  expect(elapsed).toBeLessThan(250);
});
