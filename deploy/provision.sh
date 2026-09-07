#!/usr/bin/env bash
# One-time setup for the Provenance box. Idempotent — safe to re-run, and re-running it
# is the actual backup strategy: the box holds no durable state, so a lost instance is
# recovered by running this on a fresh one and letting CI deploy again.
#
#   ssh provenance 'sudo bash -s' < deploy/provision.sh
#
# Optionally installs the CI deploy key at the same time:
#   ssh provenance "sudo CI_AUTHORIZED_KEY='$(cat ~/.ssh/provenance_deploy.pub)' bash -s" \
#     < deploy/provision.sh
#
# WHAT THIS BOX CAN AND CANNOT DO. It can serve Provenance. It deliberately cannot
# build it. The Lightsail 2 GB bundle measured 1,907 MB total with no swap, and
# `next build` on this app needs more than that — so the artifact arrives prebuilt from
# GitHub Actions and the box never sees a dev dependency. An earlier draft of this
# script built on the server and provisioned 4 GB of swap to survive it; that was
# written for an 8 GB Hetzner box and does not transfer.
set -euo pipefail

APP_USER=app
APP_DIR=/srv/provenance
NODE_MAJOR=24

if [[ $EUID -ne 0 ]]; then
  echo "! run as root: ssh provenance 'sudo bash -s' < deploy/provision.sh" >&2
  exit 1
fi

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates rsync ufw gnupg >/dev/null

echo "==> node ${NODE_MAJOR}"
# Node 20 went end-of-life in April 2026, so the version the old workflow pinned is not
# a candidate. Whatever runs here MUST match the major version Actions builds with:
# `output: "standalone"` bundles traced dependencies, and a native binding built on one
# major does not load on another.
if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_MAJOR}* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

echo "==> caddy"
if ! command -v caddy >/dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
caddy version

echo "==> swap (2G)"
# Not for builds — nothing is built here. This is headroom for the running server on a
# box with 1.9 GB and no swap at all, where one memory spike is an OOM kill rather than
# a slow minute.
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon --show

echo "==> app user + release dirs"
id -u "$APP_USER" >/dev/null 2>&1 \
  || useradd --create-home --shell /bin/bash "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$APP_DIR" "$APP_DIR/releases"
# shared/ holds the one file that must survive a deploy: the runtime secrets.
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$APP_DIR/shared"

echo "==> sudoers rule for the deploy"
# THE BUG THIS FIXES. deploy.sh ends with `sudo systemctl restart provenance`, and
# nothing ever granted that, so the deploy would have failed at the swap step after
# doing all the work. Scoped to three verbs on one unit: CI can cycle the app and read
# its state, and can do nothing else as root. Passing --validate first means a typo
# here fails now rather than locking the rule in.
cat > /etc/sudoers.d/provenance-deploy <<SUDOERS
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart provenance, /usr/bin/systemctl reload provenance, /usr/bin/systemctl is-active provenance
SUDOERS
chmod 440 /etc/sudoers.d/provenance-deploy
visudo -c -f /etc/sudoers.d/provenance-deploy

echo "==> CI deploy key"
# WHY THE CI KEY DOES NOT LIVE ON `ubuntu`. That account has passwordless sudo for
# everything, so a leaked Actions secret would be root on this box. As `app` the same
# leak buys write access to the release tree and the three systemctl verbs above.
if [[ -n "${CI_AUTHORIZED_KEY:-}" ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" -m 700 "/home/$APP_USER/.ssh"
  touch "/home/$APP_USER/.ssh/authorized_keys"
  grep -qF "$CI_AUTHORIZED_KEY" "/home/$APP_USER/.ssh/authorized_keys" \
    || echo "$CI_AUTHORIZED_KEY" >> "/home/$APP_USER/.ssh/authorized_keys"
  chown "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh/authorized_keys"
  chmod 600 "/home/$APP_USER/.ssh/authorized_keys"
  wc -l < "/home/$APP_USER/.ssh/authorized_keys" | xargs echo "  keys for $APP_USER:"
else
  echo "  CI_AUTHORIZED_KEY not set — skipped (see the header for how to pass it)"
fi

echo "==> firewall"
# Lightsail has its own firewall in front of this; ufw is the second layer, and the one
# that lives in version control. OpenSSH is allowed BEFORE enabling, or this locks the
# box out and the only way back is the Lightsail browser terminal.
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status verbose | head -6

echo
echo "Provisioned. Remaining, in order:"
echo "  1. DNS A record for the domain -> this box, and let it resolve."
echo "     Caddy cannot obtain a certificate before the name resolves here."
echo "  2. /etc/caddy/Caddyfile        <- deploy/Caddyfile (set the domain)"
echo "  3. /etc/systemd/system/provenance.service  <- deploy/provenance.service"
echo "  4. $APP_DIR/shared/.env        <- deploy/env.example, chmod 600, owner $APP_USER"
echo "  5. push to main, and let the workflow build and ship the first release"
