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
APEX="${CF_FW_APEX:-provenance-online.com}"
LEGACY_NS="${CF_FW_LEGACY_NS:-dns1.registrar-servers.com dns2.registrar-servers.com}"

# THE DELEGATION GATE, AND IT EXISTS BECAUSE THE TRAFFIC GATE BELOW IS NOT ENOUGH.
#
# The traffic gate passed with 522 proxied and 0 direct requests, this script ran, and
# the site went down for the owner ten minutes later. Both numbers were true. The gate
# can only see resolvers that MADE A REQUEST inside its window; a resolver that holds
# the old delegation but happens to be idle is invisible to it, and its users find out
# the next time they open the site. That is most of them, because a stale resolver
# serves a whole ISP and an ISP is quiet for minutes at a time.
#
# So the traffic gate measures the wrong population. It answers "is anyone arriving
# direct right now", when the question is "can anyone still be TOLD to arrive direct".
# The second question has an exact answer that does not depend on timing: a visitor can
# only reach the origin if some nameserver still hands out the origin address. Ask the
# nameservers.
#
# Two checks, both cheap, both self-clearing:
#
#   1. The .com delegation must actually name Cloudflare. If it does not, the cutover
#      did not take, and closing 80/443 would take the site off the internet outright.
#   2. The OLD nameservers must have stopped answering for the zone. While they still
#      answer, every resolver holding the cached .com delegation — up to 48 hours of
#      them — is being handed the origin address, and closing the origin times those
#      visitors out. This clears by itself when the old registrar drops the zone.
#
# Neither check is a clock, and neither can be satisfied by waiting quietly at the
# wrong moment.
if [[ "${1:-}" == "--force" ]]; then
  echo "cloudflare-firewall: --force, skipping the delegation gate"
elif ! command -v dig >/dev/null; then
  echo "cloudflare-firewall: dig not found, cannot check the delegation (apt install dnsutils)" >&2
  echo "cloudflare-firewall: refusing rather than skipping the check that would have caught the last outage" >&2
  exit 1
else
  deleg="$(dig +noall +authority +time=3 +tries=2 @a.gtld-servers.net NS "$APEX" 2>/dev/null \
           | awk '$4 == "NS" { print $5 }' | sort -u)"
  if [[ -z "$deleg" ]]; then
    echo "cloudflare-firewall: could not read the .com delegation for $APEX; refusing" >&2
    exit 1
  fi
  if grep -qv 'ns\.cloudflare\.com\.$' <<<"$deleg"; then
    echo "cloudflare-firewall: the .com delegation for $APEX is not Cloudflare:" >&2
    sed 's/^/    /' <<<"$deleg" >&2
    echo "cloudflare-firewall: closing 80/443 now would take the site off the internet. Refusing." >&2
    exit 1
  fi
  echo "cloudflare-firewall: .com delegation is Cloudflare ($(tr '\n' ' ' <<<"$deleg"))"

  stale=""
  for ns in $LEGACY_NS; do
    ans="$(dig +short +time=3 +tries=2 @"$ns" A "$APEX" 2>/dev/null | grep -E '^[0-9.]+$' || true)"
    if [[ -n "$ans" ]]; then
      stale+="    $ns still answers: $(tr '\n' ' ' <<<"$ans")"$'\n'
    fi
  done
  if [[ -n "$stale" ]]; then
    cat >&2 <<MSG

cloudflare-firewall: REFUSING TO RUN.

The old nameservers are still serving this zone:

$stale
Any resolver that cached the .com delegation before the cutover is being handed the
ORIGIN address by those servers, and will keep being handed it until its cached
delegation expires — up to 48 hours. Closing 80/443 now times out every one of those
visitors, which is a worse outage than the one this script prevents.

THIS EXACT THING HAS HAPPENED. The traffic gate below passed, the firewall closed, and
the site was unreachable for everyone on one large ISP whose resolver was stale but
idle. Waiting for the traffic count to hit zero does not help: it was already zero.

Re-run when the old nameservers stop answering. That is the registrar dropping the
zone, and it is not something this box controls.

  CF_FW_LEGACY_NS="a.example b.example" ./cloudflare-firewall.sh   check different servers
  ./cloudflare-firewall.sh --force                                 apply anyway
MSG
    exit 1
  fi
  echo "cloudflare-firewall: delegation gate passed - the old nameservers no longer answer for $APEX"
fi

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

Nothing is at risk while you wait: the origin being reachable is the state it has
been in all along.

A zero here is NOT the all-clear on its own — it was zero the time this script took
the site down. It only means nobody stale happened to load a page in the window. The
delegation gate above is the check that actually settles it.

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

# READ THE RANGES WITH 'awk NF', NEVER 'cat'. Cloudflare serves ips-v4 and ips-v6 with
# NO TRAILING NEWLINE, so 'cat v4 v6' glues the last v4 range onto the first v6 one and
# emits a single malformed token: "131.0.72.0/222400:cb00::/32". awk treats each file's
# final partial line as a record, so it separates them correctly.
#
# THIS ALREADY HAPPENED, and the failure was worse than a crash. ufw rejected the glued
# token, set -e aborted mid-loop, and the box was left half-configured: 14 of 15 IPv4
# ranges allowed, NO IPv6 ranges at all, and the world-open rules still in place -- so
# the firewall looked tightened while the origin stayed reachable by anyone. The
# per-file CIDR validation above did not catch it either, because grep reads each file
# separately and both files are individually well-formed.
count=0
while read -r cidr; do
  [[ -n "$cidr" ]] || continue
  # `ufw allow` is idempotent — it reports "Skipping adding existing rule" and exits 0 —
  # so re-running this after a range is added upstream only adds the new one.
  ufw allow proto tcp from "$cidr" to any port 80,443 comment 'cloudflare edge' >/dev/null
  count=$((count + 1))
done < <(awk 'NF' "$tmp/v4" "$tmp/v6" | tr -d '\r')

echo "cloudflare-firewall: allowed $count Cloudflare ranges on 80,443"

# Now drop the world-open rules.
# ufw delete exits non-zero when the rule is already gone, which is the normal case on
# a second run, so each is tolerated individually rather than allowed to kill the script
# under set -e. Do NOT gate these on "ufw --dry-run delete": it does not reliably report
# whether a rule exists, and the version that did left BOTH world-open rules in place
# while reporting success.
for rule in "allow 80/tcp" "allow 443/tcp"; do
  if ufw delete $rule >/dev/null 2>&1; then
    echo "cloudflare-firewall: removed world-open '$rule'"
  else
    echo "cloudflare-firewall: '$rule' already absent"
  fi
done

# REFUSE TO FINISH QUIETLY IF THE WORLD IS STILL ALLOWED IN. The entire point of this
# script is that 80/443 stop being open, and a half-applied firewall that reports
# success is the exact failure this file already had once. Note the pattern matches
# "ALLOW" and not "ALLOW IN": plain `ufw status` prints the former and only the verbose
# form prints the latter, and a check written against the verbose wording silently
# passed while both rules were still there.
if ufw status | grep -qE '^(80|443)/tcp( \(v6\))?[[:space:]]+ALLOW'; then
  echo "cloudflare-firewall: FAILED -- 80/443 are still open to Anywhere" >&2
  ufw status >&2
  exit 1
fi

allowed="$(ufw status | grep -c 'cloudflare edge' || true)"
if [[ "$allowed" -lt "$count" ]]; then
  echo "cloudflare-firewall: FAILED -- only $allowed of $count Cloudflare ranges allowed" >&2
  exit 1
fi
echo "cloudflare-firewall: verified $allowed/$count ranges allowed, 80/443 closed to all else"

echo
ufw status verbose
