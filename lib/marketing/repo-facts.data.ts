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
 * Measured 2026-10-04 on feat/visit-days at origin/main 27c5bad, by the run itself:
 * `vitest run` reported 4,322 passed across 403 files. This branch adds 23 cases to two
 * existing files (return-flag, privacy-page), so `files` is main's own count.
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
 *
 * Re-measured 2026-10-11 by `vitest run` on the camera-sphere branch (on main at #276), with
 * the intro's tuned numbers: 4,670 cases across 414 files. The branch adds three files:
 * camera-sphere, sphere-intro and sphere-mark.
 *
 * Re-measured 2026-10-12 on origin/main at f3029a8 (after #277/#278/#279/#280 merged), which is
 * exactly the drift that broke `Deploy production` (run 38143429861): this file still said
 * 412/414 while the merged tree already held 416 files. `npx vitest list` on that tree: 4,715
 * cases across 416 files (`find tests/unit -name '*.test.ts' -o -name '*.test.tsx' | wc -l`
 * agrees independently).
 *
 * Re-measured 2026-10-14 on origin/main at e9da759 (after #281/#282 merged): #282 added
 * `tests/unit/signal-dossier-props.test.ts`, so this constant went stale again the same way.
 * `npx vitest list` on that tree: 4,719 cases across 417 files (`find tests/unit -name
 * '*.test.ts' -o -name '*.test.tsx' | wc -l` agrees independently).
 *
 * Re-measured 2026-10-15 on feat/accounts-m1: it adds `tests/unit/account-config.test.ts`
 * and `tests/unit/account-sync-keys.test.ts`.
 * `npx vitest list`: 4,731 cases across 419 files.
 *
 * Re-measured 2026-10-16 on feat/accounts-m2: it adds `tests/unit/account-username.test.ts`
 * and `tests/unit/account-errors.test.ts`; Task 6 adds `tests/unit/account-import-guard.test.ts`;
 * the design pass adds `tests/unit/account-reopen-flag.test.ts`.
 * `npx vitest run`: 4,753 cases across 423 files.
 *
 * Re-measured 2026-10-16 on fix/cables-hidden-p1 (origin/main at 7ed4085, after #286): it adds
 * `tests/unit/map-signal-poll.test.ts` (16 cases). `npx vitest run`: 4,780 cases across 424 files.
 *
 * Re-measured 2026-10-16 on feat/source-relay (origin/main at 20a070c, after #287/#288/#289):
 * the relay adds its route, protocol, store, reader and CelesTrak-fallback tests.
 * `npx vitest run`: 4,879 cases across 432 files.
 *
 * Re-measured 2026-10-16 on feat/sources-news (stacked on feat/source-relay at 3dc9d3d): it
 * adds `tests/unit/news-feed.test.ts` and `tests/unit/news-feeds.test.ts`. `npx vitest run`:
 * 4,905 cases across 434 files (`find tests/unit -name *.test.ts -o -name *.test.tsx | wc -l`
 * agrees).
 *
 * Re-measured 2026-10-17 on feat/sources-all (origin/main at 4ce2da5, after #290/#291/#292): the
 * ten remaining source groups land together. `npx vitest run`: 5,437 cases across 464 files.
 *
 * Re-measured 2026-10-17 on fix/remove-feedless-sources (origin/main at 54a92b6, after #293):
 * removing cyber-c2, news-coverage and utinform-hu deletes
 * `tests/unit/signals-news-coverage.test.ts` and the Feodo and Utinform cases, and adds the
 * retired-id cases. `npx vitest run`: 5,399 cases across 463 files (`find tests/unit -name
 * *.test.ts -o -name *.test.tsx | wc -l` agrees).
 *
 * Re-measured 2026-10-18 on fix/instability-acled-attribution (origin/main at 877c243, after
 * #294): adds `tests/unit/instability-attribution.test.ts` (2 cases). `npx vitest list`: 5,401
 * cases across 464 files (`find tests/unit -name *.test.ts -o -name *.test.tsx | wc -l` agrees).
 */
export const UNIT_TESTS = {
  cases: 5401,
  files: 464,
  measuredAt: "2026-10-18",
} as const;
