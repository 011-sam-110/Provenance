// Film the God's eye view for a reel: one camera move, frame by frame, to an MP4.
//
//   node scripts/eye-record.mjs                                   Westminster, orbit, 9 s, 1080 x 1920
//   node scripts/eye-record.mjs --place=tower-bridge --motion=fly --seconds=8
//   node scripts/eye-record.mjs --base=http://localhost:3000 --out=renders/westminster.mp4
//   node scripts/eye-record.mjs --size=1920x1080 --clean        16:9, and the scene alone (overlay=0)
//
// HOW. The page opens with `record=1&clock=manual`: no buttons, the clock to the minute,
// every word inside Instagram's safe bands on a 9:16 screen, and the move waits for this
// script instead of the screen. For each frame the script steps the move by one frame's
// time (window.__eye.step), waits until the map has drawn every tile it asked for
// (window.__eye.idle), and takes a picture. So the film is smooth at any speed this
// machine draws at, and no frame shows a half-loaded tile. ffmpeg joins the pictures.
//
// WHAT IS ON SCREEN IS WHAT THE VIEW SHOWS. The cards are the operators' own pictures
// with their own times, the vessels and aircraft are where they were last reported, and
// the credits line names every source. Do not crop the credits out of a reel.
//
// NOT IN THE GATE: it needs a browser, a graphics card and the network. It writes
// nothing into the repo unless --out points there.
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (k, d) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const has = (k) => args.includes(`--${k}`);

const base = flag("base", "http://localhost:3000").replace(/\/$/, "");
const place = flag("place", "westminster");
const motion = flag("motion", "orbit");
const seconds = Number(flag("seconds", 9));
const fps = Number(flag("fps", 30));
const [w, h] = flag("size", "1080x1920").split("x").map(Number);
const scale = Number(flag("scale", 2));
const out = resolve(flag("out", `eye-${place}-${motion}.mp4`));
const clean = has("clean");
const headed = has("headed");

if (!["orbit", "fly"].includes(motion)) throw new Error(`--motion must be orbit or fly, not ${motion}`);
if (!(seconds > 0 && seconds <= 60)) throw new Error("--seconds must be between 0 and 60");
if (!(w > 0 && h > 0 && scale >= 1)) throw new Error("--size is WIDTHxHEIGHT in pixels, --scale at least 1");

// The page is laid out at the size divided by the scale (1080 x 1920 at 2 is a 540 x 960
// phone screen) and drawn at full resolution.
const viewport = { width: Math.round(w / scale), height: Math.round(h / scale) };
const query = new URLSearchParams({ place, motion, record: "1", clock: "manual" });
if (clean) query.set("overlay", "0");
const url = `${base}/eye?${query}`;

const frames = mkdtempSync(join(tmpdir(), "eye-record-"));
const browser = await chromium.launch({
  channel: "chrome",
  headless: !headed,
  // The map is WebGL: without these a headless Chrome may fall back to its software
  // renderer, which draws the same frames, many times slower.
  args: ["--enable-gpu", "--ignore-gpu-blocklist", ...(process.platform === "win32" ? ["--use-angle=d3d11"] : [])],
});
try {
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale, reducedMotion: "no-preference" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  console.log(`Opening ${url} at ${viewport.width} x ${viewport.height}, scale ${scale}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector("[data-eye-state=ready]") && window.__eye, null, {
    timeout: 120_000,
  });
  await page.evaluate(() => window.__eye.idle());
  // The cards' pictures come from the operators through this site's proxy: give them
  // a moment to arrive before the first frame.
  await page.waitForTimeout(clean ? 500 : 4000);

  const total = Math.round(seconds * fps);
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    if (i > 0) await page.evaluate((ms) => window.__eye.step(ms), 1000 / fps);
    await page.evaluate(() => window.__eye.idle());
    await page.screenshot({ path: join(frames, `${String(i).padStart(5, "0")}.png`) });
    if (i % fps === 0) process.stdout.write(`\rFrame ${i + 1} of ${total}`);
  }
  console.log(`\rFilmed ${total} frames in ${Math.round((Date.now() - started) / 1000)} s`);
  if (errors.length) console.warn(`Page errors:\n${errors.join("\n")}`);

  mkdirSync(dirname(out), { recursive: true });
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(frames, "%05d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", out],
    { stdio: "inherit" },
  );
  if (ff.status !== 0) throw new Error(`ffmpeg failed (${ff.status ?? ff.error}); the frames are kept in ${frames}`);
  console.log(`Wrote ${out}`);
  rmSync(frames, { recursive: true, force: true });
} finally {
  await browser.close();
}
