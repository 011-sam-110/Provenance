#!/usr/bin/env bash
# Ship an ALREADY-BUILT release to the box. Runs from CI, and by hand identically:
#
#   npm run build && deploy/assemble.sh
#   PROVENANCE_HOST=app@52.44.44.162 deploy/deploy.sh
#
# WHY THIS NO LONGER BUILDS ON THE SERVER. The previous version ran `npm ci` and
# `npm run build` over SSH, which needed the ~1.1 GB node_modules and a build's peak
# memory on the box. The box is a 2 GB Lightsail bundle. `output: "standalone"` traces
# production dependencies into the artifact, so what arrives here is self-contained and
# the server never needs npm at all.
#
# WHAT REPLACED `git archive`. The old script shipped tracked files only, so an
# untracked .env.local physically could not ride along to a public box. That property
# has to be preserved, and it is: rsync sends ONE assembled directory whose contents
# were produced by the build, and the source checkout is never sent.
set -euo pipefail

HOST="${PROVENANCE_HOST:?set PROVENANCE_HOST=app@<ip>}"
APP_DIR=/srv/provenance
ART=.next/standalone
SHA="$(git rev-parse --short HEAD)"
REL="$APP_DIR/releases/$SHA"
SSH_OPTS=(-o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new)

# ---- preconditions -------------------------------------------------------------
# Each of these is a way the deploy can "succeed" and serve a broken site, so they are
# checked before anything is sent rather than diagnosed afterwards.
[[ -f "$ART/server.js" ]] || { echo "! $ART/server.js missing — run npm run build" >&2; exit 1; }
[[ -d "$ART/public" ]] || { echo "! $ART/public missing — run deploy/assemble.sh" >&2; exit 1; }
[[ -d "$ART/.next/static" ]] || { echo "! $ART/.next/static missing — run deploy/assemble.sh" >&2; exit 1; }

# Pick a real hashed asset now, so the health check can prove the static tree actually
# arrived. A check that only fetches / passes happily while every stylesheet 404s: the
# page renders unstyled, the map never mounts, and the server log stays clean.
PROBE_ASSET="$(cd "$ART/.next/static" && find . -name '*.js' -type f | head -1 | sed 's|^\./||')"
[[ -n "$PROBE_ASSET" ]] || { echo "! no hashed asset found under $ART/.next/static" >&2; exit 1; }
echo "==> shipping $SHA (probe asset: $PROBE_ASSET)"

# ---- ship --------------------------------------------------------------------
ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p '$REL'"
# --delete so a re-deploy of the same SHA cannot leave a stale file behind.
rsync -az --delete --info=stats1 \
  -e "ssh ${SSH_OPTS[*]}" \
  "$ART/" "$HOST:$REL/"

# ---- prove the new release answers BEFORE it takes traffic --------------------
# Runs on :3001 beside the live server. Two Next processes fit in 1.9 GB plus swap, and
# the alternative is finding out after the symlink has already moved.
echo "==> health check on :3001"
ssh "${SSH_OPTS[@]}" "$HOST" bash -euo pipefail <<REMOTE
  set -a; . '$APP_DIR/shared/.env'; set +a
  cd '$REL'
  NODE_ENV=production PORT=3001 HOSTNAME=127.0.0.1 node server.js >/tmp/probe-$SHA.log 2>&1 &
  PROBE=\$!
  trap "kill \$PROBE 2>/dev/null || true" EXIT

  for i in \$(seq 1 45); do
    if curl -fsS -o /dev/null http://127.0.0.1:3001/api/status; then break; fi
    if ! kill -0 \$PROBE 2>/dev/null; then
      echo "!  the new release exited during start-up:" >&2
      tail -20 /tmp/probe-$SHA.log >&2
      exit 1
    fi
    sleep 2
  done

  curl -fsS -o /dev/null http://127.0.0.1:3001/api/status || {
    echo "!  /api/status never answered" >&2; tail -20 /tmp/probe-$SHA.log >&2; exit 1; }
  echo "   /api/status answers"

  # The check that catches the standalone trap. A hashed asset is content-addressed, so
  # a 200 here means the static tree is present and correctly rooted.
  curl -fsS -o /dev/null "http://127.0.0.1:3001/_next/static/$PROBE_ASSET" || {
    echo "!  hashed asset 404 — public/ or .next/static did not arrive" >&2; exit 1; }
  echo "   hashed asset served"
REMOTE

# ---- swap, then restart, in that order ---------------------------------------
# systemd resolves ReadWritePaths on the `current` symlink at unit START, so the
# symlink has to move first or the service writes its ISR cache into the old release.
echo "==> swapping"
PREV="$(ssh "${SSH_OPTS[@]}" "$HOST" "readlink -f '$APP_DIR/current' 2>/dev/null || true")"
ssh "${SSH_OPTS[@]}" "$HOST" \
  "ln -sfn '$REL' '$APP_DIR/current.new' && mv -T '$APP_DIR/current.new' '$APP_DIR/current'"
ssh "${SSH_OPTS[@]}" "$HOST" "sudo -n systemctl restart provenance"

# ---- verify live, roll back if not -------------------------------------------
# DO NOT "SIMPLIFY" THIS INTO TRUSTING THE RESTART ABOVE. `systemctl restart` exits 0
# for a unit that dies instantly, because the unit sets Restart=always: systemd reports
# the dead service as "activating (auto-restart)" rather than "failed", and the restart
# JOB genuinely succeeded, so there is nothing for it to report. Measured on this box on
# 2026-09-07 with no `current` symlink at all — every start died with 226/NAMESPACE
# because WorkingDirectory did not exist, twelve times in a row, and `systemctl restart`
# returned 0 each time. Systemd's own start limiter never trips either: RestartSec=3 in a
# 10-second burst window is about three starts, under the default burst of five, so it
# loops indefinitely rather than giving up.
#
# So the ONLY thing that distinguishes a live release from a crash loop is asking the
# application whether it answers. That is what this does, and it is why the rollback
# below can be trusted.
echo "==> verifying live"
LIVE=0
for i in $(seq 1 20); do
  if ssh "${SSH_OPTS[@]}" "$HOST" "curl -fsS -o /dev/null http://127.0.0.1:3000/api/status"; then
    LIVE=1; break
  fi
  sleep 3
done

if [[ "$LIVE" == "1" ]]; then
  echo "==> live on $SHA"
  # Keep the last 3 releases. Each is a whole standalone tree plus its own ISR cache,
  # so this is the only thing stopping 58 GB filling up one deploy at a time.
  ssh "${SSH_OPTS[@]}" "$HOST" \
    "ls -1dt '$APP_DIR'/releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf"
else
  echo "!  live check failed — rolling back to ${PREV:-<none>}" >&2
  if [[ -n "$PREV" ]]; then
    ssh "${SSH_OPTS[@]}" "$HOST" \
      "ln -sfn '$PREV' '$APP_DIR/current' && sudo -n systemctl restart provenance"
    echo "   rolled back" >&2
  else
    echo "   nothing to roll back to — this was the first release" >&2
  fi
  exit 1
fi
