import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the one import pattern that has actually put this suite red.
 *
 * THE DEFECT. `await import("...")` inside a test BODY makes vitest charge the whole
 * module-graph load to that test's `testTimeout`. The same import at the top of the file
 * is charged to `collect`, which is not on the budget. Same modules, same work — only the
 * accounting moves. Two tests in inspector-routing.test.ts spent ~1.8s of a 5s budget
 * doing nothing but importing; hoisting took them to 25ms.
 *
 * WHY IT WAS HARD TO SEE. It fails by machine LOAD, not by code, so every author blames
 * their own diff. Three agents did exactly that in one afternoon before one of them
 * reproduced both failures on a branch whose registry was byte-identical to main.
 *
 * WHY THIS IS NOT A TIMEOUT ASSERTION. A tighter timeout was tried first and does not
 * work. With the hoist reverted, a 2s timeout PASSED at 1,345ms — green on the exact
 * regression it existed to catch. The same import measured ~1.3s idle, ~2.6s busy, and
 * over 5,021ms on a box also running a dev server and a Playwright gate. Correct-fast and
 * broken-slow are one distribution three orders wide, so no threshold separates them. A
 * runtime check is no better: it has to execute the import to observe it, inheriting the
 * timing it is trying to escape. Structural, on the source, is the only stable form.
 *
 * WHY IT IS SCOPED TO THESE MODULES AND NOT TO EVERY DYNAMIC IMPORT. ~37 other in-body
 * `await import(...)` calls exist across 8 test files, and banning all of them was the
 * first instinct. Measured before acting: their slowest test is 534ms, because they pull
 * console stores rather than the signal registry. Condemning 37 working call sites to
 * prevent a half-second is not a trade worth making, and a guard that has to be argued
 * with gets deleted. The registry graph is the one that is expensive, so it is the one
 * that is guarded — with room to add a module here the day another proves costly.
 */

/** Prefixes whose graphs pull the signal registry — the expensive one. */
const HEAVY = ["@/lib/signals", "@/lib/variants", "@/lib/layers"];

const TEST_DIR = join(process.cwd(), "tests", "unit");

function offendersIn(file: string): string[] {
  const source = readFileSync(join(TEST_DIR, file), "utf8");
  const found: string[] = [];
  source.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    // Prose about the pattern is not the pattern. This very file, and the explanatory
    // comment in inspector-routing.test.ts, both describe it in words on purpose.
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) return;
    const m = /await\s+import\(\s*["'`]([^"'`]+)["'`]/.exec(line);
    if (m && HEAVY.some((h) => m[1] === h || m[1].startsWith(`${h}/`))) {
      found.push(`${file}:${i + 1} imports ${m[1]}`);
    }
  });
  return found;
}

describe("the signal registry is never loaded inside a test body", () => {
  test("no test file dynamically imports a registry-backed module", () => {
    const files = readdirSync(TEST_DIR).filter((f) => f.endsWith(".test.ts"));
    // A guard that silently stops reading files passes forever. Pin that it found the suite.
    expect(files.length).toBeGreaterThan(50);
    expect(files.flatMap(offendersIn)).toEqual([]);
  });
});
