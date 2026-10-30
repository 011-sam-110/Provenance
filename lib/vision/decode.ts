// Turn the segmentation model's raw output into vehicle detections.
//
// YOLO11-seg answers with two tensors:
//   output0 [1, 4 + 80 + 32, N]  per anchor: box (cx, cy, w, h in input pixels), the
//                                80 COCO class scores (already sigmoid), 32 mask weights
//   output1 [1, 32, H/4, W/4]    the 32 mask prototypes the weights mix
// Both are CHANNEL-MAJOR: the value of channel c at anchor i is at c * N + i.
//
// WHY THE FLOOR IS SO LOW. On a compressed traffic stream the model scores most
// real cars between 0.05 and 0.25 (measured 2026-10-30 on Caltrans CCTV 822: 14
// boxes at 0.25, 84 at 0.05, nearly all of them cars). A single cut at 0.25 is what
// makes a tracker miss most of a busy road. So this keeps everything down to
// `minScore` and lets the tracker decide: a weak box only becomes a vehicle on
// screen after it has been seen again and again AND has moved (tracker.ts).

import { COCO_VEHICLES, type VehicleKind } from "./vehicles";
import type { Letterbox } from "./letterbox";

export const NUM_CLASSES = 80;
export const MASK_DIM = 32;

export type Detection = {
  /** Box in SOURCE pixels (the video's own resolution). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  kind: VehicleKind;
  /** Box in model-input pixels, kept for cutting the mask out of the prototypes. */
  inBox: [number, number, number, number];
  /** The 32 mask weights of this anchor. */
  coeffs: Float32Array;
};

export type DecodeOptions = {
  minScore: number;
  /** Boxes overlapping more than this are one vehicle. */
  iou: number;
  maxDetections: number;
};

export const DECODE_DEFAULTS: DecodeOptions = { minScore: 0.06, iou: 0.55, maxDetections: 150 };

export function decodeYoloSeg(
  out: Float32Array,
  anchors: number,
  lb: Letterbox,
  srcW: number,
  srcH: number,
  opts: DecodeOptions = DECODE_DEFAULTS,
): Detection[] {
  const found: Detection[] = [];
  const maskBase = 4 + NUM_CLASSES;
  for (let i = 0; i < anchors; i++) {
    // Best VEHICLE class only. Taking the best of all 80 first would drop a car whose
    // top class is "train" by a hair, which happens to long trucks.
    let best = -1;
    let score = opts.minScore;
    for (const cls of COCO_VEHICLES.keys()) {
      const s = out[(4 + cls) * anchors + i];
      if (s > score) {
        score = s;
        best = cls;
      }
    }
    if (best < 0) continue;
    const cx = out[i];
    const cy = out[anchors + i];
    const w = out[2 * anchors + i];
    const h = out[3 * anchors + i];
    const ix1 = cx - w / 2;
    const iy1 = cy - h / 2;
    const ix2 = cx + w / 2;
    const iy2 = cy + h / 2;
    const x1 = clamp((ix1 - lb.padX) / lb.scale, 0, srcW);
    const y1 = clamp((iy1 - lb.padY) / lb.scale, 0, srcH);
    const x2 = clamp((ix2 - lb.padX) / lb.scale, 0, srcW);
    const y2 = clamp((iy2 - lb.padY) / lb.scale, 0, srcH);
    if (x2 - x1 < 2 || y2 - y1 < 2) continue;
    const coeffs = new Float32Array(MASK_DIM);
    for (let k = 0; k < MASK_DIM; k++) coeffs[k] = out[(maskBase + k) * anchors + i];
    found.push({ x1, y1, x2, y2, score, kind: COCO_VEHICLES.get(best)!, inBox: [ix1, iy1, ix2, iy2], coeffs });
  }
  return nms(found, opts.iou, opts.maxDetections);
}

/**
 * Class-AGNOSTIC non-maximum suppression. The model often scores one pickup as both
 * a car and a truck; per-class NMS would keep both boxes and the tracker would give
 * one vehicle two IDs.
 */
export function nms<T extends { x1: number; y1: number; x2: number; y2: number; score: number }>(
  boxes: T[],
  iouThreshold: number,
  max: number,
): T[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const b of sorted) {
    if (kept.length >= max) break;
    if (kept.every((k) => iou(k, b) <= iouThreshold && !mostlyInside(b, k))) kept.push(b);
  }
  return kept;
}

export function iou(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): number {
  const inter = overlap(a, b);
  if (inter <= 0) return 0;
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * A weaker box that lies almost wholly inside a stronger one is a part of the same
 * vehicle (a cab, a trailer, a windscreen) more often than a second vehicle, and IoU
 * alone never removes it because the two areas differ so much.
 */
function mostlyInside(
  inner: { x1: number; y1: number; x2: number; y2: number },
  outer: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  const a = area(inner);
  return a > 0 && overlap(inner, outer) / a > 0.85;
}

function overlap(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}

function area(a: { x1: number; y1: number; x2: number; y2: number }): number {
  return Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
