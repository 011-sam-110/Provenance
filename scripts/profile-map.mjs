// What a zoom gesture actually costs on the console map.
//
// This measures rather than guesses. It drives ONE deterministic wheel-zoom over
// London and reports what the map did during it: long tasks, frame intervals,
// setTerrain calls, queryRenderedFeatures calls, heap growth. Ablations neutralise
// one suspect at a time at RUNTIME, so every run is the same build and the numbers
// are comparable.
//
// Run:  node scripts/profile-map.mjs [baseUrl] [--headed] [--start=z] [--ablate=a,b] [--label=name]
//       node scripts/profile-map.mjs http://localhost:3080 --headed
//       node scripts/profile-map.mjs http://localhost:3080 --headed --start=11
//       node scripts/profile-map.mjs --headed --idle=14 --ablate=no-spin   (idle cost)
//
// USE --headed FOR ANYTHING YOU INTEND TO BELIEVE. Headless Chromium falls back to
// SwiftShader, which rasterises WebGL on the CPU: it reported ~33 s of long tasks
// that do not exist on a real GPU, and it completely hid a WebGL context loss that
// was the actual bug. renderMode is recorded in every JSON for that reason — never
// compare a headless run to a headed one.
//
// --start=z sets the zoom the gesture begins at (default 4). Use --start=11 to land
// inside the live-thumbnail regime (z12+), which a run from z4 may never reach.
//
// Ablations:
//   terrain-guard  apply the proposed syncTerrain fix at runtime (skip a no-op setTerrain)
//   terrain-off    force terrain off entirely for the whole run
//   no-blur        strip every backdrop-filter
//   low-zoom       stop at z11.5, below the live-thumbnail threshold (z12)
//   no-satellites  satellites layer off (kills the 1 Hz re-render)
//   no-planes      planes layer off
//   no-cameras     cameras layer off
//   no-spin        neutralise the calm idle rotation (WorldMap's setCenter rAF loop)
//
// `no-spin` is the ablation for "why does the map feel heavy when I am not touching
// it". The idle rotation moves the camera every frame, and a moving camera means
// MapLibre re-renders continuously — matrices, style-expression evaluation, the lot.
// Measured against prod, `--idle=14 --start=3`, headed on an Arc iGPU:
//
//                      frames rendered   sourcedata   long tasks
//     baseline                     810          123    1 (62 ms)
//     --ablate=no-spin               0            0            0
//
// 810 full renders in fourteen seconds with nobody touching the map. Main-thread
// BUSY over the same window: 99.5% -> 44.8% at 4x CPU throttle, 26.1% -> 6.2%
// unthrottled. So on a mid-range machine the console has no headroom left at rest,
// which is why interaction feels rough rather than the interaction itself being slow.
//
// It does NOT scale with how often setCenter is called: throttling the loop to 30fps
// and 20fps measured 99.4% and 99.6% busy, i.e. unchanged. Movement is the cost, not
// the call, and only not-moving is cheaper.
//
// USE --start=3 (OR LOWER) WITH THIS ABLATION. The default start zoom is 4 and
// WorldMap's guard is `getZoom() < SPIN_MAX_ZOOM` with SPIN_MAX_ZOOM = 4, so the
// default parks the camera exactly ON the boundary where the spin is already off.
// The first run of this ablation was done that way and reported 0 frames for BOTH
// arms — a real null result in appearance, and measuring nothing in fact.
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
  "no-satellites", "no-planes", "no-cameras", "no-spin",
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
const START_ZOOM = Number((argv.find((a) => a.startsWith("--start=")) || "--start=4").replace("--start=", ""));
const WHEEL_STEPS = 24;
const DIR = (argv.find((a) => a.startsWith("--dir=")) || "--dir=in").replace("--dir=", "");
if (DIR !== "in" && DIR !== "out") { console.error("--dir must be in|out"); process.exit(2); }
const WHEEL_DELTA = DIR === "out" ? 120 : -120; // negative = zoom in
const WHEEL_GAP_MS = 60;
// Reproduce Blink re-firing hover as the map slides under a STATIONARY cursor.
// Without this the profiler cannot see the delegated-listener storm at all: it
// moves the mouse once, so every baseline in profile-out/ recorded ~26 queries
// where production does thousands. Per-FRAME, not per-notch — the live capture
// showed ~140 pointer events across a ~6 s gesture (~24/s), not 60.
const HOVER = argv.includes("--hover");
// --idle=<seconds> replaces the wheel gesture with a do-nothing window. The console
// spends most of its life here — nobody touching it, the calm rotation running — and
// it is the ONLY gesture on which `no-spin` means anything: every wheel step calls
// markInteract, which suppresses the spin for IDLE_RESUME_MS anyway, so a zoom run
// ablates something that was already switched off and honestly reports no difference.
const IDLE_S = Number((argv.find((a) => a.startsWith("--idle=")) || "").replace("--idle=", "")) || 0;

// Headless Chromium falls back to SwiftShader, which rasterises WebGL on the CPU and
// manufactures long tasks that do not exist on a real GPU. --headed uses the actual
// GPU and is the only mode whose long-task numbers describe what a user feels.
const HEADED = argv.includes("--headed");
const browser = await chromium.launch({
  headless: !HEADED,
  // Without this, performance.memory is bucketed to 5 MB and heap growth is unreadable.
  args: ["--enable-precise-memory-info"],
});
// A protected Vercel preview needs the caller's own short-lived development
// token as an origin header. Read from the environment only — never a flag, so
// the value cannot land in a shell history or a profile-out JSON.
// Usage: npx vercel env pull, then run this script through `vercel env run`.
const OIDC = process.env.VERCEL_OIDC_TOKEN;
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
if (OIDC) {
  // Scope the header to the deployment ORIGIN ONLY. A context-wide
  // extraHTTPHeaders sends it to every host, which makes the tile CDN requests
  // non-simple, fails their CORS preflight, and silently profiles a map with no
  // basemap - flattering, and wrong.
  const origin = new URL(BASE).origin;
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) {
      route.continue({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": OIDC } });
    } else {
      route.continue();
    }
  });
}
const page = await context.newPage();

// The boot veil intercepts input, and a gesture dispatched under it never begins,
// reports no error, and looks exactly like a broken map.
await page.addInitScript(() => {
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

// Neutralise the idle spin by refusing to SCHEDULE it. WorldMap's loop re-arms
// itself from inside its own callback, so declining the first rAF ends it for good,
// and nothing else on the page is touched — same build, same bundle, one behaviour
// removed. Matching on `setCenter(` survives minification because it is a property
// access on the MapLibre map, not a local the minifier may rename.
if (ABLATIONS.includes("no-spin")) {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    let fakeId = 1e7;
    window.__spinBlocked = 0;
    window.requestAnimationFrame = (cb) => {
      try {
        if (typeof cb === "function" && /setCenter\(/.test(Function.prototype.toString.call(cb))) {
          window.__spinBlocked += 1;
          return fakeId++;
        }
      } catch {
        /* a cross-origin or native callback cannot be stringified; let it through */
      }
      return raf(cb);
    };
  });
}

// PerformanceObserver has to exist before the work happens, not after.
await page.addInitScript(() => {
  window.__prof = {
    setTerrain: 0, setTerrainSkipped: 0, qrf: 0, sourcedata: 0, mousemoves: 0,
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

  P.qrfByLayer = {};
  P.qrfMs = 0;
  const origQrf = m.queryRenderedFeatures.bind(m);
  m.queryRenderedFeatures = (...a) => {
    P.qrf++;
    // Attribute the call. A viewport-wide query (no point argument) is the
    // expensive shape, so record that separately from a point hit-test.
    const opts = a.find((x) => x && !Array.isArray(x) && typeof x === "object" && "layers" in x);
    const layers = opts && opts.layers ? opts.layers.join(",") : "(point-hit-test)";
    const wide = a.length === 1 && opts ? "wide:" : "pt:";
    const key = wide + layers;
    P.qrfByLayer[key] = (P.qrfByLayer[key] || 0) + 1;
    const t = performance.now();
    try { return origQrf(...a); } finally { P.qrfMs += performance.now() - t; }
  };

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
  P.setTerrain = 0; P.setTerrainSkipped = 0; P.qrf = 0; P.sourcedata = 0; P.mousemoves = 0;
  P.frames.length = 0; P.longtasks.length = 0;
  P.t0 = performance.now();
});

// The gesture. Real wheel events through the input pipeline — a scripted easeTo
// would not reproduce the per-frame `zoom` storm a user's wheel actually causes.
const ceiling = ABLATIONS.includes("low-zoom") ? 11.5 : 99;
const floor = 1.3;
await page.mouse.move(720, 450);
if (HOVER) {
  await page.evaluate(() => {
    const P = window.__prof;
    const el = window.__map.getCanvasContainer();
    P.hoverStop = false;
    const pump = () => {
      if (P.hoverStop) return;
      el.dispatchEvent(new MouseEvent("mousemove", { clientX: 720, clientY: 450, bubbles: true }));
      P.mousemoves++;
      requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
  });
}
const wallStart = Date.now();
if (IDLE_S > 0) {
  // Park the pointer off the map first: `pointermove` over the canvas holds the spin
  // off, so measuring idle with the cursor sitting on the map measures the opposite
  // of what it claims to. Then wait out IDLE_RESUME_MS before the window opens.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(5000);
  await page.evaluate(() => { const P = window.__prof; P.frames.length = 0; P.longtasks.length = 0; });
  await page.waitForTimeout(IDLE_S * 1000);
} else {
  for (let i = 0; i < WHEEL_STEPS; i++) {
    const z = await page.evaluate(() => window.__map.getZoom());
    if (DIR === "out" ? z <= floor : z >= ceiling) break;
    await page.mouse.wheel(0, WHEEL_DELTA);
    await page.waitForTimeout(WHEEL_GAP_MS);
  }
  // Let the last inertial zoom and its tile/cluster work finish.
  await page.waitForFunction(() => window.__map.isMoving() === false, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
const wallMs = Date.now() - wallStart;
if (HOVER) await page.evaluate(() => { window.__prof.hoverStop = true; });

const raw = await page.evaluate(() => {
  const P = window.__prof;
  return {
    // Reported ALWAYS, not only under the ablation, so `no-spin: 0` on an ablated run
    // reads as "this ablation matched nothing" rather than as a genuine null result.
    // The match is on minified output; a MapLibre or bundler change could quietly stop
    // it hitting, and the numbers would then look like a finding instead of a no-op.
    spinBlocked: window.__spinBlocked ?? null,
    setTerrain: P.setTerrain, setTerrainSkipped: P.setTerrainSkipped,
    qrf: P.qrf, qrfMs: P.qrfMs, qrfByLayer: { ...P.qrfByLayer }, sourcedata: P.sourcedata,
    mousemoves: P.mousemoves,
    frames: P.frames.slice(), longtasks: P.longtasks.slice(), t0: P.t0,
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
  spinBlocked: raw.spinBlocked,
  base: BASE,
  renderMode: HEADED ? "headed-gpu" : "headless-swiftshader",
  at: new Date().toISOString(),
  gesture: IDLE_S > 0
    ? { kind: "idle", idleSeconds: IDLE_S, wallMs, hover: HOVER }
    : { kind: "wheel", wheelSteps: WHEEL_STEPS, delta: WHEEL_DELTA, gapMs: WHEEL_GAP_MS, wallMs, dir: DIR, hover: HOVER },
  mousemoveEvents: raw.mousemoves,
  // THE number for the hover fix: 26 before (13 layers x enter+leave), <=1 after.
  // Null without --hover, because a run with no pointer stream cannot measure it.
  qrfPerMousemove: HOVER && raw.mousemoves > 0 ? +(raw.qrf / raw.mousemoves).toFixed(2) : null,
  zoom: { from: before.zoom, to: raw.zoom },
  setTerrainCalls: raw.setTerrain,
  setTerrainSkipped: raw.setTerrainSkipped,
  queryRenderedFeatures: raw.qrf,
  queryRenderedFeaturesMs: +raw.qrfMs.toFixed(1),
  queryRenderedFeaturesByLayer: raw.qrfByLayer,
  sourcedataEvents: raw.sourcedata,
  frames: raw.frames.length,
  frameGapMeanMs: mean === null ? null : +mean.toFixed(1),
  frameGapP50Ms: pct(0.5) === null ? null : +pct(0.5).toFixed(1),
  frameGapP95Ms: pct(0.95) === null ? null : +pct(0.95).toFixed(1),
  frameGapMaxMs: gaps.length ? +gaps[gaps.length - 1].toFixed(1) : null,
  longTaskCount: raw.longtasks.length,
  longTaskTotalMs: +ltTotal.toFixed(1),
  longTaskWorstMs: +ltWorst.toFixed(1),
  // When each stall landed, relative to the first wheel event. A stall at t~0 is
  // setup bleeding in; one in the middle is the gesture's own cost.
  longTaskTimeline: raw.longtasks
    .map((t) => ({ atMs: +(t.start - raw.t0).toFixed(0), durMs: +t.dur.toFixed(0) }))
    .filter((t) => t.durMs >= 80),
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
row("queryRenderedFeatures", `${result.queryRenderedFeatures}  (${result.queryRenderedFeaturesMs} ms total)`);
if (HOVER) row("qRF per mousemove", `${result.qrfPerMousemove}  (${result.mousemoveEvents} pointer events)`);
for (const [k, v] of Object.entries(result.queryRenderedFeaturesByLayer).sort((a, b) => b[1] - a[1]).slice(0, 4)) {
  row(`   ${k}`, v);
}
row("sourcedata events", result.sourcedataEvents);
row("frames rendered", result.frames);
row("frame gap mean / p95 / max", `${result.frameGapMeanMs} / ${result.frameGapP95Ms} / ${result.frameGapMaxMs} ms`);
row("long tasks (n, total, worst)", `${result.longTaskCount}, ${result.longTaskTotalMs} ms, ${result.longTaskWorstMs} ms`);
row("JS heap growth", result.heapGrowthMB === null ? "n/a" : `${result.heapGrowthMB} MB  (${result.heapBeforeMB} → ${result.heapAfterMB})`);
if (result.webglContextLost) row("WebGL context", "LOST");
if (consoleErrors.length) row("console errors", consoleErrors.length);
console.log(`  → ${file}`);

await browser.close();
