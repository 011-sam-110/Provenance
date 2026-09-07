#!/usr/bin/env bash
# One-time setup for a fresh Hetzner box. Run as root, once.
#
#   ssh root@<ip> 'bash -s' < deploy/provision.sh
#
# Leaves the box able to build and serve Provenance: a non-root `app` user, Node 24,
# Caddy for TLS, a firewall, and swap. Idempotent — safe to re-run.
set -euo pipefail

APP_USER=app
APP_DIR=/srv/provenance

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ufw rsync ca-certificates ripgrep >/dev/null

echo "==> node 24"
if ! command -v node >/dev/null || [[ "$(node -v)" != v24* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
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

echo "==> swap (next build peaks well above idle; 4G keeps a 8G box off the OOM killer)"
if [[ ! -f /swapfile ]]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> app user + dirs"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> firewall — only SSH and HTTP(S). The app itself stays on loopback:3000."
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status numbered

echo
echo "Provisioned. Next:"
echo "  1. put deploy/Caddyfile at /etc/caddy/Caddyfile (edit the domain first)"
echo "  2. put deploy/provenance.service at /etc/systemd/system/provenance.service"
echo "  3. put the runtime secrets at $APP_DIR/shared/.env  (chmod 600, owner $APP_USER)"
echo "  4. run deploy/deploy.sh from your laptop"
