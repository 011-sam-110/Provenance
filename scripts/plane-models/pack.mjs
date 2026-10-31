// Packs what build.py wrote (scripts/plane-models/.raw/*.glb) into public/models/planes/ with the
// boats' gltfpack settings: meshopt compression, node names kept. Not in the gate.
//
//   node scripts/plane-models/pack.mjs
//
// GLTFPACK may name an installed cli.js, so 75 files do not start npx 75 times.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, ".raw");
const OUT = join(HERE, "../../public/models/planes");
mkdirSync(OUT, { recursive: true });

const pack = (input, output) => {
  const args = ["-cc", "-kn", "-i", input, "-o", output];
  if (process.env.GLTFPACK) execFileSync(process.execPath, [process.env.GLTFPACK, ...args], { stdio: "pipe" });
  else execFileSync("npx", ["gltfpack@1.3.0", ...args], { stdio: "pipe", shell: true });
};

let total = 0;
let largest = 0;
const files = readdirSync(RAW).filter((f) => f.endsWith(".glb"));
for (const f of files) {
  pack(join(RAW, f), join(OUT, f));
  const size = statSync(join(OUT, f)).size;
  total += size;
  largest = Math.max(largest, size);
}
console.log(`${files.length} files, ${total} bytes in all, the largest ${largest}`);
