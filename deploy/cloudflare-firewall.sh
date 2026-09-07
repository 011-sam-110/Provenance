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

# THE PROPAGATION GATE, AND IT IS THE WHOLE REASON THIS SCRIPT IS NOT JUST TWO ufw
# COMMANDS.
#
# Moving the nameservers does NOT move every visitor at once. The old registrar's
# nameservers keep answering authoritatively for the zone, and resolvers cache the
# .com delegation for up to 48 hours — measured 86400s on the authoritative RRset the
# day of the cutover. So for up to two days, some real visitors still resolve straight
# to the origin IP. Closing 80/443 while that is true does not gently push them to the
# edge; it hard-fails them with a connection timeout, which is a worse outage than the
# problem this script exists to fix.
#
# Measured on 2026-09-07, from the cutover: 89.8% of an hour's requests still direct,
# 31.9% over fifteen minutes, 2.1% over five. It drains fast, but not instantly, and
# the tail is real browsers rather than scanners.
#
# So the gate is a MEASUREMENT, not a clock. Requests that came through Cloudflare
# carry a Cf-Ipcountry header; requests that reached the origin directly never do.
# That is an exact discriminator, already sitting in the access log. Known crawlers and
# our own tooling are excluded because neither is a person who loses the site.
WINDOW_MIN="${CF_FW_WINDOW_MIN:-10}"
LOG=/var/log/caddy/provenance.log

if [[ "${1:-}" == "--force" ]]; then
  echo "cloudflare-firewall: --force, skipping the propagation gate"
elif [[ -r "$LOG" ]]; then
  gate_out="$(python3 - "$LOG" "$WINDOW_MIN" <<'PY'
import json, sys, time, collections
path, window = sys.argv[1], float(sys.argv[2]) * 60
now = time.time()
# Excluded from "a person who loses the site": declared crawlers, and the shells this
# repo drives the box with. A scanner timing out is the intended outcome, not a cost.
SKIP = ('l9scan', 'discordbot', 'bot/', 'bot;', 'spider', 'crawl', 'curl/', 'wget',
        'powershell', 'python-requests', 'go-http-client', 'headlesschrome')
direct = collections.Counter()
via = 0
for line in open(path, errors='replace'):
    line = line.strip()
    if not line.startswith('{'):
        continue
    try:
        r = json.loads(line)
    except Exception:
        continue
    if now - r.get('ts', 0) > window:
        continue
    req = r.get('request') or {}
    h = req.get('headers') or {}
    if 'Cf-Ipcountry' in h:
        via += 1
        continue
    ua = (h.get('User-Agent') or ['-'])[0]
    low = ua.lower()
    if any(s in low for s in SKIP):
        continue
    direct[ua[:70]] += 1
print('VIA=%d' % via)
print('DIRECT=%d' % sum(direct.values()))
for ua, c in direct.most_common(6):
    print('UA=%d	%s' % (c, ua))
PY
)"
  echo "$gate_out" | sed -n 's/^UA=/    still direct: /p'
  via_n="$(sed -n 's/^VIA=//p' <<<"$gate_out")"
  direct_n="$(sed -n 's/^DIRECT=//p' <<<"$gate_out")"
  echo "cloudflare-firewall: last ${WINDOW_MIN} min - ${via_n:-0} via Cloudflare, ${direct_n:-0} direct (excluding crawlers and our own tooling)"
  if [[ "${direct_n:-0}" -gt 0 ]]; then
    cat >&2 <<MSG

cloudflare-firewall: REFUSING TO RUN.

${direct_n} request(s) in the last ${WINDOW_MIN} minutes reached this origin directly from
what looks like a real browser. Those visitors are on a resolver that still has the
old delegation cached, and closing 80/443 now would time them out rather than route
them through the edge.

Re-run when that reaches zero. It falls away on its own as the cached delegation
expires — up to 48 hours from the nameserver change, though in practice most of it
goes within the hour. Nothing is at risk while you wait: the origin being reachable
is the state it has been in all along.

  ./cloudflare-firewall.sh --force     apply anyway, accepting the timeouts
  CF_FW_WINDOW_MIN=30 ./cloudflare-firewall.sh    use a stricter window
MSG
    exit 1
  fi
  echo "cloudflare-firewall: gate passed - no real direct traffic in the window"
else
  echo "cloudflare-firewall: $LOG unreadable, cannot check propagation; use --force if that is deliberate" >&2
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
