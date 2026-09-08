# Stage A findings: do the twelve silent feeds publish live video?

Run 2026-09-08, exit IP 86.20.84.13 (no VPN — Mullvad daemon resident but not connected).
Raw bodies in `data/liveness/raw/`, machine-readable report in `data/liveness/report.json`.
Re-checkable with no network: `node --import ./scripts/ts-alias-hook.mjs scripts/liveness-measure.mts --replay`

## Answer

**Zero additional live cameras are available from the existing registry.**

| feed | cameras | stream URLs found | live | verdict |
|---|---:|---:|---:|---|
| castlerock | 13,180 | **97** (all HLS) | 0 | **Refused — credentialed endpoint** |
| tripcheck | 771 | 0 | 0 | stills only |
| drivebc | 1,062 | 0 | 0 | stills only |
| digitraffic | — | 0 | 0 | stills only |
| nzta | — | 0 | 0 | stills only |
| trafficscotland | — | 0 | 0 | stills only |
| iceland | — | 0 | 0 | stills only |
| estonia | — | 0 | 0 | stills only |
| cetsp | 11 | 0 | 0 | stills only |
| bihamk | 15 | 0 | 0 | stills only |
| act-pr | 31 | 0 | 0 | stills only |
| tfl | — | 0 | 0 | MP4 clips, no live stream |

Eleven of the twelve publish no stream URL of any kind. The twelfth is the interesting one.

## Castle Rock does publish HLS, and it is behind HTTP Basic auth

The Castle Rock 511 platform — 13,180 cameras, 65% of the whole registry — carries a
`videoUrl` field the production adapter never reads. Sampled across two of its ten
systems (FL511 and 511ON), 97 rows carry one, all of this shape:

    data.0.images.0.videoUrl -> https://dis-se18.divas.cloud:8200/chan-1_h/index.m3u8

That is the **Divas** streaming vendor, which is exactly the "operator portal in front of
a streaming backend" pattern the acquisition plan was built around. Every one of the 40
probed returns:

    HTTP/1.1 401 Unauthorized
    Www-Authenticate: Basic realm="XEngine"
    Server: XEngine

Tried and refused identically: bare, `Referer: https://fl511.com/`,
`Referer: https://fl511.com/map`, `Origin: https://fl511.com`. The camera-list JSON and
both map pages were searched for credentials — no `Authorization`, no `user:pass@` URL,
no Basic token anywhere in the public payloads.

**Verdict: refused, not dead.** These are real live streams behind a real access
control. Getting in would mean defeating authentication, which is the same call already
made against the Netherlands (`stream.inmoves.nl`, refused for needing a forged Referer).
The unblock is a permission request to Castle Rock or the operating agencies, not code.

**Negative result worth keeping:** if Divas/XEngine deployments are Basic-auth by
default, that vendor family is a dead end across all its customers. That removes one of
the largest candidate stacks from the acquisition plan before any adapter was written
for it.

## Two flaws found in the measurement itself

Both were the same shape as the trap the run was designed to avoid, one level up.

1. **TripCheck answered `406 Not Acceptable`** to the HTML `Accept` header the runner
   sent, and the first run recorded Oregon as "0 streams found". That would have written
   off a state on the strength of our own request header. Fixed with an `Accept: */*`
   request shape, and TripCheck now returns its real 329 KB inventory: genuinely zero.
2. **`streamsFound` was set from "any request answered"**, so a feed whose real endpoint
   failed while its marketing page loaded was reported as a measured zero rather than
   unknown. Now keyed to level 1 alone.

Also fixed: **ACT Puerto Rico failed with a bare Node `fetch failed`**, the known
malformed-header bug on that host. The runner now falls back to curl for that specific
failure, which resolves it to a real zero rather than leaving a hole in the table.

## Known limits of this measurement

- **Level 2 read page HTML, not the JavaScript bundles those pages load.** DriveBC
  returned a 4 KB app shell, so a stream URL living in a JS chunk would have been missed.
  The zeros for SPA-style portals are therefore weaker than the zeros for portals that
  returned real content.
- **Per-camera detail endpoints were not called.** A portal that exposes a stream only
  on a per-camera API would read as stream-free here.
- Castle Rock was sampled at two of ten systems and the first 100 rows of each. That is
  enough to answer "does this platform expose a stream field", which it does; it is not
  a count of how many streams the platform holds.

## What this means for the plan

The acquisition work now rests entirely on new operators, since the existing registry
contributes nothing. The expectation of 65,000–80,000 cameras has no support from this
measurement in either direction — Stage A simply says none of them are already in hand.
