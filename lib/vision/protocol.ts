// Messages between the page and the detection worker (detect.worker.ts).

import type { Point } from "./contour";
import type { VehicleKind } from "./vehicles";

export type Backend = "webgpu" | "wasm";

export type ToWorker =
  | { type: "load"; modelUrl: string; ortBase: string }
  | {
      type: "detect";
      frame: ImageBitmap;
      srcW: number;
      srcH: number;
      /** Video time of the frame, handed back untouched. */
      t: number;
    };

export type WireDetection = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  kind: VehicleKind;
  outline: Point[] | null;
};

export type FromWorker =
  | { type: "progress"; loaded: number; total: number | null }
  | { type: "ready"; backend: Backend }
  | {
      type: "result";
      t: number;
      detections: WireDetection[];
      /** Milliseconds spent on the model alone, and on the whole frame. */
      inferMs: number;
      totalMs: number;
      inW: number;
      inH: number;
    }
  | { type: "error"; message: string };
