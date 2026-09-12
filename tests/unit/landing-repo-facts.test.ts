import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { UNIT_TESTS } from "../../lib/marketing/repo-facts.data";

/**
 * The landing page prints "N unit tests across M files" in its ledger.
 *
 * That is a claim about this repository, on a page whose entire argument is that its
 * numbers are checkable, so it must not be allowed to rot the way an unpinned figure in
 * a README always does. `CLAUDE.md` records the last time this exact class of figure was
 * left unguarded: the row said 1,414 / 215 while the suite had grown past 3,600, and
 * nothing failed for a month.
 *
 * The FILE count is checkable from disk, so it is checked here. The CASE count is not —
 * `describe.each` expands at collection time — so it is pinned TO the file count instead:
 * when someone adds a test file this goes red, and the fix is to re-run `npx vitest list`
 * and update both numbers together.
 */

const UNIT_DIR = resolve(__dirname, "..", "unit");

function testFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...testFilesUnder(full));
    else if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

test("the landing page's unit-test file count matches the files actually on disk", () => {
  const actual = testFilesUnder(UNIT_DIR).length;
  expect(
    actual,
    `The suite has ${actual} unit test files; lib/marketing/repo-facts.data.ts says ${UNIT_TESTS.files}. ` +
      "Re-run `npx vitest list`, then update BOTH files and cases together and move measuredAt.",
  ).toBe(UNIT_TESTS.files);
});

test("the case count is at least the file count, because a test file with no test is a mistake", () => {
  expect(UNIT_TESTS.cases).toBeGreaterThanOrEqual(UNIT_TESTS.files);
});
