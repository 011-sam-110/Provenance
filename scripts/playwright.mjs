// Resolve Playwright from the worktree the script is being run in.
//
// WHY THIS EXISTS. A worktree gets its node_modules as a junction rather than an
// `npm install` of its own, so a bare `import "playwright"` can miss depending on
// where the process was started. The profilers below it were written with an
// absolute path to one checkout on one machine, which worked for an evening and
// would have been a puzzle for anyone else.
//
// Node ESM on Windows needs a file:// URL for an absolute path import, and these
// packages are CJS, so the namespace lands under `.default` when interop kicks in.
// scripts/profile-map.mjs carries its own copy of this, inline and chromium-only;
// it predates this file and is left alone rather than churned.

import path from "node:path";
import { pathToFileURL } from "node:url";

// `playwright` first: `playwright-core` has no `devices` table, and idleprof needs it.
const CANDIDATES = [
  "node_modules/playwright/index.js",
  "node_modules/playwright-core/index.js",
  "node_modules/@playwright/test/index.js",
];

/** The playwright namespace ({ chromium, devices, … }). Throws if none resolves. */
export async function loadPlaywright() {
  for (const rel of CANDIDATES) {
    try {
      const mod = await import(pathToFileURL(path.resolve(rel)).href);
      const ns = mod.chromium ? mod : mod.default;
      if (ns?.chromium) return ns;
    } catch {
      /* try the next one */
    }
  }
  throw new Error(`playwright not resolvable from ${process.cwd()} — run from the worktree root`);
}
