# The webcam catalogue

Provenance draws **70,698 Windy webcams** from committed static tiles under
`public/webcams/`. This is the layer that used to be a 1,567-row live sample.

Everything below was measured against `api.windy.com` on 2026-09-05 with this repo's
own key. Re-measure before restating any of it — Windy's inventory moves (70,736 and
70,686 were both read within an hour).

## What changed, and why it is not a bigger API plan

`lib/sources/windy.ts` fans out across 18 hand-written region boxes at 2 pages of 50,
which is a 100-row ceiling per region regardless of what the region holds. Its own
comment records the cost: `w-europe` contains 19,204 webcams, fetches 100, and on the
measured day returned 60 Italian cameras and **zero Belgian ones** while containing
Brussels. Prod `/api/webcams` answered `count: 1567` — 2.2% of the catalogue, and an
unranked 2.2%, because which rows arrive is whatever Windy returns first.

The binding constraint is the free tier's offset ceiling:

```
limit=100               → 400  {"message":["limit must not be greater than 50"]}
offset=1000  limit=50   → 200  50 rows
offset=2000  limit=50   → 400  {"message":"Offset is over API tier limit 1000!"}
```

**One bounding box yields at most 1,050 rows, ever.** Windy's pricing page puts the
free ceiling at offset 1,000 and the Professional ceiling at 10,000 for €9,990/year.

Paying for that tier is not necessary. Windy returns a truthful `total` for any bbox in
response to a **one-row** request, so a box can be asked how full it is for a single
cheap call rather than being paged into the wall and having truncation inferred
afterwards. That turns the harvest into a quadtree keyed on capacity: probe, and split
any box over 1,050 into quadrants.

Measured live from the whole globe:

| | |
|---|---|
| Probe requests to resolve the planet | **285** |
| Leaf boxes, each fully pageable | **196** |
| Webcams reachable in those leaves | **70,698 — 100%** |
| Full harvest cost | 285 probes + 1,518 pages ≈ **1,803 requests** |
| Leaf depth range | 1 to 8, dense band at 6–7 |

This is why `lib/sources/windy.ts`'s standing comment — *"splitting a dense bbox into
smaller boxes is the tempting fix and it is the wrong one — the split has to be
re-tuned every time Windy's inventory moves"* — does not apply here. It is true of a
**fixed** split, which is exactly why that file carries bespoke `brazil` and `belgium`
entries. An adaptive split re-derives the density map itself on every plan, for ~285
requests, and needs no hand-tuning.

## Running it

```bash
npm run webcams:status                       # coverage, makes no requests
npm run webcams:plan                         # rebuild the leaf plan   (~285 requests)
npm run webcams:cycle                        # one refresh cycle       (budget 60)
node scripts/harvest-webcams.mjs --cycle --budget 220
node scripts/harvest-webcams.mjs --manifest  # rebuild the manifest from disk, no requests
```

Needs `WINDY_WEBCAMS_API_KEY` (read from the environment or `.env.local`). With no key
the script exits without changing anything, like every other upstream in this repo.

**Cycles are rolling and oldest-first.** Windy publishes no daily quota and returns no
rate-limit headers, so the ceiling is genuinely unknown; the safe way to spend an
unknown budget is at a low constant rate rather than in one burst. Each cycle reads the
stalest leaves within its budget, so coverage climbs monotonically and then keeps
rolling as a refresh. A leaf too expensive for the remaining budget is **skipped, not
half-read** — a partially-paged leaf would be recorded as fetched, drop to the back of
the queue, and never have its remaining rows collected.

A leaf that is not reached keeps its existing tile. Nothing is deleted because a cycle
did not get to it — the same last-good contract as `registry.ts`'s `mergeResults`.

The first full fill ran in 8 cycles of ~220 requests with **zero upstream failures**,
and 97–99% of rows came back marked `active`.

## What is on disk

```
data/webcams/plan.json         the leaf plan + per-leaf cursor (44 KB, not served)
public/webcams/manifest.json   tile index: key, box, row count, last read (24 KB)
public/webcams/t/<key>.json    196 tiles, 8.2 MB raw / 2.0 MB gzipped
```

Tiles are static files on the CDN, so drawing the layer costs **no serverless
invocation**. `lib/webcams/tileLoad.ts` fetches the manifest and streams the tiles in,
so the map paints before the whole catalogue has arrived, and batches its callbacks —
one per tile would be 196 React renders each rebuilding a FeatureCollection growing
towards 70,698 features.

A leaf's key is its **quadrant path from the world root** (`r30122013`), so a tile is
self-locating and its filename cannot drift through float formatting.

### Rows are positional, and that is load-bearing

A tile stores `w: [[id, title, lat, lon, country, region, city, available, categories]]`,
not an array of objects. Objects spend ~80 bytes per row on repeated key names, which
is ~5.6 MB across the catalogue and is paid again in git history on every refresh; the
first draft measured 18.2 MB where the positional form is 8.2 MB.

`detailUrl` is not stored either — it is `https://www.windy.com/webcams/{id}` for every
row, so `webcamUrl()` rebuilds it. Coordinates are rounded to five decimals (~1 m).

**Because rows are read by index, a column added on one side only would shift every
later field**: `available` would be read out of `city`, the coordinate out of the
title, and nothing would throw. `TILE_VERSION` exists so a reader refuses an unknown
format outright, and `tests/unit/webcams-harvest-script-parity.test.ts` pins the
generator's column order against `TILE_COLUMNS`.

## What is deliberately NOT stored

**Image URLs.** Free-tier image tokens expire in 15 minutes, so a committed image URL
would ship a dead link. `/api/webcam-image` re-resolves one per view, which is also why
`/api/webcams` has always omitted them.

**Live availability.** `available` is a snapshot from harvest time. A camera's real
up/down state is a per-camera question answered on click, not something a daily
catalogue can carry honestly.

## Attribution and admission

Unchanged, and both already settled. Windy requires *"Webcams provided by Windy.com"*
plus a per-webcam link back to its Windy page; `WINDY_SOURCE.attribution` and each
row's `detailUrl` carry that. Free tier permits link-or-embed, which is what the
dossier does.

`windy.com` is in `RELAY_HOSTS` in `lib/discovery/gates.ts`, and that gate's own
comment carves this layer out: it bans a Windy URL arriving through **discovery**,
where it would be a second unattributed copy of a camera an operator already publishes.
This layer is keyed, attributed, and deliberately outside the road-camera registry — so
`CAMERA_FEED_COUNT` does not move and none of the operator-primary admission rules in
`docs/CAMERA_DISCOVERY.md` are touched.

## The one unresolved risk

**Windy documents no request quota and returns no rate-limit headers.** ~1,803 requests
for a full sweep is a measured cost, not a confirmed-permitted volume. The mitigations
in place are a per-cycle budget, concurrency of 4, exponential backoff on 429/5xx, and
a hard stop after 5 consecutive failures — after which the next cycle resumes from the
same cursor. Nothing observed a refusal during the first full fill. If that changes,
lower the budget before anything else.
