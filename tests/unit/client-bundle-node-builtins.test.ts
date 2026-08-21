import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NO CLIENT COMPONENT MAY REACH A `node:` BUILTIN.
 *
 * WHY THIS EXISTS. On 2026-08-21 production silently stopped deploying. Three merges
 * went in, three Vercel builds ERRORed, and the live site quietly carried on serving a
 * build from two merges earlier — `/api/coverage` still answering with 14 feeds while
 * `main` held 17. The break:
 *
 *     components/shell/ConsoleShell.tsx   "use client"
 *       → lib/sources/registry.ts
 *         → lib/sources/actpr.ts          (added by #136)
 *           → lib/http/h2.ts              import http2 from "node:http2"
 *
 * `ConsoleShell` imported ONE INTEGER (`CAMERA_FEED_COUNT`) from the adapter registry,
 * which drags every camera adapter into the browser bundle. That was survivable while
 * adapters were fetch-only. The moment one of them imported a Node builtin it became a
 * fatal webpack resolution error — `next.config.ts` strips the `node:` scheme for the
 * client, so `node:http2` becomes `http2`, which is not in `resolve.fallback`.
 *
 * WHY THE REST OF THE SUITE CANNOT SEE IT. Vitest runs in a NODE environment, so
 * `node:http2` resolves perfectly here. `tsc --noEmit` passes too — the types are fine.
 * Only `next build` fails, and its only outward symptom is that production stops
 * updating. 2,445 tests were green through the entire outage. This test is the suite
 * learning to see what it structurally could not.
 *
 * WHY IT IS SHAPED THIS WAY. The rule that holds is "no client component may reach a
 * `node:` builtin", not "nobody may import registry.ts" — the registry is only today's
 * path to one. A string match on `lib/sources/registry` would pass the moment somebody
 * wrote it as a relative path, a re-export or a barrel. So this walks the real import
 * graph and reports the chain, the way webpack does.
 *
 * WHAT IT DOES NOT CATCH, stated rather than implied:
 *   - Imports it cannot see statically: `await import(someVariable)`, `require(expr)`.
 *   - Node builtins imported WITHOUT the `node:` prefix (`import fs from "fs"`). Those
 *     are already stubbed to `false` in `next.config.ts`'s `resolve.fallback`, so they
 *     fail loudly in a different way; the `node:` form is the one that slips past.
 *   - Anything reached through a third-party package. Only first-party files (`@/…`
 *     and relative paths) are followed; `node_modules` is not walked.
 * A guard that quietly checks less than it claims is worse than a narrow one that says
 * so, so the limits are listed here rather than discovered later.
 */

const ROOT = resolve(__dirname, "..", "..");
const SEARCH_DIRS = ["components", "app", "lib"];
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/** Every source file under the directories a bundle can be rooted in. */
function sourceFiles(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (EXTENSIONS.some((e) => p.endsWith(e))) out.push(p);
    }
  };
  walk(abs);
  return out;
}

/**
 * Resolve a first-party specifier to a file on disk. Returns undefined for bare
 * package names — `node_modules` is deliberately not walked.
 */
function resolveSpecifier(spec: string, fromFile: string): string | undefined {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return undefined;

  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const ext of EXTENSIONS) {
      const idx = join(base, "index" + ext);
      if (existsSync(idx)) return idx;
    }
  }
  return existsSync(base) && statSync(base).isFile() ? base : undefined;
}

/** Static `import`/`export from`/dynamic-import specifiers, with comments stripped. */
function specifiersOf(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  const patterns = [
    /(?:^|\s)import\s[^;]*?from\s*["']([^"']+)["']/g,
    /(?:^|\s)import\s*["']([^"']+)["']/g,
    /(?:^|\s)export\s[^;]*?from\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) out.push(m[1]);
  }
  return out;
}

/** The `node:` builtins a file imports directly. */
function nodeBuiltinsOf(source: string): string[] {
  return specifiersOf(source).filter((s) => s.startsWith("node:"));
}

function isClientComponent(file: string): boolean {
  const head = readFileSync(file, "utf8").slice(0, 400);
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(head);
}

/**
 * The chain from `file` to the first `node:` builtin it can reach, or null if clean.
 *
 * MEMOISED, and that is not a micro-optimisation. Forty-odd client entry points share
 * most of their import graph, so the naive walk re-reads the same files once per entry
 * and the test costs ~14s on a 27s suite. A guard that slow is a guard somebody
 * eventually skips. The answer for a file does not depend on who imported it, so it
 * caches cleanly.
 */
const reachCache = new Map<string, { builtins: string[]; chain: string[] } | null>();

function firstBuiltinChain(
  file: string,
  visiting: Set<string>,
): { builtins: string[]; chain: string[] } | null {
  const cached = reachCache.get(file);
  if (cached !== undefined) return cached;
  // A cycle: this branch contributes nothing. Not cached — the answer here is "unknown
  // on this path", not "clean", and caching it would poison the entry that asked.
  if (visiting.has(file)) return null;

  visiting.add(file);
  const source = readFileSync(file, "utf8");

  let result: { builtins: string[]; chain: string[] } | null = null;
  const builtins = nodeBuiltinsOf(source);
  if (builtins.length) {
    result = { builtins, chain: [file] };
  } else {
    for (const spec of specifiersOf(source)) {
      const next = resolveSpecifier(spec, file);
      if (!next) continue;
      const found = firstBuiltinChain(next, visiting);
      if (found) {
        result = { builtins: found.builtins, chain: [file, ...found.chain] };
        break;
      }
    }
  }

  visiting.delete(file);
  reachCache.set(file, result);
  return result;
}

/** An import trace in webpack's shape, or undefined when the graph is clean. */
function findNodeBuiltinReach(entry: string): string | undefined {
  const found = firstBuiltinChain(entry, new Set());
  if (!found) return undefined;
  const trace = found.chain.map((f) => "  " + relative(ROOT, f).replace(/\\/g, "/")).join("\n");
  return `imports ${found.builtins.join(", ")}\nImport trace:\n${trace}`;
}

describe("client bundle", () => {
  const clientEntries = SEARCH_DIRS.flatMap(sourceFiles).filter(isClientComponent);

  it("finds the client components to check", () => {
    // If this drops to zero the walk below is vacuously green, which would be worse
    // than no test at all.
    expect(clientEntries.length).toBeGreaterThan(10);
  });

  it("no client component reaches a node: builtin", () => {
    const offenders: string[] = [];
    for (const entry of clientEntries) {
      const reach = findNodeBuiltinReach(entry);
      if (reach) offenders.push(`${relative(ROOT, entry).replace(/\\/g, "/")} ${reach}`);
    }

    expect(
      offenders.join("\n\n"),
      "A client component reaches a Node builtin. It will be bundled for the browser, " +
        "and `next build` fails with \"Module not found\" — while tsc and the rest of " +
        "this suite stay green and production silently stops deploying. Read the value " +
        "the client actually needs in a SERVER component and pass it down as a prop; " +
        "components/shell/SourceCatalog.tsx is the in-repo precedent.",
    ).toBe("");
  });
});
