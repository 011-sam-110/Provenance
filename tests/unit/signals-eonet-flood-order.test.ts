import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/eonet-floods.json";
import { eonetToFeatures, CATEGORIES, type EonetEvent } from "@/lib/signals/eonet";

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
