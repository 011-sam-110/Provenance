// Load waterfall that INCLUDES worker-initiated fetches (MapLibre pulls vector tiles
// inside its worker; a page-session CDP Network capture never sees them).
// usage (cwd = Provenance repo): node <this> <url> [--wait=15000] [--cpu=1] [--net=slow4g] [--out=x.json]
import fs from "node:fs";
import { loadPlaywright } from "./playwright.mjs";
const { chromium } = await loadPlaywright();
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const url = process.argv[2];
const waitMs = Number(args.wait || 15000), cpu = Number(args.cpu || 1);
const NET = { slow4g: { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 } };

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__marks = {};
  const t0 = performance.now(); const seen = {};
  const iv = setInterval(() => {
    const t = Math.round(performance.now());
    if (!seen.canvas && document.querySelector("canvas.maplibregl-canvas")) { seen.canvas = 1; window.__marks.mapCanvas = t; }
    if (!seen.veil && document.querySelector(".tnx-boot")) { seen.veil = 1; window.__marks.veilSeen = t; }
    if (seen.veil && !seen.veilGone && !document.querySelector(".tnx-boot")) { seen.veilGone = 1; window.__marks.veilGone = t; }
    if (!seen.map && window.__map?.once) { seen.map = 1; window.__marks.mapHandle = t;
      window.__map.once("load", () => { window.__marks.mapLoad = Math.round(performance.now()); });
      window.__map.once("idle", () => { window.__marks.mapFirstIdle = Math.round(performance.now()); });
      window.__map.once("style.load", () => { window.__marks.styleLoad = Math.round(performance.now()); });
      window.__marks.sourcedata = []; window.__map.on("sourcedata", (e) => { if (e.isSourceLoaded && e.sourceId) window.__marks.sourcedata.push([Math.round(performance.now()), e.sourceId]); });
    }
    if (t - t0 > 60000) clearInterval(iv);
  }, 8);
});
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
const cdp = await ctx.newCDPSession(page);
if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
if (NET[args.net]) { await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NET[args.net] }); }

let nav0 = 0;
const rows = new Map();
page.on("request", (r) => { const t = Date.now(); if (!nav0) nav0 = t; rows.set(r, { url: r.url(), type: r.resourceType(), start: t - nav0, worker: !!r.serviceWorker() ? "sw" : (r.frame() ? "" : "worker") }); });
page.on("requestfinished", async (r) => { const row = rows.get(r); if (!row) return; row.end = Date.now() - nav0; try { const s = await r.sizes(); row.kb = (s.responseBodySize + s.responseHeadersSize) / 1024; const resp = await r.response(); row.status = resp?.status(); row.cache = resp?.headers()["x-vercel-cache"] || resp?.headers()["cf-cache-status"] || resp?.headers()["x-cache"] || ""; } catch {} });
page.on("requestfailed", (r) => { const row = rows.get(r); if (row) { row.end = Date.now() - nav0; row.failed = r.failure()?.errorText; } });

await page.goto(url, { waitUntil: "commit" });
await page.waitForTimeout(waitMs);
const marks = await page.evaluate(() => window.__marks);
await browser.close();

const list = [...rows.values()].filter((r) => !r.url.startsWith("data:")).sort((a, b) => a.start - b.start);
const short = (u) => u.replace("https://provenance-online.vercel.app", "").replace("https://tiles.openfreemap.org", "OFM").replace("https://osirisai.live", "").replace(/\?dpl=[^&]+/, "").replace(/url=https%3A%2F%2F/, "url=").slice(0, 100);
const { sourcedata, ...m } = marks;
console.log(`=== ${url} cpu=${cpu} net=${args.net || "none"}\nmarks ${JSON.stringify(m)}`);
console.log("sources loaded: " + (sourcedata || []).map(([t, id]) => `${id}@${t}`).join(" "));
console.log(" start    end    KB  type      who     url");
for (const r of list) console.log(`${String(r.start).padStart(6)} ${String(r.end ?? "-").padStart(6)} ${String(Math.round(r.kb ?? 0)).padStart(5)}  ${(r.type || "").padEnd(9)} ${(r.worker || "page").padEnd(7)} ${r.failed ? "FAIL " : ""}${r.status && r.status !== 200 ? r.status + " " : ""}${r.cache ? "[" + r.cache + "] " : ""}${short(r.url)}`);
const kinds = {};
for (const r of list) { const k = /\/planet\/\d+\/|\/vector\//.test(r.url) ? "vector-tile" : /fonts\/|\.pbf/.test(r.url) ? "glyph" : /sprite/.test(r.url) ? "sprite" : /styles\/|style\.json/.test(r.url) ? "style" : /\/api\//.test(r.url) ? "api" : r.type; kinds[k] = kinds[k] || { n: 0, kb: 0, last: 0 }; kinds[k].n++; kinds[k].kb += r.kb || 0; kinds[k].last = Math.max(kinds[k].last, r.end || 0); }
console.log("by kind: " + Object.entries(kinds).map(([k, v]) => `${k}=${v.n}/${Math.round(v.kb)}KB(last ${v.last})`).join("  "));
if (args.out) fs.writeFileSync(String(args.out), JSON.stringify({ url, marks, list }, null, 1));
