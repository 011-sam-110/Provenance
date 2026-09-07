#!/usr/bin/env bash
# Deploy Provenance to the Hetzner box. Run from the repo root on your laptop:
#
#   PROVENANCE_HOST=app@1.2.3.4 deploy/deploy.sh
#
# Ships the COMMITTED tree only (git archive), builds on the server, and swaps the
# `current` symlink atomically. Rolls back and leaves the old release serving if the
# new one fails to answer.
set -euo pipefail

HOST="${PROVENANCE_HOST:?set PROVENANCE_HOST=app@<ip>}"
APP_DIR=/srv/provenance
SHA="$(git rev-parse --short HEAD)"
REL="$APP_DIR/releases/$SHA"

# WHY `git archive` AND NOT rsync/scp OF THE WORKING TREE. It emits only tracked
# files, so an untracked .env.local sitting in the checkout — which is exactly where
# this repo's API keys live — physically cannot ride along to a public-facing box.
# It also means the server runs a commit you can name, not "whatever was on disk".
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "! working tree is dirty — deploying committed state ($SHA), not what you see." >&2
  echo "  ctrl-c within 5s to abort."; sleep 5
fi

echo "==> shipping $SHA"
ssh "$HOST" "mkdir -p '$REL'"
git archive --format=tar HEAD | ssh "$HOST" "tar x -C '$REL'"

echo "==> building on the server"
# NEXT_PUBLIC_* is inlined at build time, so shared/.env must be sourced HERE, not
# just by systemd at runtime. A build that cannot see NEXT_PUBLIC_SITE_URL bakes the
# fallback host into every canonical link and og:image in the bundle, and no runtime
# setting can undo it afterwards.
ssh "$HOST" bash -euo pipefail <<REMOTE
  set -a; . '$APP_DIR/shared/.env'; set +a
  export NODE_ENV=production
  cd '$REL'
  npm ci --no-audit --fund=false
  npm run build

  # output:"standalone" leaves these behind — see the comment in next.config.ts.
  # Without them the app serves HTML and 404s every asset.
  cp -r public '$REL/.next/standalone/public'
  cp -r .next/static '$REL/.next/standalone/.next/static'

  # server.js resolves its own directory, so the tree it runs from must be the tree
  # that holds them. Prune the build-only deps to reclaim the ~1 GB node_modules.
  npm prune --omit=dev
REMOTE

echo "==> health check on the new release before it takes traffic"
ssh "$HOST" bash -euo pipefail <<REMOTE
  set -a; . '$APP_DIR/shared/.env'; set +a
  cd '$REL/.next/standalone'
  NODE_ENV=production PORT=3001 HOSTNAME=127.0.0.1 node server.js &
  PROBE=\$!
  trap "kill \$PROBE 2>/dev/null || true" EXIT
  for i in \$(seq 1 45); do
    if curl -fsS -o /dev/null http://127.0.0.1:3001/api/status; then
      echo "   new release answers /api/status"; exit 0
    fi
    sleep 2
  done
  echo "!  new release never answered on :3001 — NOT swapping" >&2
  exit 1
REMOTE

echo "==> swapping"
PREV="$(ssh "$HOST" "readlink -f '$APP_DIR/current' 2>/dev/null || true")"
ssh "$HOST" "ln -sfn '$REL' '$APP_DIR/current.new' && mv -T '$APP_DIR/current.new' '$APP_DIR/current'"
ssh "$HOST" "sudo systemctl restart provenance"

sleep 4
if ssh "$HOST" "curl -fsS -o /dev/null http://127.0.0.1:3000/api/status"; then
  echo "==> live on $SHA"
  # Keep the last 3 releases; each carries its own node_modules and ISR cache.
  ssh "$HOST" "ls -1dt '$APP_DIR'/releases/*/ | tail -n +4 | xargs -r rm -rf"
else
  echo "!  live check failed — rolling back to ${PREV:-<none>}" >&2
  [[ -n "$PREV" ]] && ssh "$HOST" "ln -sfn '$PREV' '$APP_DIR/current' && sudo systemctl restart provenance"
  exit 1
fi
