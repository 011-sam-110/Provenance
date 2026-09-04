// Idle main-thread cost of a page at rest, headed, with optional ablations.
// usage: node idleprof.mjs <url> [--settle=5000] [--window=10000] [--cpu=1] [--reduced-motion] [--scroll=N] [--mobile]
//
// Against a Vercel PREVIEW, which is a production build this machine did not have to
// make and cannot always afford to:
//   vercel env run --project traffic-nerd-v2 -- node scripts/idleprof.mjs <preview-url>/app
// `vercel env run` puts VERCEL_OIDC_TOKEN in the environment without it ever appearing
// in a command line or in output, and the header below is what gets past Deployment
// Protection. It is `x-vercel-trusted-oidc-idp-token`, NOT `x-vercel-oidc-token` —
// different header, different purpose. Never disable Deployment Protection to make a
// run pass, and never print the token.
import { loadPlaywright } from "./playwright.mjs";
const { chromium, devices } = await loadPlaywright();
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const url = process.argv[2];
const settle = Number(args.settle || 5000), win = Number(args.window || 10000), cpu = Number(args.cpu || 1);

// THE HEADER MUST BE SCOPED TO THE TARGET ORIGIN, and a route handler is the only way
// to do it. This block previously CLAIMED to be scoped while using `extraHTTPHeaders`,
// which applies to every request the page makes, cross-origin ones included. A
// non-simple header forces a CORS preflight, and `tiles.openfreemap.org` answers 405
// to any OPTIONS — verified: plain GET 200, OPTIONS 405. The Liberty style then fails,
// WorldMap falls back to Satellite, arcgisonline refuses the preflight too, and the run
// reports entirely plausible idle numbers for a map that never loaded. "Zero map
// renders" is exactly what a dead map produces, which is why this was not obvious.
const oidc = process.env.VERCEL_OIDC_TOKEN;

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({
  ...(args.mobile ? { ...devices["Pixel 7"] } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }),
});
if (oidc) {
  const targetOrigin = new URL(url).origin;
  await ctx.route((u) => u.origin === targetOrigin, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": oidc } }),
  );
}
const page = await ctx.newPage();
if (args["reduced-motion"]) await page.emulateMedia({ reducedMotion: "reduce" });
await page.addInitScript(() => {
  window.__frames = 0; window.__raf = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { window.__raf++; cb(t); });
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true }); } catch {}
});
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
await page.goto(url, { waitUntil: "load" });
if (args.scroll) await page.evaluate((y) => window.scrollTo(0, y), Number(args.scroll));
await page.waitForTimeout(settle);
const m0 = (await cdp.send("Performance.getMetrics")).metrics.reduce((o, m) => (o[m.name] = m.value, o), {});
const raf0 = await page.evaluate(() => window.__raf);
const lt0 = await page.evaluate(() => window.__lt.length);
const t0 = Date.now();
// map render counter if a MapLibre handle is exposed
await page.evaluate(() => { const m = window.__map; if (m && m.on) { window.__mapRenders = 0; window.__mapSrc = 0; m.on("render", () => window.__mapRenders++); m.on("sourcedata", () => window.__mapSrc++); } });
await page.waitForTimeout(win);
const elapsed = (Date.now() - t0) / 1000;
const m1 = (await cdp.send("Performance.getMetrics")).metrics.reduce((o, m) => (o[m.name] = m.value, o), {});
const raf1 = await page.evaluate(() => window.__raf);
const lt = await page.evaluate(() => window.__lt);
const mapc = await page.evaluate(() => ({ renders: window.__mapRenders ?? null, sourcedata: window.__mapSrc ?? null, hasMap: !!window.__map, moving: window.__map?.isMoving?.() ?? null, zoom: window.__map?.getZoom?.()?.toFixed(2) ?? null }));
const busy = (m1.TaskDuration - m0.TaskDuration) / elapsed * 100;
const script = (m1.ScriptDuration - m0.ScriptDuration) / elapsed * 100;
const layout = (m1.LayoutDuration - m0.LayoutDuration + m1.RecalcStyleDuration - m0.RecalcStyleDuration) / elapsed * 100;
const ltWin = lt.slice(lt0);
console.log(`${url.replace("https://provenance-online.vercel.app", "")||"/"} cpu=${cpu}x${args["reduced-motion"] ? " reduced-motion" : ""}${args.scroll ? " scroll=" + args.scroll : ""}${args.mobile ? " mobile" : ""} | settle ${settle}ms, window ${elapsed.toFixed(1)}s | BUSY ${busy.toFixed(1)}% (script ${script.toFixed(1)}%, layout+style ${layout.toFixed(1)}%) | rAF ${((raf1 - raf0) / elapsed).toFixed(0)}/s | longtasks ${ltWin.length} = ${ltWin.reduce((s, [, d]) => s + d, 0)}ms | map ${JSON.stringify(mapc)} | heap ${Math.round(m1.JSHeapUsedSize / 1048576)}MB`);
await browser.close();
