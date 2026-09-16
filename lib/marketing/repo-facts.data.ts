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
 * origin/main at f3771d0, which is the tree that ships. Four changes have met here
 * across the day: the news board (#249), the inspector rail (#250, which split
 * map-rail.test.ts into inspector-rail.test.ts and view-controls.test.ts), the area
 * colour picker (#252, which added area-colors.test.ts) and this branch, which added
 * news-rdf-feed.test.ts.
 *
 * WATCH THE FILE COUNT ACROSS A MERGE, BECAUSE GIT WILL NOT. This line has now been
 * wrong twice in one day for the same reason: two branches each add one test file, both
 * write the same new total, the text is identical on both sides, and git merges it
 * silently while the merged tree holds one more. Only `cases` differed, so only `cases`
 * conflicted — which is the only reason anyone looked at `files` at all. After ANY merge
 * that touches this file, re-measure both numbers on the merged tree. The guard catches
 * a `files` that is stale against disk, but nothing catches a `cases` that is merely
 * out of date, and nothing catches a number two branches agreed on and both got wrong.
 */
export const UNIT_TESTS = {
  cases: 4049,
  files: 391,
  measuredAt: "2026-09-16",
} as const;
