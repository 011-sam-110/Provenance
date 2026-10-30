// Follow vehicles from one detection pass to the next, so each keeps one ID.
//
// The shape is ByteTrack's (Zhang et al., 2022): strong boxes are matched to tracks
// first, then the weak boxes left over may EXTEND a track but rarely start one. On
// traffic cameras that second pass is most of the recall, because a car a long way
// off scores 0.1 in one frame and 0.4 in the next, and a tracker that drops the 0.1
// frames loses it every other frame.
//
// Two rules decide what reaches the screen, and both exist because of what fixed
// cameras show:
//   1. A track is shown only once it has been matched CONFIRM_HITS times.
//   2. It must also have MOVED, unless the model was sure of it (>= SURE_SCORE).
//      Road signs, gantries and the operator's logo score 0.2-0.45 as "truck" or
//      "car" on almost every frame, and no amount of persistence tells them from a
//      parked car. Movement does: a sign never moves. A parked car the model is sure
//      of still shows; a jammed car it is unsure of does not. That trade is made on
//      purpose: missing a stationary vehicle is better than outlining a sign.
//
// Time is the VIDEO's time in seconds (the frame a detection was run on), not the
// wall clock. Detection runs behind the picture by its inference time, so the view
// predicts each track forward to the frame on screen (`view`), which is what keeps
// the outlines on the cars instead of a quarter of a second behind them.
//
// Motion is an alpha-beta filter on the box centre, a Kalman filter with fixed
// gains. With one to ten updates a second there is too little data to tune a full
// covariance, and fixed gains are easy to reason about in a test.

import { iou } from "./decode";
import type { Point } from "./contour";
import { VEHICLE_KINDS, type VehicleKind } from "./vehicles";

export type TrackerInput = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  kind: VehicleKind;
  outline: Point[] | null;
};

export type TrackView = {
  id: number;
  kind: VehicleKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 1 while the track is being matched, fading to 0 once it is lost. */
  alpha: number;
  /** Outline fitted to the predicted box, or null when the mask was empty. */
  outline: Point[] | null;
  /** Bottom-centre path, oldest first, ending at the current position. */
  trail: Point[];
  /** Pixels per second of video. */
  vx: number;
  vy: number;
};

export const TRACKER = {
  /** A box at or above this is matched first and may always start a track. */
  HIGH_SCORE: 0.3,
  /** A box below this may extend a track but never start one. */
  NEW_SCORE: 0.12,
  /** At or above this the model is sure enough that a still vehicle is shown. */
  SURE_SCORE: 0.5,
  CONFIRM_HITS: 3,
  /** Seconds a lost track is kept, waiting to be matched again. */
  KEEP_CONFIRMED: 1.4,
  KEEP_TENTATIVE: 0.5,
  /** Seconds a lost track stays drawn, fading after FADE_FROM. */
  SHOW_LOST: 0.8,
  FADE_FROM: 0.3,
  /** Longest a box is predicted forward. */
  PREDICT_MAX: 0.8,
  /** Two seconds of path: enough to read a heading, short enough that fifty of them stay legible. */
  TRAIL_SECONDS: 2,
  TRAIL_POINTS: 24,
  ALPHA: 0.7,
  BETA: 0.35,
  /** Moved = the centre travelled this many box sizes from where the track began. */
  MOVED_SIZES: 0.6,
  /** ...and at least this share of the frame width (stops tiny boxes "moving" by jitter). */
  MOVED_FRAME: 0.008,
} as const;

type Track = {
  key: number;
  id: number | null;
  cx: number;
  cy: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** Video time of the state above. */
  t: number;
  lastSeen: number;
  hits: number;
  maxScore: number;
  originX: number;
  originY: number;
  moved: boolean;
  votes: Map<VehicleKind, number>;
  /** Outline as fractions of its own detection's box, centred on it. */
  shape: Point[] | null;
  trail: { x: number; y: number; t: number }[];
};

export type TrackerStats = {
  /** Vehicles drawn right now, by kind. */
  inView: Record<VehicleKind, number>;
  inViewTotal: number;
  /** Distinct vehicles given an ID since the tracker started. */
  seen: number;
};

export class VehicleTracker {
  private tracks: Track[] = [];
  private nextKey = 1;
  private nextId = 1;
  private lastT = -Infinity;

  constructor(
    private frameW: number,
    private frameH: number,
  ) {}

  /** The stream changed size (a new camera, or a quality switch): start again. */
  resize(frameW: number, frameH: number): void {
    if (frameW === this.frameW && frameH === this.frameH) return;
    this.frameW = frameW;
    this.frameH = frameH;
    this.tracks = [];
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
    this.lastT = -Infinity;
  }

  get seen(): number {
    return this.nextId - 1;
  }

  update(detections: TrackerInput[], t: number): void {
    // Time went backwards: the video looped or was sought. Every motion estimate is
    // now wrong, so the tracks go; the count of vehicles seen does not.
    if (t < this.lastT - 0.25) this.tracks = [];
    this.lastT = t;

    const free = new Set(this.tracks);
    const high = detections.filter((d) => d.score >= TRACKER.HIGH_SCORE);
    const low = detections.filter((d) => d.score < TRACKER.HIGH_SCORE);

    const leftHigh = this.associate(high, free, t);
    this.associate(low, free, t).forEach((d) => {
      if (d.score >= TRACKER.NEW_SCORE) this.spawn(d, t);
    });
    leftHigh.forEach((d) => this.spawn(d, t));

    this.tracks = this.tracks.filter((tr) => {
      const keep = tr.id === null ? TRACKER.KEEP_TENTATIVE : TRACKER.KEEP_CONFIRMED;
      return t - tr.lastSeen <= keep;
    });
  }

  /** Tracks to draw on the frame at video time `t`. */
  view(t: number): TrackView[] {
    const out: TrackView[] = [];
    for (const tr of this.tracks) {
      if (tr.id === null) continue;
      // Lost is measured to the latest detection PASS, not to the frame on screen.
      // A slow pass (WebGPU recompiling for a new input size took 1.3 s) means
      // nobody has looked yet; it says nothing about whether the car is still there.
      const lost = Math.max(0, this.lastT - tr.lastSeen);
      if (lost > TRACKER.SHOW_LOST) continue;
      const dt = clamp(t - tr.t, 0, TRACKER.PREDICT_MAX);
      const cx = tr.cx + tr.vx * dt;
      const cy = tr.cy + tr.vy * dt;
      const alpha =
        lost <= TRACKER.FADE_FROM ? 1 : 1 - (lost - TRACKER.FADE_FROM) / (TRACKER.SHOW_LOST - TRACKER.FADE_FROM);
      const trail: Point[] = tr.trail.filter((p) => t - p.t <= TRACKER.TRAIL_SECONDS).map((p) => [p.x, p.y]);
      trail.push([cx, cy + tr.h / 2]);
      out.push({
        id: tr.id,
        kind: leadingKind(tr.votes),
        x1: cx - tr.w / 2,
        y1: cy - tr.h / 2,
        x2: cx + tr.w / 2,
        y2: cy + tr.h / 2,
        alpha: clamp(alpha, 0, 1),
        outline: tr.shape ? tr.shape.map(([u, v]): Point => [cx + u * tr.w, cy + v * tr.h]) : null,
        trail,
        vx: tr.vx,
        vy: tr.vy,
      });
    }
    return out;
  }

  stats(t: number): TrackerStats {
    const inView = Object.fromEntries(VEHICLE_KINDS.map((k) => [k, 0])) as Record<VehicleKind, number>;
    const shown = this.view(t).filter((v) => v.alpha > 0.5);
    for (const v of shown) inView[v.kind]++;
    return { inView, inViewTotal: shown.length, seen: this.seen };
  }

  /** Greedy best-first matching. Returns the detections nothing took. */
  private associate(dets: TrackerInput[], free: Set<Track>, t: number): TrackerInput[] {
    const pairs: { tr: Track; d: TrackerInput; sim: number }[] = [];
    for (const tr of free) {
      const p = predicted(tr, t);
      for (const d of dets) {
        const sim = similarity(p, d, tr.hits < 2);
        // A vehicle already on screen wins a tie against a track not yet shown, so a
        // stray box cannot steal a confirmed car's detection and orphan its ID.
        if (sim > 0) pairs.push({ tr, d, sim: sim + (tr.id === null ? 0 : 0.1) });
      }
    }
    pairs.sort((a, b) => b.sim - a.sim);
    const taken = new Set<TrackerInput>();
    for (const { tr, d } of pairs) {
      if (!free.has(tr) || taken.has(d)) continue;
      free.delete(tr);
      taken.add(d);
      this.correct(tr, d, t);
    }
    return dets.filter((d) => !taken.has(d));
  }

  private spawn(d: TrackerInput, t: number): void {
    const cx = (d.x1 + d.x2) / 2;
    const cy = (d.y1 + d.y2) / 2;
    const tr: Track = {
      key: this.nextKey++,
      id: null,
      cx,
      cy,
      w: d.x2 - d.x1,
      h: d.y2 - d.y1,
      vx: 0,
      vy: 0,
      t,
      lastSeen: t,
      hits: 1,
      maxScore: d.score,
      originX: cx,
      originY: cy,
      moved: false,
      votes: new Map([[d.kind, d.score]]),
      shape: normalise(d),
      trail: [{ x: cx, y: d.y2, t }],
    };
    this.tracks.push(tr);
    this.promote(tr);
  }

  private correct(tr: Track, d: TrackerInput, t: number): void {
    const dt = t - tr.t;
    const mx = (d.x1 + d.x2) / 2;
    const my = (d.y1 + d.y2) / 2;
    if (dt > 1e-3) {
      const px = tr.cx + tr.vx * dt;
      const py = tr.cy + tr.vy * dt;
      if (tr.hits === 1) {
        // Second sighting: the first velocity is simply the step between the two.
        tr.vx = (mx - tr.cx) / dt;
        tr.vy = (my - tr.cy) / dt;
        tr.cx = mx;
        tr.cy = my;
      } else {
        const rx = mx - px;
        const ry = my - py;
        tr.cx = px + TRACKER.ALPHA * rx;
        tr.cy = py + TRACKER.ALPHA * ry;
        tr.vx += (TRACKER.BETA * rx) / dt;
        tr.vy += (TRACKER.BETA * ry) / dt;
      }
      // A wrong match can fling the estimate across the frame; no road vehicle on a
      // fixed camera crosses the whole picture in under half a second.
      const cap = 2 * Math.max(this.frameW, this.frameH);
      tr.vx = clamp(tr.vx, -cap, cap);
      tr.vy = clamp(tr.vy, -cap, cap);
    } else {
      tr.cx = mx;
      tr.cy = my;
    }
    tr.w += 0.5 * (d.x2 - d.x1 - tr.w);
    tr.h += 0.5 * (d.y2 - d.y1 - tr.h);
    tr.t = t;
    tr.lastSeen = t;
    tr.hits++;
    tr.maxScore = Math.max(tr.maxScore, d.score);
    tr.votes.set(d.kind, (tr.votes.get(d.kind) ?? 0) + d.score);
    const shape = normalise(d);
    if (shape) tr.shape = shape;
    tr.trail.push({ x: tr.cx, y: tr.cy + tr.h / 2, t });
    if (tr.trail.length > TRACKER.TRAIL_POINTS) tr.trail.splice(0, tr.trail.length - TRACKER.TRAIL_POINTS);
    if (!tr.moved) {
      const travelled = Math.hypot(tr.cx - tr.originX, tr.cy - tr.originY);
      const need = Math.max(TRACKER.MOVED_SIZES * Math.sqrt(tr.w * tr.h), TRACKER.MOVED_FRAME * this.frameW);
      tr.moved = travelled >= need;
    }
    this.promote(tr);
  }

  private promote(tr: Track): void {
    if (tr.id !== null) return;
    if (tr.hits < TRACKER.CONFIRM_HITS) return;
    if (!tr.moved && tr.maxScore < TRACKER.SURE_SCORE) return;
    tr.id = this.nextId++;
  }
}

type Box = { x1: number; y1: number; x2: number; y2: number; w: number; h: number };

function predicted(tr: Track, t: number): Box {
  const dt = clamp(t - tr.t, 0, TRACKER.PREDICT_MAX);
  const cx = tr.cx + tr.vx * dt;
  const cy = tr.cy + tr.vy * dt;
  return { x1: cx - tr.w / 2, y1: cy - tr.h / 2, x2: cx + tr.w / 2, y2: cy + tr.h / 2, w: tr.w, h: tr.h };
}

/**
 * 0 means "cannot be the same vehicle". Overlap counts most; centre distance breaks
 * ties and carries the match when a small, fast box has stepped clear of its own
 * last position (IoU 0). A young track has no velocity yet, so it is allowed a
 * wider reach.
 */
export function similarity(p: Box, d: TrackerInput, young: boolean): number {
  const dw = d.x2 - d.x1;
  const dh = d.y2 - d.y1;
  const ratio = (dw * dh) / Math.max(1e-6, p.w * p.h);
  if (ratio > 4 || ratio < 0.25) return 0;
  const overlap = iou(p, d);
  const size = Math.sqrt(Math.max(p.w * p.h, dw * dh));
  const gate = (young ? 2.2 : 1.2) * size;
  const dist = Math.hypot((d.x1 + d.x2) / 2 - (p.x1 + p.x2) / 2, (d.y1 + d.y2) / 2 - (p.y1 + p.y2) / 2);
  if (overlap < 0.05 && dist >= gate) return 0;
  return overlap + 0.3 * Math.max(0, 1 - dist / gate);
}

function normalise(d: TrackerInput): Point[] | null {
  if (!d.outline || d.outline.length < 3) return null;
  const cx = (d.x1 + d.x2) / 2;
  const cy = (d.y1 + d.y2) / 2;
  const w = Math.max(1e-6, d.x2 - d.x1);
  const h = Math.max(1e-6, d.y2 - d.y1);
  return d.outline.map(([x, y]): Point => [(x - cx) / w, (y - cy) / h]);
}

function leadingKind(votes: Map<VehicleKind, number>): VehicleKind {
  let best: VehicleKind = "car";
  let max = -1;
  for (const [k, v] of votes) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  return best;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
