/**
 * The play check, once, from the command line: how many of the registry's video cameras
 * play right now.
 *
 *   npx vite-node -c vitest.config.ts scripts/liveness-playcheck.mts --ran-on=provenance-1
 *   npx vite-node -c vitest.config.ts scripts/liveness-playcheck.mts --feeds=caltrans,scdot
 *   npx vite-node -c vitest.config.ts scripts/liveness-playcheck.mts --limit=100 --out=/tmp/playcheck.json
 *
 * WHY vite-node AND NOT `node --import ./scripts/ts-alias-hook.mjs` like the other
 * liveness scripts. This one loads the camera registry, and the adapters use TypeScript
 * that Node's strip-only mode refuses (a constructor parameter property in
 * lib/sources/feedKit.ts) and type imports written without `type` (lib/sources/tfl.ts).
 * vite-node compiles them the way vitest does, with the same `@/` alias.
 *
 * WHAT THIS IS FOR. The server decides which cameras the map calls video with the play
 * check in lib/liveness/playcheck.ts, in the background, every three hours. This runs the
 * SAME `runPlayCheck` over the same cameras with the same upstream fetch
 * (lib/proxy/hls-upstream.ts, which /api/hls uses too), once, and prints the summary that
 * `/api/coverage` serves as `playcheck`. That summary is the measured "video that plays"
 * figure; quote it with its window, never as a standing fact.
 *
 * HOW IT CAN MISLEAD, AND WHAT IS DONE ABOUT EACH:
 *
 * 1. It runs from wherever you run it. An operator can answer a home IP and refuse a
 *    data-centre one, or the reverse (Hungary's Utinform did exactly that). The output
 *    names the machine; a figure from a laptop is not a figure from production.
 *
 * 2. It is a moment. A camera that 404s at 02:15 can play at 09:00. The window
 *    (first and last check) is printed beside every count.
 *
 * 3. `--limit` and `--feeds` make a sample, not the registry. The output says which.
 *
 * Pacing is the server's: six checks at once, at least 500 ms between two requests to
 * one host. Do not raise them to make a run finish sooner; the operators see this.
 */

import { writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { CAMERA_FEEDS, feedHealth, getRegistry } from "@/lib/sources/registry";
import { fetchHlsUpstream } from "@/lib/proxy/hls-upstream";
import {
  encodePlayResults,
  orderForCycle,
  runPlayCheck,
  summarisePlayCheck,
  videoCameras,
  type PlayResult,
} from "@/lib/liveness/playcheck";
import type { Camera } from "@/lib/types";

const argv = process.argv.slice(2);
const opt = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");

const FEEDS = opt("feeds")?.split(",").map((s) => s.trim()).filter(Boolean);
const LIMIT = opt("limit") ? Math.max(1, Number(opt("limit"))) : undefined;
const OUT = opt("out");
/** A container's hostname says nothing; name the machine the requests left from. */
const RAN_ON = opt("ran-on") ?? hostname();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Fetch feeds by key; the keys that failed come back too. */
async function fetchFeeds(keys: readonly string[]): Promise<{ cameras: Camera[]; failed: string[] }> {
  const cameras: Camera[] = [];
  const failed: string[] = [];
  for (const f of CAMERA_FEEDS.filter((x) => keys.includes(x.key))) {
    try {
      cameras.push(...(await f.fetch()));
    } catch (err) {
      failed.push(f.key);
      console.error(`feed ${f.key} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { cameras, failed };
}

/**
 * The cameras to check. A cold process is missing any adapter that warms up in the
 * background (North Macedonia's answers "the first read of the site list is still
 * running"), so a feed that failed is asked again, up to three times, 30 s apart. One
 * retry was not enough for North Macedonia from provenance-1 on 2026-10-27.
 */
async function loadCameras(): Promise<Camera[]> {
  const byId = new Map<string, Camera>();
  let failed: string[];
  if (FEEDS) {
    const unknown = FEEDS.filter((k) => !CAMERA_FEEDS.some((f) => f.key === k));
    if (unknown.length) throw new Error(`unknown feed key(s): ${unknown.join(", ")}`);
    const got = await fetchFeeds(FEEDS);
    got.cameras.forEach((c) => byId.set(c.id, c));
    failed = got.failed;
  } else {
    (await getRegistry()).forEach((c) => byId.set(c.id, c));
    failed = feedHealth().filter((h) => !h.ok && !h.dormant).map((h) => h.key);
  }
  for (let attempt = 1; attempt <= 3 && failed.length > 0; attempt++) {
    console.error(`playcheck: asking ${failed.join(", ")} again in 30 s (retry ${attempt} of 3)`);
    await sleep(30_000);
    const again = await fetchFeeds(failed);
    again.cameras.forEach((c) => byId.set(c.id, c));
    failed = again.failed;
  }
  if (failed.length) console.error(`playcheck: still failed, not in this run: ${failed.join(", ")}`);
  return [...byId.values()];
}

/** Spread a sample across operators: every n-th camera, not the first n of one feed. */
function sample<T>(items: T[], n: number): T[] {
  if (n >= items.length) return items;
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]);
}

let done = 0;

// A run that dies says why. An adapter's background warm-up can reject after the
// registry has moved on, and an unlogged exit 1 an hour into a run tells nobody anything.
process.on("unhandledRejection", (err) => {
  console.error(`playcheck: unhandled rejection: ${err instanceof Error ? err.stack : String(err)}`);
});
process.on("exit", (code) => {
  if (code !== 0) console.error(`playcheck: exiting with code ${code} after ${done} results`);
});

const started = Date.now();
console.error(`playcheck: loading cameras (${FEEDS ? `feeds ${FEEDS.join(",")}` : "whole registry"})`);
const all = videoCameras(await loadCameras());
const cams = LIMIT ? sample(all, LIMIT) : all;
console.error(`playcheck: ${all.length} cameras with an allowlisted stream; checking ${cams.length}`);

const results = await runPlayCheck(orderForCycle(cams, new Map(), Date.now()), {
  fetch: (url, referer) => fetchHlsUpstream(url, referer),
  now: Date.now,
  sleep,
  onResult: () => {
    done++;
    if (done % 100 === 0) console.error(`playcheck: ${done} of ${cams.length}`);
  },
});

const finished = Date.now();
const summary = summarisePlayCheck(cams, results, finished);

/** The commonest non-rolling reasons per operator: what to look at first. */
function reasons(rs: ReadonlyMap<string, PlayResult>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rs.values()) {
    if (r.verdict === "rolling") continue;
    // A URL in a reason (a host name) would split one cause into many rows.
    const key = `${r.verdict}: ${r.reason}`.replace(/https?:\/\/\S+/g, "<url>");
    const op = (out[r.source] ??= {});
    op[key] = (op[key] ?? 0) + 1;
  }
  return out;
}

const report = {
  ranOn: RAN_ON,
  scope: FEEDS ? `feeds: ${FEEDS.join(",")}` : "whole registry",
  sample: LIMIT ? `${cams.length} of ${all.length}, spread across operators` : "all",
  startedAt: new Date(started).toISOString(),
  finishedAt: new Date(finished).toISOString(),
  minutes: Math.round(((finished - started) / 60_000) * 10) / 10,
  summary: {
    ...summary,
    windowFrom: summary.windowFrom === null ? null : new Date(summary.windowFrom).toISOString(),
    windowTo: summary.windowTo === null ? null : new Date(summary.windowTo).toISOString(),
  },
  reasons: reasons(results),
};

console.log(JSON.stringify(report, null, 2));
if (OUT) {
  writeFileSync(OUT, encodePlayResults(results, finished));
  console.error(`playcheck: per-camera results written to ${OUT}`);
}

// Exit once stdout has drained: an adapter's own timer (a background warm-up) must not
// hold the run open after the report is out.
process.stdout.write("", () => process.exit(0));
