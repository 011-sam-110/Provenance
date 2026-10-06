// The landing globe's two painters, side by side: 2D canvas on the left, WebGL in the middle,
// the difference on the right.
//
//   node scripts/landing-look.mjs                                (production)
//   node scripts/landing-look.mjs http://localhost:3000/
//   node scripts/landing-look.mjs <url> --out=profile-out/landing-look --marks=split,flat
//   node scripts/landing-look.mjs <url> --size=390x844@3         (the phone layout)
//
// WHY THIS EXISTS. The dots and lines of the globe have two painters that must look the same:
// `lib/marketing/landingGlobe.ts` on a 2D canvas and `lib/marketing/landingGlobeGL.ts` in
// WebGL. A visitor gets one or the other and never both, so nobody sees them drift apart.
// No unit test can see it either: both read the same style table, and what differs is what
// each rasteriser does with it. This is the only place the two are put next to each other.
// Run it after any change to either painter, and LOOK at the pictures. It is not in the gate.
//
// HOW IT WORKS. Real Chrome, headed, opens the same build twice. The first time a small
// script refuses a WebGL context to the globe's upper canvas, which is exactly what a visitor
// without WebGL gets: the 2D painter draws everything. The second time nothing is refused.
// Each load goes to the same named moments (`window.__pvLanding.go`), waits until the stage
// has stopped painting, and takes a picture. The two pictures of a moment are then compared
// inside a blank page, so this script needs no image library.
//
// WHAT THE NUMBERS MEAN. They cover the globe's own part of the screen, which the stage
// reports (`window.__pvLanding.globes()`): each disc and a margin for its halo, or the whole
// screen while the globe is unrolled into the flat map.
//   mean      the average difference of a pixel there, on the 0 to 255 scale
//   over 24   the share of those pixels that differ by more than 24, in percent
//   light     the total light of the WebGL picture over the 2D picture. 1.000 is equal.
//             Under 1 the WebGL picture is dimmer, over 1 it is brighter.
//   outside   the mean difference of the rest of the screen. It must be near 0: the rest is
//             the same HTML in both loads. If it is not, something other than a painter moved
//             (an animation, a late image), and the other three numbers are not to be trusted.
// The two are never equal. They are two rasterisers, and the edge of every dot falls on
// different pixels. The rule the WebGL painter was approved under is "the same to the eye",
// so no number here is a pass mark. A number that moved after a change is the reason to look.
// For scale, on 2026-10-07 in a 1646 by 894 window at 1.75: `mean` ran from 0.33 (the flat
// map) to 4.73 (the small globe at the close, where the dots sit on each other), `light`
// from 0.978 to 1.008, and `outside` was 0.03 or less.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (k, d) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const url = args.find((a) => !a.startsWith("--")) || "https://provenance-online.com/";
/* Not under test-results/: Playwright empties that folder at the start of every e2e run. */
const out = resolve(flag("out", "profile-out/landing-look"));
const MARKS = flag(
  "marks",
  "flight,flight-late,inset,split,merge,camera,volcano,band,to-flat,unroll-mid,flat,zoom,handoff,street2,to-close",
)
  .split(",")
  .filter(Boolean);
/* No --size: this machine's own window and pixel ratio, which is what its reader sees. */
const size = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(flag("size", ""));

/** The margin round a disc, in radii: the halo of a dot on the limb and the rim reach past R. */
const MARGIN = 1.18;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => (Math.round(n * 100) / 100).toFixed(2);

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--start-maximized",
    /* A window that Chrome believes is hidden gets about one frame a second, and the stage
       would take that long to arrive at each moment. */
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
  ],
});
const contextOptions = size
  ? { viewport: { width: Number(size[1]), height: Number(size[2]) }, deviceScaleFactor: Number(size[3] || 1) }
  : { viewport: null };

/** One load of the page: go to every moment, take a picture, note where the globes are. */
async function shoot(painter) {
  const ctx = await browser.newContext({ ...contextOptions, reducedMotion: "no-preference" });
  if (painter === "2d") {
    /* Only the globe's canvas is refused. The star sky keeps its own WebGL context. */
    await ctx.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (this.dataset && this.dataset.testid === "landing-globe-gl" && String(type).startsWith("webgl")) return null;
        return real.call(this, type, ...rest);
      };
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => window.__pvLanding && window.__pvLanding.ready === true, null, { timeout: 60_000 });
  const info = await page.evaluate(() => ({
    painter: window.__pvLanding.renderer,
    known: typeof window.__pvLanding.globes === "function",
    reducedMotion: window.__pvLanding.reducedMotion,
    marks: window.__pvLanding.marks(),
    dpr: devicePixelRatio,
    w: innerWidth,
    h: innerHeight,
  }));
  if (info.reducedMotion) throw new Error("the page is in reduced motion: it has one painter and nothing to compare");
  if (!info.known) throw new Error("this build has one painter (no window.__pvLanding.globes): there is nothing to compare");
  if (info.painter !== painter) throw new Error(`asked for the ${painter} painter and the page draws with ${info.painter}`);
  const shots = {};
  for (const m of MARKS) {
    if (!(m in info.marks)) throw new Error(`no moment named "${m}" in window.__pvLanding.marks()`);
    await page.evaluate((k) => window.__pvLanding.go(k), m);
    /* Arrived = forty animation frames in a row with no paint. Frames, not milliseconds: a
       slow window then waits longer, it does not take the picture early. */
    const settled = await page.evaluate(
      () =>
        new Promise((done) => {
          const t0 = performance.now();
          let last = window.__pvLanding.draws;
          let still = 0;
          const loop = () => {
            const d = window.__pvLanding.draws;
            still = d === last ? still + 1 : 0;
            last = d;
            if (still >= 40) done(true);
            else if (performance.now() - t0 > 30_000) done(false);
            else requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        }),
    );
    if (!settled) throw new Error(`the stage was still painting 30 s after it went to "${m}"`);
    /* The HTML over the globe (cards, photographs) has its own transitions. */
    await sleep(700);
    const png = await page.screenshot({ animations: "disabled" });
    writeFileSync(join(out, `${m}-${painter}.png`), png);
    const at = await page.evaluate(() => ({ globes: window.__pvLanding.globes(), y: Math.round(window.scrollY), painter: window.__pvLanding.renderer }));
    /* A WebGL context can be lost in the middle of a run. The page then draws with the 2D
       painter, and the pair would compare that painter with itself and read 0. */
    if (at.painter !== painter) throw new Error(`at "${m}" the page draws with ${at.painter}, not ${painter}: the WebGL context was lost during the run. Run it again.`);
    shots[m] = { png, globes: at.globes, y: at.y };
  }
  await ctx.close();
  return { info, shots, errors };
}

/** Runs in a blank page. Two PNGs in, the four numbers and the side-by-side picture out. */
async function compareInPage({ a, b, boxes, label }) {
  const load = async (b64) => {
    const im = new Image();
    im.src = "data:image/png;base64," + b64;
    await im.decode();
    return im;
  };
  const [A, B] = await Promise.all([load(a), load(b)]);
  if (A.width !== B.width || A.height !== B.height) return { error: `the pictures are ${A.width}x${A.height} and ${B.width}x${B.height}` };
  const w = A.width;
  const h = A.height;
  const pixels = (im) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(im, 0, 0);
    return x.getImageData(0, 0, w, h).data;
  };
  const da = pixels(A);
  const db = pixels(B);

  /* The globe's part of the screen, and the rectangle the picture is cut to. */
  const mask = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  if (!boxes) {
    mask.fill(1);
    x0 = 0; y0 = 0; x1 = w; y1 = h;
  } else {
    for (const q of boxes) {
      const bx0 = Math.max(0, Math.floor(q[0])), by0 = Math.max(0, Math.floor(q[1]));
      const bx1 = Math.min(w, Math.ceil(q[2])), by1 = Math.min(h, Math.ceil(q[3]));
      if (bx1 <= bx0 || by1 <= by0) continue;
      for (let y = by0; y < by1; y++) mask.fill(1, y * w + bx0, y * w + bx1);
      x0 = Math.min(x0, bx0); y0 = Math.min(y0, by0); x1 = Math.max(x1, bx1); y1 = Math.max(y1, by1);
    }
    if (x1 <= x0 || y1 <= y0) {
      x0 = 0; y0 = 0; x1 = w; y1 = h;
    }
  }

  const diff = new ImageData(w, h);
  const dd = diff.data;
  let nIn = 0, sumIn = 0, bigIn = 0, la = 0, lb = 0, nOut = 0, sumOut = 0;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const r = Math.abs(da[i] - db[i]), g = Math.abs(da[i + 1] - db[i + 1]), bl = Math.abs(da[i + 2] - db[i + 2]);
    const d = (r + g + bl) / 3;
    dd[i] = Math.min(255, r * 4);
    dd[i + 1] = Math.min(255, g * 4);
    dd[i + 2] = Math.min(255, bl * 4);
    dd[i + 3] = 255;
    if (mask[p]) {
      nIn++;
      sumIn += d;
      if (d > 24) bigIn++;
      la += da[i] + da[i + 1] + da[i + 2];
      lb += db[i] + db[i + 1] + db[i + 2];
    } else {
      nOut++;
      sumOut += d;
    }
  }

  /* Three panels, each at most 1200 px wide, under one line of text. */
  const cw = x1 - x0, ch = y1 - y0;
  const s = Math.min(1, 1200 / cw);
  const pw = Math.round(cw * s), ph = Math.round(ch * s);
  const GAP = 6, BAR = 46;
  const board = document.createElement("canvas");
  board.width = pw * 3 + GAP * 2;
  board.height = ph + BAR;
  const c = board.getContext("2d");
  c.fillStyle = "#0b0f17";
  c.fillRect(0, 0, board.width, board.height);
  const dc = document.createElement("canvas");
  dc.width = w;
  dc.height = h;
  dc.getContext("2d").putImageData(diff, 0, 0);
  c.imageSmoothingQuality = "high";
  [A, B, dc].forEach((im, k) => c.drawImage(im, x0, y0, cw, ch, k * (pw + GAP), BAR, pw, ph));
  c.font = "600 20px system-ui, 'Segoe UI', sans-serif";
  c.textBaseline = "middle";
  c.fillStyle = "#e8eef7";
  const mean = nIn ? sumIn / nIn : 0;
  [`${label}: 2D canvas`, "WebGL", `difference x 4 (mean ${mean.toFixed(2)} of 255)`].forEach((t, k) => c.fillText(t, k * (pw + GAP) + 10, BAR / 2));

  return {
    mean,
    over: nIn ? (bigIn / nIn) * 100 : 0,
    light: la ? lb / la : 1,
    outside: nOut ? sumOut / nOut : 0,
    share: (nIn / (w * h)) * 100,
    png: board.toDataURL("image/png").slice("data:image/png;base64,".length),
  };
}

let exitCode = 0;
try {
  const flat = await shoot("2d");
  const gl = await shoot("webgl");
  const dpr = gl.info.dpr;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("about:blank");
  const rows = [];
  for (const m of MARKS) {
    const A = flat.shots[m];
    const B = gl.shots[m];
    /* The two loads must have stopped at the same place, or the pair compares two moments. */
    const moved = A.y !== B.y || A.globes.length !== B.globes.length || A.globes.some((g, i) => Math.abs(g.cx - B.globes[i].cx) + Math.abs(g.cy - B.globes[i].cy) + Math.abs(g.R - B.globes[i].R) > 0.5);
    const whole = !B.globes.length || B.globes.some((g) => g.flat);
    const boxes = whole ? null : B.globes.map((g) => [(g.cx - g.R * MARGIN) * dpr, (g.cy - g.R * MARGIN) * dpr, (g.cx + g.R * MARGIN) * dpr, (g.cy + g.R * MARGIN) * dpr]);
    const r = await page.evaluate(compareInPage, { a: A.png.toString("base64"), b: B.png.toString("base64"), boxes, label: m });
    if (r.error) throw new Error(`${m}: ${r.error}`);
    writeFileSync(join(out, `${m}.png`), Buffer.from(r.png, "base64"));
    rows.push({ m, ...r, moved, whole });
  }
  await ctx.close();

  console.log(`\n${url}`);
  console.log(`window    ${gl.info.w}x${gl.info.h} CSS px at ${Math.round(dpr * 100) / 100}`);
  console.log(`pictures  ${out}\n`);
  const pad = (s, n) => String(s).padEnd(n);
  const padl = (s, n) => String(s).padStart(n);
  console.log(pad("moment", 14) + ["mean", "over 24 %", "light", "outside", "area %"].map((h) => padl(h, 11)).join(""));
  for (const r of rows) {
    console.log(pad(r.m, 14) + [r2(r.mean), r2(r.over), r.light.toFixed(3), r2(r.outside), r.share.toFixed(0)].map((v) => padl(v, 11)).join("") + (r.moved ? "   NOT THE SAME MOMENT" : ""));
  }
  console.log("");
  if (rows.some((r) => r.moved)) {
    console.log("INVALID: a pair did not stop at the same place in the two loads. Run it again.");
    exitCode = 1;
  }
  const noisy = rows.filter((r) => !r.whole && r.outside > 0.5).map((r) => r.m);
  if (noisy.length) console.log(`NOTE: the screen outside the globe differs at ${noisy.join(", ")}. Something other than a painter moved there. Read "What the numbers mean" in this script.`);
  for (const [name, list] of [["2D", flat.errors], ["WebGL", gl.errors]]) {
    if (list.length) console.log(`page errors in the ${name} load: ${list.slice(0, 6).join(" | ")}`);
  }
} catch (e) {
  console.error(String(e && e.message ? e.message : e));
  exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
