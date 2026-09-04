// Sampled CPU profile of a page at rest, headed. Aggregates self time by function+script.
// usage: node cpuprof.mjs <url> [--settle=7000] [--window=6000] [--reduced-motion] [--top=20]
import { loadPlaywright } from "./playwright.mjs";
const { chromium } = await loadPlaywright();
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const url = process.argv[2];
const settle = Number(args.settle || 7000), win = Number(args.window || 6000), top = Number(args.top || 20);
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
if (args["reduced-motion"]) await page.emulateMedia({ reducedMotion: "reduce" });
const cdp = await ctx.newCDPSession(page);
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(settle);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
await cdp.send("Profiler.start");
await page.waitForTimeout(win);
const { profile } = await cdp.send("Profiler.stop");
await browser.close();

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const self = new Map();
const total = profile.samples.length;
const dt = profile.timeDeltas;
const selfUs = new Map();
for (let i = 0; i < profile.samples.length; i++) { const id = profile.samples[i]; selfUs.set(id, (selfUs.get(id) || 0) + (dt[i] || 0)); }
const key = (n) => { const cf = n.callFrame; const u = (cf.url || "").replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").split("/").pop(); return `${cf.functionName || "(anon)"} @ ${u || "(native)"}:${cf.lineNumber}:${cf.columnNumber}`; };
const agg = new Map();
let idleUs = 0, gcUs = 0, progUs = 0, totalUs = 0;
for (const [id, us] of selfUs) {
  const n = byId.get(id); totalUs += us;
  const fn = n.callFrame.functionName;
  if (fn === "(idle)") { idleUs += us; continue; }
  if (fn === "(garbage collector)") { gcUs += us; continue; }
  if (fn === "(program)") { progUs += us; continue; }
  const k = key(n); agg.set(k, (agg.get(k) || 0) + us);
}
// Inclusive time by script URL (walk parents to attribute each sample to the outermost non-native frame's script)
const byScript = new Map();
for (const [id, us] of selfUs) { const n = byId.get(id); const u = (n.callFrame.url || "").replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").split("/").pop() || n.callFrame.functionName; byScript.set(u, (byScript.get(u) || 0) + us); }
const pct = (us) => (us / totalUs * 100).toFixed(1) + "%";
console.log(`\n=== ${url.replace("https://provenance-online.vercel.app", "") || "/"}${args["reduced-motion"] ? " reduced-motion" : ""} | ${(totalUs / 1e6).toFixed(1)}s sampled | idle ${pct(idleUs)} gc ${pct(gcUs)} program ${pct(progUs)} busy ${pct(totalUs - idleUs)}`);
console.log("--- self time by script:");
for (const [k, v] of [...byScript].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${pct(v).padStart(6)}  ${k}`);
console.log(`--- top ${top} functions by self time:`);
for (const [k, v] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${pct(v).padStart(6)}  ${k}`);
// Top-level entry points: attribute samples to the frame just below (root) — i.e. the task entry
const entry = new Map();
for (const [id, us] of selfUs) {
  let n = byId.get(id); if (["(idle)", "(garbage collector)", "(program)", "(root)"].includes(n.callFrame.functionName)) continue;
  let cur = id, last = id;
  while (parent.has(cur)) { const p = parent.get(cur); const pn = byId.get(p); if (pn.callFrame.functionName === "(root)") break; last = p; cur = p; }
  const k = key(byId.get(last)); entry.set(k, (entry.get(k) || 0) + us);
}
console.log("--- top task entry frames (inclusive):");
for (const [k, v] of [...entry].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${pct(v).padStart(6)}  ${k}`);
