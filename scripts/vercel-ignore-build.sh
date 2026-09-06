#!/usr/bin/env bash
#
# Vercel "Ignored Build Step". Wired up by `ignoreCommand` in vercel.json.
#
#   exit 0  ->  SKIP this build
#   exit 1  ->  RUN this build
#
# WHY. 200+ deployments in the 23 Aug - 6 Sep cycle burned 14 hours of build CPU
# ($3.09, 13.5% of the infra bill). Preview builds are a genuinely useful review
# surface and are worth keeping -- but a commit that only edits a doc, a test or a
# screenshot cannot change what `next build` emits, and paying four minutes of CPU
# to rebuild it byte-for-byte buys nothing.
#
# FAIL-SAFE BY CONSTRUCTION, and this is the whole design. A wrong answer in the
# SKIP direction is silent: production keeps serving the old build and nothing
# anywhere says the deploy did not happen. So this script does not try to list the
# paths that matter. It lists the paths that provably CANNOT matter, and skips only
# when every changed file is one of them. A new top-level directory, a new config
# file, an unfamiliar path -- all of them fall through to "build".
#
# It also builds whenever it cannot see the history it needs to decide, which on a
# shallow clone is a real case rather than a theoretical one.

set -u

# A change confined to these cannot alter the output of `next build`:
#   docs/, *.md, LICENSE   documentation
#   tests/                 vitest suite -- `npm run build` is `next build`, no tests
#   persona-shots/         Playwright UI evidence, committed as review artefacts
#   .github/               CI config, not shipped
#   *.config.ts for test runners only (playwright, vitest -- NOT next.config.ts)
IGNORABLE='^(docs/|tests/|persona-shots/|launch-shots/|\.github/|scratchpad/)|(^|/)[^/]*\.md$|^LICENSE$|^\.gitignore$|^(playwright|playwright\.preview|vitest)\.config\.ts$'

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -z "$base" ] && base="HEAD^"

if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "ignore-build: base '${base}' is not in this clone - building."
  exit 1
fi

changed="$(git diff --name-only "$base" HEAD 2>/dev/null)"
if [ $? -ne 0 ]; then
  echo "ignore-build: could not diff against '${base}' - building."
  exit 1
fi

if [ -z "$changed" ]; then
  # No diff at all is not "nothing to do" -- it usually means the base is wrong, or
  # this is a redeploy of the same tree. Neither is a safe reason to skip.
  echo "ignore-build: no diff against '${base}' - building."
  exit 1
fi

relevant=0
while IFS= read -r file; do
  [ -z "$file" ] && continue
  if ! echo "$file" | grep -Eq "$IGNORABLE"; then
    echo "ignore-build: '${file}' can affect the build."
    relevant=1
    break
  fi
done <<EOF
$changed
EOF

if [ "$relevant" -eq 0 ]; then
  echo "ignore-build: every change since ${base} is documentation, tests or screenshots - skipping."
  exit 0
fi

echo "ignore-build: building."
exit 1
