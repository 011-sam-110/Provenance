// What a zoom gesture actually costs on the console map.
//
// This measures rather than guesses. It drives ONE deterministic wheel-zoom over
// London and reports what the map did during it: long tasks, frame intervals,
// setTerrain calls, queryRenderedFeatures calls, heap growth. Ablations neutralise
// one suspect at a time at RUNTIME, so every run is the same build and the numbers
// are comparable.
//
// Run:  node scripts/profile-map.mjs [baseUrl] [--ablate=a,b] [--label=name]
//       node scripts/profile-map.mjs http://localhost:3080 --ablate=terrain-guard
//
// Ablations:
//   terrain-guard  apply the proposed syncTerrain fix at runtime (skip a no-op setTerrain)
//   terrain-off    force terrain off entirely for the whole run
//   no-blur        strip every backdrop-filter
//   low-zoom       stop at z11.5, below the live-thumbnail threshold (z12)
//   no-satellites  satellites layer off (kills the 1 Hz re-render)
//   no-planes      planes layer off
//   no-cameras     cameras layer off
//
// Output: one JSON per run under profile-out/, plus a terminal summary.

import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const BASE = argv.find((a) => !a.startsWith("--")) || "http://localhost:3080";
const ABLATE = (argv.find((a) => a.startsWith("--ablate=")) || "").replace("--ablate=", "");
const ABLATIONS = ABLATE ? ABLATE.split(",").map((s) => s.trim()).filter(Boolean) : [];
const LABEL = (argv.find((a) => a.startsWith("--label=")) || "").replace("--label=", "") ||
  (ABLATIONS.length ? ABLATIONS.join("+") : "baseline");
const OUT = "profile-out";
mkdirSync(OUT, { recursive: true });

const KNOWN = new Set([
  "terrain-guard", "terrain-off", "no-blur", "low-zoom",
  "no-satellites", "no-planes", "no-cameras",
]);
for (const a of ABLATIONS) {
  if (!KNOWN.has(a)) {
    console.error(`unknown ablation: ${a}\nknown: ${[...KNOWN].join(", ")}`);
    process.exit(2);
  }
}

// Node ESM on Windows needs a file:// URL for an absolute path import, and these
// packages are CJS, so the namespace lands under .default when interop kicks in.
async function loadChromium() {
  for (const rel of [
    "node_modules/playwright-core/index.js",
    "node_modules/playwright/index.js",
    "node_modules/@playwright/test/index.js",
  ]) {
    try {
      const mod = await import(pathToFileURL(path.resolve(rel)).href);
      const c = mod.chromium ?? mod.default?.chromium;
      if (c) return c;
    } catch {
      /* try the next one */
    }
  }
  throw new Error("playwright not resolvable from this worktree");
}
const chromium = await loadChromium();

// London, and a zoom span that crosses BOTH thresholds that matter:
// TERRAIN_MIN_ZOOM (6) and the live-thumbnail floor (12).
const CENTER = [-0.1276, 51.5072];
const START_ZOOM = 4;
const WHEEL_STEPS = 24;
const WHEEL_DELTA = -120; // negative = zoom in
const WHEEL_GAP_MS = 60;

// Headless Chromium falls back to SwiftShader, which rasterises WebGL on the CPU and
// manufactures long tasks that do not exist on a real GPU. --headed uses the actual
// GPU and is the only mode whose long-task numbers describe what a user feels.
const HEADED = argv.includes("--headed");
const browser = await chromium.launch({
  headless: !HEADED,
  // Without this, performance.memory is bucketed to 5 MB and heap growth is unreadable.
  args: ["--enable-precise-memory-info"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// The boot veil and the guided tour both intercept input, and a gesture dispatched
// under them never begins, reports no error, and looks exactly like a broken map.
// The 99 is deliberate: seeding the CURRENT tour version means a later version bump
// silently re-arms the overlay and this harness starts lying.
await page.addInitScript(() => {
  localStorage.setItem("tn.tour.v1", JSON.stringify({ v: 1, d: { seenVersion: 99 } }));
  localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
});

// Layer ablations go in before hydrate() reads them (lib/layers.ts PERSIST_KEY).
const layerOff = {
  satellites: ABLATIONS.includes("no-satellites"),
  planes: ABLATIONS.includes("no-planes"),
  cameras: ABLATIONS.includes("no-cameras"),
};
if (layerOff.satellites || layerOff.planes || layerOff.cameras) {
  await page.addInitScript((off) => {
    const d = { cameras: !off.cameras, satellites: !off.satellites, planes: !off.planes,
      ships: false, webcams: false, weather: false, countries: true };
    localStorage.setItem("tn.layers.v1", JSON.stringify({ v: 1, d }));
  }, layerOff);
}

// PerformanceObserver has to exist before the work happens, not after.
await page.addInitScript(() => {
  window.__prof = {
    setTerrain: 0, setTerrainSkipped: 0, qrf: 0, sourcedata: 0,
    frames: [], longtasks: [], contextLost: false, patched: false,
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__prof.longtasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ entryTypes: ["longtask"] });
  } catch { /* not every build exposes longtask */ }
});

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

console.log(`\n→ ${LABEL}  (${BASE}/app)`);
await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 60000 });

// Wait the boot plate out rather than assuming the seed worked.
await page.waitForFunction(() => !document.querySelector(".tnx-boot"), { timeout: 30000 })
  .catch(() => console.warn("  ! boot veil never cleared — gestures may be swallowed"));

// The map is next/dynamic + ssr:false, so it arrives after hydration.
await page.waitForFunction(() => !!window.__map, { timeout: 60000 });
await page.waitForFunction(() => window.__map.isStyleLoaded(), { timeout: 60000 }).catch(() => {});

if (ABLATIONS.includes("no-blur")) {
  await page.addStyleTag({ content: "*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}" });
}

// Instrument the live instance. Assigning over a prototype method shadows it on
// the instance, so the app's own calls are counted without touching source.
await page.evaluate((ablations) => {
  const m = window.__map;
  const P = window.__prof;

  const origSetTerrain = m.setTerrain.bind(m);
  const guard = ablations.includes("terrain-guard");
  const forceOff = ablations.includes("terrain-off");
  m.setTerrain = (opts) => {
    if (forceOff) opts = null;
    if (guard || forceOff) {
      const cur = m.getTerrain();
      const same = (!cur && !opts) ||
        (!!cur && !!opts && cur.source === opts.source && cur.exaggeration === opts.exaggeration);
      if (same) { P.setTerrainSkipped++; return m; }
    }
    P.setTerrain++;
    return origSetTerrain(opts);
  };

  const origQrf = m.queryRenderedFeatures.bind(m);
  m.queryRenderedFeatures = (...a) => { P.qrf++; return origQrf(...a); };

  m.on("sourcedata", () => { P.sourcedata++; });
  m.on("render", () => { P.frames.push(performance.now()); });
  m.getCanvas().addEventListener("webglcontextlost", () => { P.contextLost = true; });
  P.patched = true;
}, ABLATIONS);

if (ABLATIONS.includes("terrain-off")) {
  await page.evaluate(() => window.__map.setTerrain(null));
}

// Park the camera at a known start. Setup is not measured — counters reset after.
await page.evaluate(({ center, zoom }) => {
  window.__map.jumpTo({ center, zoom, bearing: 0, pitch: 0 });
}, { center: CENTER, zoom: START_ZOOM });
await page.waitForFunction(() => window.__map.isMoving() === false, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500); // let tiles, clustering and the camera feed settle

const before = await page.evaluate(() => ({
  heap: performance.memory ? performance.memory.usedJSHeapSize : null,
  zoom: window.__map.getZoom(),
}));

// Reset counters so we measure the GESTURE, not the setup.
await page.evaluate(() => {
  const P = window.__prof;
  P.setTerrain = 0; P.setTerrainSkipped = 0; P.qrf = 0; P.sourcedata = 0;
  P.frames.length = 0; P.longtasks.length = 0;
  P.t0 = performance.now();
});

// The gesture. Real wheel events through the input pipeline — a scripted easeTo
// would not reproduce the per-frame `zoom` storm a user's wheel actually causes.
const ceiling = ABLATIONS.includes("low-zoom") ? 11.5 : 99;
await page.mouse.move(720, 450);
const wallStart = Date.now();
for (let i = 0; i < WHEEL_STEPS; i++) {
  const z = await page.evaluate(() => window.__map.getZoom());
  if (z >= ceiling) break;
  await page.mouse.wheel(0, WHEEL_DELTA);
  await page.waitForTimeout(WHEEL_GAP_MS);
}
// Let the last inertial zoom and its tile/cluster work finish.
await page.waitForFunction(() => window.__map.isMoving() === false, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
const wallMs = Date.now() - wallStart;

const raw = await page.evaluate(() => {
  const P = window.__prof;
  return {
    setTerrain: P.setTerrain, setTerrainSkipped: P.setTerrainSkipped,
    qrf: P.qrf, sourcedata: P.sourcedata,
    frames: P.frames.slice(), longtasks: P.longtasks.slice(),
    contextLost: P.contextLost,
    zoom: window.__map.getZoom(),
    heap: performance.memory ? performance.memory.usedJSHeapSize : null,
  };
});

// Frame intervals from the map's own render events — the thing a user feels.
const gaps = [];
for (let i = 1; i < raw.frames.length; i++) gaps.push(raw.frames[i] - raw.frames[i - 1]);
gaps.sort((a, b) => a - b);
const pct = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : null);
const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;

const ltTotal = raw.longtasks.reduce((a, t) => a + t.dur, 0);
const ltWorst = raw.longtasks.reduce((a, t) => Math.max(a, t.dur), 0);

const result = {
  label: LABEL,
  ablations: ABLATIONS,
  base: BASE,
  renderMode: HEADED ? "headed-gpu" : "headless-swiftshader",
  at: new Date().toISOString(),
  gesture: { wheelSteps: WHEEL_STEPS, delta: WHEEL_DELTA, gapMs: WHEEL_GAP_MS, wallMs },
  zoom: { from: before.zoom, to: raw.zoom },
  setTerrainCalls: raw.setTerrain,
  setTerrainSkipped: raw.setTerrainSkipped,
  queryRenderedFeatures: raw.qrf,
  sourcedataEvents: raw.sourcedata,
  frames: raw.frames.length,
  frameGapMeanMs: mean === null ? null : +mean.toFixed(1),
  frameGapP50Ms: pct(0.5) === null ? null : +pct(0.5).toFixed(1),
  frameGapP95Ms: pct(0.95) === null ? null : +pct(0.95).toFixed(1),
  frameGapMaxMs: gaps.length ? +gaps[gaps.length - 1].toFixed(1) : null,
  longTaskCount: raw.longtasks.length,
  longTaskTotalMs: +ltTotal.toFixed(1),
  longTaskWorstMs: +ltWorst.toFixed(1),
  heapBeforeMB: before.heap === null ? null : +(before.heap / 1048576).toFixed(1),
  heapAfterMB: raw.heap === null ? null : +(raw.heap / 1048576).toFixed(1),
  heapGrowthMB: before.heap === null || raw.heap === null ? null : +((raw.heap - before.heap) / 1048576).toFixed(1),
  webglContextLost: raw.contextLost,
  consoleErrors: consoleErrors.slice(0, 10),
};

const file = path.join(OUT, `${LABEL.replace(/[^a-z0-9.+-]/gi, "_")}.json`);
writeFileSync(file, JSON.stringify(result, null, 2));

const row = (k, v) => console.log(`  ${k.padEnd(26)} ${v}`);
console.log(`  zoom ${result.zoom.from.toFixed(2)} → ${result.zoom.to.toFixed(2)}  in ${wallMs} ms`);
row("setTerrain calls", `${result.setTerrainCalls}${result.setTerrainSkipped ? `  (${result.setTerrainSkipped} skipped by guard)` : ""}`);
row("queryRenderedFeatures", result.queryRenderedFeatures);
row("sourcedata events", result.sourcedataEvents);
row("frames rendered", result.frames);
row("frame gap mean / p95 / max", `${result.frameGapMeanMs} / ${result.frameGapP95Ms} / ${result.frameGapMaxMs} ms`);
row("long tasks (n, total, worst)", `${result.longTaskCount}, ${result.longTaskTotalMs} ms, ${result.longTaskWorstMs} ms`);
row("JS heap growth", result.heapGrowthMB === null ? "n/a" : `${result.heapGrowthMB} MB  (${result.heapBeforeMB} → ${result.heapAfterMB})`);
if (result.webglContextLost) row("WebGL context", "LOST");
if (consoleErrors.length) row("console errors", consoleErrors.length);
console.log(`  → ${file}`);

await browser.close();
