#!/usr/bin/env bash
# scripts/pull-rollups.sh
#
# Copy the production access-log rollups down, so /admin/analytics can be read on a
# laptop.
#
# WHY THIS IS A SCRIPT AND NOT A NOTE. Two facts combine into something nobody
# remembers a week later. `/admin` returns 404 whenever NODE_ENV is production
# (`lib/discovery/devOnly.ts`), so the dashboard cannot be opened on the box that holds
# its data; and `/srv/provenance/shared` is mode 750 `app:app`, so an ordinary ssh login
# cannot read the rollups even though the `app` user can. Getting either half wrong
# produces a page reading "the rollup directory exists but holds no days yet" — which is
# indistinguishable from the rollup timer having silently stopped. That false alarm is
# the whole reason this exists.
#
# It copies. It never writes to the box, and it never deletes anything there.

set -euo pipefail

HOST="${ROLLUP_HOST:-provenance}"
REMOTE_PARENT="/srv/provenance/shared"
DEST="${1:-${ROLLUP_DEST:-$HOME/provenance-rollups}}"

# Extract beside the destination and swap at the end. A pull that dies halfway would
# otherwise leave a truncated state.json in place, and the page would report that as
# "no days yet" — the same misleading empty state this script exists to avoid.
INCOMING="$DEST.incoming.$$"
trap 'rm -rf "$INCOMING"' EXIT

echo "pull-rollups: $HOST:$REMOTE_PARENT/analytics -> $DEST"
mkdir -p "$INCOMING"

# sudo, because the parent directory does not admit the login user. tar over a pipe
# rather than scp -r, because the tree is small and this needs exactly one sudo.
ssh "$HOST" "sudo tar -C $REMOTE_PARENT -cf - analytics" | tar -C "$INCOMING" -xf -

state="$INCOMING/analytics/state.json"
if [[ ! -f "$state" ]]; then
  echo "pull-rollups: FAILED — no state.json arrived. Has the timer ever run?" >&2
  echo "  check: ssh $HOST 'systemctl status provenance-rollup.service'" >&2
  exit 1
fi

# Parse it here rather than letting the page fail soft. readRollups() treats unparseable
# JSON as absent, on purpose, so a truncated copy reaches the screen as an empty
# dashboard and not as an error.
if command -v node >/dev/null 2>&1; then
  node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$state" ||
    { echo "pull-rollups: FAILED — state.json did not parse, so the copy is truncated." >&2; exit 1; }
fi

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$INCOMING" "$DEST"
trap - EXIT

finalised="$(find "$DEST/analytics/days" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
echo "pull-rollups: ok — $finalised finalised day(s) plus whatever is open in state.json"
echo "              (days/ stays empty for the first 36 h; FINALISE_LAG_MS in scripts/lib/rollup-store.mts)"
echo

# Node on Windows cannot resolve a Git Bash path like /c/Users/..., and the failure is
# silent: existsSync returns false and the page reports the directory as missing. Print
# the form the runtime actually accepts.
abs="$DEST/analytics"
if command -v cygpath >/dev/null 2>&1; then
  abs="$(cygpath -m "$DEST/analytics")"
fi

echo "Now run the dev server against them — /admin only exists outside production:"
echo
echo "  ANALYTICS_ROLLUP_DIR=\"$abs\" npx next dev -p 3007"
echo
echo "then open http://127.0.0.1:3007/admin/analytics"
