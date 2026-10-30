import { describe, expect, it } from "vitest";
import { letterbox, toSource } from "@/lib/vision/letterbox";
import { decodeYoloSeg, iou, nms, MASK_DIM, NUM_CLASSES } from "@/lib/vision/decode";
import { maskOutline, ringArea, simplify, type Point } from "@/lib/vision/contour";

describe("letterbox", () => {
  it("fits a 16:9 stream into a rectangle, not a square", () => {
    const lb = letterbox(1280, 720, 640);
    expect([lb.inW, lb.inH]).toEqual([640, 384]);
    expect(lb.scale).toBe(0.5);
    expect([lb.padX, lb.padY]).toEqual([0, 12]);
  });

  it("never scales a small stream up", () => {
    const lb = letterbox(768, 432, 1280);
    expect([lb.inW, lb.inH]).toEqual([768, 448]);
    expect(lb.scale).toBe(1);
  });

  it("keeps both sides on the model's stride and maps points back", () => {
    for (const [w, h, cap] of [[720, 480, 640], [1920, 1080, 1280], [352, 240, 640]] as const) {
      const lb = letterbox(w, h, cap);
      expect(lb.inW % 32).toBe(0);
      expect(lb.inH % 32).toBe(0);
      expect(Math.max(lb.inW, lb.inH)).toBeLessThanOrEqual(cap);
      const [x, y] = toSource(lb, lb.padX + 10 * lb.scale, lb.padY + 20 * lb.scale);
      expect(x).toBeCloseTo(10);
      expect(y).toBeCloseTo(20);
    }
  });
});

/** A model output with `anchors` anchors, all zero, plus the rows given. */
function output(anchors: number, rows: { box: [number, number, number, number]; cls: number; score: number }[]) {
  const ch = 4 + NUM_CLASSES + MASK_DIM;
  const out = new Float32Array(ch * anchors);
  rows.forEach((r, i) => {
    r.box.forEach((v, c) => (out[c * anchors + i] = v));
    out[(4 + r.cls) * anchors + i] = r.score;
    out[(4 + NUM_CLASSES) * anchors + i] = i + 1; // first mask weight, to see it travel
  });
  return out;
}

describe("decodeYoloSeg", () => {
  const lb = letterbox(1280, 720, 640); // scale 0.5, padY 12

  it("keeps vehicles, drops other classes, and maps boxes to source pixels", () => {
    const out = output(8, [
      { box: [100, 112, 40, 20], cls: 2, score: 0.8 }, // car
      { box: [300, 200, 20, 40], cls: 0, score: 0.9 }, // person: not a vehicle
      { box: [500, 100, 60, 30], cls: 7, score: 0.02 }, // truck below the floor
    ]);
    const dets = decodeYoloSeg(out, 8, lb, 1280, 720);
    expect(dets).toHaveLength(1);
    const [car] = dets;
    expect(car.kind).toBe("car");
    expect(car.x1).toBeCloseTo(160);
    expect(car.x2).toBeCloseTo(240);
    expect(car.y1).toBeCloseTo(180);
    expect(car.y2).toBeCloseTo(220);
    expect(car.coeffs[0]).toBe(1);
  });

  it("keeps a weak car, because the tracker is what filters weak boxes", () => {
    const dets = decodeYoloSeg(output(4, [{ box: [100, 100, 20, 10], cls: 2, score: 0.08 }]), 4, lb, 1280, 720);
    expect(dets).toHaveLength(1);
  });

  it("suppresses one vehicle scored as both car and truck (class-agnostic NMS)", () => {
    const out = output(4, [
      { box: [100, 100, 40, 20], cls: 2, score: 0.7 },
      { box: [102, 101, 40, 21], cls: 7, score: 0.5 },
    ]);
    const dets = decodeYoloSeg(out, 4, lb, 1280, 720);
    expect(dets.map((d) => d.kind)).toEqual(["car"]);
  });
});

describe("nms", () => {
  it("drops a weaker box lying inside a stronger one, keeps neighbours", () => {
    const kept = nms(
      [
        { x1: 0, y1: 0, x2: 100, y2: 50, score: 0.9 },
        { x1: 10, y1: 10, x2: 40, y2: 40, score: 0.3 }, // the cab of the same truck
        { x1: 120, y1: 0, x2: 200, y2: 50, score: 0.4 }, // the next car
      ],
      0.55,
      10,
    );
    expect(kept.map((k) => k.score)).toEqual([0.9, 0.4]);
  });

  it("measures IoU", () => {
    expect(iou({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 5, y1: 0, x2: 15, y2: 10 })).toBeCloseTo(50 / 150);
    expect(iou({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 20, y1: 0, x2: 30, y2: 10 })).toBe(0);
  });
});

describe("maskOutline", () => {
  // 64x64 input, so 16x16 prototype cells of 4 px. Prototype 0 is +1 over cells
  // x 4..9, y 6..9 and -1 elsewhere; the other 31 are zero.
  const lb = letterbox(64, 64, 64);
  const PW = 16;
  const protos = new Float32Array(MASK_DIM * PW * PW);
  for (let y = 0; y < PW; y++) for (let x = 0; x < PW; x++) protos[y * PW + x] = x >= 4 && x <= 9 && y >= 6 && y <= 9 ? 1 : -1;
  const coeffs = new Float32Array(MASK_DIM);
  coeffs[0] = 1;

  it("traces the mask as a polygon in source pixels", () => {
    const ring = maskOutline(protos, PW, PW, coeffs, [8, 16, 48, 48], lb)!;
    expect(ring.length).toBeGreaterThanOrEqual(4);
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    // The blob covers source x 16..40 and y 24..40 (cell edges; marching squares
    // puts the line between a +1 and a -1 cell centre, i.e. on the cell boundary).
    expect(Math.min(...xs)).toBeCloseTo(16, 0);
    expect(Math.max(...xs)).toBeCloseTo(40, 0);
    expect(Math.min(...ys)).toBeCloseTo(24, 0);
    expect(Math.max(...ys)).toBeCloseTo(40, 0);
  });

  it("never leaks past the box, even when the mask does", () => {
    const ring = maskOutline(protos, PW, PW, coeffs, [24, 28, 48, 48], lb)!;
    for (const [x, y] of ring) {
      expect(x).toBeGreaterThanOrEqual(24 - 4);
      expect(y).toBeGreaterThanOrEqual(28 - 4);
    }
  });

  it("answers null for an empty mask, so the caller draws the box", () => {
    expect(maskOutline(protos, PW, PW, coeffs, [52, 4, 60, 12], lb)).toBeNull();
  });
});

describe("simplify", () => {
  it("removes points on a straight edge and keeps the corners", () => {
    const square: Point[] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5], [0, 0]];
    const s = simplify(square, 0.5);
    expect(s).toHaveLength(4);
    expect(Math.abs(ringArea(s))).toBeCloseTo(100);
  });
});
