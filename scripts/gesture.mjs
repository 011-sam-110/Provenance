// Site-agnostic map gesture profiler: how smooth is a MapLibre page under a real
// wheel-zoom and drag-pan, measured as main-thread frame gaps + long tasks.
// usage (cwd MUST be the Provenance repo so playwright resolves):
//   node <this> <url> [--settle=8000] [--shot=path.png] [--out=path.json] [--steps=30] [--label=name]
import fs from "node:fs";
import { loadPlaywright } from "./playwright.mjs";
const { chromium } = await loadPlaywright();

const args = Object.fromEntries(process.argv.slice(3).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const url = process.argv[2];
const settle = Number(args.settle || 8000);
const steps = Number(args.steps || 30);
const label = args.label || url;
const ablate = String(args.ablate || "").split(",").filter(Boolean);
const first = !!args.first;

const browser = await chromium.launch({ headless: false, args: ["--enable-precise-memory-info"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => {
  // Provenance-only seeds: skip the boot plate + tour so gestures reach the canvas. Harmless elsewhere.
  try {
    localStorage.setItem("tn.tour.v1", JSON.stringify({ v: 1, d: { seenVersion: 99 } }));
    localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  } catch {}
  window.__ft = [];
  const loop = (t) => { window.__ft.push(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true }); } catch {}
  window.__mapRenders = 0;
});
if (ablate.includes("no-spin")) {
  // Same trick as scripts/profile-map.mjs: refuse to SCHEDULE WorldMap's spin rAF (it re-arms from its own callback).
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    let fakeId = 1e7; window.__spinBlocked = 0;
    window.requestAnimationFrame = (cb) => {
      try { if (typeof cb === "function" && /setCenter\(/.test(Function.prototype.toString.call(cb))) { window.__spinBlocked++; return fakeId++; } } catch {}
      return raf(cb);
    };
  });
}
// Deployment Protection, scoped to the ORIGIN UNDER TEST and to nothing else.
//
// THE TRAP THIS AVOIDS, measured 2026-09-05. A context-level `extraHTTPHeaders`
// applies to EVERY request the page makes, cross-origin ones included. A
// non-simple header forces a CORS preflight, and `tiles.openfreemap.org` answers
// 405 to ANY OPTIONS (plain GET 200, OPTIONS 405). So the basemap style fails,
// WorldMap falls back to Satellite, arcgisonline's preflight is refused too, and
// the map loads NOTHING while the run reports entirely plausible numbers. The tell
// in a dump is `Image=64/0KB`, zero `.pbf`, and net::ERR_FAILED on the style URL.
//
// Supplied by `vercel env run` so it never reaches a command line, a log or a file:
//   vercel env run --project traffic-nerd-v2 -- node scripts/<this> <preview-url>/app
const OIDC = process.env.VERCEL_OIDC_TOKEN;
if (OIDC) {
  const targetOrigin = new URL(url).origin;
  await ctx.route(
    (u) => u.origin === targetOrigin,
    (route) => route.continue({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": OIDC } }),
  );
}
// Network, including worker-initiated tile fetches (Playwright sees those; page-session CDP does not).
const reqs = [];
page.on("requestfinished", async (r) => {
  try { const s = await r.sizes(); reqs.push({ url: r.url(), t: performance.now(), bytes: s.responseBodySize + s.responseHeadersSize }); } catch {}
});
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 160)));

const now = () => page.evaluate(() => performance.now());
async function phase(name, fn) {
  const r0 = await page.evaluate(() => ({ renders: window.__mapRenders, reqs: 0 }));
  const n0 = reqs.length;
  const t0 = await now();
  await fn();
  const t1 = await now();
  await page.waitForTimeout(900); // inertia / settle tail
  const t2 = await now();
  const r1 = await page.evaluate(() => ({ renders: window.__mapRenders }));
  const data = await page.evaluate(([a, b]) => {
    const ft = window.__ft.filter((t) => t >= a && t <= b);
    const gaps = []; for (let i = 1; i < ft.length; i++) gaps.push(ft[i] - ft[i - 1]);
    gaps.sort((x, y) => x - y);
    const pct = (p) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] : null;
    const lt = window.__lt.filter(([s]) => s >= a && s <= b);
    return { frames: ft.length, gapMean: gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null, gapP95: pct(0.95), gapMax: gaps.length ? gaps[gaps.length - 1] : null, dropped: gaps.filter((g) => g > 50).length, longTasks: lt.length, longTaskMs: lt.reduce((s, [, d]) => s + d, 0) };
  }, [t0, t2]);
  const bytes = reqs.slice(n0).reduce((s, r) => s + r.bytes, 0);
  const kinds = {};
  for (const r of reqs.slice(n0)) {
    const k = /elevation-tiles|terrarium/.test(r.url) ? "dem" : /natural_earth/.test(r.url) ? "relief" : /\/planet\/\d+\/|\/vector\/|\.mvt|\.pbf(\?|$)/.test(r.url) && !/fonts/.test(r.url) ? "vector" : /fonts\/|glyph/.test(r.url) ? "glyph" : /sprite/.test(r.url) ? "sprite" : /arcgisonline|cartocdn\.com\/(dark|light)_all|opentopomap/.test(r.url) ? "raster" : /\/api\//.test(r.url) ? "api" : "other";
    kinds[k] = kinds[k] || { n: 0, kb: 0 }; kinds[k].n++; kinds[k].kb += r.bytes / 1024;
  }
  const byKind = Object.entries(kinds).map(([k, v]) => `${k}=${v.n}/${Math.round(v.kb)}KB`).join(" ");
  const tileReqs = reqs.slice(n0).filter((r) => /\.pbf|\.png|\.jpg|\.webp|proxy-tiles|\/planet\/|tile/i.test(r.url)).length;
  results.push({ name, gestureMs: Math.round(t1 - t0), windowMs: Math.round(t2 - t0), ...data, renders: r1.renders - r0.renders, requests: reqs.length - n0, tileReqs, kb: Math.round(bytes / 1024), zoom: await zoomOf(), byKind });
}

const zoomOf = () => page.evaluate(() => window.__map?.getZoom?.()?.toFixed(2) ?? null);

const wall0 = performance.now();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 60000 });
await page.waitForFunction(() => !document.querySelector(".tnx-boot"), { timeout: 30000 }).catch(() => {});
await page.evaluate(() => { const m = window.__map; if (m?.on) m.on("render", () => window.__mapRenders++); });
if (ablate.includes("terrain-off")) await page.evaluate(() => window.__worldmap?.setTerrain(false));
if (ablate.includes("buildings-off")) await page.evaluate(() => { const m = window.__map; const hide = () => { try { if (m.getLayer("tn-buildings-3d")) m.setLayoutProperty("tn-buildings-3d", "visibility", "none"); } catch {} }; hide(); m.on("style.load", hide); });
const results = [];
if (first) await phase("first-10s", async () => { await page.waitForTimeout(10000); });
await page.waitForTimeout(settle);
if (args.shot) await page.screenshot({ path: String(args.shot) });

const box = await page.locator("canvas.maplibregl-canvas").first().boundingBox();
const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
await page.mouse.move(cx, cy);
await page.waitForTimeout(300);

await phase("zoom-in", async () => {
  for (let i = 0; i < steps; i++) { await page.mouse.move(cx + (i % 3) - 1, cy + ((i * 7) % 3) - 1); await page.mouse.wheel(0, -100); await page.waitForTimeout(45); }
});
await phase("pan", async () => {
  await page.mouse.down();
  for (let i = 0; i < 40; i++) { await page.mouse.move(cx + i * 6, cy + Math.round(Math.sin(i / 6) * 40)); await page.waitForTimeout(30); }
  await page.mouse.up();
});
await phase("zoom-out", async () => {
  for (let i = 0; i < steps; i++) { await page.mouse.move(cx + (i % 3) - 1, cy + ((i * 5) % 3) - 1); await page.mouse.wheel(0, 100); await page.waitForTimeout(45); }
});
await phase("rest", async () => { await page.waitForTimeout(2500); });

const heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
const out = { label, url, settle, steps, ablate, results, heapMB: heap, consoleErrors: consoleErrors.slice(0, 5), totalRequests: reqs.length, totalKB: Math.round(reqs.reduce((s, r) => s + r.bytes, 0) / 1024) };
if (args.out) fs.writeFileSync(String(args.out), JSON.stringify(out, null, 1));
console.log(`\n=== ${label}  (settle ${settle} ms, ${steps} wheel steps)  heap ${heap} MB  requests ${reqs.length} / ${out.totalKB} KB  errors ${consoleErrors.length}`);
console.log("phase      gesture  frames  gap mean  p95    max   >50ms  longtasks(ms)  renders  reqs(tiles)  KB    zoom");
for (const r of results) console.log(`${r.name.padEnd(10)} ${String(r.gestureMs).padStart(6)}  ${String(r.frames).padStart(6)}  ${r.gapMean?.toFixed(1).padStart(7)}  ${r.gapP95?.toFixed(0).padStart(4)}  ${r.gapMax?.toFixed(0).padStart(5)}  ${String(r.dropped).padStart(5)}  ${String(r.longTasks).padStart(3)} (${String(Math.round(r.longTaskMs)).padStart(5)})  ${String(r.renders).padStart(7)}  ${String(r.requests).padStart(4)} (${String(r.tileReqs).padStart(3)})  ${String(r.kb).padStart(5)}  ${r.zoom ?? "-"}   ${r.byKind}`);
await browser.close();
