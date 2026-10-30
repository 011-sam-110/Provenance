// Copy ONNX Runtime Web's browser files into public/ort/, where the vehicle
// tracker's worker imports them at run time (lib/vision/detect.worker.ts).
//
// Run by `predev` and `prebuild`, so the files always match the installed version.
// They are NOT committed (public/ort/ is in .gitignore): the WebGPU wasm alone is
// 28 MB, and a copy in git would drift from package.json the first time someone
// bumps the dependency.

import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// The package exports no package.json, so find dist/ through its main entry.
const dist = dirname(require.resolve("onnxruntime-web"));
const out = join(process.cwd(), "public", "ort");

// Two builds: WebGPU (with its own CPU fallback) and plain WASM for browsers with
// no WebGPU adapter. Each is an entry module plus the wasm and its loader.
const FILES = [
  "ort.webgpu.min.mjs",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort.wasm.min.mjs",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];

mkdirSync(out, { recursive: true });
for (const f of FILES) {
  const from = join(dist, f);
  if (!existsSync(from)) {
    console.error(`copy-ort: ${f} is missing from onnxruntime-web/dist; the vehicle tracker will not load.`);
    process.exit(1);
  }
  copyFileSync(from, join(out, f));
}
console.log(`copy-ort: ${FILES.length} files -> public/ort/`);
