#!/usr/bin/env bash
# Install the access-log rollup job on the box. Run from a checkout, as a sudoer:
#
#   scp -r deploy scripts lib ubuntu@<box>:/tmp/prov-rollup/ && \
#     ssh ubuntu@<box> 'cd /tmp/prov-rollup && sudo bash deploy/install-rollup.sh'
#
# Re-running is the update path and is safe: every step is a replace, and the timer is
# restarted rather than re-enabled. The job's cursor lives in the output directory, not
# next to the code, so an update never re-reads the log.
#
# THE DIRECTORY LAYOUT UNDER /usr/local/lib/provenance MIRRORS THE REPOSITORY, and that
# is not tidiness. The job runs under plain `node` with no bundler and no path aliases,
# so its imports are relative paths — scripts/rollup-access-log.mts reaches back to
# ../lib/analytics/rollup.ts. Flattening the three files into one directory breaks every
# one of those, at runtime, on a box, five minutes after anyone stopped looking.
set -euo pipefail

DEST=/usr/local/lib/provenance
OUT=/srv/provenance/shared/analytics
UNITS=/etc/systemd/system

if [[ $EUID -ne 0 ]]; then
  echo "install-rollup: must run as root (sudo bash $0)" >&2
  exit 1
fi

for f in scripts/rollup-access-log.mts scripts/lib/rollup-store.mts lib/analytics/rollup.ts \
         deploy/provenance-rollup.service deploy/provenance-rollup.timer; do
  [[ -f "$f" ]] || { echo "install-rollup: $f not found; run from a checkout root" >&2; exit 1; }
done

# Node has to be able to strip types, which it does natively from 22.18. An older node
# fails with a syntax error on the first type annotation, which reads like a corrupt file
# rather than a version problem.
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "$node_major" -lt 22 ]]; then
  echo "install-rollup: node $node_major cannot run TypeScript directly; need 22.18 or newer" >&2
  exit 1
fi

install -d -m 755 "$DEST/scripts/lib" "$DEST/lib/analytics"
install -m 644 scripts/rollup-access-log.mts "$DEST/scripts/rollup-access-log.mts"
install -m 644 scripts/lib/rollup-store.mts "$DEST/scripts/lib/rollup-store.mts"
install -m 644 lib/analytics/rollup.ts "$DEST/lib/analytics/rollup.ts"

# Owned by app, because the dashboard reads these files as app. Written by root, which is
# what the job runs as — the mode is what makes both work.
install -d -m 755 -o app -g app "$OUT" "$OUT/days"

install -m 644 deploy/provenance-rollup.service "$UNITS/provenance-rollup.service"
install -m 644 deploy/provenance-rollup.timer "$UNITS/provenance-rollup.timer"

systemctl daemon-reload
systemctl enable --now provenance-rollup.timer
# One run now, rather than waiting up to five minutes to find out whether it works.
systemctl start provenance-rollup.service

echo
systemctl --no-pager --lines=20 status provenance-rollup.service || true
echo
systemctl list-timers --no-pager provenance-rollup.timer

# Where to look at the result, said here because it is the one question the operator
# has next and the answer is not guessable: /admin returns 404 whenever NODE_ENV is
# production, so the dashboard cannot be opened on this box at all.
cat <<'NOTE'

The rollups are written to /srv/provenance/shared/analytics. To read them:

  scripts/pull-rollups.sh        # from a checkout, copies them down and prints the rest

/admin/analytics 404s in production by design (lib/discovery/devOnly.ts), so it is only
reachable from `npx next dev` on a laptop pointed at a copy of these files.
NOTE
