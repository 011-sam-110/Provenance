#!/usr/bin/env node
// Re-harvest lib/signals/nuclear.data.ts: the OpenStreetMap nuclear power-plant set,
// read from QLever's OSM-planet index (Overpass refused this query from every mirror
// on 2026-10-16: 406, 500, 502), joined to Wikidata's "state of use" (P5817) and
// "dissolved, abolished or demolished" date (P576) through each plant's OSM
// `wikidata` tag.
//
//   node scripts/harvest-nuclear.mjs            write the file
//   node scripts/harvest-nuclear.mjs --dry-run  print counts only
//
// It writes NOTHING when either upstream fails or the plant count is implausible, so a
// bad run cannot replace a good snapshot. The query and the mapping mirror
// QLEVER_QUERY / qleverToElements / wikidataStatusQuery in lib/signals/nuclear.ts;
// change them together.
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const QLEVER = "https://qlever.dev/api/osm-planet";
const WIKIDATA = "https://query.wikidata.org/sparql";
const OUT = "lib/signals/nuclear.data.ts";
const PLAUSIBLE_MIN = 100;

const QUERY = `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm ?name ?nameEn ?output ?operator ?start ?wikidata ?centroid WHERE {
  ?osm osmkey:power "plant" .
  ?osm osmkey:plant:source "nuclear" .
  ?osm geo:hasGeometry/geo:asWKT ?g .
  BIND (geof:centroid(?g) AS ?centroid)
  OPTIONAL { ?osm osmkey:name ?name }
  OPTIONAL { ?osm osmkey:name:en ?nameEn }
  OPTIONAL { ?osm osmkey:plant:output:electricity ?output }
  OPTIONAL { ?osm osmkey:operator ?operator }
  OPTIONAL { ?osm osmkey:start_date ?start }
  OPTIONAL { ?osm osmkey:wikidata ?wikidata }
}`;

async function sparql(endpoint, query, timeoutMs) {
  try {
    return await sparqlOnce(endpoint, query, timeoutMs);
  } catch (err) {
    // Some networks drop the first SYNs to qlever.dev, so the TCP connect takes ~20 s
    // and undici gives up at its fixed 10 s connect timeout (seen from a UK box on
    // 2026-10-16, where curl got through on the same host). curl waits longer.
    console.warn(`${endpoint}: ${err.cause?.code ?? err.message}; retrying with curl`);
    const out = execFileSync(
      "curl",
      ["-sS", "--fail", "--max-time", String(Math.ceil(timeoutMs / 1000)), "-A", UA,
       "-H", "Accept: application/sparql-results+json", "--data-urlencode", `query=${query}`, endpoint],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(out.toString("utf8")).results.bindings;
  }
}

async function sparqlOnce(endpoint, query, timeoutMs) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: `query=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${endpoint} answered ${res.status}`);
  return (await res.json()).results.bindings;
}

const round = (n) => Math.round(n * 1e5) / 1e5;

function toElements(bindings) {
  const out = [];
  for (const b of bindings) {
    const v = (k) => b[k]?.value?.trim() ?? "";
    const m = v("osm").match(/openstreetmap\.org\/(node|way|relation)\/(\d+)$/);
    const p = v("centroid").match(/POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/);
    if (!m || !p) continue;
    const tags = {};
    for (const [k, t] of [["name", "name"], ["nameEn", "name:en"], ["output", "plant:output:electricity"], ["operator", "operator"], ["start", "start_date"], ["wikidata", "wikidata"]]) {
      if (v(k)) tags[t] = v(k);
    }
    if (!tags.name && !tags["name:en"]) continue;
    out.push({ type: m[1], id: Number(m[2]), lat: round(Number(p[2])), lon: round(Number(p[1])), tags });
  }
  return out;
}

function statusQuery(qids) {
  return `SELECT ?item ?statusLabel ?end WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(" ")} }
  OPTIONAL { ?item wdt:P5817 ?status . }
  OPTIONAL { ?item wdt:P576 ?end . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

function toStatus(bindings) {
  const labels = new Map();
  const ends = new Map();
  for (const b of bindings) {
    const q = b.item.value.split("/").pop();
    if (b.statusLabel?.value) labels.set(q, [...new Set([...(labels.get(q) ?? []), b.statusLabel.value])]);
    if (b.end?.value) ends.set(q, b.end.value.slice(0, 10));
  }
  const out = {};
  for (const q of new Set([...labels.keys(), ...ends.keys()])) {
    const parts = [...(labels.get(q) ?? [])].sort();
    if (ends.has(q)) parts.push(`closed ${ends.get(q)}`);
    out[q] = parts.join("; ");
  }
  return out;
}

const dry = process.argv.includes("--dry-run");
const t0 = Date.now();
const elements = toElements(await sparql(QLEVER, QUERY, 120_000));
if (elements.length < PLAUSIBLE_MIN) {
  console.error(`QLever returned ${elements.length} named plants (< ${PLAUSIBLE_MIN}); nothing written`);
  process.exit(1);
}
const qids = [...new Set(elements.map((e) => e.tags.wikidata).filter((q) => /^Q\d+$/.test(q ?? "")))];
const status = toStatus(await sparql(WIKIDATA, statusQuery(qids), 60_000));
for (const e of elements) {
  const s = status[e.tags.wikidata ?? ""];
  if (s) e.status = s;
}
elements.sort((a, b) => `${a.type}/${a.id}`.localeCompare(`${b.type}/${b.id}`));
const today = new Date().toISOString().slice(0, 10);
console.log(`${elements.length} named plants, ${qids.length} with a Wikidata id, ${Object.keys(status).length} with a status, ${Date.now() - t0} ms`);
if (dry) process.exit(0);

const body = `// GENERATED by scripts/harvest-nuclear.mjs — do not hand-edit. A dated snapshot of
// the OpenStreetMap nuclear power-plant set, so this layer is never dark while the
// live read is slow or refused. Real OSM data — NOT a placeholder, NOT synthesised:
// every row came from the query in that script (QLever's OSM-planet index), with only
// the tags we render kept and the centroid rounded to 5dp (~1 m). \`status\` is the
// plant's Wikidata "state of use" (P5817) and "closed" date (P576), joined through the
// OSM \`wikidata\` tag; absent when Wikidata states neither.
//
// Harvested: ${today} (UTC) from qlever.dev/api/osm-planet + query.wikidata.org
// Rows:      ${elements.length} named plants (${Object.keys(status).length} with a Wikidata status)
// Refresh:   node scripts/harvest-nuclear.mjs; lib/signals/nuclear.ts upgrades to the
//            live answer at runtime whenever QLever responds inside its budget.
import type { OsmNuclearElement } from "@/lib/signals/nuclear";

/** ISO date the snapshot below was harvested. Rendered as provenance. */
export const NUCLEAR_SNAPSHOT_DATE = "${today}";

/** The snapshot, in the SAME element shape the live read maps to, so one pure mapper
 *  (normalizeOsmNuclear) serves both paths. */
export const NUCLEAR_SNAPSHOT: OsmNuclearElement[] = [
${elements.map((e) => `  ${JSON.stringify(e)},`).join("\n")}
];
`;
writeFileSync(OUT, body);
console.log(`wrote ${OUT}`);
