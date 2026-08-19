import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The curation tools have no password, no session and no rate limit. What they have is
 * a production 404 on every route, and that is the entire security model — so this
 * file is the thing that keeps it true.
 *
 * The failure it exists to catch is not someone deleting a guard. It is someone adding
 * a ROUTE and not thinking about the guard at all, six months from now, in a hurry.
 * That is why the test enumerates the directory rather than checking a list: a list
 * would pass forever while the directory grew around it.
 *
 * Proven by injection rather than by reading: adding an unguarded
 * `app/api/admin/x/route.ts` to a scratch tree fails this suite with that path named
 * in the message. Deleting the guard from an existing route fails it too. Both were
 * run before this test was committed — a guard nobody has watched go red is
 * decoration.
 */

const ROOT = process.cwd();

/** Block and line comments out, so a file that DESCRIBES a pattern does not match it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every route/page/layout file under a directory, recursively. */
function routeFiles(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/^(route|page|layout)\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(abs);
  return out;
}

/**
 * What counts as guarded.
 *
 * Both forms are accepted because they are the right tool in different places: a page
 * or layout can call `notFound()` and get Next's own 404 rendering, while an API route
 * has no such affordance and returns the status itself. What is NOT accepted is a
 * check against anything other than NODE_ENV — `VERCEL_ENV` is unset on a self-hosted
 * deployment and a check against it would silently pass everything through.
 */
const GUARDS = [
  /process\.env\.NODE_ENV === "production"[\s\S]{0,120}?notFound\(\)/,
  /process\.env\.NODE_ENV === "production"[\s\S]{0,160}?status: 404/,
  /assertDevOnly\(\)/,
];

describe("the /admin production gate", () => {
  const files = [...routeFiles("app/admin"), ...routeFiles("app/api/admin")];

  it("finds the curation routes at all, so an empty scan cannot pass vacuously", () => {
    // Without this, deleting app/admin entirely would turn the test below into a
    // green assertion about nothing — the classic way a directory-walking guard
    // stops guarding.
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it("gives every route a production 404", () => {
    const unguarded = files
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return !GUARDS.some((g) => g.test(src));
      })
      .map((f) => f.replace(ROOT, "").replace(/\\/g, "/"));
    expect(
      unguarded,
      "these curation routes would be reachable in production: " + unguarded.join(", "),
    ).toEqual([]);
  });

  it("keeps the review tool out of the crawler's way as well", () => {
    const layout = readFileSync(join(ROOT, "app", "admin", "layout.tsx"), "utf8");
    expect(layout).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});

describe("the curation data files", () => {
  it("ships an ADMITTED_FEEDS list that only the promote step writes", () => {
    // discovered.data.ts is generated. If someone hand-edits a feed into it, the next
    // promotion silently reverts them, so the file has to say that in the file.
    const src = readFileSync(join(ROOT, "lib", "sources", "discovered.data.ts"), "utf8");
    expect(src).toContain("ADMITTED_FEEDS");
    expect(src.toLowerCase()).toMatch(/generated|ledger/);
  });

  it("keeps node:fs out of everything except the curation tooling", () => {
    // The /privacy page tells readers the deployed application writes no files, and
    // that sentence is only checkable if the exception is exactly one directory. This
    // is the check the page's claim points at.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      const abs = join(ROOT, dir);
      if (!existsSync(abs)) return;
      for (const name of readdirSync(abs)) {
        const rel = dir + "/" + name;
        if (statSync(join(ROOT, rel)).isDirectory()) {
          walk(rel);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        // Comments are stripped first. Without that the /privacy page reports itself,
        // because it documents the very grep this test performs — and a guard that
        // fires on prose is a guard people learn to route around.
        const src = stripComments(readFileSync(join(ROOT, rel), "utf8"));
        if (/from "node:fs"|require\("node:fs"\)|writeFileSync|appendFileSync/.test(src)) {
          offenders.push(rel);
        }
      }
    };
    walk("app");
    walk("lib");
    walk("components");
    const allowed = new Set(["lib/discovery/store.ts", "app/api/admin/promote/route.ts"]);
    const unexpected = offenders.filter((f) => !allowed.has(f));
    expect(
      unexpected,
      "these files write to disk outside the dev-only curation tooling, which makes the /privacy page's 'writes no files' sentence false: " +
        unexpected.join(", "),
    ).toEqual([]);
  });
});
