/**
 * Lets a plain `node` run import repo modules by their `@/` alias.
 *
 * Node 24 executes TypeScript directly, so a script can import lib/ modules and be
 * tested by the same vitest as everything else — no build step, no tsx dependency. The
 * one thing Node does not know is the `@/` path alias that tsconfig and vitest both
 * resolve, and rewriting lib/liveness to relative imports to work around that would
 * make one folder disagree with the rest of the repo about how imports are written.
 *
 * Usage:  node --import ./scripts/ts-alias-hook.mjs scripts/whatever.mts
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "..") + "/");

// tsconfig-style imports are extensionless, and Node ESM is not. Both orders matter:
// .ts before .js so a stale build artefact never shadows the source, and /index last
// so a directory only wins when no file of that name exists.
const CANDIDATES = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const bare = new URL(specifier.slice(2), repoRoot);
    for (const ext of CANDIDATES) {
      const candidate = new URL(bare.href + ext);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(bare.href, context);
  },
});
