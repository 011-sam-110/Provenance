// Frames per second of the landing page while it scrolls, section by section.
//
//   node scripts/landing-fps.mjs                                (production)
//   node scripts/landing-fps.mjs http://localhost:3000/
//   node scripts/landing-fps.mjs <url> --speed=1600 --json=out.json
//
// WHY THIS EXISTS. On 2026-10-07 the page ran at 8 to 48 frames per second on a 120 Hz laptop
// and nothing in the repo could see it. `window.__pvLanding.drawMs` read 10 ms, because the
// time was not in the page: Chrome rasterised the globe's 2D paths on the CPU in its GPU
// process. The only number that shows that is the one a reader sees, the frames the page
// actually produced. This counts them. It is not in the gate and it cannot be: it needs a
// real screen.
//
// HOW IT MEASURES. Real Chrome, headed, on this machine's own graphics card. Wheel input at a
// fixed speed, from the top to the footer. A requestAnimationFrame probe in the page records
// the time of every frame and the scroll position, and the frames are grouped by the stage's
// own named marks (`window.__pvLanding.marks()`), so a section here is the same stretch of
// scroll on every run and every screen size.
//
// FOUR WAYS THIS GIVES A FALSE NUMBER, all met while writing it:
//   1. HEADLESS. Headless Chrome draws with a software renderer. Its frame rate says nothing
//      about a graphics card. This script has no headless switch on purpose.
//   2. A COVERED WINDOW. Chrome gives a window nobody can see about one frame a second. If
//      the median frame is longer than half a second the run is reported INVALID. Leave the
//      window in front and run it again.
//   3. ENERGY SAVER. At 20% battery or less Chrome holds every page at 30 frames per second.
//      The profile this script starts turns that off, so a low battery measures the page and
//      not the cap. A visitor's own Chrome on a low battery is still capped, and no page can
//      change that.
//   4. POWER. The same page gave 4 to 11 frames per second on battery and 8 to 48 on mains,
//      because the graphics card is throttled on battery. The power state is printed with
//      the table. Never compare a battery run with a mains run.
import { chromium } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (k, d) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const url = args.find((a) => !a.startsWith("--")) || "https://provenance-online.com/";
const speed = Number(flag("speed", 1600));
const jsonPath = flag("json", "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (n) => Math.round(n * 10) / 10;
const quantile = (list, p) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/* A throwaway profile whose Local State turns Energy Saver off (false number 3 above). */
const profile = mkdtempSync(join(tmpdir(), "landing-fps-"));
writeFileSync(
  join(profile, "Local State"),
  JSON.stringify({ performance_tuning: { battery_saver_mode: { state: 0 }, high_efficiency_mode: { state: 0 } } }),
);
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chrome",
  headless: false,
  viewport: null,
  reducedMotion: "no-preference",
  args: [
    "--start-maximized",
    "--no-first-run",
    "--no-default-browser-check",
    /* These stop Chrome from slowing a window it believes is hidden. They do not help a
       window that really is covered: its frames are not shown, so they are not made. */
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
  ],
});
let exitCode = 0;
try {
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => window.__pvLanding && window.__pvLanding.ready === true, null, { timeout: 60_000 });
  await sleep(2500);

  const env = await page.evaluate(async () => {
    let gpu = "";
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {}
    let power = "unknown";
    try {
      const b = await navigator.getBattery();
      power = (b.charging ? "mains" : "BATTERY") + " " + Math.round(b.level * 100) + "%";
    } catch {}
    const cv = document.querySelector('[data-testid="landing-globe"]');
    return {
      gpu,
      power,
      viewport: innerWidth + "x" + innerHeight,
      dpr: devicePixelRatio,
      canvas: cv ? cv.width + "x" + cv.height : "",
      painter: window.__pvLanding.renderer ?? "2d (this build has one painter)",
      reducedMotion: window.__pvLanding.reducedMotion,
      marks: window.__pvLanding.marks(),
      bottom: document.documentElement.scrollHeight - innerHeight,
    };
  });
  if (env.reducedMotion) throw new Error("the page is in reduced motion: nothing scrolls, so there is nothing to measure");

  /* The probe. One rAF loop that does nothing but write down when it ran. */
  await page.evaluate(() => {
    const P = (window.__fps = { on: false, t: [], y: [], d: [] });
    const loop = (now) => {
      if (P.on) {
        P.t.push(now);
        P.y.push(window.scrollY);
        P.d.push(window.__pvLanding.draws);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const take = () =>
    page.evaluate(() => {
      const P = window.__fps;
      P.on = false;
      const out = { t: P.t.slice(), y: P.y.slice(), d: P.d.slice() };
      P.t.length = P.y.length = P.d.length = 0;
      return out;
    });
  const start = () => page.evaluate(() => void (window.__fps.on = true));

  /* At rest: the screen's own frame interval, and the rule that an idle page draws nothing. */
  await start();
  await sleep(1500);
  const rest = await take();
  const restIv = [];
  for (let i = 1; i < rest.t.length; i++) restIv.push(rest.t[i] - rest.t[i - 1]);
  const screenMs = quantile(restIv, 0.5);
  const restDraws = rest.d.length ? rest.d[rest.d.length - 1] - rest.d[0] : 0;

  /* The scroll. One wheel step is capped, so a page that stalls is not skipped across. */
  const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await page.mouse.move(Math.round(size.w / 2), Math.round(size.h / 2));
  const bottom = Math.round(env.bottom);
  let reached = false;
  await start();
  const began = Date.now();
  let last = began;
  let lastCheck = began;
  let lastY = -1;
  let stuck = 0;
  for (;;) {
    await sleep(14);
    const now = Date.now();
    await page.mouse.wheel(0, Math.min(250, Math.max(1, Math.round(((now - last) / 1000) * speed))));
    last = now;
    if (now - lastCheck >= 350) {
      lastCheck = now;
      const y = await page.evaluate(() => window.scrollY);
      if (y >= bottom - 2) {
        reached = true;
        break;
      }
      stuck = Math.abs(y - lastY) < 1 ? stuck + 1 : 0;
      lastY = y;
      if (stuck > 12) break;
    }
    if (now - began > 120_000) break;
  }
  await sleep(900);
  const run = await take();
  const painterAfter = await page.evaluate(() => window.__pvLanding.renderer);
  /* The probe ran on after the scroll stopped. Those frames are a page at rest: at the screen's
     own rate, with no work in them. Counted, they would make a slow page look faster, and the
     last section most of all. Keep the frames up to the last one in which the page moved or
     the stage painted (it eases for about half a second after the last wheel step). */
  let end = 0;
  for (let i = 1; i < run.t.length; i++) if (run.y[i] !== run.y[i - 1] || run.d[i] !== run.d[i - 1]) end = i;
  run.t.length = run.y.length = run.d.length = end + 1;

  /* Sections, bounded by the stage's own marks. */
  const m = env.marks;
  const bounds = [
    ["1 hero flight", 0, m.inset],
    ["2 split, four globes", m.inset, m.merge],
    ["3 merge", m.merge, m.centre],
    ["4 photos, lens", m.centre, m.band0],
    ["5 card band", m.band0, m["to-flat"]],
    ["6 flat map, unroll", m["to-flat"], m.flat],
    ["7 zoom", m.flat, m.street1],
    ["8 street", m.street1, m["to-close"]],
    ["9 to the close", m["to-close"], m.close],
    ["10 close and footer", m.close, Infinity],
    ["whole scroll", -1, Infinity],
  ];
  if (bounds.some(([, lo, hi]) => lo === undefined || hi === undefined)) {
    throw new Error("a mark this script reads is gone from window.__pvLanding.marks(). Rename it here in the same change.");
  }
  const rows = [];
  for (const [name, lo, hi] of bounds) {
    const iv = [];
    let paints = 0;
    for (let i = 1; i < run.t.length; i++) {
      if (run.y[i] < lo || run.y[i] >= hi) continue;
      iv.push(run.t[i] - run.t[i - 1]);
      paints += run.d[i] - run.d[i - 1];
    }
    if (!iv.length) {
      rows.push({ section: name, seconds: 0 });
      continue;
    }
    const total = iv.reduce((a, b) => a + b, 0);
    rows.push({
      section: name,
      seconds: r1(total / 1000),
      fps: r1((iv.length / total) * 1000),
      p50: r1(quantile(iv, 0.5)),
      p90: r1(quantile(iv, 0.9)),
      p99: r1(quantile(iv, 0.99)),
      longest: r1(Math.max(...iv)),
      paints,
    });
  }

  const all = rows[rows.length - 1];
  const covered = !all.seconds || all.p50 > 500;
  const invalid = covered || !reached;
  const painter = !painterAfter || painterAfter === env.painter ? env.painter : `${env.painter} at the start, ${painterAfter} at the end (the WebGL context was lost during the run)`;
  const capped = screenMs > 30 && screenMs < 37;

  console.log(`\n${url}`);
  console.log(`graphics  ${env.gpu || "unknown"}`);
  console.log(`window    ${env.viewport} CSS px at ${env.dpr}, canvas ${env.canvas} device px`);
  console.log(`screen    one frame every ${r1(screenMs)} ms at rest (${r1(1000 / screenMs)} per second)`);
  console.log(`power     ${env.power}`);
  console.log(`painter   ${painter}`);
  console.log(`at rest   ${restDraws} paints in 1.5 s ${restDraws ? "(an idle page must draw nothing)" : "(correct: an idle page draws nothing)"}`);
  console.log(`scroll    ${speed} px per second, by wheel\n`);
  const pad = (s, n) => String(s).padEnd(n);
  const padl = (s, n) => String(s).padStart(n);
  console.log(pad("section", 24) + ["sec", "fps", "p50 ms", "p90 ms", "p99 ms", "longest", "paints"].map((h) => padl(h, 9)).join(""));
  for (const r of rows) {
    if (!r.seconds) console.log(pad(r.section, 24) + padl("no frames", 18));
    else console.log(pad(r.section, 24) + [r.seconds, r.fps, r.p50, r.p90, r.p99, r.longest, r.paints].map((v) => padl(v, 9)).join(""));
  }
  console.log("");
  if (covered) console.log("INVALID RUN: the window was not being drawn (covered, minimised, or on another desktop). Keep it in front and run again.");
  else if (!reached) console.log("INVALID RUN: the scroll did not reach the bottom of the page, so the table is not the whole page. Run it again.");
  if (invalid) exitCode = 1;
  if (capped) console.log("NOTE: this screen or this browser is held at about 30 frames per second, so no section can read higher.");
  if (!env.power.startsWith("mains")) console.log("NOTE: not on mains power. Compare this run only with other battery runs.");

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ url, when: new Date().toISOString(), speed, invalid, screenMs: r1(screenMs), restDraws, env: { ...env, painter, marks: undefined }, rows }, null, 1));
    console.log(`written ${jsonPath}`);
  }
} catch (e) {
  console.error(String(e && e.message ? e.message : e));
  exitCode = 1;
} finally {
  await ctx.close();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {}
}
process.exit(exitCode);
