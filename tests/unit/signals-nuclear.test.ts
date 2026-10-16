import { afterEach, expect, test } from "vitest";
import qlever from "@/tests/fixtures/qlever-nuclear.json";
import wikidata from "@/tests/fixtures/wikidata-nuclear-status.json";
import {
  normalizeOsmNuclear,
  nuclearSnapshotFeatures,
  plantStatus,
  qleverToElements,
  wikidataToStatus,
  __resetNuclearCache,
  __nuclearRefreshSettled,
  __setNuclearLiveBudget,
  NUCLEAR_SOURCE,
  LIVE_DATASET_LABEL,
  SNAPSHOT_DATASET_LABEL,
  type SparqlBinding,
} from "@/lib/signals/nuclear";
import { NUCLEAR_DENYLIST } from "@/lib/signals/nuclear-denylist";
import { NUCLEAR_SNAPSHOT, NUCLEAR_SNAPSHOT_DATE } from "@/lib/signals/nuclear.data";
import { rowMetric } from "@/lib/console/signals/signalCard";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  __resetNuclearCache();
  __setNuclearLiveBudget(6_000);
});

/** Replace global fetch for one test. Nothing here reaches the network. */
function stubFetch(impl: () => Promise<Response>) {
  globalThis.fetch = (() => impl()) as unknown as typeof fetch;
}
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
/** Build N obviously-synthetic QLever rows. Only ever used to prove the size guard
 *  and the live path — never rendered, never presented as real plants. */
function syntheticBindings(n: number): SparqlBinding[] {
  return Array.from({ length: n }, (_, i) => ({
    osm: { value: `https://www.openstreetmap.org/way/${900000 + i}` },
    name: { value: `TEST-SYNTHETIC plant ${i}` },
    output: { value: "100 MW" },
    centroid: { value: `POINT(${20 + i * 0.01} ${10 + i * 0.01})` },
  }));
}

// The fixture is a verbatim slice of the live QLever answer (2026-10-16, planet
// 2026-09-21): Hartlepool, two OSM rows for Taishan, Chornobyl, Akkuyu, the ILL
// research reactor, a Khushab plutonium reactor and one unnamed polygon. The Wikidata
// fixture is the live status read for four of those plants.
const elements = qleverToElements(qlever.results.bindings as SparqlBinding[]);
const status = wikidataToStatus(wikidata.results.bindings as SparqlBinding[]);

test("maps QLever bindings to OSM elements, centroid WKT is lon then lat", () => {
  expect(elements).toHaveLength(8);
  const hart = elements.find((e) => e.id === 4800321);
  expect(hart?.type).toBe("way");
  expect(hart?.lat).toBeCloseTo(54.635, 2);
  expect(hart?.lon).toBeCloseTo(-1.181, 2);
  expect(hart?.tags?.wikidata).toBe("Q572403");
});

test("reads Wikidata state of use and the closed date", () => {
  expect(status.Q572403).toBe("in use");
  expect(status.Q215419).toBe("decommissioned; closed 2000-12-15");
  expect(status.Q1630042).toBe("building or structure under construction");
  expect(status.Q1519910).toBeUndefined(); // Taishan: Wikidata states nothing
});

test("drops unnamed rows and denylisted research and military sites", () => {
  const out = normalizeOsmNuclear({ elements }, undefined, status);
  expect(out.some((f) => f.id === "nuclear:way/1035905414")).toBe(false); // unnamed
  expect(out.some((f) => f.id === "nuclear:node/8645134918")).toBe(false); // ILL research reactor
  expect(out.some((f) => f.id === "nuclear:way/582056234")).toBe(false); // Khushab plutonium
  expect(out.every((f) => f.signalId === "nuclear")).toBe(true);
});

test("merges two OSM rows for one Wikidata plant, keeping the one with a capacity", () => {
  const out = normalizeOsmNuclear({ elements }, undefined, status);
  const taishan = out.filter((f) => f.props?.wikidata === "Q1519910");
  expect(taishan).toHaveLength(1);
  expect(taishan[0].id).toBe("nuclear:way/299942571");
  expect(taishan[0].props?.outputMw).toBe(3320);
});

test("says each plant's status; a shut or unbuilt plant loses its capacity bar", () => {
  const out = normalizeOsmNuclear({ elements }, undefined, status);
  const hart = out.find((f) => f.id === "nuclear:way/4800321");
  expect(hart?.props?.status).toBe("Operating");
  expect(hart?.props?.outputMw).toBe(1180);
  expect(rowMetric(hart!, NUCLEAR_SOURCE.metric)).toEqual({ value: 1180, domain: [0, 8000], label: "1,180 MW" });

  const chornobyl = out.find((f) => f.id === "nuclear:way/23652365");
  expect(chornobyl?.props?.status).toBe("Shut down");
  expect(chornobyl?.props?.outputMw).toBeUndefined();
  expect(chornobyl?.color).toBe("#6b7280");

  const akkuyu = out.find((f) => f.id === "nuclear:way/880625927");
  expect(akkuyu?.props?.status).toBe("Under construction");
  expect(akkuyu?.props?.outputMw).toBeUndefined();
  expect(akkuyu?.props?.output).toBe("4800 MW"); // the tag stays as text

  // No statement is "not stated", never "operating".
  expect(out.find((f) => f.id === "nuclear:way/299942571")?.props?.status).toBe("Not stated");
});

test("plantStatus maps Wikidata labels and prefers 'in use' over a closed date", () => {
  expect(plantStatus("in use").key).toBe("operating");
  expect(plantStatus("in use; closed 1998-03-31").key).toBe("operating");
  expect(plantStatus("in partial operation").label).toBe("Partly operating");
  expect(plantStatus("decommissioned").key).toBe("retired");
  expect(plantStatus("cancelled").key).toBe("cancelled");
  expect(plantStatus("proposed building or structure").key).toBe("planned");
  expect(plantStatus(undefined)).toEqual({ key: "unknown", label: "Not stated" });
});

test("registers as an asset directory ranked by capacity, described by operator", () => {
  expect(NUCLEAR_SOURCE.kind).toBe("asset");
  expect(NUCLEAR_SOURCE.metric).toEqual({ field: "outputMw", domain: [0, 8000], unit: " MW" });
  expect(NUCLEAR_SOURCE.directory?.detailKey).toBe("operator");
  expect(NUCLEAR_SOURCE.directory?.codeKey).toBeUndefined();
});

test("stamps provenance so a reader can tell live data from the snapshot", () => {
  const live = normalizeOsmNuclear({ elements }, LIVE_DATASET_LABEL);
  expect(live[0].props?.dataset).toBe(LIVE_DATASET_LABEL);
  expect(SNAPSHOT_DATASET_LABEL).toContain(NUCLEAR_SNAPSHOT_DATE);
  // Omitting the label leaves the prop off entirely — no invented provenance.
  expect(normalizeOsmNuclear({ elements })[0].props?.dataset).toBeUndefined();
});

// --- the committed OSM extract ------------------------------------------------

test("the committed OSM snapshot is a real, complete, well-formed world", () => {
  const out = nuclearSnapshotFeatures();
  expect(NUCLEAR_SNAPSHOT.length).toBeGreaterThan(150);
  expect(out.length).toBeGreaterThan(150);
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
  // The snapshot carries Wikidata statuses, and Chornobyl reads as shut down.
  expect(out.find((f) => f.title.startsWith("Chornobyl"))?.props?.status).toBe("Shut down");
});

test("no denylisted row reaches the layer, from the snapshot or a live read", () => {
  const ids = new Set(nuclearSnapshotFeatures().map((f) => f.id));
  for (const osmId of Object.keys(NUCLEAR_DENYLIST)) expect(ids.has(`nuclear:${osmId}`)).toBe(false);
  // Every entry says why.
  expect(Object.values(NUCLEAR_DENYLIST).every((r) => r.length > 10)).toBe(true);
});

// --- fetch(): fast and never empty -------------------------------------------

/** fetch() → let the background refresh settle → fetch() again. */
async function fetchAfterRefresh() {
  await NUCLEAR_SOURCE.fetch();
  await __nuclearRefreshSettled();
  return NUCLEAR_SOURCE.fetch();
}

test("REGRESSION: a dead upstream yields the snapshot, not an empty layer", async () => {
  stubFetch(() => Promise.reject(new Error("ECONNRESET")));
  const out = await fetchAfterRefresh();
  expect(out.length).toBeGreaterThan(150);
  expect(out.every((f) => f.props?.dataset === SNAPSHOT_DATASET_LABEL)).toBe(true);
});

test("REGRESSION: a 502-ing upstream yields the snapshot, not an empty layer", async () => {
  stubFetch(() => Promise.resolve(new Response("at capacity", { status: 502 })));
  const out = await fetchAfterRefresh();
  expect(out.length).toBeGreaterThan(150);
  expect(out[0].props?.dataset).toBe(SNAPSHOT_DATASET_LABEL);
});

test("a partial live answer cannot replace the world with a handful of plants", async () => {
  stubFetch(() => Promise.resolve(jsonResponse({ results: { bindings: syntheticBindings(3) } })));
  const out = await fetchAfterRefresh();
  expect(out.length).toBeGreaterThan(150);
  expect(out[0].props?.dataset).toBe(SNAPSHOT_DATASET_LABEL);
});

test("a plausible live answer upgrades the layer on the next call, stamped as live", async () => {
  stubFetch(() => Promise.resolve(jsonResponse({ results: { bindings: syntheticBindings(120) } })));
  // First call answers from the snapshot immediately and starts the refresh…
  const first = await NUCLEAR_SOURCE.fetch();
  expect(first[0].props?.dataset).toBe(SNAPSHOT_DATASET_LABEL);
  // …which, once it lands, becomes the served set.
  await __nuclearRefreshSettled();
  const second = await NUCLEAR_SOURCE.fetch();
  expect(second).toHaveLength(120);
  expect(second.every((f) => f.props?.dataset === LIVE_DATASET_LABEL)).toBe(true);
});

test("REGRESSION: a hanging upstream cannot delay the response at all", async () => {
  // QLever takes 14-21 s. Nothing waits on it, so a hanging read costs 0 ms. (The
  // live reactor feeds are awaited for a bounded budget; shrink it here so this test
  // measures the OSM read alone. signals-nuclear-live.test.ts covers the budget.)
  __setNuclearLiveBudget(0);
  stubFetch(() => new Promise<Response>(() => {})); // never settles
  const t0 = Date.now();
  const out = await NUCLEAR_SOURCE.fetch();
  const elapsed = Date.now() - t0;
  expect(out.length).toBeGreaterThan(150);
  expect(elapsed).toBeLessThan(250);
});
