// The page side of the detection worker: one worker, one frame in flight.

import type { Backend, FromWorker, ToWorker, WireDetection } from "./protocol";

/** The model the tracker runs. See docs/VEHICLE_TRACKING.md for where it came from. */
export const MODEL_URL = "/models/yolo11n-seg.onnx";
/** Where scripts/copy-ort.mjs puts ONNX Runtime. */
export const ORT_BASE = "/ort/";

export type DetectResult = {
  t: number;
  detections: WireDetection[];
  inferMs: number;
  totalMs: number;
  inW: number;
  inH: number;
};

export type LoadEvents = {
  onProgress?: (loaded: number, total: number | null) => void;
};

export class Detector {
  private worker: Worker;
  private pending: ((r: DetectResult) => void) | null = null;
  private fail: ((e: Error) => void) | null = null;
  readonly ready: Promise<Backend>;

  constructor(events: LoadEvents = {}) {
    this.worker = new Worker(new URL("./detect.worker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise<Backend>((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === "progress") events.onProgress?.(m.loaded, m.total);
        else if (m.type === "ready") resolve(m.backend);
        else if (m.type === "result") {
          const done = this.pending;
          this.pending = this.fail = null;
          done?.(m);
        } else if (m.type === "error") {
          const err = new Error(m.message);
          const fail = this.fail;
          this.pending = this.fail = null;
          if (fail) fail(err);
          else reject(err);
        }
      };
      this.worker.onerror = (e) => reject(new Error(e.message || "worker failed to start"));
    });
    this.send({ type: "load", modelUrl: MODEL_URL, ortBase: ORT_BASE });
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  /** Detect on the frame showing now. The bitmap is handed to the worker, not copied. */
  async detect(video: HTMLVideoElement, t: number): Promise<DetectResult> {
    if (this.pending) throw new Error("a frame is already in flight");
    const frame = await createImageBitmap(video);
    return new Promise<DetectResult>((resolve, reject) => {
      this.pending = resolve;
      this.fail = reject;
      this.send({ type: "detect", frame, srcW: video.videoWidth, srcH: video.videoHeight, t }, [frame]);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending = this.fail = null;
  }

  private send(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer);
  }
}
