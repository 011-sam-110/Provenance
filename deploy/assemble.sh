#!/usr/bin/env bash
# Turn `next build` output into a shippable release. Run from the repo root, after the
# build and before deploy/deploy.sh.
#
# THE TRAP THIS EXISTS FOR. `output: "standalone"` does NOT copy `public/` or
# `.next/static` into the standalone tree — Next assumes a CDN serves them. Self-hosted
# there is no CDN. Miss this step and the app boots, answers HTML with a 200, and 404s
# every stylesheet, script chunk and icon: the page renders unstyled, the map never
# mounts, and the server log says nothing is wrong.
#
# It is one script rather than two lines in a workflow so that a person deploying by
# hand and CI deploying automatically do the identical thing.
set -euo pipefail

ART=.next/standalone

[[ -f "$ART/server.js" ]] || { echo "! $ART/server.js missing — run npm run build first" >&2; exit 1; }
[[ -d public ]] || { echo "! public/ missing — wrong working directory?" >&2; exit 1; }
[[ -d .next/static ]] || { echo "! .next/static missing — the build did not finish" >&2; exit 1; }

rm -rf "$ART/public" "$ART/.next/static"
cp -r public "$ART/public"
mkdir -p "$ART/.next"
cp -r .next/static "$ART/.next/static"

echo "assembled $ART"
du -sh "$ART" "$ART/public" "$ART/.next/static" | sed 's/^/  /'
