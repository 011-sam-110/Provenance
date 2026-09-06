#!/usr/bin/env node
// Generates lib/seo/place.data.ts — the populated places the camera directory can
// build a page for.
//
// WHY THIS EXISTS. `Camera` has no city field and never will: the upstreams do not
// publish one. `region` is the only place-ish thing on a camera and it is far too
// coarse to be a place — measured against the live registry on 2026-09-06 there are
// 45 distinct country+region pairs for 20,388 cameras, so TfL's is "London" and
// Florida's is "Florida". "Traffic cameras near Ealing" is a page people search for
// and "Traffic cameras in London" is not the same page.
//
// WHY GEONAMES AND NOT A GEOCODER. The alternative was reverse-geocoding every camera
// through Photon or Nominatim, which is ~20k requests against a free community service
// for a result that would still have to be committed. GeoNames publishes the whole
// gazetteer as a file, so the work is one download and some arithmetic, with no
// upstream to be rude to and no rate limit to pace around.
//
// WHAT IS COMMITTED, AND WHAT IS NOT. This writes the CITIES, not the camera-to-city
// assignment. The assignment is computed at request time by `assignPlaces` in
// lib/seo/places.ts, because the registry moves — it returned 18,987 cameras and then
// 20,388 within the same hour while this was being built. A committed assignment would
// leave every camera added since the last run with no place at all; a committed city
// list leaves them with the right one. The cost of that choice is a grid index and a
// haversine per camera on a cached path, which is cheap.
//
// HOW IT ROTS. A city that is not near any camera in the snapshot is not written, so a
// feed that later opens up a new area has no places until this is re-run. That is the
// same silent staleness as scripts/gen-digitraffic-join.mjs and it fails in the same
// safe direction: a missing place shows no place row, never a wrong one.
//
// LICENCE. GeoNames data is CC BY 4.0. The obligation travels with the data, so
// anything rendering a place name from this table has to credit GeoNames — the
// directory footer does.
//
// Usage
//   node scripts/gen-place-table.mjs
//   node scripts/gen-place-table.mjs --cameras <path-to-api-cameras-json>
//
// `--cameras` replays a saved /api/cameras body instead of calling production, so the
// generator can be re-run and diffed without depending on a live registry.

const GEONAMES_URL = "https://download.geonames.org/export/dump/cities15000.zip";
const CAMERAS_URL = "https://provenance-online.vercel.app/api/cameras";
const OUT_PATH = new URL("../lib/seo/place.data.ts", import.meta.url);
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/**
 * How far a camera may be from a city and still be described as near it.
 *
 * MUST match PLACE_RADIUS_KM in lib/seo/places.ts — this bounds which cities are
 * worth committing, that one bounds which cameras a committed city collects, and if
 * they disagree the file either carries cities that can never win a camera or omits
 * cities that could. A unit test pins the pair together.
 */
const PLACE_RADIUS_KM = 20;

/** Mirrors `haversineKm` in lib/cameras/surface.ts. Duplicated because this is a
 *  plain .mjs generator with no TS import path into the app. */
function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Read the single member of a zip archive.
 *
 * Same approach as `unzipSingleEntry` in lib/signals/gdelt.ts: parse the local file
 * header by hand and inflate the payload with DecompressionStream("deflate-raw"),
 * which Node has had since 20.18. cities15000.zip holds exactly one entry.
 */
async function unzipSingleEntry(buf) {
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error("not a zip");
  const method = view.getUint16(8, true);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const start = 30 + nameLen + extraLen;
  const compressed = buf.slice(start);
  if (method === 0) return new TextDecoder().decode(compressed);
  if (method !== 8) throw new Error(`unsupported zip method ${method}`);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/**
 * GeoNames' `cities15000.txt` is a headerless TSV. Columns used, by index, from the
 * published readme: 1 name, 4 latitude, 5 longitude, 8 country code, 14 population.
 * `asciiname` (2) is deliberately NOT used — the slug is built from the real name by
 * the app's own `slugify`, which folds accents itself, and using two different
 * transliterations would produce two different URLs for one city.
 */
function parseGeonames(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const f = line.split("\t");
    const name = (f[1] ?? "").trim();
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    const country = (f[8] ?? "").trim().toUpperCase();
    const population = Number(f[14]);
    if (!name || country.length !== 2) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ name, lat, lon, country, population: Number.isFinite(population) ? population : 0 });
  }
  return out;
}

/** Cameras bucketed into 1-degree cells, so a city only tests its own neighbourhood. */
function gridIndex(cameras) {
  const cells = new Map();
  for (const c of cameras) {
    const key = `${Math.floor(c.lat)}|${Math.floor(c.lon)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(c);
    else cells.set(key, [c]);
  }
  return cells;
}

/**
 * Is any camera within PLACE_RADIUS_KM of this city?
 *
 * A degree of latitude is ~111 km, so a 20 km radius never leaves the 3x3 block of
 * 1-degree cells around the city — except at the poles, where longitude cells narrow.
 * There are no cameras above 71°N in any feed, and the check is a pre-filter whose
 * only failure mode is omitting a city, so the cheap version is the right one.
 */
function hasCameraNear(cells, city) {
  const la = Math.floor(city.lat);
  const lo = Math.floor(city.lon);
  for (let dLa = -1; dLa <= 1; dLa++) {
    for (let dLo = -1; dLo <= 1; dLo++) {
      const bucket = cells.get(`${la + dLa}|${lo + dLo}`);
      if (!bucket) continue;
      for (const cam of bucket) {
        if (haversineKm(city.lat, city.lon, cam.lat, cam.lon) <= PLACE_RADIUS_KM) return true;
      }
    }
  }
  return false;
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadCameras() {
  const path = argValue("--cameras");
  if (path) {
    const fs = await import("node:fs/promises");
    const body = JSON.parse(await fs.readFile(path, "utf8"));
    const rows = Array.isArray(body) ? body : body.cameras;
    return { rows, origin: `replayed from ${path}` };
  }
  const res = await fetch(CAMERAS_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${CAMERAS_URL}: HTTP ${res.status}`);
  const body = await res.json();
  return { rows: body.cameras, origin: CAMERAS_URL };
}

async function main() {
  const { rows: cameras, origin } = await loadCameras();
  if (!Array.isArray(cameras) || cameras.length === 0) throw new Error("no cameras to work from");
  console.log(`cameras: ${cameras.length} (${origin})`);

  const res = await fetch(GEONAMES_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${GEONAMES_URL}: HTTP ${res.status}`);
  const all = parseGeonames(await unzipSingleEntry(await res.arrayBuffer()));
  console.log(`geonames cities15000: ${all.length}`);

  const cells = gridIndex(cameras);
  const kept = all
    .filter((city) => hasCameraNear(cells, city))
    // Biggest first inside a country, then by name: `assignPlaces` breaks a distance
    // tie on population, and a stable, meaningful order makes the diff readable.
    .sort((a, b) => a.country.localeCompare(b.country) || b.population - a.population || a.name.localeCompare(b.name));

  console.log(`kept: ${kept.length} within ${PLACE_RADIUS_KM} km of a camera`);

  const byCountry = {};
  for (const c of kept) byCountry[c.country] = (byCountry[c.country] ?? 0) + 1;

  const rowsText = kept
    .map(
      (c) =>
        `  { name: ${JSON.stringify(c.name)}, country: "${c.country}", ` +
        `lat: ${c.lat}, lon: ${c.lon}, population: ${c.population} },`,
    )
    .join("\n");

  const contents = `// GENERATED FILE — do not hand-edit. Regenerate with:
//   node scripts/gen-place-table.mjs
//
// WHAT THIS IS: every GeoNames "cities15000" populated place that sits within
// ${PLACE_RADIUS_KM} km of at least one camera in the registry, which is the set of places the
// directory can honestly build a "cameras near X" page for. It is the CITIES only —
// which camera belongs to which city is computed at request time by \`assignPlaces\` in
// lib/seo/places.ts, so cameras added since this file was written still get a place.
//
// SOURCE: GeoNames (${GEONAMES_URL}), licensed
// CC BY 4.0. That attribution obligation travels with the data: anything rendering a
// place name from this table must credit GeoNames.
//
// Captured: ${new Date().toISOString()}
// Cameras read: ${cameras.length} (${origin})
// GeoNames cities read: ${all.length}; written: ${kept.length}
// By country: ${Object.entries(byCountry)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}
// Regenerate with: node scripts/gen-place-table.mjs

export interface PlaceRow {
  /** GeoNames' own name for the place, unfolded. The URL slug is derived from it at
   *  runtime by \`slugify\`, never stored, so one function owns every slug on the site. */
  name: string;
  /** ISO-3166 alpha-2, matching \`Camera.country\`. */
  country: string;
  lat: number;
  lon: number;
  /** Used only to break a distance tie between two nearly-equidistant places. */
  population: number;
}

export const PLACES: PlaceRow[] = [
${rowsText}
];
`;

  const fs = await import("node:fs/promises");
  await fs.writeFile(OUT_PATH, contents, "utf8");
  console.log(`Wrote ${kept.length} places to ${OUT_PATH.pathname.replace(/^\/([A-Za-z]):/, "$1:")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
