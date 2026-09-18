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
 * Measured 2026-09-16 with `npx vitest list` on origin/main at c7d091b.
 *
 * THIS LINE STOPPED SIX MERGES FROM REACHING PRODUCTION, and the reason is worth more
 * than the number. The gate (`npx tsc --noEmit && npm test`) ran ONLY in deploy.yml, on
 * push to main. Pull requests ran CodeQL and nothing else. So a PR that added a test
 * file was green, merged clean, and then failed the gate on main — where the failure
 * does not block the PR that caused it, it blocks DEPLOYMENT of everything already
 * merged. #253 and #254 each added test files, this constant went stale, and prod sat
 * on #251 while five later merges piled up behind a red deploy.
 *
 * The gate now runs on pull requests too, so this constant goes red on the branch that
 * moves it, which is the only place anyone can fix it cheaply.
 *
 * WATCH THE FILE COUNT ACROSS A MERGE, BECAUSE GIT WILL NOT. It was wrong twice in one
 * day before that: two branches each add one test file, both write the same new total,
 * the text is identical on both sides, so git merges it silently while the merged tree
 * holds one more. Only `cases` differs, so only `cases` conflicts — which is the only
 * reason anyone looks at `files` at all. After ANY merge that touches this file,
 * re-measure both numbers on the merged tree.
 */
export const UNIT_TESTS = {
  cases: 4222,
  files: 400,
  measuredAt: "2026-09-18",
} as const;
