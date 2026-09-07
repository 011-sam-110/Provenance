# Live camera acquisition, with per-camera human admission

Date: 2026-09-07
Status: approved, Stage A building

## Problem

Provenance shows 91,086 cameras and can analyse 1,467 of them. "Live" is not a property
of a camera in this codebase — `isLiveStreamUrl` (`lib/proxy/hls-allowlist.ts:44`) means
"this stream URL matches one of four rules in our HLS proxy allowlist". Any feature that
needs motion runs on the 1,467, so growing that number is the goal.

A grep settled where the headroom is not. Only five of seventeen adapters read a stream
field at all — `caltrans`, `scdot`, `serbia-borders`, `serbia-tolls`, `tfl` — and four of
those five are the four already-live feeds. The fifth, TfL, parses an MP4 clip rather than
a live stream. So there is no significant pool of streams sitting behind a narrow
allowlist. **Twelve adapters never ask their upstream for a stream at all**, and whether
those upstreams publish one has never been checked.

## Decisions taken

| Question | Decision |
|---|---|
| What counts as live | HLS/DASH, plus operator-hosted MJPEG. The bare-IP ban in `isBareIpHost()` still applies. |
| Unit of admission | One camera, admitted individually. Not one feed. |
| Cameras nobody has swiped | Stay off the map. Default-deny. |
| Windy `player` include | Out of scope — it serves iframe embeds, which are neither HLS nor MJPEG and cannot be frame-analysed. |
| Order of work | Stage A measurement, then the deck, then acquisition. |

## Architecture

Three stages handing off through files on disk, so each runs, tests and audits alone.

    Probe   ->  data/liveness/raw/<feed>.json   raw upstream bodies, unchanged
            ->  data/liveness/report.json       what was found, per feed
    Queue   ->  data/liveness/queue.json        candidate live cameras awaiting a human
    Ledger  ->  data/liveness/ledger.json       camera ids personally admitted

The map reads only the ledger.

## Stage A — the measurement

For each of the twelve silent feeds:

1. Fetch the raw upstream payload and save it byte-for-byte to `data/liveness/raw/`.
   This is the record/replay harness: every later claim is re-checkable with no network.
2. Scan every string value for `.m3u8`, `.mpd`, `rtsp:`, `rtmp:`, `/hls/`, `mjpg`, `mjpeg`.
3. Level 2: fetch one sample camera viewer page per feed. Many portals list only
   coordinates in the API and expose the stream in the page that plays it. Skipping this
   would let a feed look stream-free when it is not.
4. Probe each stream URL found.

### The probe proves liveness, not a 200

BIHAMK and ACT both serve dead cameras as HTTP 200. The same applies to video. An HLS
stream passes only if **all four** hold:

1. the playlist parses as HLS (`#EXTM3U`),
2. it does not carry `#EXT-X-ENDLIST` — that marks a finished recording, not a live feed,
3. its media sequence advances between two reads about ten seconds apart,
4. one segment fetch returns bytes.

MJPEG passes only on `Content-Type: multipart/x-mixed-replace` plus two *different*
frames. A single frame is a still with a multipart header.

The probe also records **time to first segment byte per stream**, because the deck needs a
dead-stream timeout and a timeout is a policy, not a fact. Chosen too short it produces a
false negative against a real operator, and under default-deny that silently excludes a
good camera forever with nothing saying so.

### Referer

Try each host bare first. Record a `referer` only where a bare request actually fails,
matching the reasoning already written into `hls-allowlist.ts` — sending a Referer that is
not required is a claim we do not need to make. A host requiring a *forged* Referer
claiming to be someone else is refused, as the Netherlands feed was.

### Two things that could make the measurement lie

- **A VPN exit gets 403s that read exactly like "no stream here".** The run records its
  exit IP alongside every result and warns loudly if it cannot determine one.
- **A feed that fails to answer is `unknown`, never zero.** `mergeResults` in this repo
  already has form for treating a collapsed result as a good one. `politeFetchJson`
  returns `null` for 404, timeout and unparseable alike; the prober must not.

### Network manners

Per-host serialisation with a delay, a User-Agent naming the project, size caps, and a
per-request timeout — mirroring `lib/discovery/run.ts`. At the scale discussed
(65,000-80,000 cameras) the probe is roughly three requests per camera, so rate limiting
is a correctness requirement, not politeness. Getting blocked is not recoverable by
writing better code.

## Stage B — the swipe deck

A new route `/admin/live`, not an extension of `/admin/verify`. The existing deck signs a
verdict on a *feed* after sampling; this one signs a verdict on a *camera*. Sharing one
component across two verdict shapes is how `ReviewDeck.tsx` (504 lines) becomes
unreadable. Shares `admin.css`, `assertDevOnly()`, the store pattern and
`SatelliteInset.tsx`.

Keys match the existing deck muscle memory: right admit, left dead picture, `P` wrong pin,
`N` not a camera, `U` unsure, `R` reload, backspace back. One addition, `shift+X`, rejects
the rest of the current feed — when nine of the first ten are dead, swiping the remaining
four hundred is data entry, not judgment.

### The admission fact

Not "this stream played". A stream that yields one frame and then stalls passes that
test. The recorded fact is that the stream was **still producing frames at the moment the
verdict was signed**, which makes how long a card was watched part of the evidence.

Admit is inert until frames have been arriving continuously for a threshold taken from
Stage A measured latency. If admit fires instantly, holding the arrow key machine-guns the
queue into several hundred signed claims nobody watched — decoration wearing a human
signature. Reject stays available immediately; a dead stream is obvious at once and there
is no claim to protect.

### Review proxy

Candidates are not in the registry, so `/api/hls?id=` cannot resolve them. A dev-only
review proxy 404s in production like the rest of `/admin`, and will fetch **only URLs
present in the current queue file**. That constraint is what stops it being an open proxy.

### Throughput

At a five-second unlock, 1,000 cameras is about 90 minutes of continuous swiping, and
70,000 is about 97 hours. The deck therefore shows honest hours-remaining rather than a
card count, and prefetches exactly one card ahead — depth one, destroyed on move, because
deeper prefetch opens handshakes against real operators for cards that may never be seen.

**Open at the stated scale.** If the Stage A live yield really is tens of thousands,
per-camera default-deny is not reachable by hand and the policy needs revisiting. That
call is deferred until the measured number exists, deliberately.

## Stage C — the serving gate

- **Not retroactive.** Applied to everything, default-deny would empty the map: the
  existing 1,467 live and 18,921 still cameras have no ledger entries. The seventeen
  existing feeds are grandfathered as a named set, written down rather than implicit.
- **The filter lives in the `registry.ts` merge**, against a `GATED_SOURCES` set — not in
  `discovered.ts`, because portal acquisition produces hand-written adapters that would
  bypass it. Ungated is something someone has to leave undone rather than do.
- **Two guard tests, each watched go red before being trusted.** A gated source emitting
  three cameras with one in the ledger must emit exactly one. An ungated source must pass
  through untouched — a gate that silently deletes the existing 20,388 is a worse bug
  than the one it prevents.
- **Production surface is one file and one filter.** No new endpoint, no database, no
  auth. `/admin` already 404s in production.

**Not solved, stated rather than hidden:** a camera admitted today can die next month,
and default-deny does nothing about that because it is already admitted. Re-probing and
demoting is real work and is not in this design.

## Stage D — vendor-stack acquisition, sketched only

SCDOT streams live on `*.us-east-1.skyvdn.com`, which is a streaming vendor, not SCDOT.
All four live feeds share the shape "operator portal in front of a streaming backend".
Identify the stacks and find which other agencies run them, and whole DOTs of HLS become
available at once, each attributable to the operating agency. Each portal is a real
adapter, not a data row, and each needs its own robots and terms check. Designed properly
once the Stage A table exists, because that table may change the theory.
