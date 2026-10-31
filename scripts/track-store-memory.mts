// What the plane track store (lib/planes/trackStore.ts) costs in server memory.
//
//   npx vite-node -c vitest.config.ts scripts/track-store-memory.mts
//   npx vite-node -c vitest.config.ts scripts/track-store-memory.mts --real=snapshots.jsonl
//
// THREE MEASURES, each the heap the store holds after a forced collection:
//   1. 12 HOURS OF A SIMULATED FEED at today's plane count: 3,000 rows a snapshot, one
//      snapshot every 90 s, with flights that start and end, turns, wander and stretches
//      out of receiver range. Seeded, so a run repeats.
//   2. THE CAPS: a store filled to TRACK_CAPS. This is the most it can ever hold.
//   3. REAL TRACKS, with --real: replay snapshots saved from production's /api/planes, one JSON
//      object a line ({ fetchedAt, rows: [[id, lat, lon, altKm, heading, onGround, posAgeS]] }).
//      A short replay cannot show 12 hours, but it shows whether thinning keeps as many points
//      on real flights as on the simulated ones. If the two points-per-pull figures disagree,
//      trust this and raise the cap.
//
// Not in the gate: it holds real memory and takes about a minute.
import { readFileSync } from "node:fs";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type { WorldObject } from "../lib/world";
import { TRACK_CAPS, createTrackStore, ingestSnapshot, trackBody, trackStats, type TrackStore } from "../lib/planes/trackStore";
import { projectAhead } from "../lib/planes/trail";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;
const heapMb = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed / 1048576;
};

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const PULL_MS = 90_000;
const FEED = 3000;
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
      kmPerPull: 12 + rand() * 12,
      pullsLeft: Math.round((hours * 3600_000) / PULL_MS),
      silentFor: 0,
    };
  };

  const fleet: Sim[] = Array.from({ length: FEED }, () => start(0));
  const store = createTrackStore();
  const before = heapMb();
  let positions = 0;
  let spent = 0;
  const rows: string[] = [];

  for (let pull = 0; pull < 480; pull++) {
    const snapshot: WorldObject[] = [];
    for (let i = 0; i < fleet.length; i++) {
      const p = fleet[i];
      if (p.pullsLeft-- <= 0) {
        if (rand() < 0.5) parked.push({ id: p.id, until: pull + 30 + Math.floor(rand() * 80) });
        fleet[i] = start(pull);
        continue;
      }
      p.heading += (rand() - 0.5) * 1.6;
      if (rand() < 0.03) p.heading += (rand() < 0.5 ? -1 : 1) * (15 + rand() * 60);
      const next = projectAhead(p.lat, p.lon, p.heading, p.kmPerPull);
      p.lat = next.lat;
      p.lon = next.lon;
      if (p.silentFor > 0) {
        p.silentFor--;
        continue;
      }
      if (rand() < 0.0012) p.silentFor = 6 + Math.floor(rand() * 30); // 9 to 54 minutes out of range
      snapshot.push({ kind: "plane", id: p.id, lat: p.lat, lon: p.lon, altKm: 10 + rand() * 2, label: p.id, meta: { posAgeS: rand() * 8 } } as unknown as WorldObject);
    }
    positions += snapshot.length;
    const t = performance.now();
    ingestSnapshot(store, snapshot, T0 + pull * PULL_MS);
    spent += performance.now() - t;
    if ((pull + 1) % 80 === 0) {
      const { planes, points } = trackStats(store);
      rows.push(
        `  ${String((pull + 1) * 1.5 / 60).padStart(4)} h  ${String(planes).padStart(6)} planes  ${String(points).padStart(7)} points  ` +
          `${(heapMb() - before).toFixed(1).padStart(6)} MB`,
      );
    }
  }

  console.log(`1. Simulated feed, ${FEED} rows a snapshot, 12 hours at one snapshot every 90 s`);
  for (const r of rows) console.log(r);
  const { planes, points } = trackStats(store);
  console.log(`  thinning: ${positions} positions heard, ${points} points held at the end`);
  console.log(`  ingest: ${(spent / 480).toFixed(1)} ms a snapshot on average`);
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
  for (let i = 0; i < TRACK_CAPS.maxPlanes; i++) {
    const data: number[] = [];
    for (let k = 0; k < perPlane; k++) data.push(10.123 + k, 20.456 + k, 11.5, T0 + k * 1000);
    store.lines.set(`plane:${i.toString(16).padStart(6, "0")}`, {
      data,
      breaks: [],
      bearing: 90.5,
      firstHeardAt: T0,
      lastHeardAt: T0,
      trimmed: false,
    });
  }
  const { planes, points } = trackStats(store);
  console.log(`2. At the caps: ${planes} planes, ${points} points: ${(heapMb() - before).toFixed(1)} MB`);
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
  console.log(`3. Real tracks: ${lines.length} snapshots over ${hours.toFixed(2)} h from production`);
  console.log(`  ${positions} positions heard, ${planes} planes, ${points} points held: ${(heapMb() - before).toFixed(1)} MB`);
  console.log(`  a position kept ${((points - planes) / Math.max(1, positions - planes) * 100).toFixed(0)}% of the time after a plane's first`);
  console.log(`  points per plane ${(points / planes).toFixed(1)}; ingest ${(spent / lines.length).toFixed(1)} ms a snapshot`);
  return store;
}

const a = simulate();
const b = fillToCaps();
const realPath = arg("real");
const c = realPath ? replay(realPath) : null;
// Held to here so a collection above could not take a store that was still being measured.
void [a, b, c];
