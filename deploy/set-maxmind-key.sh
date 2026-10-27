#!/usr/bin/env bash
# Set the MaxMind GeoLite account ID and licence key in the box's .env, from a hidden
# prompt. Run it in your own terminal, with -t so the paste is not echoed:
#
#   scp deploy/set-maxmind-key.sh provenance:/tmp/
#   ssh -t provenance sudo bash /tmp/set-maxmind-key.sh
#
# What it does, in order:
#   1. Asks you to confirm that you accepted the GeoLite EULA on maxmind.com.
#   2. Reads the account ID, then the licence key with `read -s` (nothing echoes,
#      nothing goes into shell history).
#   3. Checks the pair with MaxMind before it writes anything: a HEAD request for the
#      GeoLite2-City download, which MaxMind answers 401 for a wrong pair. The pair goes
#      to curl on STDIN (`curl -K -`), never on the command line, so `ps` cannot show it.
#   4. Writes MAXMIND_ACCOUNT_ID and MAXMIND_LICENSE_KEY into the .env through a
#      temporary file and one rename: same owner, mode 600, LF only. Every other line of
#      the file stays as it was.
#   5. Prints the outcome, never the key.
#
# Nothing reads these two keys yet. The GeoLite2 City step (an accuracy radius for the
# IP location tool) reads them when it ships; until then the tool uses RIPEstat, which
# needs no key. So no restart is needed.
#
# ENV_FILE overrides the target file (for a test). Default: /srv/provenance/shared/.env

set -euo pipefail

ENV_FILE="${ENV_FILE:-/srv/provenance/shared/.env}"
CHECK_URL="https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz"

if [ ! -t 0 ]; then
  echo "Run me in a terminal with ssh -t, so the key is not echoed. Nothing changed." >&2
  exit 2
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "No file at $ENV_FILE. Nothing changed." >&2
  exit 2
fi
if [ ! -w "$ENV_FILE" ] || [ ! -w "$(dirname "$ENV_FILE")" ]; then
  echo "Cannot write $ENV_FILE. Run me with sudo. Nothing changed." >&2
  exit 2
fi
command -v curl >/dev/null || { echo "curl is not installed. Nothing changed." >&2; exit 2; }

read -rp "Did you accept the GeoLite EULA on maxmind.com? Type yes: " eula
if [ "$eula" != "yes" ]; then
  echo "Accept the EULA first (maxmind.com, GeoLite sign-up). Nothing changed."
  exit 1
fi

read -rp "MaxMind account ID: " account_id
read -rsp "MaxMind licence key (hidden): " licence_key
echo

# Shape checks before any request. These also keep the curl config below free of quotes.
if ! [[ "$account_id" =~ ^[0-9]{1,12}$ ]]; then
  echo "The account ID is digits only. Nothing changed."
  exit 1
fi
if ! [[ "$licence_key" =~ ^[A-Za-z0-9_]{16,64}$ ]]; then
  echo "That does not look like a MaxMind licence key (16 to 64 letters, digits or _). Nothing changed."
  exit 1
fi

# The check. HEAD: MaxMind does not count a HEAD against the daily download limit.
code="$(curl -sS -o /dev/null -w '%{http_code}' -I --max-time 20 -K - <<<"user = \"${account_id}:${licence_key}\"
url = \"${CHECK_URL}\"" || true)"
case "$code" in
  200 | 302) ;;
  401)
    echo "MaxMind refused that account ID and licence key (HTTP 401). Nothing changed."
    exit 1
    ;;
  *)
    echo "Could not check the key with MaxMind (HTTP ${code:-none}). Nothing changed."
    exit 1
    ;;
esac

# Write: every line that is not one of our two keys, CR stripped, then our two keys.
dir="$(dirname "$ENV_FILE")"
tmp="$(umask 077; mktemp "$dir/.env.maxmind.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
{
  tr -d '\r' <"$ENV_FILE" | grep -v -E '^(MAXMIND_ACCOUNT_ID|MAXMIND_LICENSE_KEY)=' || true
  printf 'MAXMIND_ACCOUNT_ID=%s\n' "$account_id"
  printf 'MAXMIND_LICENSE_KEY=%s\n' "$licence_key"
} >"$tmp"
chown --reference="$ENV_FILE" "$tmp" 2>/dev/null || true
chmod 600 "$tmp"
mv -f "$tmp" "$ENV_FILE"
trap - EXIT
unset licence_key

echo "Done: MaxMind accepted the key (HTTP $code). MAXMIND_ACCOUNT_ID and MAXMIND_LICENSE_KEY are set in $ENV_FILE, mode 600. No restart needed."
