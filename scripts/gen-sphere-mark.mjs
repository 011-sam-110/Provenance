// Generate the Provenance mark from a screenshot of the camera sphere.
//
// Run with `node scripts/gen-sphere-mark.mjs`, then `node scripts/gen-icons.mjs` for the
// favicon and app icons. It writes public/brand/sphere-mark-<size>.png (white, the screens
// opaque and the gaps clear) and lib/brand/sphereMark.json, which components/brand/Mark.tsx,
// scripts/gen-icons.mjs and the landing intro all read.
//
// WHAT THE MARK IS. A screenshot of the landing intro's camera sphere, fully lit and centred,
// with every screen a blank grey card (scripts/assets/sphere-source.png, taken by
// scripts/capture-sphere-source.mjs from the running build), run through a filter: the lit
// screens are told apart from the dark gaps and ground, and that shape is the mark, the
// screens filled and the gaps open. What is left is the ball's 59 screens exactly as the WebGL
// ball renders them, its perspective and its bend. Nothing is drawn by hand. (On 2026-10-10 it
// was an edge filter, the screens in outline, for an afternoon; filled reads better small.)
//
// It filters in a Playwright page's canvas, like scripts/gen-icons.mjs, so it adds no
// packages.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "scripts", "assets", "sphere-source.png");
const BRAND = resolve(ROOT, "public", "brand");
const JSON_OUT = resolve(ROOT, "lib", "brand", "sphereMark.json");

/** The ball in the source: 819 px across in an 848 px square, centred. */
const SOURCE_PX = 848;
const BALL_R_PX = (0.91 * 900) / 2;
/** Output sizes. 96 serves the 24 to 32 px marks at up to 3x, 512 the boot plate. */
const SIZES = [32, 64, 96, 192, 512];
/** A screen is lit; the gaps between screens and the ground round the ball are not. On the
    blank source the screens sit at 35 to 55% brightness and the gaps under 5%. */
const LIT = 0.2;

/* Runs in the page. Returns one PNG data URL per size. */
async function filterInPage({ src, sizes, lit }) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const N = img.naturalWidth;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, N, N).data;

  /** Grow every gap by `k` pixels: a square max filter, one pass across and one down. */
  function widen(src, n, k) {
    const tmp = new Uint8Array(n * n);
    const dst = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = 0;
        for (let d = -k; d <= k && !v; d++) {
          const xx = x + d;
          if (xx >= 0 && xx < n) v = src[y * n + xx];
        }
        tmp[y * n + x] = v;
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = 0;
        for (let d = -k; d <= k && !v; d++) {
          const yy = y + d;
          if (yy >= 0 && yy < n) v = tmp[yy * n + x];
        }
        dst[y * n + x] = v;
      }
    }
    return dst;
  }

  /* 1. What is lit. */
  const bright = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const l = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    bright[i] = l > lit ? 1 : 0;
  }
  /* 2. The gaps all run out to the ground round the ball, so dark that cannot be reached
        from the edge of the picture is not a gap: a speck, if the source ever has one, counts
        as lit. */
  const reached = new Uint8Array(N * N);
  const queue = new Int32Array(N * N);
  let head = 0;
  let tail = 0;
  const seed = (i) => {
    if (!bright[i] && !reached[i]) {
      reached[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let k = 0; k < N; k++) {
    seed(k);
    seed((N - 1) * N + k);
    seed(k * N);
    seed(k * N + N - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % N;
    if (x > 0) seed(i - 1);
    if (x < N - 1) seed(i + 1);
    if (i >= N) seed(i - N);
    if (i < N * (N - 1)) seed(i + N);
  }
  /* 3. Per size: the lit shape itself, filled, brought down to size. A gap between two screens
        is an eighth of a screen, which at 32 px is under half a pixel and would blur the ball
        into a grey disc, so below 192 px every gap is first widened to at least 0.9 of an
        output pixel (the narrowest gap that still read as a line, compared side by side on
        2026-10-10). The larger sizes keep the gaps exactly as rendered. */
  const out = {};
  for (const S of sizes) {
    const k = Math.max(0, Math.round((0.9 * (N / S) - 6) / 2));
    const gap = k > 0 ? widen(reached, N, k) : reached;
    const m = document.createElement("canvas");
    m.width = m.height = N;
    const mg2 = m.getContext("2d");
    const md2 = mg2.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      md2.data[i * 4] = md2.data[i * 4 + 1] = md2.data[i * 4 + 2] = 255;
      md2.data[i * 4 + 3] = gap[i] ? 0 : 255;
    }
    mg2.putImageData(md2, 0, 0);
    const small = document.createElement("canvas");
    small.width = small.height = S;
    const sg = small.getContext("2d");
    sg.imageSmoothingQuality = "high";
    sg.drawImage(m, 0, 0, S, S);
    out[S] = small.toDataURL("image/png");
  }
  return out;
}

async function main() {
  mkdirSync(BRAND, { recursive: true });
  const src = `data:image/png;base64,${readFileSync(SOURCE).toString("base64")}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><title>mark</title>");
  const pngs = await page.evaluate(filterInPage, { src, sizes: SIZES, lit: LIT });
  await browser.close();

  const files = {};
  for (const S of SIZES) {
    const file = `sphere-mark-${S}.png`;
    writeFileSync(resolve(BRAND, file), Buffer.from(pngs[S].split(",")[1], "base64"));
    files[S] = `/brand/${file}`;
    console.log(`gen-sphere-mark: ${S}px -> ./public/brand/${file}`);
  }
  /* The ball's edge in a 128-unit square, for the intro to land the photo ball on. */
  const r = Number(((BALL_R_PX / SOURCE_PX) * 128).toFixed(3));
  const json = { source: "scripts/assets/sphere-source.png", files, orb: { cx: 64, cy: 64, r } };
  writeFileSync(JSON_OUT, `${JSON.stringify(json, null, 2)}\n`);
  console.log("gen-sphere-mark: -> ./lib/brand/sphereMark.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
