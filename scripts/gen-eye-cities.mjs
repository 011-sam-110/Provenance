#!/usr/bin/env node
// Which cities are worth opening in God's eye view, measured instead of guessed.
//
// The landing page's button offers "See Madrid in 3D", and the view it opens is only as
// good as the buildings OpenFreeMap has for that place. Plenty of famous cities have
// footprints and no heights in OpenStreetMap: they rise as a flat field of 5 m boxes. So
// every candidate below is read from the same vector tiles the map draws:
//
//   1. the z14 `building` layer in a 3 x 3 block of tiles round the seed point;
//   2. the point with the most built volume within about a kilometre, which becomes the
//      centre of the frame (a seed is only a hint: "Madrid" is not where the towers are);
//   3. what stands near that point: towers over 40 m and over 100 m, the tallest, and how
//      many buildings have a real height at all;
//   4. how many public cameras from /api/cameras stand within 4 km (NEAR_KM in
//      lib/eye/cameras.ts, the reach of the view's camera cards).
//
// Run:   node scripts/gen-eye-cities.mjs            measure, print, write nothing
//        node scripts/gen-eye-cities.mjs --write    also write lib/eye/cities.data.ts,
//                                                   lib/marketing/cta-places.data.ts and
//                                                   docs/EYE_CITIES.md
//
// `KEEP` below is the gate. `REFUSED` holds the cities a person looked at and turned down
// after they passed it: numbers cannot see that a frame is mostly sea.
//
// Tiles are cached in `--cache <dir>` (default: the OS temp folder) so a re-run costs
// OpenFreeMap nothing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const CACHE_AT = args.indexOf("--cache");
const CACHE = CACHE_AT >= 0 ? args[CACHE_AT + 1] : join(tmpdir(), "pv-eye-cities");
const CAMERAS_URL = "https://provenance-online.com/api/cameras";
const TILEJSON = "https://tiles.openfreemap.org/planet";
const Z = 14;

/**
 * name: the view's title, and the button's words unless SAY has shorter ones.
 * area: the view's second line.
 * home: the visitor's region that sees it first (lib/marketing/ctaDeck.ts).
 * fame: 3 = offered to everyone, 2 = offered on its own continent, 1 = only at home.
 * Inside a region the order is the order the button leads with, so its best skyline is first.
 */
const CANDIDATES = [
  // Britain and Ireland. Westminster, Tower Bridge and Piccadilly are EYE_PLACES already.
  ["canary-wharf", "Canary Wharf", "London", 51.5045, -0.0195, "gb", 2],
  ["city-of-london", "the City", "London", 51.5145, -0.0825, "gb", 2],
  ["manchester", "Manchester", "England", 53.4775, -2.2455, "gb", 1],
  ["birmingham", "Birmingham", "England", 52.4795, -1.9025, "gb", 1],
  ["leeds", "Leeds", "England", 53.7985, -1.5445, "gb", 1],
  ["liverpool", "Liverpool", "England", 53.4065, -2.9915, "gb", 1],
  ["newcastle", "Newcastle", "England", 54.9725, -1.6135, "gb", 1],
  ["bristol", "Bristol", "England", 51.4525, -2.5915, "gb", 1],
  ["glasgow", "Glasgow", "Scotland", 55.8605, -4.2575, "gb", 1],
  ["edinburgh", "Edinburgh", "Scotland", 55.9525, -3.1925, "gb", 1],
  ["cardiff", "Cardiff", "Wales", 51.4805, -3.1775, "gb", 1],
  ["belfast", "Belfast", "Northern Ireland", 54.5975, -5.9285, "gb", 1],
  ["dublin", "Dublin", "Ireland", 53.3475, -6.2505, "ie", 1],
  // Western Europe
  ["paris", "Paris", "France", 48.8655, 2.3215, "fr", 3],
  ["la-defense", "La Défense", "Paris", 48.8915, 2.2385, "fr", 2],
  ["lyon", "Lyon", "France", 45.7605, 4.8555, "fr", 1],
  ["marseille", "Marseille", "France", 43.2995, 5.3785, "fr", 1],
  ["madrid", "Madrid", "Spain", 40.4785, -3.6885, "es", 3],
  ["barcelona", "Barcelona", "Spain", 41.3895, 2.1705, "es", 3],
  ["valencia", "Valencia", "Spain", 39.4665, -0.3765, "es", 1],
  ["benidorm", "Benidorm", "Spain", 38.5365, -0.1225, "es", 2],
  ["lisbon", "Lisbon", "Portugal", 38.7205, -9.1405, "pt", 2],
  ["porto", "Porto", "Portugal", 41.1515, -8.6105, "pt", 1],
  ["milan", "Milan", "Italy", 45.4835, 9.1905, "it", 2],
  ["rome", "Rome", "Italy", 41.9005, 12.4835, "it", 3],
  ["naples", "Naples", "Italy", 40.8515, 14.2685, "it", 1],
  ["turin", "Turin", "Italy", 45.0705, 7.6865, "it", 1],
  ["frankfurt", "Frankfurt", "Germany", 50.1125, 8.6735, "de", 2],
  ["berlin", "Berlin", "Germany", 52.5165, 13.3945, "de", 3],
  ["hamburg", "Hamburg", "Germany", 53.5495, 9.9925, "de", 1],
  ["munich", "Munich", "Germany", 48.1395, 11.5755, "de", 1],
  ["cologne", "Cologne", "Germany", 50.9385, 6.9575, "de", 1],
  ["rotterdam", "Rotterdam", "Netherlands", 51.9165, 4.4845, "nl", 2],
  ["amsterdam", "Amsterdam", "Netherlands", 52.3705, 4.8985, "nl", 3],
  ["brussels", "Brussels", "Belgium", 50.8535, 4.3575, "be", 1],
  ["antwerp", "Antwerp", "Belgium", 51.2185, 4.4105, "be", 1],
  ["zurich", "Zurich", "Switzerland", 47.3785, 8.5355, "ch", 1],
  ["geneva", "Geneva", "Switzerland", 46.2055, 6.1465, "ch", 1],
  ["vienna", "Vienna", "Austria", 48.2085, 16.3725, "at", 2],
  ["monaco", "Monaco", "Monaco", 43.7395, 7.4265, "fr", 2],
  // The North and the East
  ["stockholm", "Stockholm", "Sweden", 59.3345, 18.0635, "nordic", 2],
  ["oslo", "Oslo", "Norway", 59.9105, 10.7605, "nordic", 2],
  ["copenhagen", "Copenhagen", "Denmark", 55.6775, 12.5705, "nordic", 2],
  ["helsinki", "Helsinki", "Finland", 60.1695, 24.9385, "nordic", 2],
  ["warsaw", "Warsaw", "Poland", 52.2305, 21.0045, "pl", 2],
  ["prague", "Prague", "Czechia", 50.0855, 14.4215, "cee", 2],
  ["budapest", "Budapest", "Hungary", 47.5015, 19.0505, "cee", 2],
  ["bucharest", "Bucharest", "Romania", 44.4385, 26.0955, "cee", 1],
  ["sofia", "Sofia", "Bulgaria", 42.6965, 23.3225, "cee", 1],
  ["belgrade", "Belgrade", "Serbia", 44.8135, 20.4605, "cee", 1],
  ["vilnius", "Vilnius", "Lithuania", 54.6925, 25.2785, "cee", 1],
  ["athens", "Athens", "Greece", 37.9815, 23.7305, "gr", 2],
  ["istanbul", "Istanbul", "Turkey", 41.0785, 29.0115, "tr", 3],
  ["moscow", "Moscow", "Russia", 55.7495, 37.5375, "ru", 1],
  // The Gulf and the Middle East
  ["dubai", "Dubai", "UAE", 25.1975, 55.2745, "gulf", 3],
  ["dubai-marina", "Dubai Marina", "Dubai", 25.0815, 55.1395, "gulf", 3],
  ["abu-dhabi", "Abu Dhabi", "UAE", 24.4915, 54.3645, "gulf", 2],
  ["doha", "Doha", "Qatar", 25.3225, 51.5285, "gulf", 2],
  ["riyadh", "Riyadh", "Saudi Arabia", 24.7115, 46.6745, "gulf", 2],
  ["kuwait-city", "Kuwait City", "Kuwait", 29.3755, 47.9775, "gulf", 1],
  ["manama", "Manama", "Bahrain", 26.2355, 50.5765, "gulf", 1],
  ["tel-aviv", "Tel Aviv", "Israel", 32.0735, 34.7935, "il", 1],
  ["beirut", "Beirut", "Lebanon", 33.8965, 35.5015, "levant", 1],
  ["cairo", "Cairo", "Egypt", 30.0455, 31.2355, "eg", 2],
  // Africa
  ["johannesburg", "Johannesburg", "South Africa", -26.2045, 28.0465, "za", 2],
  ["cape-town", "Cape Town", "South Africa", -33.9185, 18.4235, "za", 2],
  ["durban", "Durban", "South Africa", -29.8585, 31.0245, "za", 1],
  ["nairobi", "Nairobi", "Kenya", -1.2865, 36.8205, "ke", 1],
  ["lagos", "Lagos", "Nigeria", 6.4495, 3.4085, "ng", 1],
  ["casablanca", "Casablanca", "Morocco", 33.5885, -7.6205, "ma", 1],
  // South Asia
  ["mumbai", "Mumbai", "India", 18.9385, 72.8265, "in", 3],
  ["delhi", "Delhi", "India", 28.6315, 77.2195, "in", 1],
  ["gurugram", "Gurugram", "India", 28.4955, 77.0885, "in", 1],
  ["bengaluru", "Bengaluru", "India", 12.9725, 77.5945, "in", 1],
  ["karachi", "Karachi", "Pakistan", 24.8505, 67.0245, "pk", 1],
  ["dhaka", "Dhaka", "Bangladesh", 23.7945, 90.4045, "bd", 1],
  ["colombo", "Colombo", "Sri Lanka", 6.9185, 79.8505, "lk", 1],
  // South-East Asia
  ["singapore", "Singapore", "Singapore", 1.2825, 103.8515, "sg", 3],
  ["kuala-lumpur", "Kuala Lumpur", "Malaysia", 3.1565, 101.7125, "my", 3],
  ["bangkok", "Bangkok", "Thailand", 13.7255, 100.5295, "th", 3],
  ["jakarta", "Jakarta", "Indonesia", -6.2085, 106.8225, "id", 2],
  ["ho-chi-minh", "Ho Chi Minh City", "Vietnam", 10.7775, 106.7045, "vn", 2],
  ["hanoi", "Hanoi", "Vietnam", 21.0245, 105.8415, "vn", 1],
  ["manila", "Manila", "Philippines", 14.5545, 121.0245, "ph", 2],
  // East Asia
  ["hong-kong", "Hong Kong", "Hong Kong", 22.2825, 114.1585, "hk", 3],
  ["shenzhen", "Shenzhen", "China", 22.5365, 114.0555, "cn", 2],
  ["shanghai", "Shanghai", "China", 31.2365, 121.5035, "cn", 3],
  ["beijing", "Beijing", "China", 39.9085, 116.4605, "cn", 2],
  ["guangzhou", "Guangzhou", "China", 23.1195, 113.3225, "cn", 2],
  ["chongqing", "Chongqing", "China", 29.5605, 106.5745, "cn", 2],
  ["taipei", "Taipei", "Taiwan", 25.0335, 121.5645, "tw", 2],
  ["tokyo", "Tokyo", "Japan", 35.6585, 139.7445, "jp", 3],
  ["shibuya", "Shibuya", "Tokyo", 35.6585, 139.7015, "jp", 2],
  ["osaka", "Osaka", "Japan", 34.7005, 135.4965, "jp", 2],
  ["yokohama", "Yokohama", "Japan", 35.4555, 139.6325, "jp", 1],
  ["seoul", "Seoul", "South Korea", 37.5085, 127.0605, "kr", 3],
  ["busan", "Busan", "South Korea", 35.1615, 129.1605, "kr", 1],
  // Oceania
  ["sydney", "Sydney", "Australia", -33.8655, 151.2095, "au", 3],
  ["melbourne", "Melbourne", "Australia", -37.8145, 144.9625, "au", 2],
  ["brisbane", "Brisbane", "Australia", -27.4685, 153.0255, "au", 2],
  ["gold-coast", "the Gold Coast", "Australia", -28.0025, 153.4295, "au", 1],
  ["perth", "Perth", "Australia", -31.9525, 115.8585, "au", 1],
  ["auckland", "Auckland", "New Zealand", -36.8485, 174.7635, "nz", 1],
  // The United States, east
  ["manhattan", "Manhattan", "New York", 40.7545, -73.9845, "us-east", 3],
  ["new-york", "New York", "New York", 40.7075, -74.0115, "us-east", 3],
  ["times-square", "Times Square", "New York", 40.7575, -73.9855, "us-east", 2],
  ["jersey-city", "Jersey City", "New Jersey", 40.7185, -74.0345, "us-east", 1],
  ["boston", "Boston", "Massachusetts", 42.3525, -71.0585, "us-east", 2],
  ["philadelphia", "Philadelphia", "Pennsylvania", 39.9525, -75.1665, "us-east", 2],
  ["pittsburgh", "Pittsburgh", "Pennsylvania", 40.4415, -79.9955, "us-east", 1],
  ["washington", "Washington", "D.C.", 38.8995, -77.0365, "us-east", 2],
  ["baltimore", "Baltimore", "Maryland", 39.2885, -76.6105, "us-east", 1],
  ["atlanta", "Atlanta", "Georgia", 33.7595, -84.3885, "us-east", 2],
  // Sam's own example: the state's tallest skyline is Uptown Charlotte.
  ["north-carolina", "North Carolina", "Charlotte", 35.2265, -80.8425, "us-east", 2],
  ["raleigh", "Raleigh", "North Carolina", 35.7795, -78.6395, "us-east", 1],
  ["miami", "Miami", "Florida", 25.7695, -80.1905, "us-east", 3],
  ["tampa", "Tampa", "Florida", 27.9475, -82.4585, "us-east", 1],
  ["orlando", "Orlando", "Florida", 28.5395, -81.3795, "us-east", 1],
  ["detroit", "Detroit", "Michigan", 42.3305, -83.0465, "us-east", 1],
  ["cleveland", "Cleveland", "Ohio", 41.5005, -81.6935, "us-east", 1],
  ["columbus", "Columbus", "Ohio", 39.9625, -82.9985, "us-east", 1],
  // The United States, centre
  ["chicago", "Chicago", "Illinois", 41.8815, -87.6295, "us-central", 3],
  ["houston", "Houston", "Texas", 29.7575, -95.3655, "us-central", 2],
  ["dallas", "Dallas", "Texas", 32.7815, -96.7975, "us-central", 2],
  ["austin", "Austin", "Texas", 30.2675, -97.7425, "us-central", 1],
  ["san-antonio", "San Antonio", "Texas", 29.4265, -98.4895, "us-central", 1],
  ["new-orleans", "New Orleans", "Louisiana", 29.9515, -90.0715, "us-central", 1],
  ["minneapolis", "Minneapolis", "Minnesota", 44.9765, -93.2705, "us-central", 1],
  ["nashville", "Nashville", "Tennessee", 36.1625, -86.7795, "us-central", 1],
  ["st-louis", "St. Louis", "Missouri", 38.6265, -90.1925, "us-central", 1],
  ["kansas-city", "Kansas City", "Missouri", 39.1005, -94.5835, "us-central", 1],
  ["milwaukee", "Milwaukee", "Wisconsin", 43.0405, -87.9085, "us-central", 1],
  // The United States, mountain and west
  ["denver", "Denver", "Colorado", 39.7445, -104.9915, "us-mountain", 1],
  ["salt-lake-city", "Salt Lake City", "Utah", 40.7625, -111.8905, "us-mountain", 1],
  ["phoenix", "Phoenix", "Arizona", 33.4495, -112.0725, "us-mountain", 1],
  ["los-angeles", "Los Angeles", "California", 34.0505, -118.2535, "us-west", 3],
  ["san-francisco", "San Francisco", "California", 37.7905, -122.3985, "us-west", 3],
  ["las-vegas", "Las Vegas", "Nevada", 36.1145, -115.1725, "us-west", 3],
  ["san-diego", "San Diego", "California", 32.7155, -117.1625, "us-west", 1],
  ["seattle", "Seattle", "Washington", 47.6065, -122.3345, "us-west", 2],
  ["portland", "Portland", "Oregon", 45.5205, -122.6775, "us-west", 1],
  ["honolulu", "Honolulu", "Hawaii", 21.2845, -157.8325, "us-west", 2],
  // Canada
  ["toronto", "Toronto", "Canada", 43.6455, -79.3815, "ca-east", 3],
  ["montreal", "Montreal", "Canada", 45.5015, -73.5675, "ca-east", 2],
  ["ottawa", "Ottawa", "Canada", 45.4205, -75.6975, "ca-east", 1],
  ["vancouver", "Vancouver", "Canada", 49.2835, -123.1205, "ca-west", 2],
  ["calgary", "Calgary", "Canada", 51.0465, -114.0675, "ca-west", 1],
  // Latin America
  ["mexico-city", "Mexico City", "Mexico", 19.4285, -99.1705, "mx", 3],
  ["monterrey", "Monterrey", "Mexico", 25.6535, -100.3585, "mx", 1],
  ["guadalajara", "Guadalajara", "Mexico", 20.6745, -103.3875, "mx", 1],
  ["panama-city", "Panama City", "Panama", 8.9785, -79.5205, "latam", 2],
  ["bogota", "Bogotá", "Colombia", 4.6525, -74.0585, "co", 1],
  ["medellin", "Medellín", "Colombia", 6.2085, -75.5675, "co", 1],
  ["lima", "Lima", "Peru", -12.1045, -77.0305, "pe", 1],
  ["santiago", "Santiago", "Chile", -33.4175, -70.6065, "cl", 2],
  ["buenos-aires", "Buenos Aires", "Argentina", -34.5985, -58.3745, "ar", 2],
  ["sao-paulo", "São Paulo", "Brazil", -23.5605, -46.6565, "br", 3],
  ["rio", "Rio de Janeiro", "Brazil", -22.9685, -43.1855, "br", 2],
  ["balneario-camboriu", "Balneário Camboriú", "Brazil", -26.9915, -48.6345, "br", 1],
];

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
const metresPerDegLat = 111_320;
const km = (aLat, aLon, bLat, bLon) => {
  const mid = ((aLat + bLat) / 2) * (Math.PI / 180);
  return Math.hypot((aLat - bLat) * 110.574, (aLon - bLon) * 111.32 * Math.cos(mid));
};

let tileBase = "";
async function tileBuildings(x, y) {
  mkdirSync(CACHE, { recursive: true });
  const at = join(CACHE, `${Z}-${x}-${y}.json`);
  if (existsSync(at)) return JSON.parse(readFileSync(at, "utf8"));
  const res = await fetch(tileBase.replace("{z}", Z).replace("{x}", x).replace("{y}", y));
  if (res.status === 404 || res.status === 204) {
    writeFileSync(at, "[]");
    return [];
  }
  if (!res.ok) throw new Error(`tile ${x}/${y}: HTTP ${res.status}`);
  const tile = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
  const layer = tile.layers.building;
  const rows = [];
  for (let i = 0; layer && i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.properties.hide_3d === true) continue;
    const ring = f.loadGeometry()[0];
    if (!ring?.length) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const ext = layer.extent;
    rows.push([
      +x2lon(x + (minX + maxX) / 2 / ext, Z).toFixed(5),
      +y2lat(y + (minY + maxY) / 2 / ext, Z).toFixed(5),
      Math.round(Number(f.properties.render_height) || 0),
      // Footprint as a fraction of the tile, bounding box: good enough to rank by volume.
      +(((maxX - minX) * (maxY - minY)) / (ext * ext)).toFixed(6),
    ]);
  }
  writeFileSync(at, JSON.stringify(rows));
  return rows;
}

function measure(seedLat, seedLon, rows, cameras) {
  // Built volume on a 200 m grid, blurred over about a kilometre.
  const cosLat = Math.cos((seedLat * Math.PI) / 180);
  const cell = 200;
  const dLat = cell / metresPerDegLat;
  const dLon = dLat / cosLat;
  const tileM2 = ((40_075_016 * cosLat) / 2 ** Z) ** 2;
  const grid = new Map();
  for (const [lon, lat, h, area] of rows) {
    const i = Math.round((lat - seedLat) / dLat);
    const j = Math.round((lon - seedLon) / dLon);
    const key = `${i},${j}`;
    // Height counts for more than its share: a frame is judged by what stands out.
    grid.set(key, (grid.get(key) ?? 0) + area * tileM2 * h * (h >= 40 ? 3 : 1));
  }
  let best = null;
  for (const key of grid.keys()) {
    const [i, j] = key.split(",").map(Number);
    let sum = 0;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) sum += grid.get(`${i + a},${j + b}`) ?? 0;
    if (!best || sum > best.sum) best = { i, j, sum };
  }
  if (!best) return null;
  let lat = seedLat + best.i * dLat;
  let lon = seedLon + best.j * dLon;

  // What stands within 900 m of that point: about what a frame at this zoom holds.
  const near = rows.filter((r) => km(lat, lon, r[1], r[0]) <= 0.9);
  const tall = near.filter((r) => r[2] >= 40);
  if (tall.length >= 3) {
    // Centre the frame on the towers themselves, weighted by height.
    let w = 0, wLat = 0, wLon = 0;
    for (const r of tall) {
      w += r[2];
      wLat += r[1] * r[2];
      wLon += r[0] * r[2];
    }
    lat = wLat / w;
    lon = wLon / w;
  }

  // The long axis of the towers, so the view looks along them and they stack in depth.
  let sxx = 0, syy = 0, sxy = 0;
  for (const r of tall) {
    const dx = (r[0] - lon) * cosLat;
    const dy = r[1] - lat;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const axis = tall.length >= 3 ? (Math.atan2(2 * sxy, sxx - syy) / 2) * (180 / Math.PI) : 30;
  const heading = ((90 - axis) % 360 + 360) % 360;

  const reach = tall.length
    ? tall.reduce((s, r) => s + km(lat, lon, r[1], r[0]) * r[2], 0) / tall.reduce((s, r) => s + r[2], 0)
    : 0.5;
  const zoom = reach > 0.55 ? 14.9 : reach > 0.38 ? 15.2 : 15.5;

  const cams = cameras.filter((c) => km(lat, lon, c.lat, c.lon) <= 4);
  return {
    lat: +lat.toFixed(5),
    lon: +lon.toFixed(5),
    zoom,
    heading: Math.round(heading),
    buildings: near.length,
    withHeight: near.filter((r) => r[2] >= 12).length,
    over40: tall.length,
    over100: near.filter((r) => r[2] >= 100).length,
    over200: near.filter((r) => r[2] >= 200).length,
    tallest: near.reduce((m, r) => Math.max(m, r[2]), 0),
    cameras: cams.length,
    liveCameras: cams.filter((c) => c.live).length,
  };
}

/** THE GATE. London's own numbers set it: see docs/EYE_CITIES.md. */
const KEEP = (m) => m.over100 >= 6 || (m.over40 >= 40 && m.tallest >= 90) || (m.over40 >= 120 && m.tallest >= 60);

/** Passed the numbers, and a person looked at the frame and said no. id: reason. */
const FLAT = "the frame is a flat field: few towers stand out";
const FEW = "too few towers in the frame";
const REFUSED = {
  manchester: FLAT,
  birmingham: FLAT,
  liverpool: FLAT,
  benidorm: FLAT,
  "buenos-aires": FLAT,
  "sao-paulo": FLAT,
  johannesburg: FLAT,
  nairobi: FLAT,
  "mexico-city": FLAT,
  vienna: FLAT,
  munich: FLAT,
  ottawa: FLAT,
  hamburg: FLAT,
  milwaukee: FEW,
  "kuwait-city": FEW,
  colombo: FEW,
  columbus: FEW,
  tampa: FEW,
  baltimore: FEW,
  "salt-lake-city": FEW,
  "new-orleans": FEW,
  portland: FEW,
  istanbul: FEW,
  phoenix: FEW,
  "st-louis": FEW,
  brussels: FEW,
  bogota: FEW,
  "kansas-city": FEW,
  "cape-town": FEW,
  orlando: FEW,
  raleigh: FEW,
  naples: FEW,
  hanoi: FEW,
  lyon: FEW,
  monaco: FEW,
  cairo: FEW,
  oslo: FEW,
};
/** A person looked and turned the frame. id: degrees added to the measured heading. */
const LOOK = {};
/** Button words where the title will not fit "See ... in 3D" (MAX_WORDS in lib/marketing/ctaDeck.ts). */
const SAY = { "city-of-london": "the Square Mile", "ho-chi-minh": "Saigon" };
/** Two seeds that found the same towers keep the first: this many km apart is one frame. */
const SAME_FRAME_KM = 1.2;
const LF = String.fromCharCode(10);

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function main() {
  const tilejson = await (await fetch(TILEJSON)).json();
  tileBase = tilejson.tiles[0];
  const camRes = await fetch(CAMERAS_URL, { headers: { "user-agent": "provenance-gen-eye-cities" } });
  const cameras = (await camRes.json()).cameras.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  console.error(`${cameras.length} cameras read, tiles from ${tileBase}`);

  const rows = await pool(CANDIDATES, 4, async ([id, name, area, lat, lon, home, fame]) => {
    const cx = Math.floor(lon2x(lon, Z));
    const cy = Math.floor(lat2y(lat, Z));
    const tiles = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) tiles.push([cx + a, cy + b]);
    const buildings = (await Promise.all(tiles.map(([x, y]) => tileBuildings(x, y)))).flat();
    const m = measure(lat, lon, buildings, cameras);
    return { id, name, area, home, fame, ...(m ?? { over40: 0, over100: 0, tallest: 0, buildings: 0, withHeight: 0, over200: 0, cameras: 0, liveCameras: 0 }) };
  });

  const passed = rows.filter((r) => KEEP(r) && !REFUSED[r.id]);
  const kept = [];
  for (const r of passed) {
    const twin = kept.find((k) => km(k.lat, k.lon, r.lat, r.lon) < SAME_FRAME_KM);
    if (twin) REFUSED[r.id] = `the same frame as ${twin.name}`;
    else kept.push(r);
  }
  rows.sort((a, b) => b.over100 - a.over100 || b.over40 - a.over40);
  console.log("id".padEnd(20), "bld", ">12m", ">40", ">100", ">200", "max", "cams", "live", "z", "hdg", "keep");
  for (const r of rows) {
    console.log(
      r.id.padEnd(20),
      String(r.buildings).padStart(4),
      String(r.withHeight).padStart(4),
      String(r.over40).padStart(4),
      String(r.over100).padStart(4),
      String(r.over200).padStart(3),
      String(r.tallest).padStart(4),
      String(r.cameras).padStart(5),
      String(r.liveCameras).padStart(4),
      String(r.zoom ?? "").padStart(4),
      String(r.heading ?? "").padStart(3),
      REFUSED[r.id] ? "REFUSED" : KEEP(r) ? "yes" : "",
    );
  }
  console.error(`${kept.length} of ${rows.length} kept`);
  writeFileSync(join(CACHE, "measured.json"), JSON.stringify(rows, null, 1));

  if (!WRITE) return;
  // Written in the candidate list's order, so a regenerated file diffs cleanly.
  const order = new Map(CANDIDATES.map((c, i) => [c[0], i]));
  kept.sort((a, b) => order.get(a.id) - order.get(b.id));
  const when = new Date().toISOString().slice(0, 10);
  const rowsOut = kept
    .map((r) => {
      const heading = (r.heading + (LOOK[r.id] ?? 0) + 360) % 360;
      return `  [${JSON.stringify(r.id)}, ${JSON.stringify(r.name)}, ${JSON.stringify(r.area)}, ${r.lat}, ${r.lon}, ${r.zoom}, ${heading}],`;
    })
    .join(LF);
  writeFileSync(
    "lib/eye/cities.data.ts",
    `// GENERATED by scripts/gen-eye-cities.mjs on ${when}. Do not edit by hand: change the
// candidates or the gate in that script and run it again. docs/EYE_CITIES.md has the
// measurements behind every row, and lib/eye/places.ts turns a row into a place.

/** id, name, area, lat, lon, zoom, heading */
export type EyeCityRow = readonly [string, string, string, number, number, number, number];

export const EYE_CITY_ROWS: readonly EyeCityRow[] = [
${rowsOut}
];
`,
  );
  const ctaOut = kept
    .map((r) => `  [${JSON.stringify(r.id)}, ${JSON.stringify(SAY[r.id] ?? r.name)}, ${JSON.stringify(r.home)}, ${r.fame}],`)
    .join(LF);
  writeFileSync(
    "lib/marketing/cta-places.data.ts",
    `// GENERATED by scripts/gen-eye-cities.mjs on ${when}, beside lib/eye/cities.data.ts. Do not
// edit by hand. This half goes in the landing page's bundle, so it holds only what the
// button says and who it says it to: no coordinates.

/** id, the words between "See" and "in 3D", home region, fame */
export type CtaPlaceRow = readonly [string, string, string, 1 | 2 | 3];

export const CTA_PLACES: readonly CtaPlaceRow[] = [
${ctaOut}
];
`,
  );
  const doc = [
    "# Cities God's eye view can open",
    "",
    `Generated by \`scripts/gen-eye-cities.mjs\` on ${when}. Do not edit by hand.`,
    "",
    "Each row was read from the OpenFreeMap z14 `building` layer, the tiles the view draws, within 900 m of the",
    "frame's centre. `Cameras` are public cameras from `/api/cameras` within 4 km, the reach of the view's camera cards.",
    "",
    "| Place | Buildings | Over 40 m | Over 100 m | Tallest (m) | Cameras | Offered |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...rows.map((r) => {
      const said = REFUSED[r.id] ? `no: ${REFUSED[r.id]}` : KEEP(r) ? "yes" : "no: too few tall buildings";
      return `| ${r.name} (${r.area}) | ${r.buildings} | ${r.over40} | ${r.over100} | ${r.tallest} | ${r.cameras} | ${said} |`;
    }),
    "",
  ].join("\n");
  writeFileSync("docs/EYE_CITIES.md", doc);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
