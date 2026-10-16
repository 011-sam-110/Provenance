import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/eonet-floods.json";
import mixed from "@/tests/fixtures/eonet-floods-2026-10.json";
import {
  eonetToFeatures,
  CATEGORIES,
  FLOOD_LONLAT_FROM_GDACS_ID,
  floodPairOrder,
  type EonetEvent,
} from "@/lib/signals/eonet";

/**
 * EONET publishes the FLOODS category with its ring vertices in [lat, lon] order, which
 * is the reverse of every other category and of GeoJSON itself. The floods category is
 * relayed from GDACS, and the transposition comes through the relay unchanged.
 *
 * Captured live from eonet.gsfc.nasa.gov/api/v3/categories/floods?status=all on
 * 2026-09-12 and trimmed to five vertices per ring. All five flood events in the fixture
 * are GDACS-sourced Polygons; the wildfire Point and the ReliefWeb drought Polygon are
 * there to hold the other half of the contract, which is that nothing else moves.
 *
 * `scripts/country-event-breakdown.mts` has carried a private correction for this since
 * 2026-09-08 so the country audit would not be wrong. The shipped layer was left alone,
 * so every flood pin on the globe and in the console has been drawn transposed —
 * "Flood in Slovenia" rendered off the coast of Yemen.
 */
const events = (fixture as { events: EonetEvent[] }).events;
const NOW = Date.parse("2026-09-12T00:00:00Z");

/**
 * Where each fixture event genuinely is: the centroid of its (trimmed) ring, checked to
 * half a degree — about 55 km, far tighter than the thousands of kilometres a transposed
 * pair moves a pin, and loose enough that trimming the ring cannot flip the result.
 */
const TRUTH: Record<string, { lon: number; lat: number }> = {
  "eonet:EONET_24157": { lon: 98.8, lat: 1.2 }, // Flood in Indonesia — North Sumatra
  "eonet:EONET_24158": { lon: -75.1, lat: -13.1 }, // Flood in Peru — Ayacucho
  "eonet:EONET_24193": { lon: 54.7, lat: 37.3 }, // Flood in Iran — Golestan
  "eonet:EONET_24244": { lon: 13.8, lat: 45.5 }, // Flood in Slovenia — the Koper coast
  "eonet:EONET_24101": { lon: 18.0, lat: 53.2 }, // Flood in Poland — Kuyavia
};

test("flood rings are read as [lat, lon], so the pin lands in the country the title names", () => {
  const floods = eonetToFeatures(events, CATEGORIES.floods, NOW);

  // Every flood in the fixture must survive. Under the [lon, lat] reading, Indonesia's
  // ring averages to a latitude of 98 and is DROPPED by the range guard — so the bug
  // both misplaces pins and silently deletes the ones whose longitude exceeds 90.
  expect(floods.map((f) => f.id).sort()).toEqual(Object.keys(TRUTH).sort());

  for (const f of floods) {
    const t = TRUTH[f.id];
    expect(t, `${f.id} (${f.title}) is not in the truth table`).toBeTruthy();
    expect(f.lon, `${f.title} longitude`).toBeCloseTo(t.lon, 0);
    expect(f.lat, `${f.title} latitude`).toBeCloseTo(t.lat, 0);
  }
});

test("no flood pin lands in the Gulf of Aden", () => {
  // The signature of the transposition: European floods, whose real longitudes are small
  // and whose latitudes are 40-55, land in the sea off Yemen and Somalia when the pair is
  // read the wrong way round. Cheap, specific, and it fails loudly if the order flips back.
  const floods = eonetToFeatures(events, CATEGORIES.floods, NOW);
  const inGulfOfAden = floods.filter(
    (f) => f.lon > 40 && f.lon < 55 && f.lat > 8 && f.lat < 16,
  );
  expect(inGulfOfAden.map((f) => f.title)).toEqual([]);
});

test("every other category keeps GeoJSON [lon, lat] — points and polygons alike", () => {
  const fires = eonetToFeatures(events, CATEGORIES.wildfires, NOW);
  expect(fires).toHaveLength(1);
  // Wildfire in Australia: 123.7E, 20.5S. Read the other way round it would be an
  // impossible latitude, which is precisely why the fix must not be applied globally.
  expect(fires[0].lon).toBeCloseTo(123.7, 0);
  expect(fires[0].lat).toBeCloseTo(-20.5, 0);
});

/**
 * EONET changed the order UNDER US at about 2026-09-26: flood events created since then
 * arrive [lon, lat], older ones still arrive [lat, lon], and the two sit in one feed.
 * Captured live from categories/floods?status=all on 2026-10-16 (rings trimmed). Prod was
 * pinning "Flood in Nepal" at 84.6 N and "Flood in Chile" at 70.6 S off the old flag.
 */
const MIXED = (mixed as { events: EonetEvent[] }).events;
const OCT = Date.parse("2026-10-16T19:00:00Z");

const TRUTH_OCT: Record<string, { lon: number; lat: number }> = {
  "eonet:EONET_25291": { lon: 13.1, lat: 32.9 }, // Libya 1104231 — new order
  "eonet:EONET_25241": { lon: 84.6, lat: 28.0 }, // Nepal 1104225 — new order
  "eonet:EONET_25032": { lon: -14.2, lat: 65.0 }, // Iceland 1104211 — new order
  "eonet:EONET_25120": { lon: -69.9, lat: -34.3 }, // Chile 1104217 — new order
  "eonet:EONET_24986": { lon: 56.0, lat: 37.9 }, // "Islamic Republic of Iran" 1104206 — no centroid name, id rule
  "eonet:EONET_24511": { lon: 97.7, lat: 17.8 }, // Thailand 1104169 — re-geometried 10-04, OLD order
  "eonet:EONET_24832": { lon: -101.7, lat: 17.7 }, // Mexico 1104191 — re-geometried 10-04, OLD order
  "eonet:EONET_24812": { lon: -74.0, lat: -38.3 }, // Chile 1104190 — old order
};

test("a feed that mixes both orders: each flood lands where its title says", () => {
  const floods = eonetToFeatures(MIXED, CATEGORIES.floods, OCT);
  for (const [id, t] of Object.entries(TRUTH_OCT)) {
    const f = floods.find((x) => x.id === id);
    expect(f, `${id} missing`).toBeTruthy();
    // A degree is far tighter than the thousands of km a transposition moves a pin.
    expect(Math.abs(f!.lon - t.lon), `${f!.title} lon ${f!.lon}`).toBeLessThan(1.5);
    expect(Math.abs(f!.lat - t.lat), `${f!.title} lat ${f!.lat}`).toBeLessThan(1.5);
  }
});

test("the order rule: country centroid first, then the GDACS id threshold", () => {
  const byId = (id: string) => MIXED.find((e) => e.id === id)!;
  expect(floodPairOrder(byId("EONET_25241"))).toBe("lonlat"); // Nepal, by centroid
  expect(floodPairOrder(byId("EONET_24812"))).toBe("latlon"); // Chile 1104190, by centroid
  // No centroid for the name: falls to the id rule.
  const iran = byId("EONET_24986");
  expect(floodPairOrder({ ...iran, title: "Flood in Atlantis 1104206" })).toBe("lonlat");
  expect(floodPairOrder({ ...iran, title: "Flood in Atlantis", sources: [{ id: "GDACS", url: "https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1104150" }] })).toBe("latlon");
  expect(FLOOD_LONLAT_FROM_GDACS_ID).toBe(1104199);
});
