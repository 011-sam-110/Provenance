# Brazil coverage — design

> Research sweep and every figure below: live-verified 2026-08-13/14. Counts rot;
> re-measure before quoting one anywhere. Companion research:
> `docs/superpowers/research/camera-sources.md` (which never covered South America).

## Why

Brazil was invisible in this product. A sweep of the open-source landscape found
that almost every route in is closed, and the two that are open were being
throttled by our own defaults rather than by the upstreams.

Measured tonight:

| Route | Verdict |
|---|---|
| Windy webcams | **OPEN** — 135 Brazilian webcams in the bbox, but our region paging surfaced only 10 |
| CET São Paulo | **OPEN** — keyless JPEG snapshots, 11 registered / 10 actually refreshing |
| YouTube live streams | **OPEN** — 146 Brazilian streams across 47 channels, no coordinates |
| Toll-road concessionaires (Ecovias, Arteris, Rota das Bandeiras, ViaPaulista) | **CLOSED** — hard 403 to a real Chromium, two different WAFs |
| Motiva / AutoBAn (ex-CCR) | **CLOSED** — `CamerasAoVivo.aspx` is now a 404; live cameras withdrawn |
| Rio de Janeiro | **CLOSED** — no camera dataset in data.rio's 2,021; `api.dados.rio` 503; the COR API times out from here and from two third-party proxies |
| DNIT (federal highways) | **CLOSED** — `servicos.dnit.gov.br` / `vgeo.dnit.gov.br` do not resolve |
| dados.gov.br, ArcGIS Online | **CLOSED** — no camera datasets; only hobbyist uploads of 6 and 12 rows |

Brazil is a ~290-camera country for us. That is the honest ceiling, not a
starting point, and it is an order of magnitude below what one Castle Rock
adapter yields in the US.

## Two traps this design exists to avoid

**Freshness, not status code, is the liveness test for snapshot feeds.** 205 of
CET-SP's `cams/{id}` folders return HTTP 200 JPEGs. Only 10 were modified within
8 minutes of the check; the rest are abandoned stills last written between 2017
and 2025 that still serve 200. Counting 200s would have reported "205 São Paulo
cameras" and been wrong by 195. `vwCamerasWeb` and the site's own `gCams` array
both say 11, because they count *registered*, not *refreshing* — folder 22 last
updated 25 Feb 2026. The registry count measures the wrong thing.

**A per-region override that only one fan-out reads is a field that does
nothing.** `WINDY_REGIONS` is consumed by two separate loops. `planPageJobs()`
exists so the paging arithmetic has exactly one implementation.

## Scope

Four changes, one PR each, each branched off the latest `main`.

### 1. `feat/windy-brazil-region`

`PAGES_PER_REGION = 2` ceilings **every** region at 100 webcams and reports no
shortfall. The `latin-america` bbox spans a continent, and its first 100 rows
came back 49 Chile / 15 Argentina / 11 Mexico / **10 Brazil**.

- `WindyRegion` gains an optional `pages`.
- `planPageJobs()` — pure, unit-tested — expands regions into page requests, and
  both fan-outs call it.
- A `brazil` region, `bbox [5.3, -34.7, -33.8, -74.0]`, `pages: 5` (250 capacity
  against a measured total of 206, i.e. headroom, not a number tuned to today).
  It overlaps `latin-america` deliberately; the fan-out dedupes by `webcamId`, so
  overlap costs requests, not correctness.
- `PAGES_PER_REGION` and `LIMIT` are exported so tests derive the expected
  request count from the registry instead of hard-coding "14 regions × 2".

**Verified end to end:** `/api/webcams` returns 1,358 webcams of which **136 are
BR** — second only to the US. Was 10.

### 2. `feat/cetsp-cameras`

A 12th camera adapter, following `lib/sources/estonia.ts`.

- List: the `gCams` array inlined in `https://cameras.cetsp.com.br/View/Cam.aspx`
  (`pasta`, `titulo`, `subTitulo`, `detalhe`).
- Image: `https://cameras.cetsp.com.br/cams/{pasta}/1.jpg`, keyless.
- `available` is driven by the snapshot's `Last-Modified` age, never by HTTP 200
  and never by `CamerasCentral.status` — three cameras are marked `INOPERANTE`
  there while their images update fine.
- Coordinates ship as a hand-verified `.data.ts` table (precedent:
  `cities.data.ts`, `ports.data.ts`). Token-matching the 11 cameras against the
  GeoServer's 615-row `CamerasCentral` resolved 9 cleanly and got 2 wrong on a
  single shared token (`Ibirapuera / R Ipê` matched a Bandeirantes intersection).
  For eleven cameras, verify once offline and commit the table.
- **The adapter never contacts the GeoServer at runtime.** `cet-inf7242.cetsp.com.br:8080`
  is an internal-looking host — no TLS, port 8080 — that happens to be reachable.
  It is a build-time research tool here, not a production dependency.
- `cameras.cetsp.com.br` is added to `lib/proxy/allowlist.ts`.

### 3. `fix/youtube-channel-resolver`

**This fixes a bug that is live in production.**
`lib/console/widgets/satellites.detail.tsx:278` embeds
`https://www.youtube.com/embed/live_stream?channel={id}`. YouTube has retired
that endpoint: loaded in a real Chromium against the repo's own `NASA_CHANNEL`
it renders **"Error 153 — Video player configuration error"**, and the page
builds a link to `watch?v=live_stream`, i.e. it treats the literal string as a
video id. The ISS "Live feed" panel is a dead player for every user today.

The same file's sibling problem: `lib/console/news/providers.ts` pins 12 channels
by **video** id, and `lib/console/help.ts:206` already documents the failure
("broadcasters rotate those ids without notice and a rotated preset simply plays
nothing"). Measured uptimes on seven live cams: 8h, 8h, 7d, 13d, 14d, 18d, 86d —
**2 of 7 had restarted within 10 hours.**

`lib/youtube/` resolves channel id → current live video id, server-side:

- Holds last-known `videoId` per channel.
- Each refresh batches every known id into one `videos.list` call — **1 quota
  unit per 50 ids** — and keeps those still `live`.
- Only a channel whose id went dead costs a `search.list?eventType=live`
  (100 units).
- At the measured ~29%/day rotation rate: ~1,900 units/day against a 10,000/day
  free quota.
- Dormant-safe: no `YOUTUBE_API_KEY` → empty list and an honest note. Never a
  throw, never a 5xx, never a stale embed presented as live.

`YOUTUBE_API_KEY` goes in `docs/API_KEYS.md` and `NEEDED-APIS.txt`.

### 4. `feat/brazil-livecams-board`

A Brazil live-cams board in the console, on the same pattern as the news presets,
consuming the resolver from #3. Channels are the registered unit, not videos.

**Explicitly not doing:** no map pins for the YouTube streams. YouTube returns no
geotags — `location` was `None` on every stream checked — so pins would mean
geocoding titles to city centroids, and a city-centroid pin sitting next to
metre-accurate camera pins misrepresents what it is. This also keeps
`lib/types.ts`'s existing separation intact: "Windy webcams are a DISTINCT layer
from road CCTV … keeping the camera registry + counts uncontaminated."

## Testing

Per `CLAUDE.md`: `npx tsc --noEmit && npm test`, vitest in `tests/unit/`, node
environment, pure normalisers tested against captured fixtures. One commit per
PR, solo attribution.

Live verification is not optional for a source adapter — every count in this
document came from a real request, and the end-to-end check for #1 was
`/api/webcams` on a dev server, not a unit test.
