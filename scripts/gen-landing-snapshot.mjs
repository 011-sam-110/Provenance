// Save one snapshot of the live map for the landing page's globe.
//
// WHY THIS EXISTS. The globe on `/` (`lib/marketing/landingGlobe.ts`) is not a map: it
// draws ONE committed file, `public/marketing/globe-snapshot.json`. The landing page makes no
// `/api` call and loads no MapLibre, so the dots a visitor sees are whatever this script wrote
// on the day it last ran. That is cheaper than a live globe and it is also a claim with a
// date on it: the page prints `GLOBE_SNAPSHOT.takenAt` beside the globe, and this script is
// the only thing allowed to move that date.
//
// EVERY POINT IS READ FROM PRODUCTION, NONE IS TYPED. The script asks the same routes the
// console asks (`/api/cameras`, `/api/planes`, `/api/signals/<id>`) and keeps nothing but a
// coordinate per row. It has no fixture, no fallback and no last-good copy.
//
// IT WRITES NOTHING UNLESS EVERY LAYER ANSWERED WITH ROWS. The routes are dormant-safe: an
// upstream that fails resolves to `{count: 0, features: []}` with HTTP 200, never a 5xx. That
// is correct for a live map, where an empty layer recovers on the next poll, and it is exactly
// wrong for a file that gets committed: one bad minute would ship a globe with no aircraft
// until somebody happened to notice. So a failed request, a body that is not the expected
// shape, a row set that is empty, or a layer whose every row lacks a usable coordinate each
// end the run with a non-zero exit and BOTH output files untouched.
//
// What it does NOT refuse is a layer that answered with rows and `ok: false` (a partial read,
// or last-good rows served during an upstream outage) or a stale aircraft set. Those are what
// the live map was showing at that moment, so they are a true snapshot of it. Each one is
// named on stderr so the person running this can decide to run it again later.
//
// TWO FILES, ONE DATE. The JSON is what the browser fetches. `globe-snapshot.meta.ts` carries
// the same `takenAt` so the server component can print the date without importing half a
// megabyte of coordinates into its bundle. `tests/unit/landing-snapshot.test.ts` fails if the
// two disagree, which is what a hand-edit of either one would produce.
//
// THE SHAPE IS A CONTRACT with `lib/marketing/landingGlobe.ts`. Do not add, rename or re-nest
// a field here without changing the reader in the same commit:
//
//   { _note, takenAt, layers: { <id>: { label, color, count_in_snapshot, points | lines } } }
//
//   points  [[lon, lat], ...]            3 decimal places, about 110 m
//   lines   [[[lon, lat], ...], ...]     cables only, 2 decimal places, thinned (see thin())
//
// `count_in_snapshot` is the number of points for a point layer. For cables it is the number
// of CABLES, which is fewer than the number of lines: one cable is usually several segments.
// It counts what this file holds. It is not a coverage figure and the page must not print it
// as one. Coverage figures come from `lib/marketing/coverage-audit.data.ts`.
//
// usage:
//   node scripts/gen-landing-snapshot.mjs [baseUrl]
//     default baseUrl:  https://provenance-online.com
//     output:           public/marketing/globe-snapshot.json
//                       lib/marketing/globe-snapshot.meta.ts
//
// Plain Node 20 or later, no dependencies. Run it from the repository root.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = String(process.argv[2] || "https://provenance-online.com").replace(/\/+$/, "");
const OUT_JSON = "public/marketing/globe-snapshot.json";
const OUT_META = "lib/marketing/globe-snapshot.meta.ts";

/**
 * The same ceiling `tests/unit/landing-snapshot.test.ts` holds the committed file to. Checked
 * here as well, so an oversized snapshot is refused before it is written rather than
 * discovered by a red gate after it has replaced the good one.
 */
const MAX_BYTES = 1_000_000;

/** A cold `/api/signals/cables` enriches ~700 per-cable documents and may take most of a minute. */
const TIMEOUT_MS = 90_000;

/**
 * The layers, in the order the file lists them. The reader looks layers up by id, so the
 * order is for a person reading the JSON and nothing else.
 *
 * `label` for a signal layer is its id. That is deliberate and not a missing lookup: the
 * registry's display labels live in TypeScript, this is plain Node, and the page takes its
 * wording from its own copy rather than from this file.
 *
 * Cameras and aircraft are not signal layers and their routes return no per-row layer colour
 * (an aircraft row's `color` is its category, not the layer's), so those two colours are
 * stated here. Every signal layer's colour is read from its first feature.
 */
const LAYERS = [
  { id: "cameras", path: "/api/cameras", rows: "cameras", label: "Traffic cameras", color: "#38bdf8" },
  { id: "planes", path: "/api/planes", rows: "planes", label: "Aircraft (proportional sample)", color: "#f59e0b" },
  ...["earthquakes", "wildfires", "volcanoes", "airports", "ports", "nuclear", "launches", "gdacs"].map((id) => ({
    id,
    path: `/api/signals/${id}`,
    rows: "features",
    label: id,
    color: null,
  })),
  { id: "cables", path: "/api/signals/cables", rows: "features", label: "Submarine cables", color: null, lines: true },
];

/** Thrown for a layer that must stop the run. Collected per layer in main(), so one run names them all. */
class SnapshotError extends Error {}

/** The output files this run has written so far, so an unexpected stop can say what is on disk. */
const written = [];

const fmt = (n) => n.toLocaleString("en-GB");

/**
 * Round through the number's own decimal expansion (`toFixed`) rather than multiplying by a
 * power of ten first, so 51.6145 does not pick up a floating-point error on the way.
 */
const round = (n, dp) => Number(n.toFixed(dp));

/** A coordinate the globe can draw. Anything else is dropped and counted, never guessed at. */
const usable = (lon, lat) =>
  typeof lon === "number" &&
  typeof lat === "number" &&
  Number.isFinite(lon) &&
  Number.isFinite(lat) &&
  lon >= -180 &&
  lon <= 180 &&
  lat >= -90 &&
  lat <= 90;

/**
 * Thin one cable segment.
 *
 * A segment of six vertices or fewer is kept whole: there is nothing to save and a short
 * festoon loses its shape quickly. A longer one keeps every third vertex and then its last,
 * so the cable still ends at its landing point instead of somewhere offshore.
 *
 * When the last vertex is itself a third one it is written twice. That is a zero-length step,
 * it draws nothing, and it is left in on purpose: it is how the first committed snapshot was
 * written, so a run over unchanged cable data reproduces the committed `lines` exactly and a
 * diff of the file shows data that moved rather than a formatting change.
 */
function thin(line) {
  if (line.length <= 6) return line;
  const out = [];
  for (let i = 0; i < line.length; i += 3) out.push(line[i]);
  out.push(line[line.length - 1]);
  return out;
}

/** GET one route and return its parsed body, or stop the run saying which route and why. */
async function read(path) {
  const url = BASE + path;
  let res;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "provenance-gen-landing-snapshot" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new SnapshotError(`${url}: request failed (${err?.cause?.code || err?.name || "error"}: ${err?.message || err})`);
  }
  if (!res.ok) throw new SnapshotError(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // A challenge page or a maintenance curtain answers 200 with HTML. Say so, because
    // "unexpected token <" sends the reader looking for a bug in this script.
    throw new SnapshotError(`${url}: the body is not JSON (it starts ${JSON.stringify(text.slice(0, 60))})`);
  }
}

/** The line strings of one cable feature. A cable is a MultiLineString; a LineString is accepted too. */
function linesOf(feature) {
  const g = feature?.geometry;
  if (!g || !Array.isArray(g.coordinates)) return [];
  if (g.type === "MultiLineString") return g.coordinates;
  if (g.type === "LineString") return [g.coordinates];
  return [];
}

/** One layer, built or refused. `warnings` collects what was accepted but is worth knowing. */
async function build(layer, warnings) {
  const body = await read(layer.path);
  const rows = body?.[layer.rows];
  if (!Array.isArray(rows)) {
    throw new SnapshotError(`${layer.path}: no \`${layer.rows}\` array in the response`);
  }
  if (rows.length === 0) {
    const why = body?.degradedReason || body?.staleness?.reason;
    throw new SnapshotError(`${layer.path}: returned zero rows${why ? ` (${why})` : ""}`);
  }

  if (body.ok === false) {
    warnings.push(`${layer.id}: the route answered ok:false (${body.degradedReason || "no reason given"}), so these rows are partial or last-good`);
  }
  if (body.staleness?.stale) {
    warnings.push(`${layer.id}: the route marks these positions stale (${Math.round((body.staleness.ageMs ?? 0) / 1000)} s old)`);
  }

  const color = layer.color ?? rows[0]?.color;
  if (typeof color !== "string" || color === "") {
    throw new SnapshotError(`${layer.path}: the first feature carries no \`color\`, so the layer has no colour to draw in`);
  }

  if (layer.lines) {
    const lines = [];
    let cables = 0;
    for (const feature of rows) {
      let kept = 0;
      for (const raw of linesOf(feature)) {
        if (!Array.isArray(raw)) continue;
        const clean = raw.filter((p) => Array.isArray(p) && usable(p[0], p[1]));
        if (clean.length < 2) continue;
        lines.push(thin(clean).map((p) => [round(p[0], 2), round(p[1], 2)]));
        kept += 1;
      }
      if (kept > 0) cables += 1;
    }
    if (lines.length === 0) {
      throw new SnapshotError(`${layer.path}: ${fmt(rows.length)} rows, and not one carries a drawable line`);
    }
    if (cables < rows.length) warnings.push(`${layer.id}: ${fmt(rows.length - cables)} of ${fmt(rows.length)} rows had no drawable line and were left out`);
    return { label: layer.label, color, count_in_snapshot: cables, lines };
  }

  const points = [];
  for (const row of rows) {
    if (usable(row?.lon, row?.lat)) points.push([round(row.lon, 3), round(row.lat, 3)]);
  }
  if (points.length === 0) {
    throw new SnapshotError(`${layer.path}: ${fmt(rows.length)} rows, and not one carries a usable coordinate`);
  }
  if (points.length < rows.length) {
    warnings.push(`${layer.id}: ${fmt(rows.length - points.length)} of ${fmt(rows.length)} rows had no usable coordinate and were left out`);
  }
  return { label: layer.label, color, count_in_snapshot: points.length, points };
}

async function main() {
  // One instant for the whole run, to the second. The requests below take a few seconds
  // between them; a snapshot with eleven timestamps would be a precision nobody can use.
  const takenAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();

  // One route at a time. Eleven cold functions asked at once is how a rate limit gets met,
  // and every failure is collected so one run reports all of them rather than the first.
  const layers = {};
  const failures = [];
  const warnings = [];
  for (const layer of LAYERS) {
    try {
      layers[layer.id] = await build(layer, warnings);
    } catch (err) {
      if (!(err instanceof SnapshotError)) throw err;
      failures.push(err.message);
    }
  }

  if (failures.length > 0) {
    console.error(`gen-landing-snapshot: ${failures.length} of ${LAYERS.length} layers failed. Nothing was written.`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }

  const snapshot = {
    _note:
      `One live snapshot from ${BASE} on ${takenAt.slice(0, 10)} (UTC), written by scripts/gen-landing-snapshot.mjs. ` +
      "Coordinates are [lon,lat]. Real data; do not hand-edit. count_in_snapshot is what this file holds, not a coverage figure.",
    takenAt,
    layers,
  };
  const json = JSON.stringify(snapshot) + "\n";
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes >= MAX_BYTES) {
    console.error(
      `gen-landing-snapshot: the snapshot is ${fmt(bytes)} bytes, over the ${fmt(MAX_BYTES)}-byte ceiling. Nothing was written.\n` +
        "  Every visitor to / downloads this file. Thin a layer here rather than raising the ceiling.",
    );
    process.exit(1);
  }

  const meta = `/**
 * GENERATED by \`scripts/gen-landing-snapshot.mjs\`. Do not hand-edit.
 *
 * What the landing globe draws is one saved snapshot of the live map
 * (\`public/marketing/globe-snapshot.json\`), not live data. This file carries the
 * snapshot's own date so the page can print it without importing the ${Math.round(bytes / 1000)} KB JSON
 * into the server bundle. tests/unit/landing-snapshot.test.ts checks the two agree.
 */
export const GLOBE_SNAPSHOT = {
  takenAt: ${JSON.stringify(takenAt)},
  takenFrom: ${JSON.stringify(BASE)},
} as const;
`;

  // Both bodies exist in memory before either file is touched, so every refusal above
  // leaves the committed pair exactly as it was.
  writeFileSync(resolve(OUT_JSON), json, "utf8");
  written.push(OUT_JSON);
  writeFileSync(resolve(OUT_META), meta, "utf8");
  written.push(OUT_META);

  console.log(`${OUT_JSON}: ${LAYERS.length} layers, ${fmt(bytes)} bytes, taken ${takenAt} from ${BASE}`);
  for (const layer of LAYERS) {
    const l = layers[layer.id];
    const extra = l.lines ? ` in ${fmt(l.lines.length)} lines` : "";
    console.log(`  ${layer.id.padEnd(12)} ${fmt(l.count_in_snapshot).padStart(7)}${extra}  ${l.color}`);
  }
  console.log(`${OUT_META}: takenAt ${takenAt}`);
  for (const w of warnings) console.error(`  note: ${w}`);
}

main().catch((err) => {
  // Not a refusal: something this script did not expect. Say exactly what reached the disk,
  // because if the first write landed and the second did not, the two files now disagree
  // and tests/unit/landing-snapshot.test.ts will say so until the script is run again.
  console.error(
    `gen-landing-snapshot: stopped on an unexpected error. ${
      written.length === 0 ? "Nothing was written." : `Written before it stopped: ${written.join(", ")}. Run it again.`
    }`,
  );
  console.error(err);
  process.exit(1);
});
