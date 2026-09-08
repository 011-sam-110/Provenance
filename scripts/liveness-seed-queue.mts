/**
 * Build a review queue from cameras that already carry a playable stream.
 *
 *   node --import ./scripts/ts-alias-hook.mjs scripts/liveness-seed-queue.mts --limit=6
 *
 * WHAT THIS IS FOR, HONESTLY. The acquisition pipeline has no candidates yet: Stage A
 * measured the twelve silent feeds and found nothing admissible (see
 * docs/superpowers/research/2026-09-08-liveness-stage-a-findings.md). So the only real
 * live streams available today are the feeds already on the map, and this pulls a
 * handful into the queue so the review deck can be exercised against genuine moving
 * video rather than declared working on the strength of it compiling.
 *
 * THESE CAMERAS ARE ALREADY LIVE ON THE MAP. Queueing one changes nothing about what
 * the product serves: SCDOT is grandfathered in lib/liveness/ledger.ts, so the gate
 * passes its cameras through whatever the ledger says. Admitting one here is a note in
 * a file, not a publication.
 *
 * WHY IT DOES NOT IMPORT THE ADAPTER. Node executes TypeScript by stripping types, not
 * by understanding them, so a module importing a type without the `type` keyword fails
 * at runtime — lib/sources/scdot.ts does exactly that on line 1. Rewriting a production
 * adapter to suit a seeding script would be the tail wagging the dog, and it is a file
 * other sessions are working in. Reading the same upstream directly costs ten lines.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { QUEUE_PATH, type LiveQueue, type QueueCamera } from "@/lib/liveness/queue";

const argv = process.argv.slice(2);
const value = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const LIMIT = Number(value("limit") ?? 6);

/** The same endpoint and Referer lib/sources/scdot.ts uses, so this reads what it reads. */
const SCDOT = "https://sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson";

interface ScFeature {
  properties?: {
    id?: string | number;
    name?: string;
    description?: string;
    image_url?: string;
    https_url?: string;
    ios_url?: string;
    active?: boolean;
    problem_stream?: boolean;
  };
  geometry?: { coordinates?: [number, number] };
}

const res = await fetch(SCDOT, {
  headers: { Accept: "application/json", Referer: "https://www.511sc.org/" },
  signal: AbortSignal.timeout(20_000),
});
if (!res.ok) {
  console.error(`SCDOT GeoJSON: ${res.status}`);
  process.exit(1);
}
const json = (await res.json()) as { features?: ScFeature[] };
const features = json.features ?? [];

const cameras: QueueCamera[] = [];
for (const f of features) {
  if (cameras.length >= LIMIT) break;
  const p = f.properties;
  const coords = f.geometry?.coordinates;
  const streamUrl = p?.https_url?.trim() || p?.ios_url?.trim();
  // The operator's own two flags. Queueing a camera SCDOT already says is broken would
  // waste a review slot proving something the feed already told us.
  if (!p || !coords || !streamUrl || p.active !== true || p.problem_stream === true) continue;
  // The id has to be built EXACTLY as lib/sources/scdot.ts builds it -- `p.name` first,
  // falling back to `p.id`. A ledger keyed on a different id would look perfectly
  // healthy and admit nothing, because no camera the registry emits would ever match it.
  const nativeId = (p.name ?? p.id ?? "").toString().trim();
  if (!nativeId) continue;
  cameras.push({
    cameraId: `scdot:${nativeId}`,
    feed: "scdot",
    name: p.description?.trim() || p.name?.trim() || `SCDOT ${nativeId}`,
    lat: coords[1],
    lon: coords[0],
    country: "US",
    streamUrl,
    kind: "hls",
    // Same thumbs-to-root rewrite the adapter does: the advertised thumb URL 301s, and
    // the review proxy would otherwise show a broken still beside a working stream.
    imageUrl: p.image_url?.trim().replace("/thumbs/", "/").replace(/\.flv\.png$/, ".png"),
    operator: "South Carolina DOT (511SC)",
    license: "SCDOT 511 public camera feed — no stated licence",
    attribution: "South Carolina DOT (511SC)",
    flags: ["Seeded from an already-live feed to exercise the deck. Not an acquisition."],
  });
}

const queue: LiveQueue = { version: 1, generatedAt: new Date().toISOString(), cameras };
mkdirSync(dirname(QUEUE_PATH), { recursive: true });
writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n", "utf8");

console.log(`scdot: ${features.length} features, ${cameras.length} queued`);
for (const c of cameras) console.log(`  ${c.cameraId}  ${c.name}`);
