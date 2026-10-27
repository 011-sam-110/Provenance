#!/usr/bin/env node
// Writes lib/roads/hk-irn-segments.data.json: the road line of every Hong Kong segment
// the Transport Department publishes a speed for.
//
// WHY A COMMITTED FILE. The speeds (irnAvgSpeed-all.xml, every 2 minutes) name each road
// segment only by its id. The line of each segment is in the Transport Department's Road
// Network dataset (CENTERLINE layer, ROUTE_ID), served by the CSDI Portal. That is a whole
// territory of roads; we need 4,525 of them, and they change only when TD revises the
// network. So this script asks the CSDI Portal for exactly those ids, once, simplifies each
// line to about 5 m, and commits the result. The server then joins speeds to lines in
// memory and never calls the CSDI Portal.
//
// Run it again when TD's speed file names a new `irn_version`, or to pick up new segments:
//   node scripts/gen-hk-irn-segments.mjs
// It writes nothing if either source fails or if fewer than 90% of the ids get a line.
//
// Terms: DATA.GOV.HK and the CSDI Portal both allow commercial and non-commercial use free
// of charge, on condition that the source is named, the Government's and the Transport
// Department's ownership is acknowledged, and attribution is given (read 27 Oct 2026).

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SPEEDS = "https://resource.data.one.gov.hk/td/traffic-detectors/irnAvgSpeed-all.xml";
const CENTERLINE =
  "https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638949160594_2844/FeatureServer/10/query";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "roads", "hk-irn-segments.data.json");
const BATCH = 150;
const TOLERANCE = 0.00005; // about 5 m

const round5 = (v) => Math.round(v * 1e5) / 1e5;

function offset(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

function simplify(line) {
  if (line.length <= 2) return line.map(([x, y]) => [round5(x), round5(y)]);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = offset(line[k], line[i], line[j]);
      if (d > worst) [worst, at] = [d, k];
    }
    if (at > 0 && worst > TOLERANCE) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return line.filter((_, k) => keep[k]).map(([x, y]) => [round5(x), round5(y)]);
}

const xml = await (await fetch(SPEEDS)).text();
const ids = [...xml.matchAll(/<segment_id>(\d+)<\/segment_id>/g)].map((m) => m[1]);
const irnVersion = xml.match(/<irn_version>([^<]+)<\/irn_version>/)?.[1];
if (ids.length < 1000 || !irnVersion) {
  console.error(`speed file looks wrong (${ids.length} ids, irn_version ${irnVersion}); nothing written`);
  process.exit(1);
}

const segments = {};
for (let i = 0; i < ids.length; i += BATCH) {
  const batch = ids.slice(i, i + BATCH);
  const params = new URLSearchParams({
    where: `ROUTE_ID IN (${batch.join(",")})`,
    outFields: "ROUTE_ID,STREET_ENAME,TRAVEL_DIRECTION",
    outSR: "4326",
    f: "geojson",
  });
  const res = await fetch(`${CENTERLINE}?${params}`, { headers: { "User-Agent": "Provenance/1.0 (+github.com/011-sam-110/Provenance)" } });
  if (!res.ok) {
    console.error(`CSDI answered ${res.status} at batch ${i / BATCH}; nothing written`);
    process.exit(1);
  }
  const fc = await res.json();
  for (const f of fc.features ?? []) {
    const id = String(f.properties?.ROUTE_ID ?? "");
    const g = f.geometry;
    const lines = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : [];
    if (!id || lines.length === 0) continue;
    const name = typeof f.properties.STREET_ENAME === "string" ? f.properties.STREET_ENAME.trim() : "";
    segments[id] = { ...(name ? { n: name } : {}), c: lines.map(simplify).filter((l) => l.length >= 2) };
  }
}

const found = ids.filter((id) => segments[id]).length;
if (found < ids.length * 0.9) {
  console.error(`only ${found} of ${ids.length} segments got a line; nothing written`);
  process.exit(1);
}
const body = {
  irnVersion,
  generatedAt: new Date().toISOString(),
  speedSegments: ids.length,
  withLine: found,
  source: "Road Network (CENTERLINE), Transport Department, HKSAR Government, via the CSDI Portal",
  segments,
};
writeFileSync(OUT, JSON.stringify(body) + "\n");
console.log(`wrote ${OUT}: ${found} of ${ids.length} segments, irn_version ${irnVersion}`);
