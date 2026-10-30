/// <reference lib="webworker" />
// The detection worker: video frame in, vehicles with outlines out.
//
// Everything heavy happens here so the page never drops a frame for it: resizing
// the frame into the model's input, the model itself, and the mask outlines.
//
// ONNX Runtime is NOT bundled. It is imported at run time from /ort/, where
// scripts/copy-ort.mjs puts the files of the exact installed version (predev and
// prebuild). Webpack cannot be trusted with ORT's own `new URL(..., import.meta.url)`
// wasm loader, and bundling it would put ~0.4 MB of runtime into a chunk for a
// feature most visitors never switch on.
//
// WebGPU first, WASM when the browser has no adapter. The WebGPU build is ~5 MB
// compressed and runs a 1280-wide frame in tens of milliseconds on a laptop GPU;
// the plain WASM build is ~3 MB and runs a 640-wide frame in a few hundred, single
// threaded (threads need cross-origin isolation, which this site does not set
// because it would break every third-party tile and image it shows).

import type * as Ort from "onnxruntime-web";
import { letterbox, PAD_GREY } from "./letterbox";
import { decodeYoloSeg } from "./decode";
import { maskOutline } from "./contour";
import type { Backend, FromWorker, ToWorker, WireDetection } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

/** Longest input side tried per backend, and the steps down when frames take too long. */
const SIDES: Record<Backend, number[]> = { webgpu: [1280, 960, 640], wasm: [640, 480] };
/**
 * Over this many ms per frame, the next smaller input is used. Generous on purpose:
 * on Caltrans CCTV 178 a 1280-wide input finds ~50 vehicles a frame and a 640-wide
 * one ~27 (measured 2026-10-30), and the tracker predicts every vehicle between
 * detections, so four detections a second at full width beat twelve at half.
 */
const BUDGET_MS: Record<Backend, number> = { webgpu: 260, wasm: 900 };

let ort: typeof Ort | null = null;
let session: Ort.InferenceSession | null = null;
let backend: Backend = "wasm";
let sideIndex = 0;
let avgMs = 0;
let runs = 0;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

const post = (m: FromWorker) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") await load(msg.modelUrl, msg.ortBase);
    else if (msg.type === "detect") await detect(msg.frame, msg.srcW, msg.srcH, msg.t);
  } catch (err) {
    if (msg.type === "detect") msg.frame.close();
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

async function load(modelUrl: string, ortBase: string): Promise<void> {
  const model = await download(modelUrl);
  const adapter = await gpuAdapter();
  if (adapter) {
    try {
      ort = await importOrt(ortBase, "ort.webgpu.min.mjs");
      ort.env.webgpu.adapter = adapter as never;
      session = await ort.InferenceSession.create(model, {
        executionProviders: [{ name: "webgpu", preferredLayout: LAYOUT }],
      });
      backend = "webgpu";
    } catch {
      session = null; // An adapter that cannot run the graph: fall through to WASM.
    }
  }
  if (!session) {
    ort = await importOrt(ortBase, "ort.wasm.min.mjs");
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    backend = "wasm";
  }
  post({ type: "ready", backend });
}

async function importOrt(base: string, file: string): Promise<typeof Ort> {
  const mod = (await import(/* webpackIgnore: true */ `${base}${file}`)) as typeof Ort & { default?: typeof Ort };
  const o = mod.InferenceSession ? mod : mod.default!;
  o.env.wasm.wasmPaths = base;
  return o;
}

/** ORT's WebGPU kernels for convolutions are written for channels-last. */
const LAYOUT = "NHWC";

/**
 * Ask for the HIGH-PERFORMANCE adapter: a laptop has two GPUs and the integrated one
 * is the default. Chrome on Windows may still answer with whichever GPU Windows has
 * given the browser (measured 2026-10-30 on a laptop with an RTX 4050: the same
 * ~210 ms a 1280-wide frame either way), so this is a request, not a guarantee.
 */
async function gpuAdapter(): Promise<unknown | null> {
  type Gpu = { requestAdapter(o?: { powerPreference?: string }): Promise<{ info?: Record<string, string> } | null> };
  const gpu = (navigator as unknown as { gpu?: Gpu }).gpu;
  if (!gpu) return null;
  try {
    const a = (await gpu.requestAdapter({ powerPreference: "high-performance" })) ?? (await gpu.requestAdapter());
    return a;
  } catch {
    return null;
  }
}

/** The model, with progress, because it is the slow part of switching tracking on. */
async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model ${res.status}`);
  const total = Number(res.headers.get("content-length")) || null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (loaded - lastPost > 512 * 1024) {
      lastPost = loaded;
      post({ type: "progress", loaded, total });
    }
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  post({ type: "progress", loaded, total: total ?? loaded });
  return bytes;
}

async function detect(frame: ImageBitmap, srcW: number, srcH: number, t: number): Promise<void> {
  if (!ort || !session) {
    frame.close();
    throw new Error("detector not loaded");
  }
  const started = performance.now();
  const lb = letterbox(srcW, srcH, SIDES[backend][sideIndex]);

  if (!canvas || canvas.width !== lb.inW || canvas.height !== lb.inH) {
    canvas = new OffscreenCanvas(lb.inW, lb.inH);
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!ctx) throw new Error("no 2d context in worker");
  ctx.fillStyle = `rgb(${PAD_GREY},${PAD_GREY},${PAD_GREY})`;
  ctx.fillRect(0, 0, lb.inW, lb.inH);
  ctx.drawImage(frame, lb.padX, lb.padY, lb.drawW, lb.drawH);
  frame.close();
  const rgba = ctx.getImageData(0, 0, lb.inW, lb.inH).data;
  const plane = lb.inW * lb.inH;
  const input = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    input[i] = rgba[p] / 255;
    input[plane + i] = rgba[p + 1] / 255;
    input[2 * plane + i] = rgba[p + 2] / 255;
  }

  const inferStart = performance.now();
  const tensor = new ort.Tensor("float32", input, [1, 3, lb.inH, lb.inW]);
  const out = await session.run({ [session.inputNames[0]]: tensor });
  const inferMs = performance.now() - inferStart;
  const boxes = out[session.outputNames[0]];
  const masks = out[session.outputNames[1]];
  const anchors = boxes.dims[2];
  const [, , protoH, protoW] = masks.dims;
  const protos = masks.data as Float32Array;

  const detections: WireDetection[] = decodeYoloSeg(boxes.data as Float32Array, anchors, lb, srcW, srcH).map(
    (d) => ({
      x1: d.x1,
      y1: d.y1,
      x2: d.x2,
      y2: d.y2,
      score: d.score,
      kind: d.kind,
      outline: maskOutline(protos, protoW, protoH, d.coeffs, d.inBox, lb),
    }),
  );
  tensor.dispose();
  boxes.dispose();
  masks.dispose();

  const totalMs = performance.now() - started;
  adapt(totalMs);
  post({ type: "result", t, detections, inferMs, totalMs, inW: lb.inW, inH: lb.inH });
}

/**
 * Step the input down when frames take too long. The first runs at a new size are
 * skipped: WebGPU compiles its shaders on them and they say nothing about the rest.
 */
function adapt(ms: number): void {
  runs++;
  if (runs <= 2) return;
  avgMs = runs === 3 ? ms : avgMs * 0.8 + ms * 0.2;
  if (runs > 6 && avgMs > BUDGET_MS[backend] && sideIndex < SIDES[backend].length - 1) {
    sideIndex++;
    runs = 0;
  }
}
