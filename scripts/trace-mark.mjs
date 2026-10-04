// Trace public/brand/mark.png into vector contours.
//
// WHY THIS EXISTS. The mark had to become SVG — a raster cannot animate its parts
// for the boot sequence, cannot recolour for the light skin, and cannot be the one
// source the favicon and PWA icons are generated from. But a HAND-drawn
// approximation of an approved logo is not that logo: the first attempt got the
// rings and the book close and turned the globe's continents into abstract
// texture, which is a different mark wearing the same layout.
//
// So the geometry is TRACED from the approved artwork rather than redrawn.
// Deterministic: the same PNG in gives the same paths out, so re-running is safe
// and reviewable.
//
//   node scripts/trace-mark.mjs
//   -> lib/brand/markPaths.json  { viewBox, rings, dots, glass, book }
//
// components/brand/Mark.tsx and scripts/gen-icons.mjs both read that file, which
// is what stops the app and its icons ever showing different logos.
//
// HOW IT TRACES (second version, 2026-10-04). The first version thresholded the
// PNG on a 256 grid and joined the cell corners with straight lines, so every
// edge was a staircase of 0.5-unit steps. It also kept three specks: the two
// orbit dots and one fragment of the outer ring, each traced as a tiny island.
// This version:
//   1. reads the PNG at its full 1254px and blurs it by one pixel, which removes
//      the grain in the artwork's fill and leaves its edges where they are;
//   2. follows the iso-line at THRESHOLD with linear interpolation (marching
//      squares on the grey values), so each vertex sits on the real edge to a
//      fraction of a pixel, not on a cell corner;
//   3. fits cubic Bezier curves to each contour (the method of P. J. Schneider,
//      "An Algorithm for Automatically Fitting Digitized Curves", Graphics Gems,
//      1990), with a split at each sharp corner;
//   4. measures the two orbit rings and the two dots from the artwork, writes
//      them as numbers, and removes their traced fragments from the figure;
//   5. drops every remaining subpath that is smaller than MIN_SPAN.
//
// LICENCE. This repo is AGPL-3.0-only. The curve fitting below is written here
// from the published algorithm. It is not copied from any library. node-potrace
// (GPL-2.0) and potrace were NOT used, and no new package was added: Playwright
// is already a devDependency and decodes the PNG.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "public", "brand", "mark.png");
const OUT = resolve(ROOT, "lib", "brand", "markPaths.json");

/** The output box. Every number written to the JSON is in these units. */
const BOX = 128;
/** Gaussian blur before tracing, in source px. One pixel removes the grain in the
 *  artwork's fill. A straight edge does not move under a symmetric blur. */
const BLUR_SIGMA = 1;
/** Luminance of the traced edge. The fill is about 141 (median) on a ground of 0,
 *  so the half-way line is about 70. The .5 keeps a grid value from landing
 *  exactly on the level. */
const THRESHOLD = 70.5;
/** Largest distance, in source px, between a fitted curve and the contour it
 *  replaces. 1px is 0.1 units: under a fifth of a pixel at the 220px boot size. */
const FIT_TOLERANCE = 1;
/** A turn sharper than this, over CORNER_REACH px each side, is a corner. The
 *  curves keep the corner instead of rounding it off. */
const CORNER_DEG = 50;
const CORNER_REACH = 3;
/** The size floor, in units. A subpath whose width and height are both under this
 *  is dropped: it is grain in the fill, or an island too small to see (0.5 units
 *  is under 1px at the 220px boot size). Keep the floor LOW. The globe has real
 *  small islands (the British Isles, Iceland, Madagascar, the Caribbean) about 1
 *  to 3 units across, and a floor that removes them turns the map into the
 *  "abstract texture" the first hand-drawn attempt was rejected for. The three
 *  specks of the first version are not removed by this floor: they are the dots
 *  and a ring fragment, and the classifier below takes them out by what they are. */
const MIN_SPAN = 0.5;

/** Where to look for the rings and dots. Approximate on purpose: the script
 *  measures the real values from the pixels and writes those. */
const RING_PRIORS = {
  outer: { cx: 64, cy: 61, r: 45.5 },
  inner: { cx: 64, cy: 60, r: 35.7 },
};
const DOT_PRIORS = [
  { cx: 24.5, cy: 61.6 },
  { cx: 103.7, cy: 61.6 },
];

// ---------------------------------------------------------------------------
// 1. Decode. Playwright is used purely as an image decoder (canvas +
//    getImageData) at the PNG's natural size, so nothing is resampled.

async function decodePng(path) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const { width, height, b64 } = await page.evaluate(async (dataUrl) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let bin = "";
      for (let i = 0; i < px.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
      }
      return { width: canvas.width, height: canvas.height, b64: btoa(bin) };
    }, `data:image/png;base64,${readFileSync(path).toString("base64")}`);
    return { width, height, rgba: Buffer.from(b64, "base64") };
  } finally {
    await browser.close();
  }
}

function luminance({ width, height, rgba }) {
  const out = new Float32Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    const a = rgba[j + 3] / 255;
    out[i] = (0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]) * a;
  }
  return out;
}

function gaussianBlur(src, w, h, sigma) {
  const rad = Math.ceil(sigma * 3);
  const k = [];
  let sum = 0;
  for (let i = -rad; i <= rad; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -rad; i <= rad; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        acc += src[y * w + xx] * k[i + rad];
      }
      tmp[y * w + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -rad; i <= rad; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        acc += tmp[yy * w + x] * k[i + rad];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Iso-contours. Grid point (i, j) is the centre of pixel (i, j), at
//    (i + 0.5, j + 0.5) in source px. Values outside the image are 0, so every
//    contour closes. Each segment is oriented with the ink on its right, and the
//    segments are joined through the grid edge they share.

function isoContours(f, w, h, level) {
  const at = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : f[j * w + i]);
  const W = w + 2; // edge keys cover i, j in -1..w
  const hKey = (i, j) => ((j + 1) * W + (i + 1)) * 2; // (i,j)-(i+1,j)
  const vKey = (i, j) => ((j + 1) * W + (i + 1)) * 2 + 1; // (i,j)-(i,j+1)
  const point = (key) => {
    const vertical = key & 1;
    const base = key >> 1;
    const i = (base % W) - 1;
    const j = Math.floor(base / W) - 1;
    const f0 = at(i, j);
    const f1 = vertical ? at(i, j + 1) : at(i + 1, j);
    const t = (level - f0) / (f1 - f0);
    return vertical ? [i + 0.5, j + t + 0.5] : [i + t + 0.5, j + 0.5];
  };

  // Edges of cell (i, j): 0 top, 1 right, 2 bottom, 3 left.
  // Corners: 0 a=(i,j), 1 b=(i+1,j), 2 c=(i+1,j+1), 3 d=(i,j+1).
  const CORNER = [[0, 0], [1, 0], [1, 1], [0, 1]];
  // Per case (a<<3 | b<<2 | c<<1 | d): [edgeA, edgeB, reference corner]. The
  // reference corner orients the segment. Saddles (5, 10) are resolved by the
  // value at the cell centre.
  const TABLE = {
    1: [[3, 2, 3]], 14: [[3, 2, 3]],
    2: [[2, 1, 2]], 13: [[2, 1, 2]],
    3: [[3, 1, 3]], 12: [[3, 1, 3]],
    4: [[0, 1, 1]], 11: [[0, 1, 1]],
    6: [[0, 2, 1]], 9: [[0, 2, 1]],
    7: [[0, 3, 0]], 8: [[0, 3, 0]],
  };
  const SADDLE_CUT_AC = [[0, 3, 0], [1, 2, 2]]; // cut off corners a and c
  const SADDLE_CUT_BD = [[0, 1, 1], [3, 2, 3]]; // cut off corners b and d

  const next = new Map(); // start edge key -> end edge key
  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      const ins = v.map((x) => x > level);
      const c = (ins[0] << 3) | (ins[1] << 2) | (ins[2] << 1) | ins[3];
      if (c === 0 || c === 15) continue;
      let segs = TABLE[c];
      if (c === 5 || c === 10) {
        const centreIn = (v[0] + v[1] + v[2] + v[3]) / 4 > level;
        // 5 = b,d inside. 10 = a,c inside. When the centre joins the two inside
        // corners, the segments cut off the two outside ones, and vice versa.
        segs = (c === 5) === centreIn ? SADDLE_CUT_AC : SADDLE_CUT_BD;
      }
      const edgeKey = [hKey(i, j), vKey(i + 1, j), hKey(i, j + 1), vKey(i, j)];
      for (const [ea, eb, rc] of segs) {
        let k0 = edgeKey[ea];
        let k1 = edgeKey[eb];
        const p0 = point(k0);
        const p1 = point(k1);
        const r = [i + CORNER[rc][0] + 0.5, j + CORNER[rc][1] + 0.5];
        const cross = (p1[0] - p0[0]) * (r[1] - p0[1]) - (p1[1] - p0[1]) * (r[0] - p0[0]);
        // Ink on the right in y-down coordinates means cross > 0 for an ink corner.
        if (cross > 0 !== ins[rc]) [k0, k1] = [k1, k0];
        next.set(k0, k1);
      }
    }
  }

  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const pts = [];
    let k = start;
    for (let guard = 0; guard < 1e7; guard++) {
      seen.add(k);
      pts.push(point(k));
      k = next.get(k);
      if (k === undefined || k === start) break;
    }
    if (pts.length > 2) loops.push(pts);
  }
  return loops;
}

// ---------------------------------------------------------------------------
// Small geometry helpers.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => {
  const l = len(a);
  return l === 0 ? [0, 0] : [a[0] / l, a[1] / l];
};

function signedArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return s / 2;
}

function centroid(pts) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cr = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += cr;
    cx += (pts[j][0] + pts[i][0]) * cr;
    cy += (pts[j][1] + pts[i][1]) * cr;
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Resample a closed loop to points `step` apart along its length. */
function resampleClosed(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const seg = len(sub(b, a));
    let t = step - carry;
    while (t <= seg) {
      out.push(add(a, mul(sub(b, a), t / seg)));
      t += step;
    }
    carry = seg - (t - step);
  }
  // The last sample can land on the first one.
  if (out.length > 1 && len(sub(out[out.length - 1], out[0])) < step * 0.5) out.pop();
  return out;
}

// ---------------------------------------------------------------------------
// 3. Curve fitting (Schneider 1990). Fits one cubic to a run of points with
//    chord-length parameters, improves the parameters with Newton-Raphson, and
//    splits the run at the worst point when one cubic is not close enough.

const bez = (b, t) => {
  const mt = 1 - t;
  const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
  return [
    b[0][0] * b0 + b[1][0] * b1 + b[2][0] * b2 + b[3][0] * b3,
    b[0][1] * b0 + b[1][1] * b1 + b[2][1] * b2 + b[3][1] * b3,
  ];
};
const bezD1 = (b, t) => {
  const mt = 1 - t;
  return add(
    add(mul(sub(b[1], b[0]), 3 * mt * mt), mul(sub(b[2], b[1]), 6 * mt * t)),
    mul(sub(b[3], b[2]), 3 * t * t),
  );
};
const bezD2 = (b, t) =>
  add(
    mul(add(sub(b[2], mul(b[1], 2)), b[0]), 6 * (1 - t)),
    mul(add(sub(b[3], mul(b[2], 2)), b[1]), 6 * t),
  );

function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((x) => x / total);
}

function generateBezier(pts, u, t1, t2) {
  const p0 = pts[0];
  const p3 = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
    const a0 = mul(t1, b1);
    const a1 = mul(t2, b2);
    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);
    const tmp = sub(pts[i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a0, tmp);
    x1 += dot(a1, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let ar = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  const segLen = len(sub(p3, p0));
  const eps = 1e-6 * segLen;
  if (al < eps || ar < eps) al = ar = segLen / 3;
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}

function maxError(pts, b, u) {
  let max = 0;
  let split = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len(sub(bez(b, u[i]), pts[i]));
    if (d >= max) {
      max = d;
      split = i;
    }
  }
  return { max, split };
}

function reparameterize(pts, b, u) {
  return u.map((t, i) => {
    const d = sub(bez(b, t), pts[i]);
    const d1 = bezD1(b, t);
    const d2 = bezD2(b, t);
    const den = dot(d1, d1) + dot(d, d2);
    if (den === 0) return t;
    return Math.min(1, Math.max(0, t - dot(d, d1) / den));
  });
}

/** t1 points out of pts[0] into the run; t2 points out of the last point back
 *  into the run. Returns a list of cubics, each [p0, c1, c2, p3]. */
function fitCubic(pts, t1, t2, tol) {
  if (pts.length === 2) {
    const d = len(sub(pts[1], pts[0])) / 3;
    return [[pts[0], add(pts[0], mul(t1, d)), add(pts[1], mul(t2, d)), pts[1]]];
  }
  let u = chordParams(pts);
  let b = generateBezier(pts, u, t1, t2);
  let err = maxError(pts, b, u);
  if (err.max < tol) return [b];
  if (err.max < tol * 4) {
    for (let it = 0; it < 20; it++) {
      u = reparameterize(pts, b, u);
      b = generateBezier(pts, u, t1, t2);
      err = maxError(pts, b, u);
      if (err.max < tol) return [b];
    }
  }
  const s = err.split;
  const tc = norm(sub(pts[s - 1], pts[s + 1]));
  return [
    ...fitCubic(pts.slice(0, s + 1), t1, tc, tol),
    ...fitCubic(pts.slice(s), mul(tc, -1), t2, tol),
  ];
}

/** Indices of sharp corners on a closed, evenly spaced loop. */
function findCorners(pts, reach) {
  const n = pts.length;
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - reach + n) % n];
    const b = pts[i];
    const c = pts[(i + reach) % n];
    const v1 = norm(sub(b, a));
    const v2 = norm(sub(c, b));
    turn[i] = Math.acos(Math.max(-1, Math.min(1, dot(v1, v2)))) * (180 / Math.PI);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < CORNER_DEG) continue;
    let isMax = true;
    for (let k = -reach; k <= reach && isMax; k++) {
      if (k === 0) continue;
      const j = (i + k + n) % n;
      if (turn[j] > turn[i] || (turn[j] === turn[i] && j < i)) isMax = false;
    }
    if (isMax) out.push(i);
  }
  return out;
}

/** Fit a closed loop (source px). Returns cubics in source px. */
function fitClosed(loop, tol) {
  const pts = resampleClosed(loop, 0.5);
  const n = pts.length;
  const reach = Math.max(2, Math.round(CORNER_REACH / 0.5));
  let breaks = findCorners(pts, reach);
  const corner = new Set(breaks);
  // A loop with no corners, or one, still needs runs to fit: add smooth breaks
  // spread around it. A smooth break keeps one tangent on both sides.
  if (breaks.length < 2) {
    const extra = breaks.length === 0 ? [0, Math.floor(n / 3), Math.floor((2 * n) / 3)] : [];
    if (breaks.length === 1) {
      const b0 = breaks[0];
      extra.push((b0 + Math.floor(n / 3)) % n, (b0 + Math.floor((2 * n) / 3)) % n);
    }
    breaks = [...breaks, ...extra].sort((a, b) => a - b);
  }
  const tangentAt = (i, dir) => {
    const k = 4;
    if (corner.has(i)) {
      // One-sided: from the corner into the run.
      const j = (i + dir * k + n) % n;
      return norm(sub(pts[j], pts[i]));
    }
    // Smooth: the centred tangent, pointing the way the run leaves the break.
    const fwd = norm(sub(pts[(i + k) % n], pts[(i - k + n) % n]));
    return dir > 0 ? fwd : mul(fwd, -1);
  };
  const curves = [];
  for (let bi = 0; bi < breaks.length; bi++) {
    const s = breaks[bi];
    const e = breaks[(bi + 1) % breaks.length];
    const run = [];
    for (let i = s; ; i = (i + 1) % n) {
      run.push(pts[i]);
      if (i === e && run.length > 1) break;
    }
    curves.push(...fitCubic(run, tangentAt(s, +1), tangentAt(e, -1), tol));
  }
  return curves;
}

// ---------------------------------------------------------------------------
// 4. The orbit rings. They are hairlines at low contrast, so thresholding shreds
//    them. Instead, for 1440 directions, find the brightest point of the ring
//    along the radius, then fit an axis-aligned ellipse to those points. The
//    artwork's rings are NOT circles: both are about 2.7% taller than wide, and
//    the lens beside them is round, so this is the drawing, not a stretched
//    image.

function sampler(f, w, h, scale) {
  // Bilinear sample at a position in units.
  return (x, y) => {
    const px = x / scale - 0.5;
    const py = y / scale - 0.5;
    const i = Math.floor(px);
    const j = Math.floor(py);
    const fx = px - i;
    const fy = py - j;
    const g = (a, b) => (a < 0 || b < 0 || a >= w || b >= h ? 0 : f[b * w + a]);
    return (
      g(i, j) * (1 - fx) * (1 - fy) + g(i + 1, j) * fx * (1 - fy) +
      g(i, j + 1) * (1 - fx) * fy + g(i + 1, j + 1) * fx * fy
    );
  };
}

function ringPeaks(sample, e, half) {
  const out = [];
  for (let k = 0; k < 1440; k++) {
    const a = (k / 1440) * 2 * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rs = [];
    const vs = [];
    for (let s = -half; s <= half + 1e-9; s += 0.02) {
      const x = e.cx + (e.rx + s) * ca;
      const y = e.cy + (e.ry + s) * sa;
      rs.push(s);
      vs.push(sample(x, y));
    }
    const vmax = Math.max(...vs);
    if (vmax < 25) continue; // nothing here: the ring is hidden on this ray
    // The figure is wide and bright. A ray that crosses more than 1.2 units of
    // it is measuring the figure, not the ring.
    if (vs.filter((v) => v > 110).length * 0.02 > 1.2) continue;
    // The centre of the hairline is half way between the two points where it
    // falls to half its peak. The brightest point is not the centre: the artwork
    // lights one side of each ring like a bevel.
    const kk = vs.indexOf(vmax);
    const halfV = vmax / 2;
    let a0 = kk;
    while (a0 > 0 && vs[a0] > halfV) a0--;
    let a1 = kk;
    while (a1 < vs.length - 1 && vs[a1] > halfV) a1++;
    if (vs[a0] > halfV || vs[a1] > halfV) continue; // the band runs off the window
    const cross = (i, j) => rs[i] + ((halfV - vs[i]) / (vs[j] - vs[i])) * (rs[j] - rs[i]);
    const s = (cross(a0, a0 + 1) + cross(a1, a1 - 1)) / 2;
    out.push([e.cx + (e.rx + s) * ca, e.cy + (e.ry + s) * sa]);
  }
  return out;
}

/** Least squares for A x^2 + C y^2 + D x + E y = 1 (an axis-aligned ellipse). */
function fitEllipse(pts) {
  const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const v = [0, 0, 0, 0];
  for (const [x, y] of pts) {
    const r = [x * x, y * y, x, y];
    for (let i = 0; i < 4; i++) {
      v[i] += r[i];
      for (let j = 0; j < 4; j++) M[i][j] += r[i] * r[j];
    }
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    [v[c], v[p]] = [v[p], v[c]];
    for (let r = c + 1; r < 4; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      v[r] -= f * v[c];
    }
  }
  const s = [0, 0, 0, 0];
  for (let r = 3; r >= 0; r--) {
    let acc = v[r];
    for (let k = r + 1; k < 4; k++) acc -= M[r][k] * s[k];
    s[r] = acc / M[r][r];
  }
  const [A, C, D, E] = s;
  const cx = -D / (2 * A);
  const cy = -E / (2 * C);
  const F = 1 + A * cx * cx + C * cy * cy;
  return { cx, cy, rx: Math.sqrt(F / A), ry: Math.sqrt(F / C) };
}

/** Approximate distance from a point to an ellipse, in units. */
function ellipseDistance(e, [x, y]) {
  const t = Math.atan2((y - e.cy) / e.ry, (x - e.cx) / e.rx);
  return Math.hypot(x - (e.cx + e.rx * Math.cos(t)), y - (e.cy + e.ry * Math.sin(t)));
}

/** Least squares circle (Kasa): x^2 + y^2 = 2 a x + 2 b y + c. */
function fitCircle(pts) {
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; n++;
    sxz += x * z; syz += y * z; sz += z;
  }
  // Normal equations for [2a, 2b, c].
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const v = [sxz, syz, sz];
  const det3 = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det3(M);
  const col = (k) => M.map((row, i) => row.map((x, j) => (j === k ? v[i] : x)));
  const A = det3(col(0)) / d;
  const B = det3(col(1)) / d;
  const C = det3(col(2)) / d;
  const cx = A / 2;
  const cy = B / 2;
  const r = Math.sqrt(C + cx * cx + cy * cy);
  return { cx, cy, rx: r, ry: r };
}

function measureRing(sample, prior) {
  // Coarse passes fit a CIRCLE: the inner ring is hidden along its bottom, and an
  // ellipse fitted to a partial arc in its first passes can drift onto the book.
  let e = { cx: prior.cx, cy: prior.cy, rx: prior.r, ry: prior.r };
  let pts = ringPeaks(sample, e, 2.5);
  for (let pass = 0; pass < 3; pass++) {
    e = fitCircle(pts);
    pts = ringPeaks(sample, e, 2);
  }
  // Robust: drop points far from the fit (a book tip on a ray), then refit.
  let keep = pts;
  for (let pass = 0; pass < 4; pass++) {
    e = fitEllipse(keep);
    const d = pts.map((p) => ellipseDistance(e, p));
    const med = [...d].sort((a, b) => a - b)[Math.floor(d.length / 2)];
    keep = pts.filter((_, i) => d[i] < Math.max(4 * med, 0.15));
  }
  e = fitEllipse(keep);
  const d = keep.map((p) => ellipseDistance(e, p));
  const rms = Math.sqrt(d.reduce((a, b) => a + b * b, 0) / d.length);
  return { e, samples: pts.length, kept: keep.length, rms };
}

/** The longest stretch of the ellipse where the ring is visible, in degrees
 *  (0 = 3 o'clock, increasing clockwise on screen). Gaps under 2 degrees are
 *  joined. Returns null if the ring is visible all the way round. */
function visibleArc(sample, e) {
  const STEP = 0.5;
  const n = Math.round(360 / STEP);
  const on = [];
  for (let k = 0; k < n; k++) {
    const t = (k * STEP * Math.PI) / 180;
    let v = 0;
    for (let s = -0.6; s <= 0.6 + 1e-9; s += 0.1) {
      v = Math.max(v, sample(e.cx + (e.rx + s) * Math.cos(t), e.cy + (e.ry + s) * Math.sin(t)));
    }
    on.push(v > 40);
  }
  if (on.every(Boolean)) return null;
  const gap = Math.round(2 / STEP);
  for (let k = 0; k < n; k++) {
    if (on[k]) continue;
    let r = 0;
    while (r < n && !on[(k + r) % n]) r++;
    if (r <= gap && on[(k - 1 + n) % n]) for (let i = 0; i < r; i++) on[(k + i) % n] = true;
    k += r - 1;
  }
  let best = { start: 0, length: 0 };
  for (let k = 0; k < n; k++) {
    if (!on[k] || on[(k - 1 + n) % n]) continue; // start of a run
    let r = 0;
    while (r < n && on[(k + r) % n]) r++;
    if (r > best.length) best = { start: k, length: r };
  }
  return { fromDeg: best.start * STEP, toDeg: (best.start + best.length - 1) * STEP };
}

// ---------------------------------------------------------------------------
// Output formatting.

const fmt = (n) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};
const pt = (p) => `${fmt(p[0])} ${fmt(p[1])}`;

function pathFromCurves(curves, scale) {
  const s = (p) => mul(p, scale);
  let d = `M${pt(s(curves[0][0]))}`;
  for (const c of curves) d += ` C${pt(s(c[1]))} ${pt(s(c[2]))} ${pt(s(c[3]))}`;
  return `${d} Z`;
}

function arcPath(e, fromDeg, toDeg) {
  const at = (deg) => {
    const t = (deg * Math.PI) / 180;
    return [e.cx + e.rx * Math.cos(t), e.cy + e.ry * Math.sin(t)];
  };
  const sweep = (((toDeg - fromDeg) % 360) + 360) % 360;
  return `M${pt(at(fromDeg))} A${fmt(e.rx)} ${fmt(e.ry)} 0 ${sweep > 180 ? 1 : 0} 1 ${pt(at(toDeg))}`;
}

const round = (e) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, Number(fmt(v))]));

// ---------------------------------------------------------------------------

const img = await decodePng(SRC);
if (img.width !== img.height) throw new Error(`mark.png is ${img.width}x${img.height}; expected a square`);
const N = img.width;
const SCALE = BOX / N; // source px -> units
const lum = luminance(img);
const field = gaussianBlur(lum, N, N, BLUR_SIGMA);
const sample = sampler(lum, N, N, SCALE);

// Rings and dots, measured.
const outer = measureRing(sample, RING_PRIORS.outer);
const inner = measureRing(sample, RING_PRIORS.inner);
const outerArc = visibleArc(sample, outer.e);
const innerArc = visibleArc(sample, inner.e);

// The figure, traced.
const loops = isoContours(field, N, N, THRESHOLD).map((pts) => {
  const u = pts.map((p) => mul(p, SCALE));
  const b = bbox(u);
  return { pts, u, b, area: signedArea(u), c: centroid(u) };
});

const isRingFragment = (l) => {
  const near = (e) => l.u.filter((p) => ellipseDistance(e, p) < 1.2).length / l.u.length;
  return near(outer.e) > 0.85 || near(inner.e) > 0.85;
};

const dots = [];
const kept = [];
const dropped = [];
for (const l of loops) {
  const where = `(${fmt(l.c[0])}, ${fmt(l.c[1])}) ${fmt(l.b.w)}x${fmt(l.b.h)} area ${fmt(l.area)}`;
  const dotPrior = DOT_PRIORS.findIndex((d) => Math.hypot(l.c[0] - d.cx, l.c[1] - d.cy) < 2);
  if (dotPrior >= 0 && Math.max(l.b.w, l.b.h) < 4 && l.area > 0) {
    dots[dotPrior] = { cx: l.c[0], cy: l.c[1], r: Math.sqrt(l.area / Math.PI) };
    dropped.push(`dot          ${where}  (authored as a circle)`);
  } else if (isRingFragment(l)) {
    dropped.push(`ring piece   ${where}  (the ring is authored as a stroke)`);
  } else if (Math.max(l.b.w, l.b.h) < MIN_SPAN) {
    dropped.push(`speck        ${where}  (under the ${MIN_SPAN}-unit floor)`);
  } else {
    kept.push(l);
  }
}
if (dots.filter(Boolean).length !== DOT_PRIORS.length) {
  throw new Error(`trace-mark: found ${dots.filter(Boolean).length} of ${DOT_PRIORS.length} dots`);
}

kept.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
const glass = [];
const book = [];
let curveCount = 0;
for (const l of kept) {
  const curves = fitClosed(l.pts, FIT_TOLERANCE);
  curveCount += curves.length;
  // The figure splits into the two things that animate separately. Same rule as
  // the first version, so the boot sequence groups the parts as before.
  const cy = (l.b.y0 + l.b.y1) / 2;
  (cy < 72 ? glass : book).push(pathFromCurves(curves, SCALE));
}

// ONE artefact, consumed by BOTH the component and the icon generator. That is
// the whole point: the app and its favicon physically cannot show different
// logos if they read the same file.
const out = {
  viewBox: `0 0 ${BOX} ${BOX}`,
  source: "public/brand/mark.png",
  generatedBy: "scripts/trace-mark.mjs",
  // Measured from the artwork. The outer ring is visible all the way round. The
  // inner ring stops where the book and the lens handle cross it, so it is an
  // arc, drawn clockwise from its left end over the top to its right end.
  rings: {
    outer: round(outer.e),
    inner: {
      ...round(inner.e),
      d: innerArc ? arcPath(inner.e, innerArc.fromDeg, innerArc.toDeg) : null,
    },
  },
  // Measured centres. The radius is the component's: the artwork's dots are
  // under 1 unit and would vanish at header size.
  dots: dots.map((d) => ({ cx: Number(fmt(d.cx)), cy: Number(fmt(d.cy)) })),
  glass,
  book,
};
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);

const show = (name, m, arc) =>
  `  ${name}: cx ${fmt(m.e.cx)} cy ${fmt(m.e.cy)} rx ${fmt(m.e.rx)} ry ${fmt(m.e.ry)}` +
  `  (${m.kept}/${m.samples} rays, rms ${m.rms.toFixed(3)} units)` +
  (arc ? `  visible ${arc.fromDeg}..${arc.toDeg} deg` : "  visible all round");
console.log(`trace-mark: ${N}px source, ${loops.length} contours at luminance ${THRESHOLD}`);
console.log(show("outer ring", outer, outerArc));
console.log(show("inner ring", inner, innerArc));
for (const d of dots) console.log(`  dot: cx ${fmt(d.cx)} cy ${fmt(d.cy)} (artwork r ${fmt(d.r)})`);
console.log(`  kept ${kept.length} subpaths as ${curveCount} cubic curves`);
const smallest = kept.reduce((m, l) => (Math.max(l.b.w, l.b.h) < Math.max(m.b.w, m.b.h) ? l : m));
console.log(`  smallest kept: ${fmt(smallest.b.w)}x${fmt(smallest.b.h)} units at (${fmt(smallest.c[0])}, ${fmt(smallest.c[1])})`);
console.log(`  glass: ${glass.length}   book: ${book.length}   -> ${OUT.replace(ROOT, ".")}`);
console.log(`  dropped ${dropped.length}:`);
for (const line of dropped) console.log(`    ${line}`);
