import { describe, expect, it } from "vitest";
import { TRACKER, VehicleTracker, type TrackerInput } from "@/lib/vision/tracker";
import type { VehicleKind } from "@/lib/vision/vehicles";

const FRAME = [1280, 720] as const;

function box(cx: number, cy: number, score: number, kind: VehicleKind = "car", w = 60, h = 30): TrackerInput {
  return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score, kind, outline: null };
}

/** Run `steps` detection passes `dt` seconds apart; `at(i)` gives pass i's boxes. */
function run(tr: VehicleTracker, steps: number, dt: number, at: (i: number) => TrackerInput[], t0 = 0) {
  for (let i = 0; i < steps; i++) tr.update(at(i), t0 + i * dt);
  return t0 + (steps - 1) * dt;
}

describe("VehicleTracker", () => {
  it("keeps one ID on a car crossing the frame", () => {
    const tr = new VehicleTracker(...FRAME);
    const t = run(tr, 8, 0.2, (i) => [box(100 + i * 40, 300, 0.6)]);
    const v = tr.view(t);
    expect(v.map((x) => x.id)).toEqual([1]);
    expect(tr.seen).toBe(1);
    expect(v[0].vx).toBeCloseTo(200, -1); // 40 px every 0.2 s
  });

  it("predicts the box forward to the frame on screen", () => {
    const tr = new VehicleTracker(...FRAME);
    const t = run(tr, 6, 0.2, (i) => [box(100 + i * 40, 300, 0.6)]);
    const later = tr.view(t + 0.25)[0];
    expect((later.x1 + later.x2) / 2).toBeCloseTo(100 + 5 * 40 + 0.25 * 200, -1);
  });

  it("never gives an ID to a sign: a weak box that does not move", () => {
    const tr = new VehicleTracker(...FRAME);
    const t = run(tr, 30, 0.2, () => [box(600, 80, 0.35, "truck", 200, 60)]);
    expect(tr.view(t)).toEqual([]);
    expect(tr.seen).toBe(0);
  });

  it("shows a parked car the model is sure of", () => {
    const tr = new VehicleTracker(...FRAME);
    const t = run(tr, 5, 0.2, () => [box(900, 600, 0.75)]);
    expect(tr.view(t).map((v) => v.id)).toEqual([1]);
  });

  it("shows a weak car once it has moved, and only after enough sightings", () => {
    const tr = new VehicleTracker(...FRAME);
    tr.update([box(200, 200, 0.15, "car", 24, 14)], 0);
    tr.update([box(215, 200, 0.18, "car", 24, 14)], 0.2);
    expect(tr.view(0.2)).toEqual([]); // two sightings are not enough
    run(tr, 6, 0.2, (i) => [box(230 + i * 15, 200, 0.16, "car", 24, 14)], 0.4);
    expect(tr.seen).toBe(1);
  });

  it("lets a very weak box carry a track through a dip but never start one", () => {
    const tr = new VehicleTracker(...FRAME);
    let t = run(tr, 4, 0.2, (i) => [box(100 + i * 30, 300, 0.6)]);
    // The car fades to 0.08 for a second: still matched, still drawn at full strength.
    t = run(tr, 5, 0.2, (i) => [box(100 + (4 + i) * 30, 300, 0.08)], t + 0.2);
    const v = tr.view(t);
    expect(v).toHaveLength(1);
    expect(v[0].alpha).toBe(1);
    // A 0.08 box on its own goes nowhere.
    const fresh = new VehicleTracker(...FRAME);
    run(fresh, 10, 0.2, (i) => [box(100 + i * 30, 500, 0.08)]);
    expect(fresh.seen).toBe(0);
  });

  it("fades a lost vehicle, then forgets it", () => {
    const tr = new VehicleTracker(...FRAME);
    const t = run(tr, 4, 0.2, (i) => [box(100 + i * 30, 300, 0.6)]);
    tr.update([], t + 0.5);
    expect(tr.view(t + 0.5)[0].alpha).toBeGreaterThan(0);
    expect(tr.view(t + 0.5)[0].alpha).toBeLessThan(1);
    tr.update([], t + TRACKER.SHOW_LOST + 0.1);
    expect(tr.view(t + TRACKER.SHOW_LOST + 0.1)).toEqual([]);
    tr.update([], t + TRACKER.KEEP_CONFIRMED + 0.1);
    tr.update([box(100, 300, 0.6)], t + TRACKER.KEEP_CONFIRMED + 0.2);
    run(tr, 3, 0.2, (i) => [box(130 + i * 30, 300, 0.6)], t + TRACKER.KEEP_CONFIRMED + 0.4);
    expect(tr.seen).toBe(2); // a new vehicle, a new ID
  });

  it("does not fade vehicles because the DETECTOR is slow, only when it stops finding them", () => {
    // Measured 2026-10-30: WebGPU recompiles its shaders when the input size changes,
    // and that one pass took 1.3 s. Every outline faded at once and the counter read
    // "0 vehicles in view" with thirty cars on screen.
    const tr = new VehicleTracker(...FRAME);
    const t = run(tr, 5, 0.2, (i) => [box(100 + i * 40, 300, 0.6)]);
    expect(tr.stats(t + 1.3).inViewTotal).toBe(1);
    expect(tr.view(t + 1.3)[0].alpha).toBe(1);
    // ...but a pass that looks and does not find it starts the fade.
    tr.update([], t + 1.3);
    tr.update([], t + 1.9);
    expect(tr.view(t + 1.9)).toEqual([]);
  });

  it("keeps two cars in neighbouring lanes apart", () => {
    const tr = new VehicleTracker(...FRAME);
    const t = run(tr, 10, 0.2, (i) => [box(100 + i * 40, 300, 0.6), box(1100 - i * 40, 340, 0.6)]);
    const v = tr.view(t).sort((a, b) => a.id - b.id);
    expect(v).toHaveLength(2);
    expect(v[0].vx).toBeGreaterThan(0); // the eastbound car is still the one going east
    expect(v[1].vx).toBeLessThan(0);
  });

  it("names a vehicle by the kind it was scored as most", () => {
    const tr = new VehicleTracker(...FRAME);
    const kinds: VehicleKind[] = ["car", "truck", "car", "car", "truck"];
    const t = run(tr, 5, 0.2, (i) => [box(100 + i * 40, 300, 0.6, kinds[i])]);
    expect(tr.view(t)[0].kind).toBe("car");
  });

  it("drops the tracks when the video jumps back, and keeps the count", () => {
    const tr = new VehicleTracker(...FRAME);
    const t = run(tr, 5, 0.2, (i) => [box(100 + i * 40, 300, 0.6)], 10);
    expect(tr.seen).toBe(1);
    tr.update([], 0.1);
    expect(tr.view(0.1)).toEqual([]);
    expect(tr.seen).toBe(1);
    expect(t).toBeGreaterThan(10);
  });

  it("counts what is on screen by kind", () => {
    const tr = new VehicleTracker(...FRAME);
    const t = run(tr, 5, 0.2, (i) => [box(100 + i * 40, 200, 0.7), box(100 + i * 40, 500, 0.7, "bus", 120, 50)]);
    const s = tr.stats(t);
    expect(s.inViewTotal).toBe(2);
    expect(s.inView.car).toBe(1);
    expect(s.inView.bus).toBe(1);
    expect(s.seen).toBe(2);
  });

  it("fits the latest outline to the predicted box", () => {
    const tr = new VehicleTracker(...FRAME);
    const t = run(tr, 4, 0.2, (i) => {
      const b = box(100 + i * 40, 300, 0.7);
      b.outline = [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]];
      return [b];
    });
    const v = tr.view(t)[0];
    expect(v.outline).not.toBeNull();
    expect(v.outline![0][0]).toBeCloseTo(v.x1, 0);
    expect(v.outline![2][1]).toBeCloseTo(v.y2, 0);
  });
});
