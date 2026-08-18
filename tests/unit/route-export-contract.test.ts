import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, test } from "vitest";

/**
 * A Next.js route or page module may export ONLY the names Next recognises. Anything
 * else is a hard build failure:
 *
 *     Type error: Route "app/api/webcams/route.ts" does not match the required types
 *     of a Next.js Route. "webcamsBody" is not a valid Route export field.
 *
 * WHY THIS TEST EXISTS RATHER THAN A CODE REVIEW NOTE. The house gate is
 * `npx tsc --noEmit && npm test`, and BOTH PASS on a file that breaks this rule. The
 * route-export contract is checked only inside `next build`, during "Linting and
 * checking validity of types", after tsc has already been satisfied. So the failure
 * mode is: green locally, green in the suite, dead on deploy - and it reached `main`
 * exactly once that way, in the commit this test was added to fix.
 *
 * It is a tempting mistake because the motive is good. You write a helper in a route
 * file, you want a unit test for it, so you export it. The fix is always the same:
 * move the helper to `lib/` and have the route import it. That is better anyway - the
 * helper becomes testable without pulling a route module into the test.
 *
 * The allowed list is Next's, not ours. If a future Next version adds a segment
 * option, add it here with a link, do not widen the check.
 */
const ALLOWED = new Set([
  // HTTP verbs a route handler may implement
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
  // route segment config
  "dynamic", "dynamicParams", "revalidate", "fetchCache", "runtime",
  "preferredRegion", "maxDuration", "experimental_ppr",
  // page/layout conventions
  "default", "metadata", "generateMetadata", "generateStaticParams",
  "generateViewport", "viewport", "generateImageMetadata", "alt", "size",
  "contentType", "config",
]);

const APP = resolve(process.cwd(), "app");
const MODULE_NAMES = /^(route|page|layout|template|default|error|loading|not-found|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(ts|tsx|js|jsx)$/;

function routeModules(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) routeModules(full, found);
    else if (MODULE_NAMES.test(entry.name)) found.push(full);
  }
  return found;
}

/**
 * Exported binding names, read off the source.
 *
 * Deliberately a parse of the text rather than an import: importing every route module
 * would execute them, and several reach for adapters and environment at module scope.
 * `export type` and `export interface` are skipped - they are erased at compile time
 * and Next never sees them.
 */
function exportedNames(source: string): string[] {
  const names: string[] = [];
  const decl = /^export\s+(?!type\b|interface\b)(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of source.matchAll(decl)) names.push(m[1]);
  if (/^export\s+default\b/m.test(source)) names.push("default");
  // `export { a, b as c }` - the exported (right-hand) name is the one Next reads.
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const piece = part.trim();
      if (!piece || piece.startsWith("type ")) continue;
      names.push((piece.split(/\s+as\s+/).pop() ?? piece).trim());
    }
  }
  return names;
}

const MODULES = routeModules(APP).map((f) => relative(process.cwd(), f).replace(/\\/g, "/"));

test("there are route modules to check", () => {
  // A silent zero here would make every case below vacuously pass.
  expect(MODULES.length).toBeGreaterThan(30);
});

test.each(MODULES)("%s exports only fields Next.js recognises", (file) => {
  const offenders = exportedNames(readFileSync(file, "utf8")).filter((n) => !ALLOWED.has(n));

  // Named so the failure tells you what to move and where, rather than just going red.
  expect(
    offenders,
    `${file} exports ${offenders.join(", ")}, which Next rejects at build time. ` +
      "Move the helper into lib/ and import it from the route.",
  ).toEqual([]);
});
