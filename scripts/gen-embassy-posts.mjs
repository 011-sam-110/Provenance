#!/usr/bin/env node
// Writes lib/signals/embassy-posts.data.ts: every U.S. embassy or consulate website that
// publishes an alert feed, with the cities of its country that an alert may name.
//
//   node --max-http-header-size=65536 scripts/gen-embassy-posts.mjs <path to GeoNames cities15000.txt>
//
// The header flag is needed: every usembassy.gov page sends a ~16 KB Content-Security-Policy
// header, over Node's 16 KB default, and fetch fails with UND_ERR_HEADERS_OVERFLOW without it.
//
// Get the GeoNames file from https://download.geonames.org/export/dump/cities15000.zip
// (CC BY 4.0; the layer's attribution credits GeoNames because of it).
//
// WHAT IT DOES
//   1. Reads the list of post websites from https://www.usembassy.gov/ (the State
//      Department's own index). Missions to international bodies (NATO, the UN, the
//      OSCE...) have no country and are left out.
//   2. Asks each post's /category/alert/feed/ once, at most 2 a second, and keeps the
//      posts that answer an RSS feed. A post that does not is listed in the header.
//   3. For each kept post, takes the cities of its country from GeoNames: the capital,
//      every place of 200,000 people or more, and every first-order administrative seat
//      of 100,000 or more. An alert is placed on one of these only when it NAMES it.
//
// The User-Agent matters: the State Department's CDN refuses a bare "Mozilla/5.0" and
// curl's default, and accepts a bot UA that names itself.

import { readFileSync, writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (compatible; Provenance/2.0; +https://provenance-online.com)";
const OUT = "lib/signals/embassy-posts.data.ts";
const geonamesPath = process.argv[2];
if (!geonamesPath) {
  console.error("usage: node scripts/gen-embassy-posts.mjs <cities15000.txt>");
  process.exit(1);
}

const NOT_A_COUNTRY = new Set(["www", "search", "asean", "geneva", "icao", "nato", "osce", "useu", "usoas", "usoecd", "usunrome", "usun", "vienna", "usau"]);
// Subdomains that are not the country's ISO code.
const ISO_OF = { uk: "GB" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const index = await (await fetch("https://www.usembassy.gov/", { headers: { "User-Agent": UA } })).text();
const hosts = [...new Set([...index.matchAll(/https?:\/\/(?:www\.)?([a-z0-9-]+)\.(usembassy|usconsulate|usmission)\.gov/g)].map((m) => `${m[1]}.${m[2]}.gov`))]
  .filter((h) => !NOT_A_COUNTRY.has(h.split(".")[0]))
  .filter((h) => /^[a-z]{2}\./.test(h))
  .sort();

const kept = [];
const refused = [];
for (const host of hosts) {
  try {
    const res = await fetch(`https://${host}/category/alert/feed/`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
    const body = await res.text();
    if (res.ok && body.includes("<rss")) kept.push(host);
    else refused.push(`${host} (${res.status})`);
  } catch (e) {
    refused.push(`${host} (${e?.name ?? "error"})`);
  }
  await sleep(500);
}

// GeoNames: geonameid, name, asciiname, alternatenames, lat, lon, fclass, fcode, cc, cc2,
// admin1, admin2, admin3, admin4, population, elevation, dem, tz, modified
const byCountry = new Map();
for (const line of readFileSync(geonamesPath, "utf8").split("\n")) {
  const c = line.split("\t");
  if (c.length < 15) continue;
  const [, name, ascii, , lat, lon, , fcode, cc] = c;
  const pop = Number(c[14]) || 0;
  const keep = fcode === "PPLC" || pop >= 200_000 || (fcode === "PPLA" && pop >= 100_000);
  if (!keep) continue;
  let list = byCountry.get(cc);
  if (!list) byCountry.set(cc, (list = []));
  list.push({ name, ascii, lat: Math.round(Number(lat) * 1e4) / 1e4, lon: Math.round(Number(lon) * 1e4) / 1e4, pop, capital: fcode === "PPLC" });
}

const rows = [];
let cityCount = 0;
for (const host of kept) {
  const sub = host.split(".")[0];
  const iso2 = ISO_OF[sub] ?? sub.toUpperCase();
  const cities = (byCountry.get(iso2) ?? []).sort((a, b) => Number(b.capital) - Number(a.capital) || b.pop - a.pop);
  cityCount += cities.length;
  const cityText = cities
    .map((c) => `[${JSON.stringify(c.name)}, ${c.lat}, ${c.lon}${c.ascii && c.ascii !== c.name ? `, ${JSON.stringify(c.ascii)}` : ""}]`)
    .join(", ");
  rows.push(`  { host: ${JSON.stringify(host)}, iso2: ${JSON.stringify(iso2)}, cities: [${cityText}] },`);
}

const header = `// GENERATED FILE — do not hand-edit. Regenerate with:
//   node --max-http-header-size=65536 scripts/gen-embassy-posts.mjs <GeoNames cities15000.txt>
//
// WHAT THIS IS: every U.S. embassy or consulate website listed on www.usembassy.gov that
// answered an RSS alert feed at /category/alert/feed/ when this file was written, with the
// cities of its country an alert may name. The first city of each row is the capital.
//
// SOURCES: the post list is the State Department's own index (public domain). The cities
// are GeoNames "cities15000" (https://www.geonames.org, CC BY 4.0): the capital, places
// of 200,000 people or more, and first-order administrative seats of 100,000 or more.
// That attribution travels with the data, so the layers that place alerts with this
// table credit GeoNames.
//
// Captured: ${new Date().toISOString()}
// Posts listed: ${hosts.length}; with a feed: ${kept.length}; cities: ${cityCount}
// No feed: ${refused.join(", ") || "none"}

/** [display name, lat, lon, ascii spelling when it differs] */
export type PostCity = [string, number, number, string?];

export interface EmbassyPost {
  /** The post's website host. Its alert feed is https://<host>/category/alert/feed/. */
  host: string;
  /** ISO-3166 alpha-2 of the country the post covers. */
  iso2: string;
  /** The capital first, then the larger places, by population. */
  cities: PostCity[];
}

export const EMBASSY_POSTS: EmbassyPost[] = [
`;
writeFileSync(OUT, `${header}${rows.join("\n")}\n];\n`);
console.log(`wrote ${OUT}: ${kept.length} posts, ${cityCount} cities; no feed: ${refused.length}`);
