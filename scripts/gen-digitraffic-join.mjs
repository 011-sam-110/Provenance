#!/usr/bin/env node
// Generates lib/sources/digitraffic.join.data.ts — the camera-station -> nearest
// road-weather-station pairing for Finland's Fintraffic network.
//
// WHY THIS IS A SEPARATE GENERATED FILE AND NOT COMPUTED AT REQUEST TIME: the join is
// declared by the operator ONE STATION AT A TIME. There is no bulk endpoint for it —
// `nearestWeatherStationId` only appears on the per-station detail endpoint
// (`/api/weathercam/v1/stations/{id}`), so learning it for all 812 camera stations
// costs 812 requests. Paying that on every registry refresh would be both slow and
// rude to a keyless public API; paying it once here and shipping the result as data
// is the same trade this repo already makes elsewhere (see lib/sources/discovered.ts).
//
// Run: node scripts/gen-digitraffic-join.mjs
//
// Usage
//   node scripts/gen-digitraffic-join.mjs

const REQUEST_HEADERS = {
  // Mandatory — tie.digitraffic.fi 406s without it. See lib/sources/digitraffic.ts.
  "Accept-Encoding": "gzip",
  "Digitraffic-User": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)",
};

const CONCURRENCY = 6;
const OUT_PATH = new URL("../lib/sources/digitraffic.join.data.ts", import.meta.url);

/**
 * Kilometres between two coordinates. Mirrors `haversineKm` in
 * lib/cameras/surface.ts exactly (same formula, same Earth radius) — duplicated
 * here only because this is a plain .mjs generator script with no TS import path
 * into the app, not because the maths differs.
 */
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

async function fetchJson(url) {
  const res = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Runs `worker` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  await new Promise((resolve, reject) => {
    const launch = () => {
      if (next >= items.length) return;
      const i = next++;
      worker(items[i], i)
        .then((value) => {
          results[i] = value;
          done++;
          if (done % 50 === 0 || done === items.length) {
            console.log(`  ${done}/${items.length} station lookups done`);
          }
          if (next < items.length) launch();
          else if (done === items.length) resolve();
        })
        .catch(reject);
    };
    for (let k = 0; k < Math.min(limit, items.length); k++) launch();
    if (items.length === 0) resolve();
  });
  return results;
}

async function main() {
  const capturedAt = new Date().toISOString();
  let requestCount = 0;

  console.log("Fetching camera station list (weathercam/v1/stations)...");
  const camGeo = await fetchJson("https://tie.digitraffic.fi/api/weathercam/v1/stations");
  requestCount++;
  const camStations = camGeo.features ?? [];
  console.log(`  ${camStations.length} camera stations`);

  console.log("Fetching weather station list (weather/v1/stations), for coordinates + names...");
  const weatherGeo = await fetchJson("https://tie.digitraffic.fi/api/weather/v1/stations");
  requestCount++;
  const weatherStations = weatherGeo.features ?? [];
  console.log(`  ${weatherStations.length} weather stations`);

  /** @type {Map<number, {lat:number, lon:number, name?:string}>} */
  const weatherById = new Map();
  for (const f of weatherStations) {
    const id = f.properties?.id ?? f.id;
    const coords = f.geometry?.coordinates;
    if (!Number.isFinite(id) || !coords) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    weatherById.set(Number(id), { lat, lon, name: f.properties?.name });
  }

  console.log(
    `Fetching per-station detail for ${camStations.length} camera stations (concurrency ${CONCURRENCY})...`,
  );
  const joinRows = [];
  let failures = 0;

  await mapWithConcurrency(camStations, CONCURRENCY, async (feature) => {
    const stationId = (feature.id ?? feature.properties?.id ?? "").toString().trim();
    if (!stationId) return;
    const coords = feature.geometry?.coordinates;
    const camLon = Number(coords?.[0]);
    const camLat = Number(coords?.[1]);
    if (!Number.isFinite(camLat) || !Number.isFinite(camLon)) return;

    let detail;
    try {
      detail = await fetchJson(
        `https://tie.digitraffic.fi/api/weathercam/v1/stations/${encodeURIComponent(stationId)}`,
      );
      requestCount++;
    } catch (e) {
      failures++;
      console.warn(`  FAILED ${stationId}: ${e.message}`);
      return;
    }

    const weatherStationId = detail.properties?.nearestWeatherStationId;
    if (!Number.isFinite(weatherStationId)) return; // operator declared no pairing

    const weatherStation = weatherById.get(Number(weatherStationId));
    if (!weatherStation) return; // declared id not in the coordinate list — skip, don't guess

    const km = haversineKm(camLat, camLon, weatherStation.lat, weatherStation.lon);
    joinRows.push({ station: stationId, weatherStationId: Number(weatherStationId), km });
  });

  joinRows.sort((a, b) => a.station.localeCompare(b.station));

  console.log(
    `\nDone: ${joinRows.length} of ${camStations.length} camera stations got a join row ` +
      `(${failures} request failures). Total requests: ${requestCount}.`,
  );

  const rowsText = joinRows
    .map(
      (r) =>
        `  { station: ${JSON.stringify(r.station)}, weatherStationId: ${r.weatherStationId}, km: ${r.km.toFixed(3)} },`,
    )
    .join("\n");

  const contents = `// GENERATED FILE — do not hand-edit. Regenerate with:
//   node scripts/gen-digitraffic-join.mjs
//
// WHAT THIS IS: the pairing of each Fintraffic weather-camera station to the road-
// weather station it should show a surface reading from. \`weatherStationId\` is NOT
// our guess — it is Fintraffic's own \`nearestWeatherStationId\`, read one station at a
// time from \`/api/weathercam/v1/stations/{id}\` (that field is only on the per-station
// detail endpoint, not the list). \`km\` is the distance between the camera's published
// coordinates and that declared weather station's coordinates, computed at generation
// time with the same haversine formula as \`haversineKm\` in lib/cameras/surface.ts
// (duplicated in the generator script because it is a plain .mjs file, not a TS import).
//
// Captured: ${capturedAt}
// Camera stations seen: ${camStations.length}; join rows written: ${joinRows.length}
//   (${camStations.length - joinRows.length} stations had no usable pairing — no
//   nearestWeatherStationId, or it named a weather station missing from the coordinate
//   list — and were skipped rather than guessed).
// Requests made: ${requestCount} (1 camera-station list + 1 weather-station list +
//   ${camStations.length} per-station detail calls, concurrency ${CONCURRENCY}).
// Regenerate with: node scripts/gen-digitraffic-join.mjs

export interface DigiJoin {
  station: string;
  weatherStationId: number;
  km: number;
}

export const DIGITRAFFIC_JOIN: DigiJoin[] = [
${rowsText}
];
`;

  const fs = await import("node:fs/promises");
  await fs.writeFile(OUT_PATH, contents, "utf8");
  console.log(`Wrote ${joinRows.length} rows to ${OUT_PATH.pathname.replace(/^\/([A-Za-z]):/, "$1:")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
