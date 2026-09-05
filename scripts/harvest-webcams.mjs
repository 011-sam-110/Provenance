#!/usr/bin/env node
// Harvests Windy's webcam catalogue into committed tiles under public/webcams/.
//
// WHAT THIS REPLACES. lib/sources/windy.ts fans out across 18 hand-written region boxes
// at 2 pages of 50 each — a 100-row ceiling per region regardless of what the region
// holds. Prod /api/webcams answered `count: 1567` on 2026-09-05 against a live global
// total of 70,736: 2.2%, and an unranked 2.2% (the `w-europe` box holds 19,204 webcams,
// fetches 100, and on the measured day returned zero Belgian cameras while containing
// Brussels).
//
// HOW IT WORKS. Two phases, both driven by lib/webcams/harvest.ts's planner:
//
//   plan   — probe the globe with one-row requests, subdividing any box holding more
//            than LEAF_CAPACITY, until every leaf can be read completely. Measured
//            live 2026-09-05: 301 probes resolve the world into 208 leaves.
//   cycle  — page the STALEST leaves within a request budget, write their tiles, and
//            record when each was read.
//
// WHY A ROLLING CYCLE RATHER THAN ONE BIG RUN. Reading everything costs ~1,524 paging
// requests. Windy publishes no daily quota and returns no rate-limit headers, so the
// ceiling is genuinely unknown — and the safe way to spend an unknown budget is at a
// low constant rate, not in one burst. At the default budget on a 30-minute schedule
// this is ~2 requests a minute, fills the whole catalogue in about half a day, and
// then keeps rolling as a refresh. Coverage only ever goes up.
//
// A leaf that is not read this cycle KEEPS ITS EXISTING TILE. Nothing is deleted
// because a cycle did not reach it — same last-good contract as registry.ts's
// mergeResults, for the same reason.
//
// Usage
//   node scripts/harvest-webcams.mjs --plan              rebuild the leaf plan (~300 requests)
//   node scripts/harvest-webcams.mjs --cycle             one refresh cycle (default budget 60)
//   node scripts/harvest-webcams.mjs --cycle --budget 200
//   node scripts/harvest-webcams.mjs --status            print coverage, make no requests
//   node scripts/harvest-webcams.mjs --manifest          rebuild the manifest from disk, no requests
//
// Env: WINDY_WEBCAMS_API_KEY (loaded from .env.local if present)

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_PATH = path.join(ROOT, "data", "webcams", "plan.json");
const TILE_DIR = path.join(ROOT, "public", "webcams", "t");
const MANIFEST_PATH = path.join(ROOT, "public", "webcams", "manifest.json");

// --- the pure core, duplicated from lib/webcams/harvest.ts -------------------------
//
// This is a plain .mjs generator with no TypeScript import path into the app, the same
// situation scripts/gen-digitraffic-join.mjs is in with its copy of haversineKm. The
// constants below are pinned against the TS module by
// tests/unit/webcams-harvest-script-parity.test.ts, so the copy cannot drift silently.

const WINDY_PAGE_LIMIT = 50;
const WINDY_MAX_OFFSET = 1000;
const LEAF_CAPACITY = WINDY_MAX_OFFSET + WINDY_PAGE_LIMIT;
const MAX_DEPTH = 12;
const WORLD = [90, 180, -90, -180];

function splitBox([n, e, s, w]) {
  const midLat = (n + s) / 2;
  const midLon = (e + w) / 2;
  return [
    [n, e, midLat, midLon], // 0 NE
    [n, midLon, midLat, w], // 1 NW
    [midLat, e, s, midLon], // 2 SE
    [midLat, midLon, s, w], // 3 SW
  ];
}

const boxPath = (indices) => "r" + indices.join("");

function pageOffsets(total) {
  const offsets = [];
  for (let o = 0; o < total && o <= WINDY_MAX_OFFSET; o += WINDY_PAGE_LIMIT) offsets.push(o);
  return offsets;
}

const leafRequestCost = (total) => pageOffsets(total).length;
const needsSplit = (total, depth) => total > LEAF_CAPACITY && depth < MAX_DEPTH;

function selectLeavesForCycle(leaves, budget) {
  const order = [...leaves].sort((a, b) => a.fetchedAt - b.fetchedAt || a.k.localeCompare(b.k));
  const picked = [];
  let cost = 0;
  for (const leaf of order) {
    const c = leafRequestCost(leaf.total);
    if (cost + c > budget) {
      if (picked.length === 0 && c > budget) {
        picked.push(leaf);
        cost += c;
      }
      break;
    }
    picked.push(leaf);
    cost += c;
  }
  return { picked, cost };
}

// --- network -----------------------------------------------------------------------

const BASE = "https://api.windy.com/webcams/api/v3/webcams";
const INCLUDE = "images,location,urls,categories";
const CONCURRENCY = 4;

/**
 * Consecutive upstream refusals before the run stops.
 *
 * Windy publishes no quota, so the only signal that we have spent too much is the
 * refusals themselves. Stopping on a short streak means an unknown daily ceiling costs
 * one truncated cycle, and the next scheduled cycle resumes from the same cursor —
 * rather than a run that keeps hammering a limit it has already hit.
 */
const ABORT_AFTER_CONSECUTIVE_FAILURES = 5;

let apiKey = process.env.WINDY_WEBCAMS_API_KEY || "";
let requests = 0;
let consecutiveFailures = 0;
let aborted = false;

async function loadKey() {
  if (apiKey) return;
  const envPath = path.join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of (await readFile(envPath, "utf8")).split(/\r?\n/)) {
    const m = /^WINDY_WEBCAMS_API_KEY=(.*)$/.exec(line.trim());
    if (m) apiKey = m[1].trim().replace(/^["']|["']$/g, "");
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One upstream call, with backoff on the responses that mean "slow down".
 *
 * A 429 or 5xx is retried with exponential backoff; a 400 is NOT — it means the
 * request itself was refused (an offset past the tier ceiling, a limit over 50), and
 * retrying it just spends quota on the same refusal.
 */
async function windy(params, attempt = 0) {
  if (aborted) return null;
  const url = `${BASE}?${new URLSearchParams(params)}`;
  try {
    const res = await fetch(url, {
      headers: { "x-windy-api-key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    requests++;
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) {
        noteFailure(`HTTP ${res.status}`);
        return null;
      }
      await sleep(1000 * 2 ** attempt);
      return windy(params, attempt + 1);
    }
    if (!res.ok) {
      noteFailure(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
      return null;
    }
    consecutiveFailures = 0;
    return res.json();
  } catch (err) {
    requests++;
    if (attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      return windy(params, attempt + 1);
    }
    noteFailure(err.message);
    return null;
  }
}

function noteFailure(why) {
  consecutiveFailures++;
  console.warn(`  ! ${why}`);
  if (consecutiveFailures >= ABORT_AFTER_CONSECUTIVE_FAILURES) {
    aborted = true;
    console.warn(`  ! ${consecutiveFailures} consecutive failures — stopping this run early.`);
  }
}

/** Windy's own count for a box. One row, so it costs a request and returns nothing else. */
async function probeTotal(box) {
  const json = await windy({ bbox: box.join(","), limit: "1", offset: "0" });
  return json && typeof json.total === "number" ? json.total : -1;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length && !aborted) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// --- normalisation ------------------------------------------------------------------
//
// Mirrors normalizeWindyWebcam in lib/sources/windy.ts, minus the image URLs: free-tier
// image URLs are tokened and expire in 15 minutes, so storing one in a committed tile
// would ship a dead link. The dossier re-resolves a fresh image per view through
// /api/webcam-image, which is exactly why the existing /api/webcams omits them too.

// Rows are written POSITIONALLY, in the column order lib/webcams/tiles.ts declares —
// an object per webcam spends ~80 bytes a row on repeated key names, which is ~5.6 MB
// across the catalogue and is paid again in git history on every refresh. TILE_VERSION
// exists so a reader refuses a tile written under a different column order rather than
// decoding it by index into wrong values.
//
// Kept in step with lib/webcams/tiles.ts by tests/unit/webcams-harvest-script-parity.ts.
const TILE_VERSION = 1;
const round5 = (n) => Math.round(n * 1e5) / 1e5;

/** Upstream webcam -> one positional row, or null when it cannot be placed. */
function encodeRow(w) {
  const id = w.webcamId;
  const loc = w.location;
  if (id === undefined || id === null || !loc) return null;
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  // `detailUrl` is not stored: it is https://www.windy.com/webcams/{id} for every row,
  // so tiles.ts's webcamUrl() rebuilds it.
  return [
    Number(id),
    w.title?.trim() || `Webcam ${id}`,
    round5(lat),
    round5(lon),
    loc.country_code ? String(loc.country_code).toUpperCase() : "",
    loc.region?.trim() || "",
    loc.city?.trim() || "",
    String(w.status ?? "unknown") === "active" ? 1 : 0,
    (w.categories ?? []).map((c) => c?.name?.trim()).filter(Boolean).join("|"),
  ];
}

// --- phases -------------------------------------------------------------------------

async function readPlan() {
  if (!existsSync(PLAN_PATH)) return null;
  return JSON.parse(await readFile(PLAN_PATH, "utf8"));
}

async function writePlan(plan) {
  await mkdir(path.dirname(PLAN_PATH), { recursive: true });
  await writeFile(PLAN_PATH, JSON.stringify(plan, null, 2) + "\n");
}

async function buildPlan() {
  console.log("plan: probing the globe (one row per box)...");
  const worldTotal = await probeTotal(WORLD);
  if (worldTotal < 0) throw new Error("world probe failed — check the key");
  console.log(`  world total: ${worldTotal.toLocaleString()}`);

  const leaves = [];
  let failed = 0;
  let queue = [{ box: WORLD, total: worldTotal, path: [] }];

  while (queue.length > 0 && !aborted) {
    const over = [];
    for (const node of queue) {
      if (node.total === 0) continue;
      if (!needsSplit(node.total, node.path.length)) {
        leaves.push({ k: boxPath(node.path), box: node.box, total: node.total, depth: node.path.length });
      } else {
        over.push(node);
      }
    }
    if (over.length === 0) break;

    const jobs = [];
    for (const node of over) {
      splitBox(node.box).forEach((box, i) => jobs.push({ box, path: [...node.path, i] }));
    }
    const totals = await mapPool(jobs, CONCURRENCY, (j) => probeTotal(j.box));
    queue = [];
    for (let i = 0; i < jobs.length; i++) {
      const t = totals[i];
      // A failed probe is DROPPED, never recorded as 0 — see lib/webcams/harvest.ts.
      if (typeof t !== "number" || t < 0) { failed++; continue; }
      queue.push({ box: jobs[i].box, total: t, path: jobs[i].path });
    }
    console.log(`  depth ${jobs[0].path.length}: ${jobs.length} probes, ${leaves.length} leaves so far`);
  }

  leaves.sort((a, b) => b.depth - a.depth || a.k.localeCompare(b.k));

  const previous = await readPlan();
  const wasFetched = new Map((previous?.leaves ?? []).map((l) => [l.k, l]));
  const stateful = leaves.map((l) => {
    const prev = wasFetched.get(l.k);
    return { ...l, fetchedAt: prev?.fetchedAt ?? 0, rows: prev?.rows ?? 0 };
  });

  const plan = {
    version: 1,
    generatedAt: new Date().toISOString(),
    worldTotal,
    probes: requests,
    failedProbes: failed,
    leaves: stateful,
  };
  await writePlan(plan);
  const pages = stateful.reduce((s, l) => s + leafRequestCost(l.total), 0);
  console.log(
    `plan: ${stateful.length} leaves, ${requests} probes, ${failed} failed. ` +
    `Full sweep costs ${pages} paging requests.`,
  );
  return plan;
}

async function pageLeaf(leaf) {
  const offsets = pageOffsets(leaf.total);
  const pages = await mapPool(offsets, CONCURRENCY, (offset) =>
    windy({
      bbox: leaf.box.join(","),
      limit: String(WINDY_PAGE_LIMIT),
      offset: String(offset),
      include: INCLUDE,
      lang: "en",
    }),
  );
  const seen = new Set();
  const rows = [];
  let anyPageSucceeded = false;
  for (const page of pages) {
    if (!page) continue;
    anyPageSucceeded = true;
    for (const raw of page.webcams ?? []) {
      const row = encodeRow(raw);
      if (!row || seen.has(row[0])) continue;
      seen.add(row[0]);
      rows.push(row);
    }
  }
  return { rows, ok: anyPageSucceeded };
}

async function runCycle(budget) {
  const plan = (await readPlan()) ?? (await buildPlan());
  const { picked, cost } = selectLeavesForCycle(plan.leaves, budget);
  console.log(`cycle: ${picked.length} leaves, ~${cost} planned requests (budget ${budget})`);

  await mkdir(TILE_DIR, { recursive: true });
  const byKey = new Map(plan.leaves.map((l) => [l.k, l]));
  let written = 0;
  let rowsWritten = 0;
  let activeRows = 0;

  for (const leaf of picked) {
    if (aborted) break;
    const { rows, ok } = await pageLeaf(leaf);
    if (!ok) {
      // Every page of this leaf failed. Leave its tile and its fetchedAt alone so the
      // next cycle retries it as still-stalest, rather than recording an empty read.
      console.warn(`  ~ ${leaf.k}: all pages failed, keeping last-good`);
      continue;
    }
    await writeFile(
      path.join(TILE_DIR, `${leaf.k}.json`),
      JSON.stringify({ v: TILE_VERSION, k: leaf.k, box: leaf.box, at: Date.now(), w: rows }),
    );
    const state = byKey.get(leaf.k);
    state.fetchedAt = Date.now();
    state.rows = rows.length;
    written++;
    rowsWritten += rows.length;
    activeRows += rows.filter((r) => r[7] === 1).length;
    process.stdout.write(`\r  ${written}/${picked.length} tiles, ${rowsWritten} rows, ${requests} requests`);
  }
  process.stdout.write("\n");

  await writePlan(plan);
  await writeManifest(plan);

  const share = rowsWritten > 0 ? ((activeRows / rowsWritten) * 100).toFixed(1) : "0.0";
  console.log(
    `cycle: wrote ${written} tiles / ${rowsWritten} rows (${share}% marked active) ` +
    `in ${requests} requests${aborted ? " — STOPPED EARLY" : ""}`,
  );
  await printStatus(plan);
}

async function writeManifest(plan) {
  // Only leaves with a tile on disk go in the manifest — a manifest row the client
  // cannot fetch is a 404 per viewport, not a missing pin.
  const present = new Set(
    existsSync(TILE_DIR)
      ? (await readdir(TILE_DIR)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))
      : [],
  );
  const tiles = plan.leaves
    .filter((l) => present.has(l.k))
    .map((l) => ({ k: l.k, box: l.box, n: l.rows ?? 0, at: l.fetchedAt }));

  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(
    MANIFEST_PATH,
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        // What Windy says exists, so the client can report "N of M" honestly rather
        // than presenting the harvested count as a total.
        worldTotal: plan.worldTotal,
        harvested: tiles.reduce((s, t) => s + t.n, 0),
        leaves: plan.leaves.length,
        tiles,
      },
      null,
      1,
    ) + "\n",
  );
}

async function printStatus(planIn) {
  const plan = planIn ?? (await readPlan());
  if (!plan) return console.log("no plan yet — run with --plan");
  const done = plan.leaves.filter((l) => l.fetchedAt > 0);
  const rows = plan.leaves.reduce((s, l) => s + (l.rows ?? 0), 0);
  const remaining = plan.leaves
    .filter((l) => l.fetchedAt === 0)
    .reduce((s, l) => s + leafRequestCost(l.total), 0);
  console.log(
    `status: ${done.length}/${plan.leaves.length} leaves read, ` +
    `${rows.toLocaleString()} of ${plan.worldTotal.toLocaleString()} webcams ` +
    `(${((rows / plan.worldTotal) * 100).toFixed(1)}%). ` +
    `${remaining} requests left for first full coverage.`,
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const num = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
  };

  if (has("--status")) return printStatus(null);

  // Rewrite the manifest from what is on disk, making no upstream requests. Needed
  // after a format migration, and cheap enough to run any time the tile directory and
  // the manifest might have drifted apart.
  if (has("--manifest")) {
    const plan = await readPlan();
    if (!plan) throw new Error("no plan yet — run with --plan");
    await writeManifest(plan);
    return printStatus(plan);
  }

  await loadKey();
  if (!apiKey) {
    console.error("WINDY_WEBCAMS_API_KEY not set (env or .env.local) — nothing to do.");
    process.exit(1);
  }

  if (has("--plan")) await buildPlan();
  if (has("--cycle") || !has("--plan")) await runCycle(num("--budget", 60));
}

main().catch((err) => {
  console.error("harvest-webcams:", err.message);
  process.exit(1);
});
