// Load profiler for Provenance. Measures what the browser actually waits on.
// usage: node loadprof.mjs <url> [--cpu=4] [--net=slow4g|fast3g] [--headed] [--wait=15000] [--out=file.json]
import fs from "node:fs";
import { loadPlaywright } from "./playwright.mjs";
const { chromium } = await loadPlaywright();

const args = Object.fromEntries(process.argv.slice(3).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const url = process.argv[2];
const cpu = Number(args.cpu || 1);
const net = args.net || "none";
const headed = !!args.headed;
const waitMs = Number(args.wait || 15000);

const NET = {
  slow4g: { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
  fast3g: { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 562.5 },
  cable: { downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8, latency: 40 },
};

const browser = await chromium.launch({
  headless: !headed,
  args: headed ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
// Against a Vercel PREVIEW — see the note in idleprof.mjs for the token and the header.
// Worth preferring over localhost for anything TIMED: Chrome does not apply CDP network
// emulation to loopback traffic, so `--net=slow4g` against localhost silently measures an
// unthrottled load. An 18 ms TTFB under a "slow 4G" profile is the tell. A preview is a real
// remote origin, so the throttle actually applies.
//
// THE HEADER MUST BE SCOPED TO THE TARGET ORIGIN. `extraHTTPHeaders` on a context applies to
// EVERY request the page makes, including cross-origin ones. A non-simple header forces the
// browser to send a CORS preflight, and `tiles.openfreemap.org` answers 405 to any OPTIONS —
// so the Liberty style 405s, the basemap never loads, and the run measures a dead map while
// reporting plausible numbers. Routing it per-origin keeps third-party tile hosts untouched.
const oidc = process.env.VERCEL_OIDC_TOKEN;
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
if (oidc) {
  const targetOrigin = new URL(url).origin;
  await ctx.route((u) => u.origin === targetOrigin, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": oidc } }),
  );
}
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__lt = [];
  window.__paint = {};
  window.__marks = {};
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__paint[e.name] = Math.round(e.startTime); }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__paint.lcp = Math.round(e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  // Poll for the console's own readiness markers.
  const t0 = performance.now();
  const seen = {};
  const iv = setInterval(() => {
    const t = Math.round(performance.now());
    const q = (s) => document.querySelector(s);
    if (!seen.canvas && q("canvas.maplibregl-canvas")) { seen.canvas = 1; window.__marks.mapCanvas = t; }
    if (!seen.veilSeen && q(".tnx-boot")) { seen.veilSeen = 1; window.__marks.bootVeilSeen = t; }
    if (seen.veilSeen && !seen.veilGone && !q(".tnx-boot")) { seen.veilGone = 1; window.__marks.bootVeilGone = t; }
    if (!seen.hero && q("canvas")) { seen.hero = 1; window.__marks.firstCanvas = t; }
    if (!seen.map && window.__map && window.__map.once) { seen.map = 1; window.__marks.mapHandle = t; window.__map.once("load", () => { window.__marks.mapLoad = Math.round(performance.now()); }); window.__map.once("idle", () => { window.__marks.mapFirstIdle = Math.round(performance.now()); }); }
    if (!seen.tile && q("canvas.maplibregl-canvas") && window.__map && window.__map.areTilesLoaded && window.__map.areTilesLoaded() && window.__map.loaded && window.__map.loaded()) { seen.tile = 1; window.__marks.mapTilesLoaded = t; }
    if (t - t0 > 60000) clearInterval(iv);
  }, 16);
});

if (args.block) {
  const pats = String(args.block).split(",").filter(Boolean);
  await page.route((u) => pats.some((p) => u.href.includes(p)), (route) => route.abort("blockedbyclient"));
}
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Performance.enable");
if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
if (NET[net]) await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NET[net] });

const reqs = new Map();
let navStart = 0;
cdp.on("Network.requestWillBeSent", (e) => {
  if (!navStart && e.type === "Document") navStart = e.timestamp;
  reqs.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp, initiator: e.initiator?.type, priority: e.request.initialPriority, enc: 0, dec: 0 });
});
cdp.on("Network.responseReceived", (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.mime = e.response.mimeType; r.fromCache = e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache; r.proto = e.response.protocol; r.ttfb = e.response.timing ? Math.round(e.response.timing.receiveHeadersEnd) : null; } });
cdp.on("Network.dataReceived", (e) => { const r = reqs.get(e.requestId); if (r) { r.dec += e.dataLength; r.enc += e.encodedDataLength; } });
cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.encTotal = e.encodedDataLength; } });
cdp.on("Network.loadingFailed", (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.failed = e.errorText; } });

const wall0 = Date.now();
await page.goto(url, { waitUntil: "commit" });
await page.waitForTimeout(waitMs);

const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType("navigation")[0];
  return n ? { ttfb: Math.round(n.responseStart), domInteractive: Math.round(n.domInteractive), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transfer: n.transferSize, decoded: n.decodedBodySize } : null;
});
const paint = await page.evaluate(() => window.__paint);
const marks = await page.evaluate(() => window.__marks);
const lt = await page.evaluate(() => window.__lt);
const metrics = (await cdp.send("Performance.getMetrics")).metrics.reduce((o, m) => (o[m.name] = m.value, o), {});
const dom = await page.evaluate(() => ({ nodes: document.getElementsByTagName("*").length, canvases: document.querySelectorAll("canvas").length, veil: !!document.querySelector(".tnx-boot"), title: document.title, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }));

const rows = [...reqs.values()].map((r) => ({ ...r, startMs: Math.round((r.start - navStart) * 1000), endMs: r.end ? Math.round((r.end - navStart) * 1000) : null, enc: r.encTotal || r.enc }));
rows.sort((a, b) => a.startMs - b.startMs);
const byType = {};
for (const r of rows) { const k = r.type || "?"; byType[k] = byType[k] || { n: 0, enc: 0, dec: 0 }; byType[k].n++; byType[k].enc += r.enc; byType[k].dec += r.dec; }
const ltTotal = lt.reduce((s, [, d]) => s + d, 0);
const ltAfterLoad = lt.filter(([s]) => s > (nav?.load || 0)).reduce((s, [, d]) => s + d, 0);

const out = { url, cpu, net, headed, waitMs, nav, paint, marks, dom, longTasks: { count: lt.length, totalMs: ltTotal, afterLoadMs: ltAfterLoad, top: [...lt].sort((a, b) => b[1] - a[1]).slice(0, 8) }, cdp: { TaskDuration: +metrics.TaskDuration.toFixed(2), ScriptDuration: +metrics.ScriptDuration.toFixed(2), LayoutDuration: +metrics.LayoutDuration.toFixed(2), RecalcStyleDuration: +metrics.RecalcStyleDuration.toFixed(2), JSHeapUsedMB: Math.round(metrics.JSHeapUsedSize / 1048576) }, byType, requests: rows };
if (args.out) fs.writeFileSync(args.out, JSON.stringify(out, null, 1));

const fmt = (n) => (n == null ? "-" : n);
console.log(`\n=== ${url}  cpu=${cpu}x net=${net} ${headed ? "headed" : "headless"}  (window ${waitMs} ms)`);
console.log(`nav: ttfb=${fmt(nav?.ttfb)} domInteractive=${fmt(nav?.domInteractive)} DCL=${fmt(nav?.dcl)} load=${fmt(nav?.load)} | FCP=${fmt(paint["first-contentful-paint"])} LCP=${fmt(paint.lcp)}`);
console.log(`marks: ${JSON.stringify(marks)}  dom: ${JSON.stringify(dom)}`);
console.log(`longtasks: n=${lt.length} total=${ltTotal}ms afterLoad=${ltAfterLoad}ms top=${JSON.stringify(out.longTasks.top)}`);
console.log(`cdp: ${JSON.stringify(out.cdp)}`);
console.log("by type: " + Object.entries(byType).map(([k, v]) => `${k}=${v.n}/${Math.round(v.enc / 1024)}KB wire/${Math.round(v.dec / 1024)}KB dec`).join("  "));
console.log(`requests: ${rows.length} total wire=${Math.round(rows.reduce((s, r) => s + r.enc, 0) / 1024)}KB`);
console.log("\n start   end   wire    dec  type       url");
for (const r of rows.slice(0, 60)) {
  const u = r.url.replace("https://provenance-online.vercel.app", "").replace(/\?dpl=[^&]+/, "").slice(0, 90);
  console.log(`${String(r.startMs).padStart(6)} ${String(fmt(r.endMs)).padStart(6)} ${String(Math.round(r.enc / 1024)).padStart(5)}K ${String(Math.round(r.dec / 1024)).padStart(5)}K ${String(r.type || "?").padEnd(10)} ${r.failed ? "FAIL " + r.failed + " " : ""}${r.status && r.status !== 200 ? r.status + " " : ""}${u}`);
}
if (rows.length > 60) console.log(`... ${rows.length - 60} more`);
await browser.close();
