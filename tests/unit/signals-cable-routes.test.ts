import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import {
  emodnetAttributes,
  geometryLines,
  normalizeEmodnetCables,
  normalizeNoaaCables,
  outboundLeg,
  simplify,
  CABLE_ROUTES_SOURCE,
  __resetCableRoutes,
} from "@/lib/signals/cable-routes";
import { applyLandingStations, fccCapacity, FCC_CAPACITY_GBPS } from "@/lib/signals/cable-stations";
import { OSM_LANDING_STATIONS } from "@/lib/signals/cable-landings.osm.data";
import { buildCableFeature, mergeCableSegments } from "@/lib/signals/cables";
import type { SignalFeature } from "@/lib/signals/types";

// Fixtures are verbatim slices of live answers read on 2026-10-16: NOAA's Submarine
// Cables layer (two Americas II corridors, two unnamed charted cables) and EMODnet's
// Rijkswaterstaat, SHOM, BSH, SIG and UK sublayers.
const read = (f: string) => JSON.parse(readFileSync(`tests/fixtures/${f}`, "utf8"));
const noaa = read("noaa-submarine-cables.json");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  __resetCableRoutes();
});

// --- charted routes ---------------------------------------------------------------

test("a NOAA corridor polygon becomes its outbound route line", () => {
  // Out along the route and back, as NOAA draws a buffered cable.
  const ring: [number, number][] = [[0, 0], [1, 0], [2, 0], [2.0001, 0.0001], [1, 0.0001], [0, 0.0001], [0, 0]];
  expect(outboundLeg(ring)).toEqual([[0, 0], [1, 0], [2, 0], [2.0001, 0.0001]]);
  const lines = geometryLines({ type: "Polygon", coordinates: [ring] });
  expect(lines).toHaveLength(1);
  expect(lines[0][0]).toEqual([0, 0]);
});

test("simplify keeps the shape and drops vertices inside the tolerance", () => {
  const line: [number, number][] = [[0, 0], [0.5, 0.0005], [1, 0], [1.5, 0.5], [2, 1]];
  const s = simplify(line, 0.002);
  expect(s[0]).toEqual([0, 0]);
  expect(s[s.length - 1]).toEqual([2, 1]);
  expect(s).not.toContainEqual([0.5, 0.0005]);
  expect(s).toContainEqual([1, 0]);
});

test("NOAA: named systems group into one route; unnamed cables group by region", () => {
  const out = normalizeNoaaCables(noaa.features);
  const americas = out.filter((f) => f.title === "Americas II");
  expect(americas).toHaveLength(1);
  expect(americas[0].geometry?.type).toBe("MultiLineString");
  expect(americas[0].props).toMatchObject({ status: "In Service", owners: "AT&T Corp", routeAccuracy: "charted" });
  expect(out.some((f) => f.title.startsWith("Unnamed charted cables"))).toBe(true);
  expect(out.every((f) => f.signalId === "cable-routes")).toBe(true);
  expect(new Set(out.map((f) => f.id)).size).toBe(out.length);
});

test("EMODnet: each publisher's status words map to one vocabulary", () => {
  expect(emodnetAttributes("rijkscables", { naam: "TAT14 Segment H", status: "Ingebruik", eigenaar: "British Telecom" }))
    .toEqual({ name: "TAT14 Segment H", status: "In service", owners: "British Telecom" });
  expect(emodnetAttributes("rijkscables", { naam: "X", status: "Verlaten" }).status).toBe("Abandoned");
  expect(emodnetAttributes("bshcontiscables", { name_: "SeaMeWe 3", status: "OutOfUse" }).status).toBe("Out of service");
  expect(emodnetAttributes("ukfibrecables", { pipe_name: "Y", status: "PRECOMMISSION" }).status).toBe("Not yet in service");
  // SHOM's bare status code has no published key: it is not read.
  expect(emodnetAttributes("shomcables", { status: "4" }).status).toBe("—");
  expect(emodnetAttributes("sigcables", { name: "Z", dism_year: "15/10/2004" }).status).toBe("Dismantled 2004");
  expect(emodnetAttributes("cicacables", { name: "CABLES DE TELEFONO ABANDONADOS" }).status).toBe("Abandoned");
});

test("EMODnet: named cables stay one feature each; unnamed SHOM cables group", () => {
  const rijks = normalizeEmodnetCables("rijkscables", read("emodnet-rijkscables.json").features);
  expect(rijks.map((f) => f.title)).toEqual(["PANGEA Segment 1", "TAT14 Segment H"]);
  expect(rijks[0].props?.publisher).toBe("EMODnet / Rijkswaterstaat (Netherlands)");
  const shom = normalizeEmodnetCables("shomcables", read("emodnet-shomcables.json").features);
  expect(shom).toHaveLength(1);
  expect(shom[0].title).toBe("Unnamed charted cables (SHOM (France))");
  expect(shom[0].geometry?.type).toBe("MultiLineString");
});

test("cable-routes fetch(): one dead publisher keeps the other, declared degraded", async () => {
  globalThis.fetch = (async (url: string) =>
    String(url).includes("noaa.gov")
      ? new Response(JSON.stringify(noaa))
      : new Response("down", { status: 503 })) as unknown as typeof fetch;
  const out = await CABLE_ROUTES_SOURCE.fetch();
  expect(out.length).toBeGreaterThan(0);
  expect(out.every((f) => String(f.props?.publisher).startsWith("NOAA"))).toBe(true);
});

test("cable-routes fetch(): both dead is an honest empty layer", async () => {
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
  expect(await CABLE_ROUTES_SOURCE.fetch()).toEqual([]);
});

// --- landing stations ---------------------------------------------------------------

function landing(id: string, title: string, lat: number, lon: number, cables: string): SignalFeature {
  return { id, title, lat, lon, signalId: "cable-landings", props: { assetKind: "landing", cables } };
}

test("a landing moves onto its one OSM station and keeps the town point", () => {
  // TeleGeography's Morro Bay point; OSM's "Morro Bay CLS" is about 1 km away.
  const out = applyLandingStations([landing("landing:morro", "Morro Bay, CA, United States", 35.3667, -120.8472, "Unity")]);
  expect(out[0].props?.station).toBe("Morro Bay CLS");
  expect(out[0].props?.townPoint).toBe("35.3667, -120.8472 (TeleGeography)");
  expect(Math.abs(out[0].lat - 35.3667)).toBeGreaterThan(0.0001);
});

test("a town with several stations keeps its pin and lists them (Bude)", () => {
  const bude = landing("landing:bude", "Bude, United Kingdom", 50.8299, -4.5434, "TAT-14 · Apollo");
  const out = applyLandingStations([bude]);
  expect(out[0].lat).toBe(bude.lat);
  expect(out[0].props?.station).toBeUndefined();
  expect(String(out[0].props?.stationsNearby)).toMatch(/TAT14 Cable Landing Station/);
});

test("a station is never claimed by a farther landing", () => {
  // Two landings 10 km apart, one station 1 km from the first: only the first moves.
  const out = applyLandingStations(
    [landing("a", "Alpha", 10, 10, "C1"), landing("b", "Beta", 10.09, 10, "C2")],
    [{ osm: "node/1", name: "Some CLS", lat: 10.009, lon: 10 }],
  );
  expect(out[0].props?.station).toBe("Some CLS");
  expect(out[1].props?.station).toBeUndefined();
  expect(out[1].props?.stationsNearby).toBe("Some CLS");
});

test("the committed station snapshot is well formed", () => {
  expect(OSM_LANDING_STATIONS.length).toBeGreaterThan(40);
  expect(new Set(OSM_LANDING_STATIONS.map((s) => s.osm)).size).toBe(OSM_LANDING_STATIONS.length);
  expect(OSM_LANDING_STATIONS.every((s) => Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180)).toBe(true);
});

// --- FCC capacity ------------------------------------------------------------------

test("FCC capacity fills the cable's capacity line, and '—' stays where it is not public", () => {
  expect(fccCapacity("marea")).toBe("178,000 Gbps available at end 2024 (US FCC)");
  expect(fccCapacity("carnival-submarine-network-1-csn-1")).toBe(
    "0 Gbps available at end 2024 (US FCC); 20,000 Gbps planned by end 2026",
  );
  expect(fccCapacity("dunant")).toBeUndefined(); // confidential in the FCC table
  expect(Object.keys(FCC_CAPACITY_GBPS)).toHaveLength(9);
  const geo = {
    features: [
      { properties: { id: "marea", name: "MAREA" }, geometry: { type: "LineString", coordinates: [[-3, 43], [-76, 37]] } },
      { properties: { id: "dunant", name: "Dunant" }, geometry: { type: "LineString", coordinates: [[-1, 46], [-76, 36]] } },
    ],
  };
  const bases = mergeCableSegments(geo as never);
  expect(buildCableFeature(bases.get("marea")!, undefined).props?.capacity).toBe("—"); // no metadata: unchanged
  const meta = { id: "marea", name: "MAREA", lengthKm: 6605, lengthLabel: "6,605 km", owners: "—", suppliers: "—", rfs: "—", rfsYear: 2018, status: "Operational" as const, landingNames: [], landingCountries: [], landingIds: [], region: "Transatlantic", url: null };
  expect(buildCableFeature(bases.get("marea")!, meta).props?.capacity).toMatch(/^178,000 Gbps/);
  expect(buildCableFeature(bases.get("dunant")!, { ...meta, id: "dunant", name: "Dunant" }).props?.capacity).toBe("—");
});
