// What the plane track store (lib/planes/trackStore.ts) costs the server, in memory and in time.
//
//   npx vite-node -c vitest.config.ts scripts/track-store-memory.mts
//   npx vite-node -c vitest.config.ts scripts/track-store-memory.mts --real=snapshots.jsonl
//
// THREE MEASURES, each the heap the store holds after a forced collection:
//   1. 12 HOURS OF A SIMULATED PULL at today's size: the whole pool of about 10,000 aircraft, one
//      pull every 2 minutes, with flights that start and end, airframes that fly again, turns,
//      wander and stretches out of receiver range. Seeded, so a run repeats. Its turns are set so
//      a straight costs what real tracks cost: 6.2 points a plane an hour on production's planes
//      heard for a whole hour (2026-10-31).
//   2. THE CAPS: a store filled to TRACK_CAPS one position at a time, so each array carries the
//      spare room V8 really leaves when it grows. This is the most it can ever hold.
//   3. REAL TRACKS, with --real: replay snapshots saved from production's /api/planes, one JSON
//      object a line ({ fetchedAt, rows: [[id, lat, lon, altKm, heading, onGround, posAgeS]] }).
//      Those are the served sample, whose planes come and go, so they cost more per plane than
//      the pool does. It shows the store working on real rows, not what 12 hours holds.
//
// Not in the gate: it holds real memory and takes about a minute.
import { readFileSync } from "node:fs";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type { WorldObject } from "../lib/world";
import { TRACK_CAPS, createTrackStore, ingestSnapshot, trackBody, trackStats, type TrackStore } from "../lib/planes/trackStore";
import { newLine, stepLine } from "../lib/planes/trackLine";
import { projectAhead } from "../lib/planes/trail";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;
const heapMb = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed / 1048576;
};

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const PULL_MS = 120_000;
const POOL = 10_000;
const T0 = 1_792_180_000_000;

/** mulberry32, so a run repeats. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sim {
  id: string;
  lat: number;
  lon: number;
  heading: number;
  kmPerPull: number;
  pullsLeft: number;
  silentFor: number;
}

function simulate() {
  const rand = prng(20261031);
  let serial = 0;
  const parked: { id: string; until: number }[] = [];
  const newId = (pull: number) => {
    // Half the airframes come back after a turnaround, as the same id: a new flight on an old line.
    const i = parked.findIndex((p) => p.until <= pull);
    if (i >= 0) return parked.splice(i, 1)[0].id;
    serial += 1;
    return `plane:${serial.toString(16).padStart(6, "0")}`;
  };
  const start = (pull: number): Sim => {
    // Most flights are short, and about one in six is long-haul.
    const hours = rand() < 0.17 ? 6 + rand() * 8 : 0.5 + rand() * rand() * 5;
    return {
      id: newId(pull),
      lat: -55 + rand() * 120,
      lon: -180 + rand() * 360,
      heading: rand() * 360,
      kmPerPull: 16 + rand() * 16,
      pullsLeft: Math.round((hours * 3_600_000) / PULL_MS),
      silentFor: 0,
    };
  };

  const fleet: Sim[] = Array.from({ length: POOL }, () => start(0));
  const store = createTrackStore();
  const before = heapMb();
  let positions = 0;
  let spent = 0;
  let worst = 0;
  let firstHourPoints = 0;
  const rows: string[] = [];
  const PULLS = (12 * 3_600_000) / PULL_MS;

  for (let pull = 0; pull < PULLS; pull++) {
    const snapshot: WorldObject[] = [];
    for (let i = 0; i < fleet.length; i++) {
      const p = fleet[i];
      if (p.pullsLeft-- <= 0) {
        if (rand() < 0.5) parked.push({ id: p.id, until: pull + 25 + Math.floor(rand() * 60) });
        fleet[i] = start(pull);
        continue;
      }
      p.heading += (rand() - 0.5) * 1.2;
      if (rand() < 0.042) p.heading += (rand() < 0.5 ? -1 : 1) * (15 + rand() * 60);
      const next = projectAhead(p.lat, p.lon, p.heading, p.kmPerPull);
      p.lat = next.lat;
      p.lon = next.lon;
      if (p.silentFor > 0) {
        p.silentFor--;
        continue;
      }
      if (rand() < 0.0016) p.silentFor = 5 + Math.floor(rand() * 25); // 10 to 60 minutes out of range
      snapshot.push({ kind: "plane", id: p.id, lat: p.lat, lon: p.lon, altKm: 10 + rand() * 2, label: p.id, meta: { posAgeS: rand() * 8 } } as unknown as WorldObject);
    }
    positions += snapshot.length;
    const t = performance.now();
    ingestSnapshot(store, snapshot, T0 + pull * PULL_MS);
    const took = performance.now() - t;
    spent += took;
    if (pull > 5) worst = Math.max(worst, took);
    if (pull === 29) firstHourPoints = trackStats(store).points;
    if ((pull + 1) % 60 === 0) {
      const { planes, points } = trackStats(store);
      rows.push(
        `  ${String(((pull + 1) * PULL_MS) / 3_600_000).padStart(4)} h  ${String(planes).padStart(6)} planes  ${String(points).padStart(8)} points  ` +
          `${(heapMb() - before).toFixed(1).padStart(6)} MB`,
      );
    }
  }

  console.log(`1. Simulated pull, about ${POOL} rows, one every ${PULL_MS / 60_000} minutes, for 12 hours`);
  for (const r of rows) console.log(r);
  const { planes, points } = trackStats(store);
  console.log(`  after 1 hour: ${(firstHourPoints / POOL).toFixed(1)} points a plane (real planes heard a whole hour: 6.2)`);
  console.log(`  thinning: ${positions} positions heard, ${points} points held at the end`);
  console.log(`  time one pull spends on the store: ${(spent / PULLS).toFixed(1)} ms on average, ${worst.toFixed(1)} ms at worst`);
  const anyId = [...store.lines.keys()][0];
  const longest = [...store.lines.entries()].sort((a, b) => b[1].data.length - a[1].data.length)[0];
  console.log(`  longest line: ${longest[1].data.length / 4} points, reply ${(trackBody(store, longest[0]).length / 1024).toFixed(1)} KB; a typical one ${(trackBody(store, anyId).length / 1024).toFixed(1)} KB`);
  console.log(`  points per plane at the end: ${(points / planes).toFixed(1)}`);
  return store;
}

function fillToCaps() {
  const store: TrackStore = createTrackStore();
  const before = heapMb();
  const perPlane = Math.ceil(TRACK_CAPS.maxPoints / TRACK_CAPS.maxPlanes);
  let spent = 0;
  for (let i = 0; i < TRACK_CAPS.maxPlanes; i++) {
    const lat0 = -50 + (i % 100);
    const line = newLine({ lat: lat0, lon: i % 170, altKm: 11.5, t: T0 });
    // A zigzag, so thinning keeps every position, one push at a time as a real line grows.
    for (let k = 1; k < perPlane; k++) {
      stepLine(line, { lat: lat0 + (k % 2) * 0.3, lon: (i % 170) + k * 0.2, altKm: 11.5, t: T0 + k * PULL_MS }, TRACK_CAPS.maxPointsPerPlane);
    }
    store.lines.set(`plane:${i.toString(16).padStart(6, "0")}`, line);
  }
  const { planes, points } = trackStats(store);
  console.log(`2. At the caps: ${planes} planes, ${points} points: ${(heapMb() - before).toFixed(1)} MB`);
  // A pull against a full store, with every plane heard again, is the most a pull can cost.
  const rows = [...store.lines.keys()].slice(0, POOL).map(
    (id, i) => ({ kind: "plane", id, lat: 10 + (i % 60), lon: i % 170, altKm: 11, label: id, meta: {} }) as unknown as WorldObject,
  );
  const t = performance.now();
  ingestSnapshot(store, rows, T0 + (perPlane + 1) * PULL_MS);
  spent = performance.now() - t;
  console.log(`  a pull of ${rows.length} rows against the full store: ${spent.toFixed(1)} ms`);
  return store;
}

function replay(path: string) {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const store = createTrackStore();
  const before = heapMb();
  let positions = 0;
  let spent = 0;
  let first = 0;
  let last = 0;
  for (const raw of lines) {
    const d = JSON.parse(raw) as { fetchedAt: number; rows: [string, number, number, number, number, number, number][] };
    first ||= d.fetchedAt;
    last = d.fetchedAt;
    const planes = d.rows.map(
      ([id, lat, lon, altKm, , , posAgeS]) => ({ kind: "plane", id, lat, lon, altKm, label: id, meta: { posAgeS } }) as unknown as WorldObject,
    );
    positions += planes.length;
    const t = performance.now();
    ingestSnapshot(store, planes, d.fetchedAt);
    spent += performance.now() - t;
  }
  const { planes, points } = trackStats(store);
  const hours = (last - first) / 3_600_000;
  console.log(`3. Real rows: ${lines.length} snapshots over ${hours.toFixed(2)} h of production's served sample`);
  console.log(`  ${positions} positions heard, ${planes} planes, ${points} points held: ${(heapMb() - before).toFixed(1)} MB`);
  console.log(`  points per plane ${(points / planes).toFixed(1)}; ${(spent / lines.length).toFixed(1)} ms a snapshot of 3,000 rows`);
  return store;
}

const a = simulate();
const b = fillToCaps();
const realPath = arg("real");
const c = realPath ? replay(realPath) : null;
// Held to here so a collection above could not take a store that was still being measured.
void [a, b, c];
