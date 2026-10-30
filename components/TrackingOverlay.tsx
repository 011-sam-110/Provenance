"use client";
// Vehicle tracking over a camera's live video: a switch, the outlines, the counts.
//
// Nothing here leaves the browser. Frames go from the <video> (whose bytes already
// came through /api/hls, so the canvas may read them) to a worker on this page
// (lib/vision/detect.worker.ts) and back as boxes and outlines. Nothing is stored.
//
// THREE LOOPS, ON PURPOSE. Detection runs as fast as the worker answers, one frame
// in flight. Drawing runs on every animation frame and asks the tracker where each
// vehicle is NOW, so the outlines glide with the cars between detections instead of
// jumping four times a second. The counts reach React every 300 ms: a React render
// per animation frame is the thing this file exists to avoid.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Detector } from "@/lib/vision/client";
import { VehicleTracker, type TrackView, type TrackerStats } from "@/lib/vision/tracker";
import { KIND_COLOUR, KIND_NAME, KIND_PLURAL, VEHICLE_KINDS } from "@/lib/vision/vehicles";
import type { Backend } from "@/lib/vision/protocol";
import styles from "./TrackingOverlay.module.css";

type Phase =
  | { kind: "off" }
  | { kind: "loading"; loaded: number; total: number | null }
  | { kind: "on"; backend: Backend }
  | { kind: "error"; message: string };

type Perf = { ms: number; inW: number; inH: number };

const STATS_EVERY_MS = 300;
/** Labels go only on vehicles at least this tall on screen; smaller ones get the outline alone. */
const LABEL_MIN_PX = 18;

export function TrackingOverlay(props: {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** A new value (a new camera) switches tracking off. */
  resetKey: string;
  children: ReactNode;
}) {
  const { videoRef, resetKey, children } = props;
  const [phase, setPhase] = useState<Phase>({ kind: "off" });
  const [stats, setStats] = useState<TrackerStats | null>(null);
  const [perf, setPerf] = useState<Perf | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<Detector | null>(null);

  useEffect(() => {
    setPhase({ kind: "off" });
  }, [resetKey]);

  const running = phase.kind === "loading" || phase.kind === "on";

  // The worker lives exactly as long as tracking is switched on. Loading and
  // running share one worker, so this effect keys on `running`, not on `phase`.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const det = new Detector({
      onProgress: (loaded, total) => {
        if (!cancelled) setPhase((p) => (p.kind === "loading" ? { kind: "loading", loaded, total } : p));
      },
    });
    detectorRef.current = det;
    det.ready.then(
      (backend) => !cancelled && setPhase({ kind: "on", backend }),
      (err: unknown) => !cancelled && setPhase({ kind: "error", message: describe(err) }),
    );
    return () => {
      cancelled = true;
      det.dispose();
      detectorRef.current = null;
      setStats(null);
      setPerf(null);
      const c = canvasRef.current;
      c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    };
  }, [running]);

  useEffect(() => {
    if (phase.kind !== "on") return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const det = detectorRef.current;
    const ctx = canvas?.getContext("2d");
    if (!video || !canvas || !det || !ctx) return;

    let stopped = false;
    const tracker = new VehicleTracker(video.videoWidth || 1280, video.videoHeight || 720);
    let lastPerf: Perf | null = null;

    const pump = async (mediaTime: number) => {
      if (stopped || det.busy || video.paused || video.readyState < 2 || !video.videoWidth) return;
      tracker.resize(video.videoWidth, video.videoHeight);
      try {
        const r = await det.detect(video, mediaTime);
        if (stopped) return;
        tracker.update(r.detections, r.t);
        lastPerf = { ms: r.totalMs, inW: r.inW, inH: r.inH };
      } catch (err) {
        if (!stopped) setPhase({ kind: "error", message: describe(err) });
      }
    };

    // A new frame on screen is the moment to detect, and requestVideoFrameCallback
    // says when that is and which frame it was. Without it, poll at the stream's
    // usual 15 fps; a duplicate frame costs one wasted detection, nothing worse.
    let frameHandle = 0;
    let poll: ReturnType<typeof setInterval> | null = null;
    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      if (stopped) return;
      void pump(meta.mediaTime);
      frameHandle = video.requestVideoFrameCallback(onFrame);
    };
    if (typeof video.requestVideoFrameCallback === "function") frameHandle = video.requestVideoFrameCallback(onFrame);
    else poll = setInterval(() => void pump(video.currentTime), 66);

    const font = getComputedStyle(canvas).fontFamily || "sans-serif";
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (!cssW || !cssH || !video.videoWidth) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pxW = Math.round(cssW * dpr);
      const pxH = Math.round(cssH * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      paint(ctx, tracker.view(video.currentTime), fitVideo(cssW, cssH, video.videoWidth, video.videoHeight), font);
    };
    raf = requestAnimationFrame(draw);

    const tick = setInterval(() => {
      setStats(tracker.stats(video.currentTime));
      setPerf(lastPerf);
    }, STATS_EVERY_MS);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearInterval(tick);
      if (poll) clearInterval(poll);
      if (frameHandle) video.cancelVideoFrameCallback(frameHandle);
    };
  }, [phase.kind, videoRef]);

  const toggle = () => setPhase(running ? { kind: "off" } : { kind: "loading", loaded: 0, total: null });

  const pct = phase.kind === "loading" && phase.total ? Math.round((phase.loaded / phase.total) * 100) : null;
  const label =
    phase.kind === "off"
      ? "Track vehicles"
      : phase.kind === "loading"
        ? pct === null
          ? "Starting detector"
          : `Loading detector ${pct}%`
        : phase.kind === "on"
          ? "Stop tracking"
          : "Try tracking again";

  return (
    <div
      className={styles.root}
      data-testid="vehicle-tracking"
      data-phase={phase.kind}
      data-backend={phase.kind === "on" ? phase.backend : undefined}
      data-in-view={stats?.inViewTotal ?? 0}
      data-seen={stats?.seen ?? 0}
    >
      <div className={styles.stage}>
        {children}
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
        {phase.kind === "on" && stats && (
          <div className={styles.hud}>
            <span className={styles.hudMain}>
              <strong>{stats.inViewTotal}</strong>
              {stats.inViewTotal === 1 ? "vehicle in view" : "vehicles in view"}
            </span>
            <span className={styles.hudSeen}>{stats.seen} tracked since you switched it on</span>
            {stats.inViewTotal > 0 && <span className={styles.hudKinds}>{kindsLine(stats)}</span>}
          </div>
        )}
        <button
          type="button"
          className={styles.toggle}
          data-phase={phase.kind}
          aria-pressed={running}
          aria-busy={phase.kind === "loading"}
          onClick={toggle}
        >
          <span className={styles.mark} aria-hidden />
          {label}
          {pct !== null && <span className={styles.progress} style={{ transform: `scaleX(${pct / 100})` }} aria-hidden />}
        </button>
      </div>
      {phase.kind !== "off" && (
        <p className={styles.note} data-phase={phase.kind} role={phase.kind === "error" ? "alert" : undefined}>
          {noteText(phase, perf)}
        </p>
      )}
    </div>
  );
}

function noteText(phase: Exclude<Phase, { kind: "off" }>, perf: Perf | null): string {
  if (phase.kind === "error") return `Vehicle tracking could not start: ${phase.message}`;
  if (phase.kind === "loading") {
    return "Downloading the detection model (12 MB, kept by your browser after the first time). It runs on this device: no frame is sent anywhere.";
  }
  const where = phase.backend === "webgpu" ? "your graphics card" : "your processor";
  const speed = perf ? ` (${perf.inW}x${perf.inH}, ${Math.round(perf.ms)} ms a frame)` : "";
  return (
    `Detected on ${where} by YOLO11n-seg${speed}. Nothing is sent or stored. ` +
    "The model misses some distant, small and night-time vehicles, and shows a vehicle only once it moves " +
    "or the model is sure of it: the counts are what this tab followed, not a traffic count."
  );
}

function kindsLine(s: TrackerStats): string {
  return VEHICLE_KINDS.filter((k) => s.inView[k] > 0)
    .map((k) => `${s.inView[k]} ${s.inView[k] === 1 ? KIND_NAME[k].toLowerCase() : KIND_PLURAL[k]}`)
    .join(", ");
}

function describe(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/model 404|Failed to fetch dynamically imported module|ort\./i.test(m)) {
    return "the detector files are missing from this server.";
  }
  return m.endsWith(".") ? m : `${m}.`;
}

type Fit = { s: number; ox: number; oy: number; w: number; h: number };

/** Where the picture sits inside the element: the video letterboxes like object-fit: contain. */
function fitVideo(cssW: number, cssH: number, vw: number, vh: number): Fit {
  const s = Math.min(cssW / vw, cssH / vh);
  return { s, ox: (cssW - vw * s) / 2, oy: (cssH - vh * s) / 2, w: cssW, h: cssH };
}

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Trails first, outlines over them, labels last. Labels are placed largest vehicle
 * first and a label that would cover another is dropped: in a jam the near cars
 * keep their names and the far ones keep their outlines.
 */
function paint(ctx: CanvasRenderingContext2D, views: TrackView[], f: Fit, font: string): void {
  const X = (x: number) => f.ox + x * f.s;
  const Y = (y: number) => f.oy + y * f.s;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const v of views) {
    const hue = KIND_COLOUR[v.kind];
    const n = v.trail.length;
    if (n < 2) continue;
    ctx.lineWidth = 1.75;
    ctx.strokeStyle = hue;
    for (let i = 1; i < n; i++) {
      ctx.globalAlpha = (i / n) * 0.55 * v.alpha;
      ctx.beginPath();
      ctx.moveTo(X(v.trail[i - 1][0]), Y(v.trail[i - 1][1]));
      ctx.lineTo(X(v.trail[i][0]), Y(v.trail[i][1]));
      ctx.stroke();
    }
  }

  for (const v of views) {
    const hue = KIND_COLOUR[v.kind];
    ctx.beginPath();
    if (v.outline && v.outline.length >= 3) {
      ctx.moveTo(X(v.outline[0][0]), Y(v.outline[0][1]));
      for (let i = 1; i < v.outline.length; i++) ctx.lineTo(X(v.outline[i][0]), Y(v.outline[i][1]));
      ctx.closePath();
    } else {
      ctx.roundRect(X(v.x1), Y(v.y1), (v.x2 - v.x1) * f.s, (v.y2 - v.y1) * f.s, 3);
    }
    ctx.globalAlpha = 0.14 * v.alpha;
    ctx.fillStyle = hue;
    ctx.fill();
    ctx.globalAlpha = 0.95 * v.alpha;
    ctx.strokeStyle = hue;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // The wheel point: where the vehicle meets the road, and where its trail ends.
    const [wx, wy] = v.trail[v.trail.length - 1];
    ctx.beginPath();
    ctx.arc(X(wx), Y(wy), 2.25, 0, Math.PI * 2);
    ctx.fillStyle = hue;
    ctx.fill();
  }

  ctx.font = `600 11px ${font}`;
  ctx.textBaseline = "middle";
  const placed: Rect[] = [];
  const byHeight = [...views].sort((a, b) => b.y2 - b.y1 - (a.y2 - a.y1));
  for (const v of byHeight) {
    if ((v.y2 - v.y1) * f.s < LABEL_MIN_PX || v.alpha < 0.5) continue;
    const name = KIND_NAME[v.kind];
    const id = String(v.id);
    const nameW = ctx.measureText(name).width;
    const w = nameW + 4 + ctx.measureText(id).width + 12;
    const h = 17;
    const x = clamp(X(v.x1), 2, f.w - w - 2);
    const above: Rect = { x, y: Y(v.y1) - h - 3, w, h };
    const below: Rect = { x, y: Y(v.y2) + 3, w, h };
    const spot = [above, below].find((r) => r.y >= 2 && r.y + r.h <= f.h - 2 && !placed.some((p) => hit(p, r)));
    if (!spot) continue;
    placed.push(spot);
    ctx.globalAlpha = 0.82 * v.alpha;
    ctx.fillStyle = "#080d12";
    ctx.beginPath();
    ctx.roundRect(spot.x, spot.y, spot.w, spot.h, 4);
    ctx.fill();
    ctx.globalAlpha = v.alpha;
    ctx.fillStyle = KIND_COLOUR[v.kind];
    ctx.fillText(name, spot.x + 6, spot.y + h / 2 + 0.5);
    ctx.fillStyle = "#f2f6f8";
    ctx.fillText(id, spot.x + 6 + nameW + 4, spot.y + h / 2 + 0.5);
  }
  ctx.globalAlpha = 1;
}

function hit(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? Math.max(lo, hi) : v;
}
