# Streets board — a camera wall of user-chosen live views

**Date:** 2026-08-15
**Status:** design approved; implementation plan pending
**Origin:** user feedback — *"Custom dashboards so I can see images from major cities high
pedestrian zones throughout the day."*

This spec was verified against the codebase by a 9-agent review (58 findings, 40 critiques) before
being written. Claims below carry `file:line` where they were checked. Where the review's own
conclusion was wrong, that is noted rather than inherited.

---

## 1. What this is

A new console board, **Streets**, whose widgets are **playlists of live camera streams**. A slot
holding one stream is a static view; a slot holding several rotates through them. Slots are filled
by searching inside the widget or by picking on the map.

The board must let a user see a named place — Trafalgar Square, Puerta del Sol, Shibuya — and leave
several of them running side by side.

### 1.1 Naming

`cameras` already names four distinct things: a widget title and a widget category
(`lib/console/widgets/cameras.tsx:76-80`), a ⌘K palette section and an "Add Cameras" action
(`paletteGroups.ts:73,101`), and a map layer key. A fifth would make ⌘K "cameras" ambiguous.

- Board: **Streets** (id `streets` — ids are never renamed once shipped, because `?c=` links pin
  them, `presets.ts:100-103`)
- Widget type: title **Camera wall**, id `camslot`

## 2. Ground truth (measured 2026-08-14/15 — all of this rots, re-measure)

| Fact | Value | Source |
|---|---|---|
| Road cameras | 10,590 / 10,345 online; 12 feeds, 7 answering | `GET /api/coverage` prod |
| Cached webcam layer | 1,597 | `GET /api/webcams` prod |
| Windy catalogue reachable by bbox | far larger — Madrid **528**, Tokyo **49**, Paris 8 | direct `api.windy.com` bbox queries |
| Camera refresh cadences | 60s (Caltrans, SCDOT, Castle Rock, TripCheck) · 120s (Traffic Scotland, NZTA, CET-SP) · 180s (DriveBC) · **300s (TfL, Digitraffic, Estonia, Iceland)** · 600s (Windy) | `lib/sources/*.ts` |
| YouTube key live in prod | yes — `dormant:false`, `quotaSpent:100` per channel resolve | `GET /api/youtube-live?channel=…` |
| Widget cap | `MAX_WIDGETS = 50` | `lib/console/types.ts:51` |
| Min widget width | 3 of 12 columns | `lib/console/resize.ts:2` |
| Grid | `COLS 12`, `ROW_PX 24`, `GAP_PX 1`, `RAIL_COLS 4`, `RAIL_CAPACITY 6` | `lib/terminal/layoutGrid.ts` |
| Desktop board scroll | none — `.tn-cw-shell` is `overflow:hidden` | `app/globals.css:1485` |

**Corrections to earlier drafts of this design, recorded so they are not reintroduced:**

- **No camera source refreshes at 30s.** The `refreshSeconds={30}` in
  `lib/console/widgets/cameras.tsx:65-67` is hardcoded on every tile regardless of source and is a
  pre-existing bug in that widget.
- **`loadedCamerasStore` is not viewport-scoped.** `WorldMap.tsx:1952-1968` sets the entire
  `/api/cameras` array; `app/api/cameras/route.ts:18` takes no request argument, so there is no
  bbox to filter by. The real constraints are that it is populated only while the camera layer is
  on (`WorldMap.tsx:1859`) and carries only `{id,name,lat,lon,available,live}`.
- **A central-London box holds ~492 road cameras**, not ~61.
- `react-grid-layout` is in `package.json` but never imported. The console runs its own CSS grid
  and pointer-drag in `components/console/ConsoleWorkspace.tsx`.

## 3. The blocking problem this design exists to solve

`lib/webcams/fetch.ts:27-28` builds the webcam layer by fanning out **14 fixed region bboxes × 2
pages × 50 rows** — 50 is the free-tier `limit` cap. The result is an unranked ~2% sample, and
`/api/webcams` says so in its own coverage note: *"first valid webcam encountered across the region
fan-out (not ranked)"*.

Measured consequence for the exact use case in the feedback:

| City | Cached layer | Windy live, same bbox |
|---|---|---|
| Madrid | **0** | **528** — incl. *Sol: Gran Vía*, *Plaza Canalejas* |
| Tokyo | 1 | **49** |
| Paris | **0** | 8 |
| Barcelona / Amsterdam / Delhi / Shanghai | **0** | — |

Trafalgar Square and Parliament Square are present only through upstream ordering and can disappear
with no change on our side.

**Therefore: the picker searches Windy live by bbox, not our cached layer.** This is the single
change without which the board does not answer the feedback.

### 3.1 `GET /api/webcam-search`

New route. Bounded, keyless-to-the-client, dormant-safe — the same contract every other adapter
follows.

```
GET /api/webcam-search?bbox=N,E,S,W[&q=]   → { webcams: WebcamLite[], total, note }
```

- Delegates to the existing `fetchPage(key, bbox, offset)` shape in `lib/sources/windy.ts`.
- Reports **Windy's own `total` for that bbox**, so the count is the real denominator, never our
  page size wearing the costume of a measurement (the `describeCoverage` contract).
- Server-side LRU cache keyed by rounded bbox, TTL from `WINDY_SOURCE.refreshSeconds`, plus
  inflight dedup — the road registry's stale-while-revalidate pattern
  (`lib/sources/registry.ts:206-219`), which the webcam path currently lacks.
- **Only fires on an explicit search.** Never on page load, never on pan.
- No key → the route is dormant and says so; the picker falls back to the cached layer with an
  honest note.

Also emit `categories` and `city` from `/api/webcams` (both already survive
`lib/webcams/normalize.ts`; `app/api/webcams/route.ts` drops them from the thin projection). That
gives a real "squares & public spaces" filter instead of title keyword matching.

## 4. The board

Authored through **`arrangeWall`** (`lib/terminal/layoutGrid.ts:404`) + `applyItems`
(`reducers.ts:100`), **not** `compose()`.

`compose()` calls `arrangeHouse`, which hardcodes `mapCols = COLS - RAIL_COLS` (`:323`) — the map
always takes 8 of 12 columns and cards land in a narrow rail at measured aspect ratios of 2.68 to
6.30, none near 16:9. `arrangeWall` gives 3-across cards of 4 columns with the map occupying one
card-width across two bands. That is the shape this board needs.

`tests/unit/console-presets.test.ts:78` asserts `stage.w >= 8`. The Streets board must be
**explicitly exempted with the reason written into the test**, not smuggled past it.

`mapCore: ["cameras", "webcams"]` is required. `presetLayers.ts:40-46` hard-resets those layers to
`false` and `WIDGET_TO_CORE` (`:13-17`) does not map `camslot` back on, so without it the board
opens with no pins and map-picking has nothing to click.

### 4.1 Unlimited slots, freely resized

Per the product requirement — as many widgets as wanted, resized however wanted:

- **Scrolling already works — CORRECTED 2026-08-15.** An earlier draft of this spec said the
  desktop board does not scroll, citing `.tn-cw-shell{overflow:hidden}` at `globals.css:1485`.
  That is the *outer band*. The actual scroll container is the inner grid `.tn-seg`, which is
  `overflow-y:auto` (`globals.css:1514`), and `ConsoleWorkspace` already removed the `min-height`
  that was defeating it — its comment at `:107-130` documents the measurement and the fix. Tall
  boards scroll today. **No work required.**
- **`MAX_WIDGETS` raised 50 → 200**, globally rather than per-board, with the reasoning recorded
  in the constant. Storage is not the constraint (a `StreamRef` is ~35 bytes, so 200 slots × 10
  streams ≈ 70 KB against ~5 MB); the network is bounded by §4.2; the real cost is the drag path
  (§4.3), which is why it is 200 rather than unbounded.
- **`MIN_W` is already 2 — CORRECTED.** `layoutGrid.ts:52` has had `MIN_W = 2` all along, so
  6-across resizing works today. Only the legacy one-click width path (`resize.ts:2`
  `MIN_WIDGET_SPAN = 3`) uses 3, and that is a set of preset buttons, not a constraint on
  dragging. **No work required.**

### 4.2 Off-screen slots pause

`IntersectionObserver` per slot. Out of view → rotation timer stops and fetching stops entirely;
re-entry resumes on the current stream. This is what makes unlimited safe, and it is load-bearing
for every traffic figure in §7.

### 4.3 The drag-path cost of bigger configs

`boards.ts:44-47` re-parses the whole archive on every `read()`; `TerminalHeader.tsx:221,245` calls
`isBoardEdited` per board; `useGridDrag.ts:118-132` writes the layout on **every cell crossing of
every drag**. Measured: 8 parses of a 40-board archive holding 6×20-stream boards is **11.8 ms of
blocking `JSON.parse` per cell crossed**.

Required: memoise `read()` behind an in-memory cache invalidated on write, and trailing-edge the
archive write. Without this, playlists make dragging janky on **every** board, not just this one.

## 5. The `camslot` widget

### 5.1 Config

```ts
// PERSISTED — rides in ?c= and the board archive
{
  streams: StreamRef[],   // ordered playlist
  intervalMs: number,     // rotation dwell
  name?: string,          // user label; type.title is identical across every slot
  fit?: "cover" | "contain",
}

type StreamRef =
  | { k: "cam";    id: string }       // road camera → /api/proxy?id=
  | { k: "webcam"; id: string }       // "windy:NNN" → /api/webcam-image?id=
  | { k: "yt";     videoId: string }  // pinned video → youtube.com/embed/<id>
```

**`paused`, the current index and armed-ness are NOT config.** `store.ts:74` `configure` →
`emit()` → `writeBoardLayout`, and `boards.ts:104-108` `layoutSignature` includes `g: w.config`. So
persisting a hover-pause would light the board's "customised" dot, pin the user to that snapshot so
future template improvements never reach them, and — for a rotation index — perform ~17k
whole-archive serialisations a day. These live in component state or a transient store.

**Config is `unknown` at the boundary.** `sanitize.ts:103` tests only `typeof o.config ===
"object"`, and `typeof [] === "object"`, so an array config round-trips while the type says
`Record`. No `cfg as CamslotConfig`.

### 5.2 Behaviour

Zero streams → an empty slot inviting a pick. One → static. Several → advances every `intervalMs`,
showing the stream's own name, its source, its freshness, and an `n/m` marker.

**`intervalMs` floor.** Rotation is display-only — it switches which already-fetched frame is
shown and never triggers a fetch by itself. But a slot whose cycle time exceeds the slowest
member's cadence refetches every member on every pass, so `intervalMs` is floored and the UI states
the relationship: *"12 streams at 5s — add more, or slow to 10s."*

**Video refs never rotate.** A YouTube embed needs 2–4s to bootstrap and may serve a pre-roll, so
at a 5s dwell the viewer watches an advert start and get killed, permanently. A `yt` ref is a
**pinned** tile; if a playlist contains one, the rotation control is disabled with that reason
shown. This also avoids 720 iframe mounts/hour per slot, which is the traffic shape that earns
"playback on other websites has been disabled".

**Aspect.** `object-fit: cover` by default, `contain` per slot, plus "fit to stream" snapping the
rect to the nearest 16:9.

### 5.3 Accessibility

The whole surface is auto-changing content, so WCAG 2.2.2 applies and hover-pause alone fails it
(no keyboard, no touch).

- Always-visible pause/play, stored as a **user preference**, not board config
- `prefers-reduced-motion` → starts paused (the repo already honours it in ~13 places)
- Pause on `focus-within`; a paused tile says it is paused
- `aria-live="off"`; the playlist is exposed as a real list of buttons

### 5.4 Registration

Four edits, not one (`registry.ts:8-21`): the widget object, an import in
`lib/console/widgets/index.ts` (`registerWidget` is a bare `Map.set`), a bespoke `WIDGET_EXPLAINERS`
entry meeting `tests/unit/widget-explainers.test.ts:43-149` (`whatItShows` > 40 chars, `method` >
25, `coverage` > 5, ≥1 limitation > 40 chars, no generic fallback), and a `detail` component for
the focus view. `capabilities` is a dead field — nothing reads it.

`CardSpec` needs `config?: Record<string, unknown>` forwarded to `addWidget` (`presets.ts:73,80`);
`reducers.ts:31,46` already accepts `opts.config`. Without it a preset cannot seed a playlist at
all.

## 6. Filling a slot

### 6.1 In the widget — search and paste

One search box over road cameras (`loadedCamerasStore` for geometry, `useCameras()` to enrich only
the **selected** ids — never a session-long subscription: measured 525,978 B brotli / 6,981,333 B
raw / 20,449 rows on a 60s poller) and webcams (`/api/webcam-search`, §3.1). Filter by Windy
`categories` for squares and public spaces.

**Paste accepts video URLs only** — `youtube.com/watch?v=<id>` and `youtu.be/<id>` → `{k:"yt"}`, at
**0 quota units**.

**Channel URLs are out of v1.** `lib/youtube/live.ts:45` `COST_SEARCH_LIST = 100` against a shared
10,000/day tier, and `registry.ts:62-70` deliberately does not cache negatives (*"caching 'nothing
live' for ten minutes would hide a stream that started thirty seconds later"*), so an idle channel
re-charges on every request. One shared link carrying 100 valid-shaped channel ids would spend the
entire day's allowance on a single page load, after which the News board falls back to pinned video
ids — 8 of 12 of which this repo has already measured as dead — and the Brazil livecams board
breaks, sitewide, until the quota resets. Nothing alerts. `ytc` stays restricted to the existing
curated registry.

Ship the CDN split from §7 anyway; it is right on its own terms.

### 6.2 From the map — the armed slot

`⊕` arms one slot (visible ring, map cursor change). While armed, a pin click appends; a shift-drag
box appends everything inside the bounds. `Esc` or `⊕` disarms.

This is a **global mode on a map with ~15 independent click handlers and no mode concept**. The
full interception list, all verified:

| # | What | Where |
|---|---|---|
| 1 | Suppress `cinematic.dive` for road pins. A road pin does **not** open a dossier today — it flies the map and lands a full-screen hero card. Webcam pins *are* the dossier case. Write the two separately. | `WorldMap.tsx:1075-1090`, `:1124-1130` |
| 2 | **The worst of the seven — sharpened 2026-08-15 by map-arming, and worse than this spec first said.** Not "breaks above zoom 12": it breaks for *some pins and not others at the same zoom, side by side*. `liveThumbnails.ts:21` caps the pool at `MAX_THUMBS = 24` and `:86` skips any camera with `available !== true`, so above zoom 12 the top 24 available in-viewport cameras are DOM buttons that `stopPropagation()` while every other camera on the same screen is still a plain layer click. Arming would appear to work on one pin and silently fly the map into a cinematic dive on its neighbour. **A manual "I clicked a pin and it armed" proves nothing here — verification must hit a pin inside the thumbnail pool AND one outside it.** The fix is not "also patch `onPick`": `onPick` and `camClick` must call ONE shared resolver that reads the store at event time. | `WorldMap.tsx:1421-1427`, `liveThumbnails.ts:19-60,86` |
| 3 | Define armed cluster behaviour. `clusterMaxZoom: 11` and every pin layer filters `["!",["has","point_count"]]`, so below zoom 12 an armed user clicks a badge and the map just zooms with the counter unmoved. Append leaves via `getClusterLeaves`, or show "zoom in to add these 61". **Never leave an armed click with no visible consequence.** **This is the MAJORITY path below z12, not an edge case** — measured over central London: z9 = 3 pins / 30 clusters, z11 = 18 pins / **71 clusters**, z12 = 275 pins / 0 clusters. | `cluster.ts:22-23`, `WorldMap.tsx:1240-1247` |
| 4 | Resolve MapLibre's box zoom, which owns shift-drag and is enabled (no `boxZoom` option is passed). Prefer `map.boxZoom.disable()/.enable()` in the same effect that paints the ring — it must never desync. The constructor-only `boxZoomEnd` option suppresses fit-to-box *unconditionally* and would silently delete shift-drag zoom from all six existing boards. | `WorldMap.tsx:1389-1397` |
| 5 | Sequence disarm **inside** `ConsoleShell`'s Escape switch, ahead of `selectionStore.clear()`. A separate listener races it and one Escape does both. Note that switch returns early when any `[role="dialog"]` is mounted — including `WidgetFrame`'s help and 🔔 popovers — so "arm, open help, Esc" would otherwise leave the slot armed. | `ConsoleShell.tsx:193,214-216` |
| 6 | Find a home for the control. `MapControls.tsx` is dead code; `StageBar` self-gates off whenever a widget is focused; `WidgetFrame` has no slot or render-prop and its whole `<header>` carries `onPointerDown={onGrab}` which does not skip buttons. **Put arm/prev/next/pause in the widget body**, or amend `WidgetFrame` and own the blast radius. | `ConsoleWorkspace.tsx:226-228`, `WidgetFrame.tsx:141-194` |
| 7 | Hold arm state **outside** `WorldMap`, read at event time via ref or `useSyncExternalStore`. **There are TWO mount-once closures, not one** (corrected 2026-08-15): `wireInteractions` is a `useCallback(…, [])` closing at `:1262`, *and* `createThumbnailManager` is handed `onPick` inside a second init effect closing at `:1563`. Any arm state either one reads directly is frozen at mount. Focusing a widget also unmounts `<WorldMap/>` entirely, so the store must outlive it. | `WorldMap.tsx:1074,1262,1421-1426,1563`, `StageHost.tsx:33,37` |
**Raised and then RETRACTED, recorded so nobody re-raises it.** A worry that armed clicks could
land on invisible pins — `CAM_DOT_LAYER` has no `minzoom` and its `circle-opacity` interpolates to
0 from zoom 6, and paint opacity genuinely does not gate hit-testing (measured: `queryRenderedFeatures`
returns a hit at z9 through z14). But the *feature-level* worry does not survive: `camera-markers`
has `minzoom 5`, `icon-allow-overlap` and `icon-ignore-placement` on the same source with the same
filter, so a **visible** icon is drawn and hit-testable at the same coordinate at every zoom ≥ 5,
and below z5 the dot itself renders at 0.45–0.5 opacity. There is no zoom at which an armed click
lands on something the user cannot see. No `minzoom` needed on the armed hit target.

Focus view and map-arming are therefore **mutually exclusive modes**. Focusing a slot clears its
armed state, and the hint says so.

Every append is undoable via the shell's existing `tn-toast` CustomEvent.

**Box-select bounds and cap.** Filter by lat/lon over `loadedCamerasStore` (full list, §2) plus
`/api/webcam-search` for the same bbox. The cap is **derived from cadence**
(`floor(minRefreshSeconds / (intervalMs/1000))`), not a magic 24, and every append path refuses the
overflow. The note must be **actionable** — "492 here: add the 12 available nearest the centre, or
filter to one operator" — not a bare truncation notice. A 5% arbitrary sample presented as a
selection is the coverage lie `describeCoverage` exists to prevent.

If the camera layer is off, the store is empty; do a one-shot fetch or say so. Never render a
silent empty result.

## 7. Cost, cache and failure

### 7.1 What rotation actually costs

The review claimed rotation multiplies fetches ~9×; that compares a rotating slot against a
**single static tile**. Against the honest comparison — a static grid of the same cameras —
rotation is cheaper, because each camera is fetched once per cycle rather than once per cadence:

| Shape | Fetches/hour |
|---|---|
| 24 cameras, static grid, 60s cadence | 1,440 |
| 24 cameras, one slot rotating at 5s (120s cycle) | 720 |

The design's claim holds. What is nonetheless true is that rotation **tempts users to add far more
cameras**, so absolute traffic grows, and §7.3 is what keeps that safe.

### 7.2 Required cache work

| Change | Why | Where |
|---|---|---|
| Quantise the cache-buster to `floor(now / (refreshSeconds*1000))` | `CameraImage`'s `bust` is mount-scoped `useState(0)`, so rotating tiles reset to `_=0` and freeze; conversely a static tile's incrementing `_` is a fresh CDN key every refresh (measured: `_=0` twice → HIT, `_=1` → MISS). Quantising makes every user on the same boundary share one entry. | `CameraImage.tsx:9-19` |
| Keep tiles mounted, toggle visibility | Rotation by mount/unmount destroys the refresh interval before its first tick | `CameraImage.tsx:11-14` |
| Split TTLs on `/api/youtube-live` | A blanket `s-maxage=600` would cache "nothing live" and hide a stream that started 30s later — reversing a documented decision. Long on a positive answer, 60–90s on a negative. | `youtube/registry.ts:62-70` |
| Edge-cache `/api/webcams` | Returns `Response.json` with no headers, so every request is a serverless invocation for a ~76 KB body already held behind an 8-minute module cache. Measured live: `max-age=0, must-revalidate`, `X-Vercel-Cache: MISS`. Use `edgeCacheControl` from `lib/http/cache.ts` as `/api/cameras` does. | `app/api/webcams/route.ts` |

`s-maxage` **is** honoured by Vercel's CDN on `force-dynamic` route handlers — measured MISS→HIT on
both `/api/proxy` and `/api/webcam-image`.

### 7.3 Failure and abuse guards

- **Dead streams drop out of rotation** after 2 consecutive failures, into an honest
  "3 streams unavailable" caption, retried on a minutes-scale backoff. `/api/proxy` uses a 10s
  timeout against a 5s dwell, so without this a dead stream always has a request in flight when its
  turn comes round again — measured shape: 6 dead cameras in a slot ≈ 8,640 invocations/hour from
  one tab. 242 registry cameras are already `available: false`.
- **Never let a slot's turn stack on an outstanding request.**
- **Registry cold start.** On a CDN miss `/api/proxy` awaits `getRegistry()`, whose rebuild is
  documented at ~18.5s warm and ~40s cold. Warm the registry once on board mount and give each tile
  a timeout with an honest "still resolving" state rather than a blank rectangle.
- **Frame size varies ~80×.** TfL is 15 KB at 352×288; SCDOT ships 589 KB lossless PNGs; Estonia
  ships 596 KB JPEGs at 2592×1944 — a **19.2 MB decoded bitmap per frame**. Because box-select is
  geographic, the user picks the blowup by choosing where to drag. **v1 guard:** no prefetch for
  sources over a measured byte threshold, and a slot-count ceiling for them. **v2 fix:** `?w=`
  resize inside `/api/proxy` via `sharp`, allowlisted widths folded into the cache key. Do **not**
  use `next/image` — Vercel bills Image Transformations per source image.
- **No rate limiting exists anywhere** (no `middleware.ts`, no `vercel.json`, no limiter package),
  and these are free public feeds from TfL, Caltrans and state DOTs with no contract. The quantised
  buster is the main defence, because it turns most requests into CDN hits instead of origin
  egress. A per-client in-flight cap on `/api/proxy` is also required.

## 8. Security

- **Never interpolate a user string into an iframe `src`.** Anchored `^[A-Za-z0-9_-]{11}$`, and
  only `https://www.youtube.com/embed/<validated>` is ever built. **Extract and store the id, never
  the pasted URL.**
- Add a CSP with `frame-src https://www.youtube.com`. No CSP exists in the repo today, and this
  feature would be its first user-controlled iframe src.
- **Storing an id rather than a URL is genuinely safe and must stay that way.** `/api/proxy` and
  `/api/webcam-image` re-derive the URL server-side through the registry, pin host and path via
  `lib/proxy/allowlist.ts:40-48`, and use `redirect:"error"` with a 10s timeout. An attacker-chosen
  id cannot name a host; worst case is a 404. Say so where someone might later "optimise" it into a
  direct `imageUrl`.
- **Validate on the read path, not just on input.** `sanitize.ts:103` currently applies no
  allowlist, depth limit, size limit or per-type schema; measured, `intervalMs: -1`,
  `videoId: "\" onerror=alert(1) x=\""` and `id: "../../../etc/passwd"` all round-trip
  byte-identical. A `camslot` branch in `sanitizeLayout` — the single choke point every `?c=` passes
  through — must clamp `intervalMs` to [3000, 300000], truncate `streams` to the cadence-derived
  cap, enforce a total-refs ceiling per layout, and drop refs with an unknown discriminant or a
  failing charset. `camslot` also validates at render.
- **Pass `{archive:false}` on the share-link replace.** `ConsoleShell.tsx:81` hydrates the persisted
  board id *before* `:97-98` calls `shellLayoutStore.replace(l)` → `emit(true)` → `writeBoardLayout`,
  so a `?c=` layout is persisted over the visitor's saved board. Pre-existing, but this feature
  changes the payload from "moved rectangles" to "a stranger's camera list and embeds, persisted".
  The opt-out already exists at `store.ts:52`.
- Without these, a crafted link is a one-click DoS: `intervalMs:0` clamps to ~4ms, so 50 widgets ×
  5,000 refs pumps ~250 image requests/second at an unauthenticated `force-dynamic` route — and it
  spreads by design, because sharing is the feature.
- No prototype-pollution vector today: `reducers.ts:172-173` merges config by object spread. Keep
  the spread; re-test if a deep-merge helper is ever introduced.

## 9. Day history

Per-stream ring buffer in IndexedDB of frames the user's browser already fetched. Frames never
reach our servers, so no operator imagery is re-hosted — which keeps the promise
`app/cameras/page.tsx` already makes in writing.

**What it can and cannot be, stated plainly because the UI must not overclaim:**

- `lib/shell/visibility.ts` stops polling a hidden tab by design, and Chrome throttles background
  tabs regardless. **A backgrounded board records nothing.** The strip covers time the board was
  open and visible, and says so.
- With each stream visible 1/N of the time, a 300s TfL camera in an 8-stream slot captures a
  distinct frame roughly every 40 minutes. The strip is therefore **sparse by construction** and
  drawn with labelled gaps — never interpolated, never smoothed into a continuous day.
- **Dedupe on `ETag`/`Content-Length`** before writing. Without it the buffer fills with ~84
  byte-identical duplicates an hour and LRU-evicts the genuine morning to store them.
- Still tiers only. A YouTube iframe is opaque; those slots state they have no history rather than
  render an empty strip.
- Surfaced in the slot's **focus view** (`registry.ts:17` `detail`), not on the rotating wall.

**Quota hazard, and it is not small.** IndexedDB shares the origin's best-effort bucket with
localStorage, which Chrome evicts as a unit under disk pressure — taking `tn.console.boards.v1`
with it. `lib/shell/persist.ts:42-50` swallows `QuotaExceededError` in a bare `catch {}` and all 19
hydrated stores write through it, so exceeding quota silently stops persistence for the entire
console. Required: a hard byte ceiling well under any plausible bucket share, eviction before
writing rather than on failure, and a visible "history paused — storage full" state instead of a
silent stop.

## 10. Default board

Seeds a few real pedestrian-zone views, one road-camera slot, and one empty slot, so a first-time
visitor immediately sees what the feedback asked for.

**Write the degraded path as the primary path.** Seeded Windy ids exist by upstream ordering and
can vanish with no code change (§3). Measured today: `/api/proxy?id=<bad>` → 404 `text/plain`,
`/api/webcam-image?id=<bad>` → 404, and `CameraImage` renders a bare `<img>` with **no `onError`**,
so a dead id paints the browser's broken-image glyph. The existing "Feed offline" placeholder keys
off `camera.available`, which a de-registered id never has because it is absent from `/api/cameras`
entirely.

Required: an `onError` state on `CameraImage` (shared component — regression-check `/camera/[id]`
and the existing camera wall), or reconcile seeded ids on mount.

Related: an unregistered widget type renders an **invisible hole** — `WidgetFrame.tsx:91` returns
`null` while `sanitize` keeps the widget and `ConsoleWorkspace` lays out its rect. A `?c=` Streets
link opened against an older deploy, or a stale service worker, shows blank gaps with no message.
Render a labelled placeholder instead.

## 11. Sharing

Widget config round-trips `?c=` **byte-identical**, including nested arrays and unicode, on both the
browser and server paths (`share.ts:5-18`). Nothing tests this — add a config case to
`tests/unit/console-share.test.ts`.

But the link is one-shot: `lib/share/deepLink.ts:41-46` `writeUrl` does a `history.replaceState`
with only the map view state on a 400ms debounce, so `c=` is gone from the address bar within ~400ms
of the first pan. If sharing a wall is a headline feature it needs a visible "copy this board's
link" control — `SettingsPanel.tsx:35-50` `copyLayoutLink` already exists.

## 12. Testing

vitest, node environment, `tests/unit/**`. No React testing library — no component tests. Pure
functions only:

- rotation index advance and wrap, including 0-stream and 1-stream cases
- `intervalMs` floor derivation from a playlist's slowest cadence
- YouTube URL → `StreamRef`, **including every rejection**: non-YouTube host, wrong id length,
  `javascript:`, path traversal, an unanchored match
- `camslot` branch of `sanitizeLayout` — hostile `?c=` payloads, array config, `intervalMs:0`,
  oversized `streams`, unknown discriminant
- lat/lon bounds filter over a camera fixture, and the cadence-derived cap with its "of N" label
- ring-buffer eviction by count and by bytes, and `ETag` dedupe
- config round-trip through `encodeLayout`/`decodeLayout`

**Tests and docs that will break and must be amended with reasons written into them:**

- `tests/unit/console-presets.test.ts:12,20` — `BOARD_IDS` is exact and order-sensitive; array order
  *is* tab-strip order (`TerminalHeader.tsx:210`)
- `console-presets.test.ts:5,112-119` — `CORE_WIDGETS` is a literal set; a `camslot` card fails it
- `console-presets.test.ts:78` — the `stage.w >= 8` exemption (§4)
- `tests/unit/preset-layers.test.ts:112-118` — asserts no board *other than* `overview` turns
  webcams on
- `lib/console/tour.ts:318,324,334` — the guided tour names the boards and has **no test behind it**;
  left alone it silently tells every new visitor there are six
- `CLAUDE.md:95,118,120` and `README.md:44,90` — board count, and the widget-count claim
  (`widget-explainers.test.ts:38-41` asserts `> 40` and uniqueness, **not** a count of 69)
- `CLAUDE.md`'s "11 adapters / 19,328 cameras" — measured 12 sources / 20,449
- `lib/cameras/loaded.ts:2-3` — misleading header comment
- `app/globals.css:4301` ("five of the six board tabs") and
  `console-presets.test.ts:18,133` (titles say "five" for six)

## 13. This needs decomposing into milestones

The feature is too large for one implementation plan, and the pieces have a real dependency order.
Each milestone below is independently shippable and independently valuable — which matters, because
M1 alone already answers the originating feedback.

| M | Scope | Why this order |
|---|---|---|
| **M1** | `camslot` widget: config, rotation, prefetch, pause, accessibility (§5) · in-widget search over the **cached** pools · `sanitizeLayout` branch and render-path validation (§8) · the cache-buster and mount fixes (§7.2) | A card that displays chosen camera images is the thing the console has never had — `presets.ts` says so itself ("webcams has no widget to imply it"), and the only renderer in the tree today is `WebcamDetail.tsx`, reachable solely by clicking a pin. Drop this card on any existing board and the feedback is answered, because per-board layouts already persist. |
| **M2** | `/api/webcam-search` (§3.1) · `categories`/`city` on `/api/webcams` · category filtering in the picker | Turns "Madrid → 0 results" into "Madrid → 528". Without it M1 works but mostly on the UK, US and Brazil. |
| **M3** | The Streets board: preset via `arrangeWall`, `mapCore`, desktop scroll, `MIN_W`, unlimited slots, the `read()` memoisation (§4) · test and doc amendments (§12) | Depends on M1 existing to put on it. Carries the two test amendments, the tour rewrite and the naming work. |
| **M4** | Map arming and box-select — all seven interceptions (§6.2) | The largest risk surface and the only part that touches `WorldMap`. Deliberately last, so a regression here cannot block everything else. |
| **M5** | Day history (§9) · `?w=` image resize (§7.3) | The strip is only worth building once slots are stable, and the resize matters most once box-select can fill a board with 596 KB frames. |



- YouTube **channel** refs from users (§6.1) and `@handle` resolution
- Live HLS inside a playlist. `lib/cameras/concurrency.ts:16` `HLS_CAP` is a module-level global
  keyed by camera id, not instance — a playlist would silently evict hand-started players in the
  existing camera focus view and corrupt its `{liveActive}/{HLS_CAP}` counter, and one camera in two
  slots means unmounting slot A kills slot B. **v1 is stills plus pinned YouTube video embeds**, and
  the UI says so where a "▶ Live" affordance would otherwise be expected.
- Server-side timelapse archive
- Arbitrary user HLS/m3u8 URLs — `/api/hls` stays allowlisted
- Geolocating YouTube refs onto the map
- `?w=` server-side image resize (§7.3) — required, but as a follow-up milestone

## 15. Open risks

| Risk | Detail |
|---|---|
| Windy request ceiling | Undocumented in `docs/API_KEYS.md` and unmeasured. `/api/webcam-image` has **no cache, no TTL and no inflight dedup** on its keyed detail call, so the CDN is the only thing between a webcam wall and that quota. Measure before going wide. |
| Upstream ban | ~4,320 req/h from a handful of Vercel egress IPs to free public feeds could get the range blocked, taking the camera layer down for *every* user of the site, not just this board. |
| Scroll blast radius | Making one board scroll touches shell CSS all six others share. Must be opt-in per board and screenshot-verified on the rest. |
| Frame-size memory | Six slots of Estonian cameras ≈ 230 MB resident bitmap before the `?w=` fix lands. |
| Day-strip expectations | The strip cannot cover a day the board was closed. If it reads as an archive, it overclaims — the copy carries that weight until proven in review. |
