#!/usr/bin/env bash
# Close ports 80 and 443 to everything except Cloudflare. Run ON THE BOX as a sudoer:
#
#   scp deploy/cloudflare-firewall.sh ubuntu@<box>:/tmp/ && ssh ubuntu@<box> 'sudo bash /tmp/cloudflare-firewall.sh'
#
# WHY. With the A records proxied, every real visitor arrives from a Cloudflare
# address. Leaving 80/443 open to the world therefore protects nobody and costs two
# things:
#
#   1. Anyone who learns the origin IP — and it is not a secret, it sat in public DNS
#      for a day and lives in certificate transparency logs forever — can skip
#      Cloudflare entirely. Every edge protection becomes optional for the one category
#      of visitor you would most like it to be mandatory for.
#   2. deploy/Caddyfile trusts CF-Connecting-IP for connections from Cloudflare ranges.
#      A direct connection that FORGES a Cloudflare source address could otherwise put
#      any value it liked into the access log. The trust list and this firewall are one
#      mechanism in two halves; neither is sufficient alone.
#
# Port 22 IS DELIBERATELY UNTOUCHED. Locking SSH to Cloudflare would be locking it to
# nobody — Cloudflare does not proxy SSH on this plan — and would end the session that
# is running this script with no way back in short of the Lightsail serial console.
#
# ORDER MATTERS AND IS NOT COSMETIC: the Cloudflare allows are added BEFORE the broad
# rules are removed, so there is never an instant where the site is unreachable. A
# script that deleted first would take the site down for however long the loop takes.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "cloudflare-firewall: must run as root (sudo bash $0)" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for v in 4 6; do
  curl -fsS --max-time 20 "https://www.cloudflare.com/ips-v${v}" -o "$tmp/v${v}"
  [[ -s "$tmp/v${v}" ]] || { echo "cloudflare-firewall: ips-v${v} empty; aborting" >&2; exit 1; }
done

if grep -vqE '^[0-9a-fA-F:.]+/[0-9]{1,3}$' "$tmp/v4" "$tmp/v6"; then
  echo "cloudflare-firewall: fetched list is not all CIDRs; aborting" >&2
  exit 1
fi

# Refuse to run if SSH is not currently permitted. If something has already removed the
# OpenSSH rule, adding a default-deny web policy is how a box becomes unreachable.
if ! ufw status | grep -qE '^22/tcp|OpenSSH'; then
  echo "cloudflare-firewall: no SSH allow rule found; refusing to touch the firewall" >&2
  exit 1
fi

count=0
while read -r cidr; do
  [[ -n "$cidr" ]] || continue
  # `ufw allow` is idempotent — it reports "Skipping adding existing rule" and exits 0 —
  # so re-running this after a range is added upstream only adds the new one.
  ufw allow proto tcp from "$cidr" to any port 80,443 comment 'cloudflare edge' >/dev/null
  count=$((count + 1))
done < <(cat "$tmp/v4" "$tmp/v6" | tr -d '\r')

echo "cloudflare-firewall: allowed $count Cloudflare ranges on 80,443"

# Now drop the world-open rules. `ufw delete` returns non-zero when the rule is already
# gone, which is the normal case on a second run, so these are tolerated individually
# rather than being allowed to kill the script under `set -e`.
for rule in "allow 80/tcp" "allow 443/tcp"; do
  if ufw --dry-run delete $rule >/dev/null 2>&1; then
    ufw delete $rule >/dev/null && echo "cloudflare-firewall: removed world-open '$rule'"
  else
    echo "cloudflare-firewall: '$rule' already absent"
  fi
done

echo
ufw status verbose
