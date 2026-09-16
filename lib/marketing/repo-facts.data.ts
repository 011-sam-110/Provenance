/**
 * The figures the landing page states about this repository.
 *
 * Only ONE of these can go stale without something failing, and it is guarded:
 * `tests/unit/landing-repo-facts.test.ts` counts the test files on disk and fails if
 * `files` no longer matches. When it fails, re-run `npx vitest list` and update both
 * numbers together — the failure is telling you the suite has moved, not that the test
 * is wrong.
 *
 * Counting the CASES cannot be done from the filesystem: a `describe.each` or a
 * `test.for` expands at collection time, so a regex over the source would undercount and
 * a guess would be a made-up number on a page whose argument is that its numbers are
 * checkable. So the case count is measured, dated, and pinned to the file count that CAN
 * be checked cheaply.
 *
 * Measured 2026-09-16 with `npx vitest list` on feat/area-colours after merging
 * feat/inspector-tool-rail (which had itself merged origin/main at 184218a). Three
 * changes met here: the news board (#249) added its own cases and one test file
 * (signals-news-coverage.test.ts); the inspector-rail branch split
 * tests/unit/map-rail.test.ts into inspector-rail.test.ts and view-controls.test.ts when
 * the stage rail was retired — one file became two; and the area-colour feature added
 * tests/unit/area-colors.test.ts. The file count is 390; the case count below is
 * measured over the merged tree, which is the tree that ships.
 */
export const UNIT_TESTS = {
  cases: 4044,
  files: 390,
  measuredAt: "2026-09-16",
} as const;
