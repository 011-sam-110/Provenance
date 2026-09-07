#!/usr/bin/env bash
# Refresh the Cloudflare source ranges baked into deploy/Caddyfile.
#
# WHY THIS EXISTS RATHER THAN A NOTE TELLING YOU TO DO IT BY HAND. Two things in this
# repo hardcode Cloudflare's published networks: `trusted_proxies static` in the
# Caddyfile, and the firewall in deploy/cloudflare-firewall.sh. Cloudflare adds ranges
# occasionally, and NEITHER failure is loud:
#
#   * A range missing from trusted_proxies means Caddy stops believing CF-Connecting-IP
#     for those visitors and logs them as their edge node. The log keeps filling, every
#     request still returns 200, and the only symptom is that some fraction of the
#     analytics quietly describes Cloudflare's topology instead of an audience.
#   * A range missing from the firewall means those visitors are dropped before Caddy
#     ever sees them. That one IS visible, but only to the people it is happening to.
#
# So this diffs and reports rather than silently rewriting: run it, read what changed,
# commit it deliberately. Called with --check it only reports, and exits 1 on drift,
# which is the form a scheduled job or CI should use.
#
#   ./deploy/refresh-cloudflare-ips.sh          # rewrite the Caddyfile line if changed
#   ./deploy/refresh-cloudflare-ips.sh --check  # report only; exit 1 if stale
set -euo pipefail

CADDYFILE="$(dirname "$0")/Caddyfile"
CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# `curl -f` so an HTML error page never gets parsed as a range list. Both files are
# required: fetching v4 and silently accepting an empty v6 would strip IPv6 visitors
# from trusted_proxies, and that is exactly the quiet failure described above.
for v in 4 6; do
  curl -fsS --max-time 20 "https://www.cloudflare.com/ips-v${v}" -o "$tmp/v${v}"
  if ! [[ -s "$tmp/v${v}" ]]; then
    echo "refresh-cloudflare-ips: ips-v${v} came back empty; refusing to write" >&2
    exit 1
  fi
done

# Sanity-check the shape before trusting it. Anything that is not a CIDR means we were
# served something other than the list — a captive portal, a redirect page, an outage
# banner — and a malformed token in trusted_proxies makes Caddy refuse to start.
if grep -vqE '^[0-9a-fA-F:.]+/[0-9]{1,3}$' "$tmp/v4" "$tmp/v6"; then
  echo "refresh-cloudflare-ips: non-CIDR content in the fetched lists; refusing to write" >&2
  grep -nvE '^[0-9a-fA-F:.]+/[0-9]{1,3}$' "$tmp/v4" "$tmp/v6" >&2 || true
  exit 1
fi

new="$(cat "$tmp/v4" "$tmp/v6" | tr -d '\r' | paste -sd' ' -)"
old="$(sed -n 's/^[[:space:]]*trusted_proxies static //p' "$CADDYFILE")"

if [[ "$old" == "$new" ]]; then
  echo "refresh-cloudflare-ips: up to date ($(wc -w <<<"$new") ranges)"
  exit 0
fi

echo "refresh-cloudflare-ips: DRIFT"
# Word-per-line so the diff names the ranges rather than showing one changed long line.
diff <(tr ' ' '\n' <<<"$old" | sort) <(tr ' ' '\n' <<<"$new" | sort) || true

if (( CHECK_ONLY )); then
  echo "refresh-cloudflare-ips: --check, not writing" >&2
  exit 1
fi

# Replace the whole line. The ranges live on ONE line on purpose: the Caddyfile has no
# line-continuation syntax, so a multi-line list would not parse.
python3 - "$CADDYFILE" "$new" <<'PY'
import io, sys, re
path, new = sys.argv[1], sys.argv[2]
s = io.open(path, encoding='utf-8').read()
s2, n = re.subn(r'(?m)^(\s*trusted_proxies static ).*$', lambda m: m.group(1) + new, s)
if n != 1:
    sys.exit('expected exactly one trusted_proxies line, found %d' % n)
io.open(path, 'w', encoding='utf-8', newline='\n').write(s2)
PY

echo "refresh-cloudflare-ips: wrote $CADDYFILE"
echo "Now: caddy validate --config $CADDYFILE, commit, and re-run deploy/cloudflare-firewall.sh on the box."
