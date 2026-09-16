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
 * Measured 2026-09-16 with `npx vitest list`, rebased onto main at 6d3d1b1. Two
 * changes met here: the news route (#248) added its own cases, and this branch split
 * tests/unit/map-rail.test.ts into inspector-rail.test.ts and view-controls.test.ts
 * when the stage rail was retired — one file became two, which is the whole of the
 * move from 387 to 388.
 */
export const UNIT_TESTS = {
  cases: 3988,
  files: 388,
  measuredAt: "2026-09-16",
} as const;
