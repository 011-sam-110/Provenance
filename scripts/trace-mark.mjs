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
// Marching squares over a thresholded bitmap, then Douglas-Peucker to bring the
// point count down to something a stylesheet can live with. Deterministic: the
// same PNG in gives the same paths out, so re-running is safe and reviewable.
//
//   node scripts/trace-mark.mjs
//   -> scripts/mark-traced.json  { viewBox, paths: [{ area, pts, d }] }
//
// components/brand/Mark.tsx and scripts/gen-icons.mjs both read that file, which
// is what stops the app and its icons ever showing different logos.
//
// Playwright is used purely as an image decoder (canvas + getImageData). It is
// already a devDependency here, so this adds no packages.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "public", "brand", "mark.png");
const OUT = resolve(ROOT, "lib", "brand", "markPaths.json");

/** Working resolution. Higher = truer curves and more points; 256 resolves the
 *  continents while keeping the emitted `d` strings reviewable. */
const GRID = 256;
/** Luminance above this is ink. The artwork is a light figure on near-black, so
 *  anything near the midpoint separates the two cleanly. */
const THRESHOLD = 96;
/** Douglas-Peucker tolerance, in GRID units. */
const EPSILON = 0.55;
/** Contours smaller than this are JPEG-ish noise in the source, not artwork. */
const MIN_AREA = 5;

/** Runs inside the browser: decode → threshold → marching squares → simplify. */
function traceBitmap({ grid, threshold, epsilon, minArea, dataUrl }) {
  return (async () => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();

    const canvas = document.createElement("canvas");
    canvas.width = grid;
    canvas.height = grid;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, grid, grid);
    const px = ctx.getImageData(0, 0, grid, grid).data;

    // Binary mask, padded by one cell so a contour can never touch the border.
    const W = grid + 2;
    const mask = new Uint8Array(W * W);
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        const i = (y * grid + x) * 4;
        const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        mask[(y + 1) * W + (x + 1)] = px[i + 3] > 40 && lum > threshold ? 1 : 0;
      }
    }

    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= W ? 0 : mask[y * W + x]);
    const caseAt = (x, y) =>
      (at(x - 1, y - 1) << 3) | (at(x, y - 1) << 2) | (at(x, y) << 1) | at(x - 1, y);

    // Marching-squares step table for the corner packing above
    // (TL<<3 | TR<<2 | BR<<1 | BL), following the boundary clockwise around ink.
    // The two saddles (5 and 10) are resolved consistently rather than by sampling
    // the centre: a logo has no ambiguous single-pixel diagonals worth the extra
    // pass, and picking one resolution keeps the walk deterministic.
    const STEP = {
      1: [0, 1], 2: [1, 0], 3: [1, 0], 4: [0, -1], 5: [0, 1], 6: [0, -1], 7: [0, -1],
      8: [-1, 0], 9: [0, 1], 10: [-1, 0], 11: [1, 0], 12: [-1, 0], 13: [0, 1], 14: [-1, 0],
    };

    const visited = new Set();
    const contours = [];
    for (let y = 1; y < W; y++) {
      for (let x = 1; x < W; x++) {
        const c0 = caseAt(x, y);
        if (c0 === 0 || c0 === 15 || visited.has(`${x},${y}`)) continue;
        const pts = [];
        let cx = x;
        let cy = y;
        // Bounded: a malformed mask must not spin forever inside a build script.
        for (let guard = 0; guard < 100000; guard++) {
          const key = `${cx},${cy}`;
          if (visited.has(key) && pts.length > 2) break;
          visited.add(key);
          pts.push([cx, cy]);
          const step = STEP[caseAt(cx, cy)];
          if (!step) break;
          cx += step[0];
          cy += step[1];
          if (cx === x && cy === y) break;
        }
        if (pts.length > 6) contours.push(pts);
      }
    }

    const perp = (p, a, b) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const d = Math.hypot(dx, dy);
      if (d === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
      return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / d;
    };
    const simplify = (pts, eps) => {
      if (pts.length < 3) return pts;
      let maxD = 0;
      let idx = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const d = perp(pts[i], pts[0], pts[pts.length - 1]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
      return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
    };
    const area = (pts) => {
      let a = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
        a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
      return Math.abs(a / 2);
    };

    const S = 128 / grid; // GRID space -> a 0..128 viewBox
    const fmt = (n) => Math.round(n * 100) / 100;

    const bbox = (pts) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
    };

    return contours
      .map((pts) => simplify(pts, epsilon))
      .filter((pts) => pts.length > 3 && area(pts) > minArea)
      .sort((a, b) => area(b) - area(a))
      .map((pts) => {
        const b = bbox(pts);
        const a = area(pts);
        // Fill ratio separates the FIGURE from the two orbit rings. The rings are
        // hairlines at low contrast in the source, so the threshold shreds them
        // into arcs — each arc has a large bounding box and almost no area. They
        // are perfect circles, so they are authored as <circle> in the component
        // instead of traced, which is what the stroke-draw animation needs anyway:
        // you cannot draw-on a set of disconnected fragments.
        const fill = b.w * b.h > 0 ? a / (b.w * b.h) : 0;
        const cy = ((b.y0 + b.y1) / 2 - 1) * S;
        const cx = ((b.x0 + b.x1) / 2 - 1) * S;

        // Is this a surviving fragment of one of the two orbit rings? Position
        // alone is not enough — the book's outer page tips sit at almost exactly
        // the inner ring's radius — so it also has to be SMALL and THIN, which an
        // arc is and a page fan is not. Position alone dropped four real book
        // paths; size alone cannot tell a three-pixel arc speck from a small
        // island inside the lens, which is real artwork.
        const nearRing = [
          { x: 64, y: 63, r: 46 },
          { x: 64, y: 56, r: 37 },
        ].some((ring) => Math.abs(Math.hypot(cx - ring.x, cy - ring.y) - ring.r) < 3.5);
        const onRing = nearRing && a < 200 && fill < 0.5;

        return {
          area: Math.round(a),
          pts: pts.length,
          fill: Math.round(fill * 100) / 100,
          // The figure splits into the two things that animate separately.
          group: onRing || fill < 0.12 ? "ring-fragment" : cy < 72 ? "glass" : "book",
          d:
            pts
              .map((p, i) => `${i === 0 ? "M" : "L"}${fmt((p[0] - 1) * S)} ${fmt((p[1] - 1) * S)}`)
              .join(" ") + " Z",
        };
      });
  })();
}

const browser = await chromium.launch();
const page = await browser.newPage();

const result = await page.evaluate(traceBitmap, {
  grid: GRID,
  threshold: THRESHOLD,
  epsilon: EPSILON,
  minArea: MIN_AREA,
  dataUrl: `data:image/png;base64,${readFileSync(SRC).toString("base64")}`,
});

await browser.close();

const glass = result.filter((p) => p.group === "glass").map((p) => p.d);
const book = result.filter((p) => p.group === "book").map((p) => p.d);
const dropped = result.filter((p) => p.group === "ring-fragment").length;

// ONE artefact, consumed by BOTH the component and the icon generator. That is
// the whole point: the app and its favicon physically cannot show different
// logos if they read the same file.
writeFileSync(
  OUT,
  JSON.stringify(
    {
      viewBox: "0 0 128 128",
      source: "public/brand/mark.png",
      generatedBy: "scripts/trace-mark.mjs",
      glass,
      book,
    },
    null,
    2,
  ),
);

console.log(`trace-mark: ${result.length} contours (${dropped} ring fragments dropped)`);
console.log(`  glass: ${glass.length}   book: ${book.length}   -> ${OUT.replace(ROOT, ".")}`);
for (const p of result.slice(0, 12)) {
  console.log(
    `  ${p.group.padEnd(14)} area ${String(p.area).padStart(5)}  pts ${String(p.pts).padStart(4)}  fill ${p.fill}`,
  );
}
