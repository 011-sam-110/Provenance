// What the Full flight trail switch costs a tab: frame time and the trail source's `setData`,
// switch off against switch on, at today's plane count with simulated history.
//
//   node scripts/planes-trail-fps.mjs http://localhost:3126 [--hours=1] [--planes=3000]
//        [--base=snapshots.jsonl] [--json=out.json] [--shot=dir] [--only=on]
//
// WHY THIS EXISTS. `setData` on the trail source runs when a line changes, and a long line is
// tens of thousands of points. The unit tests can hold a cap, and cannot say what the cap should
// be. This runs the real page, polls included, and counts frames. Not in the gate: it needs a
// real screen. The header of scripts/landing-fps.mjs lists the four ways a frame rate lies here
// (headless, a covered window, Energy Saver, battery), and this keeps the same rules: a covered
// window is reported INVALID, and the power state is printed with the numbers. Windows' own
// occlusion check is off, so a window behind another one still draws, and a run with a stretch at
// one frame a second is still INVALID, even when its median looks fine.
//
// HOW. /api/planes is routed and answers a moving fleet at a real snapshot's positions (--base)
// or scattered ones, with a new snapshot on each poll. The poll's 12 s interval is shortened
// while the history builds, so an hour of snapshots takes under a minute, and then it runs at
// one poll every 12 s while the camera pans: at 2 minutes a snapshot a real tab sees a new line a
// tenth as often as this does, so this is the worse case. Each scenario is a new page.
// A plane turns often enough that a line costs what real lines cost: 6.2 points a plane an hour
// on production's planes heard for a whole hour (2026-10-31). `sized` then draws lines of a set
// size straight through the source, past any cap the tab holds, to show where the cost starts.
// A run is INVALID if the source was never written or a page script failed to load.
import { chromium } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (k, d) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const base = args.find((a) => !a.startsWith("--")) || "http://localhost:3126";
const HOURS = Number(flag("hours", 1));
const PLANES = Number(flag("planes", 3000));
const basePath = flag("base", "");
const jsonPath = flag("json", "");
const shotDir = flag("shot", "");
const only = flag("only", "");
const PULL_MS = 120_000;
const SEED_POLL_MS = 450;
const seedSnapshots = Math.round((HOURS * 3_600_000) / PULL_MS);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (n) => Math.round(n * 10) / 10;
const quantile = (list, p) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RAD = Math.PI / 180;
function step(lat, lon, bearing, km) {
  const d = km / 6371;
  const t = bearing * RAD;
  const a = lat * RAD;
  const lat2 = Math.asin(Math.sin(a) * Math.cos(d) + Math.cos(a) * Math.sin(d) * Math.cos(t));
  const lon2 = lon * RAD + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(a), Math.cos(d) - Math.sin(a) * Math.sin(lat2));
  return { lat: lat2 / RAD, lon: ((lon2 / RAD + 540) % 360) - 180 };
}

/** A seeded fleet, at a real snapshot's places when one is given. */
function makeFleet() {
  const rand = prng(20261031);
  let places = null;
  if (basePath) {
    const first = readFileSync(basePath, "utf8").split("\n")[0];
    places = JSON.parse(first).rows;
  }
  return Array.from({ length: PLANES }, (_, i) => {
    const r = places?.[i % places.length];
    return {
      id: `plane:${(i + 0x100000).toString(16)}`,
      lat: r ? r[1] : -55 + rand() * 120,
      lon: r ? r[2] : -180 + rand() * 360,
      heading: r ? r[4] : rand() * 360,
      km: 16 + rand() * 16,
      alt: 8 + rand() * 4,
    };
  });
}

function snapshotBody(fleet, rand, at) {
  const planes = fleet.map((p) => {
    p.heading = (p.heading + (rand() - 0.5) * 1.6 + (rand() < 0.1 ? (rand() < 0.5 ? -1 : 1) * (15 + rand() * 60) : 0) + 360) % 360;
    const n = step(p.lat, p.lon, p.heading, p.km);
    p.lat = n.lat;
    p.lon = n.lon;
    const velocityMs = (p.km * 1000) / 120;
    return {
      kind: "plane",
      id: p.id,
      lat: p.lat,
      lon: p.lon,
      altKm: p.alt,
      heading: p.heading,
      label: `FL${p.id.slice(6)}`,
      color: "#fbbf24",
      icon: "plane-airliner",
      typeLabel: "Airliner",
      meta: {
        callsign: `FL${p.id.slice(6)}`, country: "", velocityMs, altKm: p.alt, verticalRateMs: 0, onGround: false,
        headingDeg: p.heading, category: "airliner", categoryTrusted: true, typeLabel: "Airliner", squawk: "1000",
        typeCode: "B738", registration: "G-TEST", typeDescription: "BOEING 737-800", posSource: "adsb", posAgeS: 2.4,
      },
    };
  });
  return JSON.stringify({ count: planes.length, source: "adsb.lol", fetchedAt: at, planes });
}

async function scenario(context, on) {
  const page = await context.newPage();
  const faults = [];
  page.on("pageerror", (e) => faults.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => {
    if (r.url().includes("/_next/")) faults.push(`failed: ${r.url()}`);
  });
  const fleet = makeFleet();
  const rand = prng(7);
  let pull = 0;
  const T0 = Date.now() - (seedSnapshots + 200) * PULL_MS;
  await page.route((u) => u.pathname === "/api/planes", async (route) => {
    pull += 1;
    await route.fulfill({ contentType: "application/json", body: snapshotBody(fleet, rand, T0 + pull * PULL_MS) });
  });
  await page.addInitScript(({ on, seedMs }) => {
    // One profile runs every scenario, so each one starts from a console that has saved nothing.
    window.localStorage.clear();
    const set = (k, v) => window.localStorage.setItem(k, JSON.stringify({ v: 1, d: v }));
    set("tn.terminal.boot.v1", { seenVersion: 1 });
    if (on) set("tn.planes.fullTrail.v1", { on: true });
    const real = window.setInterval.bind(window);
    const realClear = window.clearInterval.bind(window);
    const stopped = new Set();
    let nextId = -1;
    window.__pollMs = seedMs;
    window.setInterval = (fn, ms, ...rest) => {
      if (ms !== 12_000) return real(fn, ms, ...rest);
      const id = nextId--;
      const tick = () => {
        if (stopped.has(id)) return;
        fn();
        setTimeout(tick, window.__pollMs);
      };
      setTimeout(tick, window.__pollMs);
      return id;
    };
    window.clearInterval = (id) => (id < 0 ? void stopped.add(id) : realClear(id));
  }, { on, seedMs: SEED_POLL_MS });
  await page.goto(`${base}/app`);
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120_000 });

  // The Planes row, the way a person turns it on.
  await page.keyboard.press("ControlOrMeta+k");
  await page.click("#tn-rail-tab-sources");
  await page.getByLabel("Search sources").fill("Planes");
  const toggle = page.locator('.tn-src-row[data-source-row="planes"] .tn-src-toggle');
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await page.keyboard.press("ControlOrMeta+k");

  const startPull = pull;
  let lastPull = pull;
  let lastMoved = Date.now();
  while (pull - startPull < seedSnapshots) {
    await sleep(250);
    if (pull !== lastPull) {
      lastPull = pull;
      lastMoved = Date.now();
    } else if (Date.now() - lastMoved > 30_000) {
      throw new Error(`the page stopped polling /api/planes after ${pull - startPull} snapshots`);
    }
  }
  await page.bringToFront();
  await page.evaluate(() => {
    window.__pollMs = 12_000;
  });
  await sleep(1500);

  const wantSized = on && !args.includes("--no-sized");
  const measured = await page.evaluate(async ({ wantSized }) => {
    const map = window.__map;
    const src = map.getSource("trails");
    const real = src.setData.bind(src);
    const calls = [];
    let open = null;
    const longTasks = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) longTasks.push(e.duration);
    }).observe({ entryTypes: ["longtask"] });
    src.setData = (data, ...rest) => {
      const t = performance.now();
      const out = real(data, ...rest);
      open = { syncMs: performance.now() - t, sent: t, doneMs: null };
      calls.push(open);
      return out;
    };
    map.on("sourcedata", (e) => {
      if (e.sourceId === "trails" && e.isSourceLoaded && open && open.doneMs === null) open.doneMs = performance.now() - open.sent;
    });
    const count = () => {
      const fs = src.serialize().data.features;
      let v = 0;
      for (const f of fs) {
        v += f.geometry.type === "LineString"
          ? f.geometry.coordinates.length
          : f.geometry.coordinates.reduce((s, p) => s + p.length, 0);
      }
      return { lines: fs.length, vertices: v };
    };
    const drawn = count();
    const battery = await navigator.getBattery?.().then((b) => ({ charging: b.charging, level: Math.round(b.level * 100) })).catch(() => null);
    const gl = map.getCanvas().getContext("webgl2");
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown";
    const size = { w: innerWidth, h: innerHeight, dpr: devicePixelRatio };

    // A pan the whole time, as a person dragging the map would, with polls landing in it.
    const camera = async (center, zoom, seconds, onStart) => {
      map.jumpTo({ center, zoom });
      await Promise.race([new Promise((r) => map.once("idle", r)), new Promise((r) => setTimeout(r, 15_000))]);
      onStart?.();
      const frames = [];
      const startAt = performance.now();
      let last = startAt;
      await new Promise((resolve) => {
        const tick = (now) => {
          frames.push(now - last);
          last = now;
          const t = (now - startAt) / 1000;
          map.jumpTo({ center: [center[0] + t * 1.5, center[1]], zoom });
          if (t < seconds) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return frames.slice(1);
    };
    const world = await camera([10, 30], 2.2, 30);
    const region = await camera([5, 50], 6, 30);

    // The same call at bigger sizes, to see the curve past what a tab holds today. The polls
    // stop first, so nothing writes over these lines.
    window.__pollMs = 3_600_000;
    await new Promise((r) => setTimeout(r, 13_000));
    const curve = [];
    const data = src.serialize().data;
    const sized = (target) => {
      const copy = { type: "FeatureCollection", features: data.features.map((f) => ({ ...f, geometry: { ...f.geometry, coordinates: [] } })) };
      const per = Math.max(2, Math.floor(target / Math.max(1, copy.features.length)));
      copy.features.forEach((f, i) => {
        f.geometry.type = "LineString";
        const lon = -170 + (i % 340);
        const lat = -50 + ((i * 7) % 110);
        // About 100 km between points, as a thinned line has, so a long line crosses many tiles.
        f.geometry.coordinates = Array.from({ length: per }, (_, k) => [lon + k, lat + Math.sin(k / 3) * 2]);
      });
      return copy;
    };
    const done = () =>
      new Promise((resolve) => {
        const on = (e) => {
          if (e.sourceId === "trails" && e.isSourceLoaded) {
            map.off("sourcedata", on);
            resolve();
          }
        };
        map.on("sourcedata", on);
        setTimeout(resolve, 20_000);
      });
    const sizedFrames = [];
    for (const target of [15_000, 30_000, 60_000, 120_000, 240_000]) {
      const fc = sized(target);
      const t = performance.now();
      real(fc);
      const syncMs = performance.now() - t;
      const sent = t;
      const doneMs = await new Promise((resolve) => {
        const on = (e) => {
          if (e.sourceId === "trails" && e.isSourceLoaded) {
            map.off("sourcedata", on);
            resolve(performance.now() - sent);
          }
        };
        map.on("sourcedata", on);
        setTimeout(() => resolve(-1), 20_000);
      });
      curve.push({ target, syncMs, doneMs });
      if (!wantSized) continue;
      // A pan with these lines up and the source written three times in it. A real tab writes
      // it once every 2 minutes, so this is the worse case again.
      const before = longTasks.length;
      let writes = [];
      const frames = await camera([10, 30], 2.2, 14, () => {
        writes = [3000, 7000, 11000].map((ms) => setTimeout(() => real(fc), ms));
      });
      writes.forEach(clearTimeout);
      await done();
      sizedFrames.push({ target, frames, longTasks: longTasks.slice(before) });
    }
    return { drawn, battery, renderer, size, world, region, calls, curve, sizedFrames, longTasks };
  }, { wantSized });
  if (shotDir) await page.screenshot({ path: join(shotDir, `fps-${on ? "on" : "off"}.jpg`), type: "jpeg", quality: 60 });
  await page.close();
  return { ...measured, faults };
}

const profile = mkdtempSync(join(tmpdir(), "planes-trail-fps-"));
writeFileSync(
  join(profile, "Local State"),
  JSON.stringify({ performance_tuning: { battery_saver_mode: { state: 0 }, high_efficiency_mode: { state: 0 } } }),
);
const context = await chromium.launchPersistentContext(profile, {
  channel: "chrome",
  headless: false,
  viewport: null,
  args: ["--start-maximized", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-features=CalculateNativeWinOcclusion"],
});

const describe = (name, f) => {
  const med = quantile(f, 0.5);
  return {
    name,
    frames: f.length,
    medianMs: r1(med),
    p95Ms: r1(quantile(f, 0.95)),
    p99Ms: r1(quantile(f, 0.99)),
    maxMs: r1(Math.max(...f)),
    over50ms: f.filter((x) => x > 50).length,
    fps: r1(1000 / med),
    secondFrames: f.filter((x) => x > 900).length,
    valid: med < 500 && f.filter((x) => x > 900).length === 0,
  };
};

const out = {};
try {
  const runs = [["off", false], ["on", true], ["off-again", false]].filter(([label]) => !only || label === only);
  for (const [label, on] of runs) {
    const m = await scenario(context, on);
    const calls = m.calls.map((c) => c.syncMs);
    const done = m.calls.map((c) => c.doneMs).filter((x) => x !== null);
    out[label] = {
      drawn: m.drawn,
      setDataCalls: m.calls.length,
      setDataSyncMedianMs: r1(quantile(calls, 0.5)),
      setDataSyncMaxMs: r1(Math.max(0, ...calls)),
      setDataToLoadedMedianMs: r1(quantile(done, 0.5)),
      longTasks: { count: m.longTasks.length, p50Ms: r1(quantile(m.longTasks, 0.5)), maxMs: r1(Math.max(0, ...m.longTasks)) },
      world: describe("world z2.2", m.world),
      region: describe("region z6", m.region),
      curve: m.curve.map((c) => ({ target: c.target, syncMs: r1(c.syncMs), doneMs: r1(c.doneMs) })),
      sized: m.sizedFrames.map((s) => ({
        target: s.target,
        ...describe("world z2.2, 3 writes", s.frames),
        longTasks: { count: s.longTasks.length, maxMs: r1(Math.max(0, ...s.longTasks)) },
      })),
      faults: m.faults,
      env: { battery: m.battery, renderer: m.renderer, size: m.size },
    };
    console.log(label, JSON.stringify(out[label], null, 1));
  }
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(out, null, 2));
const invalid = Object.values(out).some((o) => !o.world.valid || !o.region.valid);
if (invalid) console.log("INVALID: frames of about a second, so the window was covered or minimised. Run it again.");
// A snapshot writes the source once in the off case, and once in the on case: a run with no write
// measured a page that had stopped drawing lines.
const broken = Object.entries(out).filter(([, o]) => o.setDataCalls === 0 || o.faults.length > 0);
if (broken.length) {
  console.log(`INVALID: ${broken.map(([k]) => k).join(", ")} never wrote the source or lost a script, so its page was not running.`);
  process.exitCode = 1;
}
