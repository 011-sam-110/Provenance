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
 * Measured 2026-09-16 with `npx vitest list` on feat/news-depth after merging
 * origin/main at 05487bf.
 *
 * WATCH THE FILE COUNT ACROSS A MERGE, BECAUSE GIT WILL NOT. Two branches arrived at
 * `files: 389` from 388 by adding a different file each — the inspector rail (#250)
 * split map-rail.test.ts into inspector-rail.test.ts and view-controls.test.ts, and
 * this branch added news-rdf-feed.test.ts. Identical text on both sides, so the line
 * merged cleanly and silently, and the merged tree holds 390. Only `cases` conflicted,
 * which is the only reason anyone looked. Re-measure after a merge even when nothing
 * asked you to: the guard catches a stale `files`, but it cannot catch a stale
 * `cases`, and neither can catch a number that two branches agreed on and both got
 * wrong.
 */
export const UNIT_TESTS = {
  cases: 4034,
  files: 390,
  measuredAt: "2026-09-16",
} as const;
