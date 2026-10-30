// A vehicle's outline, from the segmentation model's mask.
//
// The mask of one detection is the sigmoid of its 32 weights mixed over the 32
// prototype planes, at a quarter of the input resolution. Two things keep this
// cheap enough to run on every box of every frame:
//   - the threshold is taken on the LOGIT (sigmoid(z) > 0.5 is z > 0), so no
//     exponential is ever computed;
//   - only the cells under the box are mixed (Ultralytics crops the mask to the box
//     too, so the outline can never leak past it).
// The outline itself is traced with marching squares (d3-contour), which
// interpolates between cells. That matters at quarter resolution: a cell-edge
// outline is a staircase, the interpolated one follows the car.

import { contours } from "d3-contour";
import { MASK_DIM } from "./decode";
import type { Letterbox } from "./letterbox";

export type Point = [number, number];

/** Value given to the ring of cells round the box, so every outline closes. */
const OUTSIDE = -8;

/**
 * Outline of one detection in SOURCE pixels, or null when the mask under its box is
 * empty (the model was sure of the box and unsure of the shape; the caller draws
 * the box instead).
 */
export function maskOutline(
  protos: Float32Array,
  protoW: number,
  protoH: number,
  coeffs: Float32Array,
  inBox: [number, number, number, number],
  lb: Letterbox,
  tolerance = 1.2,
): Point[] | null {
  const sx = lb.inW / protoW;
  const sy = lb.inH / protoH;
  // Box in prototype cells, widened by one cell of OUTSIDE on every side.
  const bx1 = Math.max(0, Math.floor(inBox[0] / sx));
  const by1 = Math.max(0, Math.floor(inBox[1] / sy));
  const bx2 = Math.min(protoW, Math.ceil(inBox[2] / sx));
  const by2 = Math.min(protoH, Math.ceil(inBox[3] / sy));
  if (bx2 - bx1 < 1 || by2 - by1 < 1) return null;
  const gx = bx1 - 1;
  const gy = by1 - 1;
  const w = bx2 - bx1 + 2;
  const h = by2 - by1 + 2;
  const plane = protoW * protoH;
  const field = new Float64Array(w * h).fill(OUTSIDE);
  let inside = 0;
  for (let y = by1; y < by2; y++) {
    for (let x = bx1; x < bx2; x++) {
      let z = 0;
      const at = y * protoW + x;
      for (let k = 0; k < MASK_DIM; k++) z += coeffs[k] * protos[k * plane + at];
      field[(y - gy) * w + (x - gx)] = z;
      if (z > 0) inside++;
    }
  }
  if (inside === 0) return null;

  const [shape] = contours().size([w, h]).thresholds([0]).smooth(true)(Array.from(field));
  let best: Point[] | null = null;
  let bestArea = 0;
  for (const polygon of shape.coordinates) {
    const ring = polygon[0] as Point[];
    const a = Math.abs(ringArea(ring));
    if (a > bestArea) {
      bestArea = a;
      best = ring;
    }
  }
  if (!best) return null;
  const mapped = best.map(([x, y]): Point => [
    ((gx + x) * sx - lb.padX) / lb.scale,
    ((gy + y) * sy - lb.padY) / lb.scale,
  ]);
  return simplify(mapped, tolerance);
}

export function ringArea(ring: Point[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return a / 2;
}

/** Ramer-Douglas-Peucker on a closed ring. Keeps the first point and the farthest one from it. */
export function simplify(ring: Point[], tolerance: number): Point[] {
  const pts = samePoint(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring.slice();
  if (pts.length <= 4) return pts;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = rdp(pts.slice(0, far + 1), tolerance);
  const b = rdp([...pts.slice(far), pts[0]], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function rdp(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let idx = 0;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  const left = rdp(pts.slice(0, idx + 1), tol);
  const right = rdp(pts.slice(idx), tol);
  return [...left.slice(0, -1), ...right];
}

function samePoint(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
