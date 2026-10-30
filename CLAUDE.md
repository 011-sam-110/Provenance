# CLAUDE.md — Provenance (repo `Provenance`)

A Next.js 15 single-page global situational-awareness map. **Product name: Provenance.**
**Prod domain: `provenance-online.com`** — that is the only domain we ship on.
`provenance-online.vercel.app` is the legacy host: `middleware.ts` 301s it here
(`lib/brand.legacy.ts`), so never publish it as a link, and `curl` it without `-L` and
you get "Redirecting..." rather than the site.
Deployed product = `origin/main`.

## Licence — `AGPL-3.0-only`

This repo is **AGPL-3.0-only** (`LICENSE`, verbatim FSF text; `BRAND.license` in
`lib/brand.ts` is the single source of truth for anything user-facing).

**§13 is an obligation on the deployment, not just a file.** Anyone interacting with
this program over a network must be offered its Corresponding Source, so the console
header (`components/terminal/TerminalHeader.tsx`) and the site footer
(`app/(site)/page.tsx`) both link the repo. **Do not remove those links** — a hosted
AGPL app that does not offer its source is in breach of its own licence.

The AGPL covers **this codebase only**. Every upstream feed keeps its own terms; the
in-app attributions (TfL, Windy, CARTO/OSM, NASA, GDACS, TeleGeography…) are separate
obligations and are not satisfied by the licence.

> **Naming guard.** `worldmonitor.app` / "World Monitor" is a **competitor**
> (`koala73/worldmonitor`, **AGPL-3.0**), not us. Never write it as our domain, our
> product name, or in user-visible strings — **their README reserves branding rights,
> and that is a trademark matter which our licence choice does not touch.**
>
> **What DID change (2026-08-13):** this repo is now AGPL-3.0 itself, so the old
> reasoning here — "lifting their code would force us to relicense" — no longer bites,
> because we have already relicensed and published. Their code is now licence-
> *compatible* with ours. That removes the legal barrier; it does not remove the
> others, and the standing instruction is unchanged: **read their repo for facts only**
> (endpoint URLs, cadences). Copying still requires preserving their copyright notices
> and attribution, and it is a bad *product* call regardless — "we have seen hundreds of
> these, all based on the same one project" is the main thing this project has to
> overcome. If you ever do want to lift something, raise it with Sampo first; it is his
> call and worth a lawyer's glance, not mine.
>
> `simplifaisoul/osiris` is **MIT** and may be copied **with** an attribution header.
> Nothing has been copied from it to date (grep for "Adapted from OSIRIS" returns none).
>
> The two known leftovers this section used to list (`lib/export.ts` naming downloads
> `worldmonitor-*`, and `lib/events/alerting.ts` sending `"World Monitor — Disasters &
> Events"` as an alert source) were **fixed in `18a9de8`**.
>
> Verified 2026-08-11: `grep -rn "worldmonitor\|World Monitor" lib/ app/ components/`
> returns 3 hits and **all three are comments** naming the competitor as a fact — in
> `i18n/catalog.ts`, `sources/keyRequirements.ts` and `api/og/route.tsx`
> (that last one documents the literal it replaced). It was 4 until 2026-09-07, when
> `monitors.ts` was deleted into `lib/console/presets.ts` and took its comment with it.
> Those are allowed. What is banned is the name in a **user-visible string**, and there
> are none. Expect the grep to be noisy; read each hit before "fixing" it.

## Build gate
- Roadmap: `ROADMAP.md` (driven by the `/goal` milestone loop — one gated milestone per invocation)
- Gate: `npx tsc --noEmit && npm test`   (full check: `npm run build`)
- UI evidence: Playwright screenshots to `persona-shots/`
- **The gate does NOT run Playwright, so "green" says nothing about `tests/e2e/*`.**
  Measured 2026-09-08 at `a85e14f` with a clean tree: `console.spec.ts` (STREETS ships
  `cards: []` by design, the spec still expects `.tn-cw`), `sources-rail.spec.ts`
  (asks for "Collapse sources"; `SourceCatalog.tsx` says `aria-label="Close sources"`)
  and 6 of 10 in `shortcuts.spec.ts` (assert `Ctrl+K`; `formatChord(c, mac)` renders
  `⌘K` on a Mac dev box) were **already failing before any feature work**. Do not
  assume you broke them, and do not "fix" them by editing the spec — verify against
  the baseline commit first.
- Commit: one commit per milestone, `M<n>: <name>`, **solo attribution** (matches every existing commit — no co-author trailer)
- PR: fresh branch + PR per milestone/group. Sampo live-merges and deletes branches fast → always branch off the latest `main` and open a new PR for follow-ons.

## Shape
- **`/` is the marketing site, `/app` is the console.** `app/(site)/` holds the landing
  page; `app/(console)/app/` holds the shell. `/` forwards any request carrying `?v=`
  or `?c=` to `/app` with the query intact — shared links and OG cards were minted
  against `/`, so removing that shim breaks every link anyone has already sent.
- **`/eye` is the God's eye view**: the console's own map engine, opened tilted over the
  satellite imagery with the 3D buildings up, and the cameras, vessels, aircraft and TfL's
  road notices of that place drawn in the scene (`app/(console)/eye`, `components/eye/*`,
  and the pure, tested `lib/eye/*`). It reads its link after mount, so the page stays
  static, and its store writes stay in the tab (`EyeApp.tsx` says why). Two rules are not
  style preferences. A still is never called live: `mediaLabel` says "Live" only while a
  stream plays, and a still or a clip says its operator's own age. And there is no road
  speed in it, because no open feed for London publishes one: the ledger says so, and
  nothing draws an invented flow (`lib/eye/streets.ts`). Its vessels come from
  `/api/eye/vessels?bbox=`, not from the console's Ships layer: the whole world, Class A
  and B, the 500 nearest the middle of the view, asked every minute and again once the
  view settles outside the box it holds (`lib/eye/vessels.ts`, `lib/eye/vesselFeed.ts`);
  the console's Ships layer (`/api/signals/ais`) stays the 11 chokepoints, Class A only.
  The HUD's vessel number counts every boat drawn inside the frame. Vessels are stylised 3D
  models (`components/eye/vesselLayer.ts`, a MapLibre custom layer with three.js loaded lazily,
  ten packed files in `public/models/vessels/`, a bare hull for an untyped boat), drawn at their
  AIS length with a 28 px minimum; the chevrons are the fallback, and the licences are in
  `docs/IMAGE-LICENSES.md`. Its link flags are
  listed at the top of `EyeApp.tsx` (`overlay=0`, `motion=orbit|fly`, `record=1`, `clock=manual`), and
  `node scripts/eye-record.mjs --base=http://localhost:3000` films one move frame by
  frame into a 9:16 MP4 for a reel (not in the gate: it needs a browser and a GPU).
  Two more rules hold the film and the frame rate. A film runs on its own clock
  (`filmClock` in `lib/eye/motion.ts`): its time, its ages and its clips move only with
  its steps and no feed is fetched during it, because a film is drawn minutes slower
  than it plays. And while the view moves only one card's clip plays (`clipsToPlay`):
  three at once halved the frame rate, measured 2026-10-25.
  **Since 2026-10-27 it is the map behind every "Open the map" door** (the landing page,
  `/privacy`), and `/` stays the landing page with no MapLibre and no /api call on load. Its
  Sources button opens the console's own rail as a tray in this view (Sections, Show all,
  a ＋ that pins a source to the bar, remembered in this browser as `tn.eye.sources.v1`),
  built from `SourceSection` and `SourceRowView` inside a `.tn-terminal` token scope
  (`components/eye/EyeSources.tsx`; the rows are built on the server by
  `lib/eye/sourceRows.ts`, so the widget registry stays out of the page's bundle). Console
  layers that are switched on draw through WorldMap with this view's own paint pass
  (`eyeSignalPaintOps`), their own ledger line and credit; the country-level layers and the
  headlines widget are left out by rule (their `precision`, `widgetOnly`), not by a list.
  The tray's "Open the full map" goes to the console at the spot on screen with its Sources
  rail open (`getSourcesHref()`; `sources=open`, read once after mount by ConsoleShell,
  `lib/console/sourcesLink.ts`); on a phone Sources is the console's own "≡ Sources" thumb
  control, first in the bar. A browser with no saved board also gets `layers=` and `base=`
  so the console does not open empty; a saved board (`tn.variant.v1`) keeps its own. `tests/unit/landing-doors.test.ts` holds
  the doors. The same link carries `eye=`, the view's own link (place or camera, centre,
  zoom, heading, tilt): ConsoleShell reads it once after mount through `parseEyeReturn`,
  which rebuilds it from checked values and never uses it as a URL, drops it from the
  address, and the console's map then shows "God's eye view / Back to <place>" at its top
  left for the rest of that visit (`components/console/EyeReturn.tsx`, in memory only, so
  a reload drops it). "Exit to main dashboard" (2026-10-30) is the view's always-visible way
  out: a plate beside the name at its top left, under the place on a phone (the ledger moves
  down by that row). It is the same link without `sources=open` (`getDashboardHref()`), so
  the console opens at the spot on screen with its rail as the visitor left it, plus the
  way back; a recording or a film draws none (`tests/e2e/eye-exit.spec.ts`).
  **Both map pages ask for WebGL before they mount MapLibre**
  (`lib/map/webgl.ts`, `components/map/*`): without it they show a plain fallback with the
  camera directory and the source link, not Next's "Application error" page.
  The "Previews" switch beside Turn turns the camera pictures off: each camera is then an
  icon that fetches nothing, one tapped icon opens that one card (a close button, Esc),
  the choice is kept in this browser under `tn.eye.v1`, and a film or a recording ignores it.
  A TfL road notice (works, incident or closure) can be clicked like a vessel: its
  streets are redrawn over the buildings and the panel shows only TfL's own fields
  (`roadDetail`, `lib/eye/detail.ts`).
- `components/marketing/*` — landing page only. ONE scroll subscriber
  (`LandingStage.tsx`): one passive `scroll` listener whose whole job is to wake one
  rAF loop. The loop smooths one scroll value, paints the canvas only when the globe's
  state changed, writes CSS custom properties for every section effect, and stops when
  the page is at rest, so an idle page draws nothing. Nothing else may add a scroll
  listener and nothing may set React state per frame: a new effect is computed in
  that loop from the same value. Pins are CSS `position: sticky`. The page's styles are
  `app/landing.css`, imported by `app/(site)/page.tsx` alone, with every rule under
  `.lp-root` so none can reach `/privacy` or the console (the one rule outside it,
  `html:has(.lp-root)`, matches only while this page is mounted).
- **The globe on `/` draws ONE saved snapshot, on two stacked canvases. It is not a map
  and it is not live.** `lib/marketing/landingGlobe.ts` is the choreography and the 2D
  painter, and touches no DOM: scroll position in, plain state objects out, pixels on a
  context it is handed. The lower canvas is 2D: the stills, the ocean discs, the rims.
  The upper canvas is WebGL: the land, the cables and the dots, drawn by
  `lib/marketing/landingGlobeGL.ts`. That one exists because Chrome rasterises a 2D
  path of 20,000 round strokes on the CPU, in the GPU process: the page ran at 8 to 48
  frames per second on a 120 Hz laptop while its own paint timer read 10 ms (measured
  2026-10-07). **So count frames, never `drawMs`:** `node scripts/landing-fps.mjs` does
  it per section in headed Chrome, and `node scripts/landing-look.mjs` puts the two
  painters side by side (neither is in the gate). The 2D painter of the dots and lines
  is NOT dead code. It is the fallback when WebGL is refused, fails or is lost, and it
  is the only painter of the reduced-motion page, which asks for no WebGL context.
  Both painters read every width, alpha, size and colour from `contentStyle` in
  `landingGlobe.ts`; a style number in the WebGL file is a second source of truth and
  `tests/unit/landing-globe-gl.test.ts` fails on one. Three rules in the WebGL painter
  are not style preferences: (a) a layer of dots is ONE SHAPE, gathered in an offscreen
  target before it is coloured, because blending each dot by itself burns every city
  to white; (b) two LAYERS do add, as two paths do on the 2D canvas, so each layer has
  a channel of the target to itself; (c) a line under one device pixel wide builds up
  along a shared route, because that is how Chrome's 2D canvas draws a hairline and the
  design was approved looking at it.
  It draws `public/marketing/globe-snapshot.json` and nothing else. **The landing page
  makes no `/api` call on load and loads no MapLibre**: no style and no tile. The one call
  it ever makes is the Discord pop-up's `/api/community`, after 15 seconds of visible time,
  at most once per browser, and never in a browser driven by automation. `/privacy` states
  the no-tiles half in public, `tests/unit/privacy-page.test.ts` pins the imports behind it, and
  `tests/e2e/landing.spec.ts` watches the network for both halves (not in the gate).
  The snapshot is written only by `node scripts/gen-landing-snapshot.mjs`, which reads
  production and writes NOTHING if any layer fails or comes back empty, so a bad fetch
  cannot ship an empty globe. The same run writes `lib/marketing/globe-snapshot.meta.ts`,
  the page prints `GLOBE_SNAPSHOT.takenAt` from it where the data first appears and in
  the footer, and `tests/unit/landing-snapshot.test.ts` fails if the two files disagree.
  Do not point the globe at `/api/*` to freshen it: one live layer beside ten dated
  ones makes the printed date false.
- **The globe draws the eleven layers in the snapshot, not the registry.** Adding a
  signal layer no longer changes `/`. To put a layer on the landing globe, add it in
  one change to `LAYERS` in `scripts/gen-landing-snapshot.mjs`, to `LAYERS` in
  `landingGlobe.ts` and to `LAYER_IDS` in `landing-snapshot.test.ts`; a layer the file
  lacks draws nothing and does not throw.
- **`GlobeStage.tsx`, `HeroGlobe.tsx` and the old `.pv-*` landing rules are unused
  leftovers, pending removal in a follow-up.** Nothing has mounted either component
  since 2026-10-05, and `landing-globe-ground` and `hero-basemap` are the tests that
  still pin them and leave with them (`Starfield.tsx` is NOT a leftover: the new page
  mounts it, held still, behind the hero and the close). `app/provenance.css` is not dead
  either: `(site)/layout.tsx` still imports it and wraps `/`, `/privacy` and
  `/account/confirm` in `.pv-root`, `/privacy` is built from its `.pv-doc` / `.pv-block` /
  `.pv-ledger` rules, and the email-link page from `.pv-doc` and its own `.pv-account*`
  rules. Delete the landing-only rules, never the file.
- **Never type a count into the landing page.** `lib/marketing/wall.ts` and the source
  wall it fed are gone; the rule outlived them, and it outlived the 2026-10-05 rebuild
  too. Every figure the page prints comes from one of three committed files, each of which
  can be re-derived (the Discord pop-up shows Discord's own live counts, and types none): `camera-facts.data.ts` (measured, pinned by a test that recomputes
  it), `coverage-audit.data.ts` (GENERATED by `scripts/gen-landing-audit.mjs` from a
  production run of `scripts/country-event-breakdown.mts` — never hand-edit it; it
  carries its own `AUDIT_MEASURED_AT`) and `globe-snapshot.meta.ts` (GENERATED, above).
  If a sentence needs a number none of those carries, the sentence loses the number.
  `surveillance.data.ts` is no longer read by the page; it stays, with the tests and
  generators that belong to the data files. `repo-facts.data.ts` (the unit-test count)
  was deleted on 2026-10-27: nothing had read it since 2026-10-05, and its pinned count
  went stale whenever two PRs added test files in parallel, which failed `Deploy
  production` on main twice (2026-09-16, 2026-10-27). If a test count goes back on `/`,
  the BUILD measures it (a prebuild step over `npx vitest list --json`), never a constant
  typed into the repo. `docs/LANDING_SOURCES.md` records
  what left the page on 2026-10-05, the source behind every outside figure, and the
  figures REMOVED from the first draft because no source carried them — read it before
  adding a number, it is the more useful half.
- **Image licences live in `docs/IMAGE-LICENSES.md`.** The landing page's photographs
  are under the Pexels License, NOT the AGPL. Its two Earth renders (NASA imagery,
  rendered in Blender) and the console screenshots are this project's own work; the
  file records what third-party material each shows. An image goes under `public/`, is
  served from this origin, and gets its row in that file in the same change. Every
  line of the landing footer's credits is a claim about what the page loads, so a
  credit arrives and leaves with its asset.
- `app/` — routes + API. `app/api/*` are internal Next handlers (no user auth):
  `cameras`, `camera`, `coverage`, `planes`, `flight`, `satellites`, `signals/[id]`,
  `webcams`, `webcam-image`, `markets`, `news`, `brief`, `advisory`, `recon`, `geocode`,
  `near`, `geolocate`, `proxy`, `hls`, `discord`, `telegram`, `air-quality`, `point-weather`,
  `status`, `presence`, `feedback`, `community` (the Discord invite's state and counts), `webcam-place`, `webcam-search`, `youtube-live`, `camera-stats`
  (the top bar's camera stats strip, `lib/cameras/stats.ts`), `relay/[feed]`
  (signed snapshots pushed from provenance-1, see `lib/relay`), `eye/streets` (TfL's road
  disruptions for `/eye`), `eye/vessels` (the boats around the God's eye view's box),
  `camera-road` (what the road operators say about each camera's
  road, for the camera detail, the camera wall and the `/eye` cards; `lib/roads/nearCamera.ts`),
  and the two doors
  `middleware.ts` opens, `gate` and `private`.
- **`middleware.ts` runs before every route its `matcher` does not exempt, and does three
  things in a fixed order.** (1) 301s the legacy `.vercel.app` host to the `.com`
  (`lib/brand.legacy.ts`) — first, so it still fires while the curtain is down. (2) The
  maintenance curtain, armed by `MAINTENANCE_MODE` (`lib/gate/armed.ts`) and unlocked through
  `/api/gate`. (3) The private endpoint (`lib/gate/private.ts`), unlocked through `/api/private`,
  which rewrites to `/app`. The `matcher` must be a string literal, so it cannot import
  `gateMatcher()`; `tests/unit/gate.test.ts` fails if the two drift. It is **not** the `/admin`
  guard — that is the 404-in-production check described under discovery below.
- `components/WorldMap.tsx` — the single MapLibre globe→2D instance; all layers are data-driven.
  Hovering a Sources rail row or section heading fades every other app mark through ONE MapLibre global-state key (`srcHover`, `lib/map/sourceHighlight.ts`); every map source is classed there as fading or never fading, and a test fails on an unclassed one.
  The lit marks also get a glow drawn under them (`srchl-*` layers, filtered by the same key, so they hold nothing at rest). A switched-off source previews while you point at it through `lib/shell/sourcePreview.ts`, which writes no store, layout or link and keeps its own 5-minute cache.
- `components/shell/*` — thin console chrome (StatusBar, CommandPalette, BreakingBanner, panels).
- **The Discord pop-up** (`components/shell/CommunityNote.tsx`, `app/community.css`, gate in
  `lib/shell/community.ts`) shows once per browser, on `/` and `/app`, never on `/eye`, after 15
  seconds of visible time. Two rules are not style preferences. It says "the link works again", so it opens
  only after `/api/community` (`lib/community/invite.ts`) has not called the invite dead; an
  expired invite keeps it shut and spends nothing. And every figure on it is Discord's: with no
  answer it opens with no number, and the globe draws one dot per member
  (`lib/community/memberGlobe.ts`). `?discord=1` opens it for review and stays on for the tab
  (`?discord=0` ends that). Automation never gets it unasked (`navigator.webdriver`).
- **The command palette reads a typed question into filters, with rules and no model.**
  `lib/shell/ask.ts` (pure, `parseAsk`) turns "fires in Spain last 24h" into a layer, a
  place, a time window and a precision rule, and gives back the words it did not
  understand. Layer names come from `MAP_SIGNALS` through `lib/shell/askContext.ts`,
  plus the `LAYER_SYNONYMS` table; `tests/unit/ask.test.ts` holds the table of
  questions and fails on a synonym for a layer that does not exist. A new form of
  question is a new row in that table first.
  **One rule is not a style preference: no filter without a chip.** The palette shows
  each filter as a chip before it applies it, and `components/console/AskChips.tsx`
  shows the applied ones on the map. Both render from the live stores
  (`appliedChips` in `lib/shell/askApplied.ts`), and each chip removes its filter. So
  the three filter stores this feature writes are not persisted: the time window
  (`timeWindow.ts`, whose `hydrate` stays a no-op), the precision filter
  (`precisionFilter.ts`) and a place scope (`origin: "place"` in `scope.ts`, dropped by
  `coerceSavedScope`). Do not persist one of them without the chip bar reading it back.
  A place is a real shape, never a guess: a country is its outline from
  `countries-110m.geojson`, any other place is the geocoder's box or a 25 km circle
  (`lib/shell/askPlace.ts`), and the chip's tooltip says which. The reader does not
  round: a time length with no window ("last 48h", "today") is shown as not understood.
- `components/console/*` — the widget workspace (segments + centre stage + resizable widget frames).
- `lib/sources/*` — one adapter per camera feed → `Camera` (zod), merged in `registry.ts` (51 feeds).
  Fifty come from forty-five hand-written adapter modules (`cars.ts` registers one feed per
  CARS state, six in all); the fifty-first was admitted through discovery and shares
  `discovered.ts` rather than adding a module of its own.
- `lib/discovery/*` + `/admin` — **camera auto-discovery and the human review gate.** Discovery
  asks open-data catalogues (CKAN, Socrata, ArcGIS Hub) and produces a queue in
  `data/discovery/candidates.json`; a person works through it at `/admin/verify`, one
  camera at a time; promote writes `lib/sources/discovered.data.ts`, which is the ONLY
  thing `lib/sources/discovered.ts` serves. **Adding a camera network is now a committed
  data row plus a signed review record, not a new adapter module.** Everything under
  `/admin` and `/api/admin` returns 404 in production — that is the whole security model,
  pinned by `tests/unit/discovery-admin-gate.test.ts`. Full write-up in
  `docs/CAMERA_DISCOVERY.md`.
- **`CAMERA_FEED_COUNT` is `50 + ADMITTED_FEEDS.length`.** It is **51** today (2026-10-16 added
  the six CARS states, 511 Virginia, WSDOT, Mi Drive and TxDOT ITS). Houston
  TranStar was admitted on 2026-08-20, the first network to reach the map through discovery
  rather than a hand-written adapter, and the source audit of 2026-10-16 added 25 hand-written
  feeds, six of which stay dormant (no cameras, `feeds.dormant` in `/api/coverage`) until
  their free key is set. One of the 25, Hungary's Utinform, was removed on 2026-10-17: its
  API answers 403 to the production server's IP and 200 to a home IP, so prod never held
  one of its cameras. When it moves, the two pinning tests go red until this
  file and the README state the new figures. That is the guard working — and note that
  `readme-counts` also had to learn that a discovered feed has no adapter module of its own,
  because that assumption stayed invisible until the count moved.
- **Windy webcams are a harvested static catalogue, not a live sample.** `public/webcams/`
  holds 196 committed tiles with **70,698 webcams** (8.2 MB raw / 2.0 MB gzipped), built by
  `scripts/harvest-webcams.mjs` and streamed in by `lib/webcams/tileLoad.ts` — static CDN
  files, so the layer costs no serverless invocation. This replaced a live 18-region sample
  that served **1,567** rows, 2.2% of the catalogue. The layer stays OUTSIDE the camera
  registry, so `CAMERA_FEED_COUNT` does not move. Full write-up: `docs/WEBCAM_CATALOGUE.md`.
  Tile rows are POSITIONAL and read by index — never add a column on one side only; see
  `TILE_VERSION` and the parity test.
- **A camera's `live` flag means its stream PLAYED at its last check, not that its URL
  passes the HLS allowlist (2026-10-27).** `lib/liveness/playcheck.ts` reads each
  allowlisted stream twice, one target duration apart, through the same fetch as
  `/api/hls` (`lib/proxy/hls-upstream.ts`), then asks for the newest segment. `rolling`
  at a check younger than two cycles (6 h) is live; stalled, error, or (after the warm-up
  below) never checked or older is not, and the camera shows as a still. Every reader
  goes through `isLiveCamera`: `/api/cameras` (`lib/cameras/body.ts`), `/api/camera/[id]`,
  `/api/near` and `/camera/[id]`. The loop runs in the server process. The first of
  those API routes to be asked starts it; a pass every 10 minutes checks what is due
  (each camera every 3 h), six at once, 500 ms apart per host. Results are in memory
  only, on purpose: a saved file would make /privacy's "nothing this site serves writes
  a file" false (`discovery-admin-gate.test.ts`). So a deploy starts with no verdicts,
  and from provenance-1 a cold pass ran at about 30 checks a minute (2026-10-27), about
  two hours for ~3,200 streams. Hence the WARM-UP: until this process's first pass ends,
  an allowlisted stream with no verdict yet stays video (the old rule); a failed verdict
  is never video; after the first pass, unknown is not video. `/api/coverage` serves the
  counts as `playcheck`, real verdicts only, with `warm: true` while the first pass runs;
  `npx vite-node -c vitest.config.ts scripts/liveness-playcheck.mts` runs one pass and
  prints them. The HUD's Live block and the `stat-line` count video and never stills.
  `PLAYCHECK=off` turns the loop off, which leaves the warm-up rule on for good.
- `lib/signals/*` — one adapter + one `registry.ts` entry per source (**56 registered, 55 of them map layers**, 2026-10-30, when the six war sources joined; 50 and 49 on 2026-10-27, when Hong Kong's measured road speed joined).
  **The war sources** (`war-zones`, `frontline-changes`, `losses-ru`, `losses-ua`, `forces-near-nato`, `war-news`) are scraped on provenance-1 by the NewsScraper `sources` package and pushed through `lib/relay` (schemas in `lib/relay/schemas/*`, one file per feed); `forces-near-nato` is a curated file instead. Each may bring its own card and expanded view (`lib/console/widgets/war/*`, the generic ones are the fallback), and a layer's figures that are not points ride on the feature array as its `summary` (`lib/signals/summary.ts`), which `/api/signals/<id>` sends and `useSignalFeed` returns.
  A removed layer's id goes into `RETIRED_SIGNAL_IDS` in `lib/layerAliases.ts`, so saved
  toggles, `?sig=` links, variant overrides and saved boards (its `signal:<id>` card) that
  name it still load. `cyber-c2` and `news-coverage` were removed on 2026-10-17 because
  production had no working feed for either.
  A source may set `dataOnly: true` (see `types.ts`) meaning registered + fetchable but NOT a
  map layer: no catalog entry, no rail row, no pin, unreachable from monitors/variants/`?sig=`.
  Layer-facing code reads **`MAP_SIGNALS`**; the route, `/api/status` and the explainers read
  `SIGNALS`. Importing `SIGNALS` into something that draws or lists layers silently turns every
  data-only source back into a layer. Today the only one is the Country Instability Index.
  **Every source declares a `precision`** (`exact`, `facility`, `area` or `country`, see
  `types.ts`): how precise its places are. A per-country figure is `country`, never a
  point. A feature sets its own level only where one layer mixes levels. The route
  writes the resolved level on every feature (`lib/signals/precision.ts`) and
  `SignalDetail` says it in one line.
  **The map draws by that level** (`lib/map/precisionMarks.ts`): `exact` and `facility`
  keep the pin; an `area` is its own polygon or a soft disc; a `country` is its shaded
  outline from `public/geo/countries-110m.geojson` with the layer's metric as the
  figure, or a dashed ring when that file has no outline (it has 177). An area or a
  country never gets a pin, and `tests/unit/precision-marks.test.ts` holds that for
  every registered layer. `shape: "diamond"` draws a pin as a diamond and `fill: "hatch"`
  draws a polygon hatched; an area never becomes a diamond. A country-level adapter sends `countryIso3`. The shading is
  not a click target: a click on it opens the country dossier, the figure opens the
  signal. `components/console/MarkLegend.tsx` is the key, top right of the map, and
  lists only the marks on the map now.
- `lib/console/*` — widget registry, presets (**3 presets** in `presets.ts`), store, share (`?c=` layout URL).
  **A preset is the whole workspace**: core layers + signal layers + the board that reads
  them, and the Sources rail's tiles and the ⌘K Profiles list drive the same three. There is
  no `lib/monitors.ts` any more — its six layer-only "monitors" merged in here — and the
  five rail boards (World, Nature, Skywatch, Infrastructure, Intel) were retired on
  2026-09-15 on request, leaving Globe (empty by design) and Streets (the camera wall).
  **News was added on 2026-09-16** and is the third: the merged headline stream plus the
  `headline-places` map layer built from it (it seeded `news-coverage` until that layer
  was removed on 2026-10-17). It is NOT a reinstatement of Intel — Intel was
  four GDELT-and-UN layers in a bottom strip; this is the `/api/news` stream, which until
  then had no surface in the console at all.
  `shellLayoutStore` (`store.ts`) is the ONLY layout the app renders. `variantStore`'s
  `layoutOverrides` slot is not drawn by anything — do not write a new feature to it
  (the Source Catalog's ＋ used to, which is why it silently did nothing).
- **The console top bar is exactly two board tabs — Globe and Streets — and nothing drops down from them.**
  After them sits the camera stats strip (`components/terminal/CameraStats.tsx`, 2026-10-27):
  video, stills, countries, operators and the time of that count, then the Windy webcams with
  their own source, from `/api/camera-stats`. It is the one thing in the bar that opens a panel,
  and only on a click. Its wording lives in `lib/cameras/statsView.ts`, where a test fails if
  any string says "live"; video there counts streams that PLAYED at their last check.
  `components/terminal/TerminalHeader.tsx` renders the tabs from `TOP_BAR_PRESET_IDS`
  (a subset of the lineup, pinned by `console-presets.test.ts`); News left the
  navbar on 2026-09-16 on request and stays a preset reachable from the Sources
  rail tiles, the ⌘K profiles list and `?c=` links. The Apple-style hover panel
  that expanded the bar downward (`NavPanel.tsx`, `lib/console/navPanel.ts`,
  `docs/CONSOLE_NAV.md`) was deleted on 2026-09-15 along with the five retired
  boards. Per-scene memory survives in `lib/console/sceneChrome.ts`.
  **Scene = board = preset**, one thing — `sceneId` IS a `ConsolePreset.id`;
  do not invent a second concept.
  Hiding is a **paint-time filter** (`visibleWidgets`, applied at two render sites), never a
  layout mutation: a hidden widget keeps its slot, its config and its place in the capacity
  count. Chrome is a **sibling store** (`tn.console.sceneChrome.v1`), deliberately orthogonal
  to `boards.ts`, so Reset and `?c=` links needed no changes — which also means share links
  do NOT carry hidden state.
- `lib/variants/*` — the top-left "variant" switcher (13 built-in monitor profiles in `variants/builtins.ts`).
- `lib/i18n/*` — EN/ES/FR catalog + store.
- **Vehicle tracking on live video** (2026-10-30): a "Track vehicles" switch on `/camera/[id]`
  and in `CameraDetail`, never on camera-wall tiles (`CameraVideo`'s `tracking` prop).
  YOLO11n-seg (AGPL-3.0, `public/models/`) runs in a worker through onnxruntime-web, which
  `scripts/copy-ort.mjs` copies into the gitignored `public/ort/` on predev/prebuild; the
  tracker (`lib/vision/tracker.ts`, pure, tested) gives each vehicle an ID. Two rules are
  not style preferences: nothing leaves the browser, and a weak box is shown only once it
  has MOVED (signs and logos score as trucks on every frame). The counts are what the tab
  followed, never a traffic count. Write-up and measurements: `docs/VEHICLE_TRACKING.md`.
  Its e2e spec needs Google Chrome (Playwright's Chromium has no H.264).
- **Camera-tile conditions** — `lib/console/widgets/camslot.conditions.ts` (pure: what may be
  SAID), `camslot.provenance.ts` (pure: what may be SHOWN as the basis), `camslot.overlay.tsx`
  (the corner scrim), `camslot.conditions.store.ts` (one board-wide weather subscription).
  Surface state rides on `Camera.surface` from the adapters; `lib/cameras/surface.ts` owns the
  five disqualification rules. Air weather comes from `/api/point-weather` (Open-Meteo), which
  is a per-coordinate route and **cannot be a signal layer** — `SignalSource.fetch()` takes no
  arguments. The route is named `point-weather` and not `conditions` on purpose: it is
  incapable of returning a road-surface state, so nothing downstream can mistake it for one.
  **Three rules that are not style preferences.** (a) A refused measurement does NOT fall
  through to derived — it says "no data", so a camera with a 12 km station shows LESS than one
  with no station at all. Flip the `return none(...)` in `roadClaim`'s refusal branch if that
  trade is ever judged the wrong way round. (b) A derived line may never contain a surface word
  — `BANNED_IN_DERIVED` is enforced over every string the tile AND the panel can render.
  (c) Open-Meteo's `current.precipitation` is a preceding-hour SUM, so every derived phrase says
  "1h"; writing "now" would be a factual regression, not a rewording.

## Conventions
- Adding a signal layer = one adapter file + one `SIGNALS` entry + a fixture unit test. No edits to WorldMap/route/dossier/rail (all data-driven).
- Every upstream fetch is keyless-first and **dormant-safe**: failures resolve to `[]` / last-good / a labelled placeholder, never a 5xx, never fabricated data.
- Keep the upstream→domain mapping in a PURE exported function with a unit test.
- Tests are vitest, NODE environment, in `tests/unit/**/*.test.ts`. No React testing library is installed — no component tests.
- Calm light identity; `.tn-*` CSS tokens in `app/globals.css`. The console (`/app`) has an
  opt-in dark skin (`lib/terminal/skin.ts`, `html[data-tnx-skin="dark"]`, the DARK SKIN block in
  `globals.css`): light by default, remembered per browser, and never read from the OS
  (`prefers-color-scheme` appears nowhere). It is not a `Theme`; see the header of `lib/shell/ui.ts`.
  `/eye` switches that dark mode on for itself, always (`app/(console)/eye/layout.tsx`,
  `lib/eye/skin.ts`, Leon's call), so its Sources tray, Sources button and pins are dark
  whatever the console is set to. Its own frame does not use the skin, and it never reads or
  writes the console's saved choice.
- **ONE typeface: Inter, everywhere — with two route-scoped exceptions.** Loaded once, self-hosted by next/font in
  `app/layout.tsx`, published as `--tn-font-sans` on `<html>`. Nothing else loads
  Inter — `(site)/layout.tsx` reads that same variable rather than loading its own copy.
  The role tokens (`--tn-mono`, `--tn-sans`, `--tn-title`, `--tnx-font-*`, `--pv-*`) all
  survive and all resolve to it, so a `font-family:` rule almost never needs editing;
  repoint the token instead. **Losing the mono face means the digits no longer align on
  their own**: `.tn-terminal` sets `font-variant-numeric: tabular-nums` and it inherits
  to the whole console, but anything rendering OUTSIDE that skin (the public camera
  pages, `/admin`, `/locate`, `/`) has to ask for it per rule. Two surfaces are NOT
  Inter and cannot cheaply be: `app/api/og/route.tsx` (Satori needs font bytes) and
  MapLibre's own labels (`MAP_LABEL_FONT` is served by the basemap's glyph server).
  **The landing page is the live exception: Archivo**, loaded by `app/(site)/page.tsx`
  through next/font (self-hosted, no request to Google) and published as `--lp-font`
  on `.lp-root`, where `app/landing.css` reads it. It is loaded in the PAGE, not in a
  layout, so no other route downloads it: not `/app`, and not `/privacy`, which shares
  the `(site)` layout. It is credited in the landing footer beside Inter, which still
  sets the Discord pop-up there.
  **Permanent Marker was the first exception and is now a leftover.** `(site)/layout.tsx`
  still loads it as `--pv-font-marker`, but the graffiti it was for left `/` with the
  surveillance section on 2026-10-05, so nothing on `/` or `/privacy` uses it and the
  landing footer no longer credits it. Remove that loader in the follow-up that removes
  the old `.pv-*` landing rules. One marketing face, one route, one credit — do not
  let a third one in on this precedent.

## Numbers, and how to re-check them
Never quote a count from memory — every figure below was measured, and each rots.
Re-measure before putting a number in a README, a CV or a PR description.

| Claim | Value | How it was checked (2026-08-10) |
|---|---|---|
| Cameras | 19,328 total / 19,112 online | `GET /api/coverage` on prod |
| Camera feeds | 51 feeds (50 from adapters + 1 discovered), 59 agency networks, 20 countries | `CAMERA_FEED_COUNT` in `lib/sources/registry.ts`; countries = distinct `country: "XX"` literals across `lib/sources/*.ts`. **Pinned** by `tests/unit/claude-md-counts.test.ts`, so unlike the rows below it this one cannot silently rot — it was wrong twice before that test existed (11/7 stated against a tree holding 12/8, then 14/9). Agencies went 25 → 26 on 2026-09-05 with Louisiana DOTD, which is a tenth **system inside the existing `castlerock` feed**, not a feed of its own — which is exactly why feeds did not move. On 2026-10-16 New York left `castlerock` (511ny.org moved to the CARS platform) and came back as one of six CARS feeds, and four single-state adapters joined: feeds 17 → 27, agencies 26 → 35. The same day the world camera audit added 25 more feeds (19 keyless, 6 dormant until a free key is set) and 10 countries: feeds 27 → 52, agencies 35 → 60, countries 11 → 21. On 2026-10-17 Hungary's Utinform feed was removed (its API refuses the production IP): feeds 52 → 51, agencies 60 → 59, countries 21 → 20. |
| Signal layers | **37 registered (36 map layers + 1 data-only); 33 returning data, 2 empty, 1 unmeasured** (2026-09-19), plus `gliders` (2026-10-16) | Every `SIGNALS[i].fetch()` run against the live upstreams with prod's key set. `gliders` (Open Glider Network) was added on 2026-10-16 and measured only from provenance-1, not from production: 74 aircraft at 20:15Z. Like `headline-places`, it has a zero row in `lib/marketing/coverage-audit.data.ts` whose note carries that figure. `headline-places` was added on 2026-09-19 and IS measured, unlike the row it sits beside: it needs no key and no push, so its fetch() was run directly against the live feeds — 71 pins over 60 countries from 231 of 440 headlines. `lib/marketing/coverage-audit.data.ts` still carries a zero row for it, because that file is one production run and mixing a second measurement into its totals would break the reconciliation its own test enforces; the row's note carries the real figures. The 2 empties are ReliefWeb and ENTSO-E grid load — not broken adapters. The unmeasured one was `news-coverage`, registered 2026-09-16. It and `cyber-c2` were removed on 2026-10-17 (no working feed on production: Feodo Tracker has listed no current C2 since 2026-03, and the coverage pins were held pending an accuracy review). Their rows stay in `lib/marketing/coverage-audit.data.ts` until the next production run, which `landing-audit.test.ts` allows for any id in `RETIRED_SIGNAL_IDS`. NOTE (2026-09-08): ReliefWeb is NOT key-gated. `api.reliefweb.int/v1` answers `410 Gone` ("decommissioned, use v2") and v2 answers `403 AccessDeniedHttpException: You are not using an approved appname`. An appname is a FREE registration at apidoc.reliefweb.int/parameters#appname, so this one is unblockable by asking, not by paying. |
| Console presets | 3 (2026-09-16) | `BUILTIN_PRESETS` in `lib/console/presets.ts`, pinned by `console-presets.test.ts` (id list, and by `readme-counts.test.ts` against the README's "three presets"). Globe, News and Streets. The five rail boards (World, Nature, Skywatch, Infrastructure, Intel) were retired on 2026-09-15 on request, together with the Apple-style hover nav panel; News was added on 2026-09-16 to give the merged headline stream a surface. Globe is deliberately empty; Streets is the camera wall. |
| Cards per rail | max 4 | `MAX_CARDS_PER_RAIL` in `presets.ts`. A board with more cards than one rail shows **spreads to a second rail** rather than scrolling. Pinned at 1280x620, 1440x820 and 1920x1000. |
| Monitor variants | 13 | `BUILTIN_VARIANTS` in `lib/variants/builtins.ts` |
| Widget types | 82 registered (2026-10-27: Hong Kong's measured road speed joined; 81 after the three London road layers and the Roads group's rollup card joined; it was 77 on 2026-10-17, after `signal:cyber-c2` and `signal:news-coverage` left with their layers) | `listWidgetTypes()` after importing `lib/console/widgets`. Was 71 until the `cameras` grid was retired in favour of `camslot`, and 65 until `signal:news-coverage` registered with its layer on 2026-09-16 (every signal source mints a widget). NOTE: `tests/unit/widget-explainers.test.ts` does **not** assert this count — it asserts `> 40` and id uniqueness, plus a trust card for every registered type. THIS table's copy is unpinned and rots silently; the README's copy of the same figure is pinned by `tests/unit/readme-counts.test.ts`, which is what caught the retirement. Re-measure rather than trusting this row. |
| Unit tests | **4,264 cases / 403 files (2026-09-19)** | `npx vitest list` (collects without running — safe alongside other agents). Re-measured on feat/camera-tiers rebased onto origin/main at 15c0efe, which is the tree that ships. The camera-tier split added layer-key-migration; #258 added signal-detail-key-note. Those two landed on separate branches and BOTH moved `cases`, which is why rebasing one onto the other conflicted in exactly one place — see the header of lib/marketing/repo-facts.data.ts (deleted 2026-10-27, in git history), which predicted this and says to re-measure on the merged tree rather than pick a side. Earlier on 2026-09-18, the news comparison board added four files (news-diversity, news-framing, news-source-badge-disclosure, rail-world-headlines). The figure moved three times on 2026-09-16 alone — 4,029 / 389, then 4,044 / 390, then this — as the news board, the inspector rail, the area-colour picker and the news-depth branch each landed their own test files. This row said **1,414 / 215** until 2026-08-11: the suite had **more than doubled** while the table went on stating the old figure. Exactly the silent rot the header of this section warns about, and a reminder that "unpinned" here means "will be wrong", not "might be". |

## Live-source notes (verified 2026-08-10, these change)
- **Aircraft come from adsb.lol, not OpenSky.** OpenSky was removed on licensing grounds
  (`lib/sources/opensky.ts` `fetchAircraftOnce` keeps the reasoning; the filename is a
  named follow-up). The live path is `lib/sources/adsb.ts` `fetchAdsbTypePull` behind
  Next's Data Cache (`planes-aircraft-v6`, revalidate 90 s since 2026-10-16, was 240 s;
  the console's freshness chip reads the snapshot's own `fetchedAt`). adsb.lol also serves the
  `military-air` signal layer, from the same per-IP rate-limit bucket. **That bucket is
  small (re-measured 2026-10-16: about three requests, then 10-20 s per token)**, so the
  pull is ONE request naming every type, and every adsb.lol request in the process waits
  its turn in `lib/http/hostLane.ts`. Four batches plus a `/v2/mil` poll in between is
  what dropped the GA batch from 3 of 5 prod snapshots. Do not add an adsb.lol call
  outside that lane.
- **GDELT left the live path on 2026-10-16.** An audit labelled a random sample: 86% of
  its conflict rows and 58% of its protest rows were not that event at that place. The
  `conflict` and `protests` layers now read UCDP's monthly verified events, U.S. Embassy
  alert feeds and UK/Canadian travel-advice changes (`lib/signals/conflict.ts`);
  `lib/signals/gdelt.ts` stays unregistered for its scripts and tests, and for the
  instability index's capped GDELT attention term (weight 0.03). The two notes
  below are its history.
- **GDELT is FIXED and live again** (was 404ing on `/api/v2/geo/geo`). The layer now reads
  the GCS event export instead. Prod check 2026-08-11: `/api/signals/conflict` returns
  `count: 300` with `coverage.available: 470` — i.e. an honest "300 of 470", not a bare
  300. The last blocker was a zip member sliced to end-of-file (`4ffcf7a`), which made
  production reject all 16 files while local decoded them fine.
- **GDELT rows are not incidents — do not re-assert them (2026-08-14).** Sampo caught prod
  showing "Use of military force · Bristol, UK" sourced from an article about a Perez
  Hilton TikTok livestream. Nothing was broken: the row cleared every guard because GDELT
  genuinely published it that way. The article referenced Christchurch, GDELT promoted the
  city name to actor `NZL` **with no actor type**, coded the violence vocabulary as CAMEO
  190, and geocoded the action to Bristol. One story seeded pins on three cities.
  Measured on the live window: that untyped-actor shape was **388 of 1,037 shipped rows
  (37%)**. Two things follow, both now enforced in `lib/signals/gdelt.ts`:
  (a) **require a typed actor** — costs ~30% of places and is the only guard that works;
  `NumSources >= 2` was measured and REJECTED (391 places → 22, and Gaza/Ukraine/Syria to
  zero). (b) **never state a CAMEO label as fact** — `toCoverageProps()` attributes it
  (`codedAs`) beside an explicit "not a verified incident", because no filter can remove
  the residue (a court report about a shooting has real police actors and survives
  everything). The layer is labelled **"Conflict coverage"**, not "Conflict". Regression
  fixture: `tests/fixtures/gdelt-bristol-miscoding.export.tsv` (verbatim rows).
- **`/api/planes` is worldwide (2026-09-06).** Until then the layer was a 40-cell
  point+radius sweep of adsb.lol, and from Vercel's shared egress IP the per-IP rate limit
  let 1 of 40 cells through: prod served 1,311 aircraft, all between 2° and 15° E, drawn
  as one or two dense discs. `lib/sources/adsb.ts` now pulls `/v2/type/{list}` (four
  paced batches of 226 designators then; ONE request of 243 since 2026-10-16, 10,346
  positioned aircraft that day) and `lib/planes/sample.ts`
  caps to 3,000 as a proportional spatial sample. Measured through the code path on
  2026-09-06: 131 ten-degree cells, largest 7.1%, all seven continents. Re-measure with
  `node scripts/probe-planes.mjs` (under `vercel env run` against a preview). Two honest
  limits remain and the coverage `rule` states both: receivers are where volunteers put
  them, and only listed types are asked for.
- **Road-surface readings are rare, and the Finland join table rots silently (2026-09-03).**
  Measured live through the real code path against both upstreams: **19,808 cameras, 912 carry
  a surface field, 649 survive every disqualification rule — 3.3%**. Only Estonia (180 cameras,
  the field was always in the `outFields=*` response and was simply being discarded) and
  Finland publish one. Of the Finnish readings, 89 sensors report their own fault and 147 of 742
  come from a station past the 10 km cap; the worst operator-declared pairing is 89 km, against
  Estonia's 37 — which is why the cap is applied to Finland too rather than trusting the
  operator's own idea of "nearest". The camera-to-station pairing lives in the committed
  `lib/sources/digitraffic.join.data.ts` because the field is only on the per-station detail
  endpoint: building it took 813 live requests, doing it per refresh would blow the feed budget,
  and doing it lazily would make a tile visibly change tier a second after it rendered. **No test
  can detect this table going stale** — a station added since the capture reads as derived, which
  is the right failure direction but still needs `scripts/gen-digitraffic-join.mjs` re-run
  occasionally.
- **Ventusky cannot be a camera feed, and the reason is not taste (2026-09-05).** It was
  asked for by URL (`ventusky.com/webcam-943487903`) and an adapter was written against a
  guessed `https://www.ventusky.com/api/webcams`. That URL 302s to the homepage; it does
  not exist. The only public webcam endpoint the site's own bundle calls is
  `https://webcams.ventusky.com/api/api.get_nearest_camera.php?lat={lat}&lon={lon}&count={count}`,
  which is **nearest-by-coordinate** — the same structural wall as `/api/point-weather`,
  because `fetchRegistry()` takes no arguments and must return a global list. Two things
  settle it beyond the plumbing: that endpoint returns rows stamped `"source":"bihamk.ba"`,
  so the camera in the pasted URL is a **re-host of BIHAMK**, which `lib/sources/bihamk.ts`
  already serves operator-primary (the fixture even names "Sarajevo-Skenderija"); and
  aggregation is what the operator-primary policy exists to refuse. Do not re-add it. The
  image CDN, if it is ever needed for something else, is
  `https://webcams.ventusky.com/data/{last 2 digits of id}/{id}/latest_thumb.jpg`, **not**
  `images.ventusky.com/{id}.jpg`.
- **Windy's free tier caps offset at 1,000, and that is what shapes the webcam harvest
  (measured 2026-09-05).** `limit>50` is a 400; `offset=2000` is a 400 reading
  `"Offset is over API tier limit 1000!"`. So one bbox yields at most **1,050 rows**, and
  the catalogue is read by an adaptive quadtree that splits any box over that capacity —
  285 probes resolve the planet into 196 leaves covering 100% of a 70,686-webcam
  inventory. Professional (offset 10,000) costs **€9,990/year** and buys nothing the
  quadtree does not already deliver. **Windy publishes no daily request quota and returns
  no rate-limit headers**, so the per-cycle budget is a precaution against an unknown
  ceiling, not a measured limit — lower it before anything else if refusals appear.
- **Four layers were removed on 2026-09-05, and two of them for measured reasons.** Asked for:
  the Country Instability Index, US airport disruption (FAA) and City weather. Measured dead:
  **ACLED** — the OAuth password grant issues a valid 811-char token and `GET /api/acled/read`
  then answers **403**, verified directly against acleddata.com, so it had been falling through
  to its GDELT fallback on every cycle and deleting it changed no score; and **food security** —
  WFP withdrew the keyless HungerMap feed, so the layer only ever published its own "unavailable"
  placeholder. The CII was NOT deleted, it became the first `dataOnly` source: the Brief, the
  Country Instability widget, the Strategic Risk panel and the country dossier all still read it.
  Two consequences worth knowing, both now pinned by tests: with ACLED gone the conflict factor is
  GDELT article volume only, whose ramp hard-caps at 0.55, so **the index can no longer exceed
  82/100** and conflict can be out-ranked as a driver by displacement. And on the live feed today
  it tops out near **32/100 with most countries on 1 of 4 factors** — the food and ACLED inputs
  are both gone, so nearly every score is a floor. Read the Brief's numbers with that in mind.
  **Superseded 2026-10-16:** the index was rebuilt on seven factors (UCDP deaths, INFORM
  Severity, FEWS NET, INFORM Risk + WGI, UNHCR as a share of population, GDELT capped,
  IODA critical alerts plus ISOC Pulse verified shutdowns; see lib/signals/instability.ts). Its ceiling is now 99, and a
  measured zero counts toward coverage, so the countries FEWS NET monitors read 7/7.
- Key-gated layers dormant in prod: none since 2026-10-16. Grid load is keyless for GB, France, Denmark and
  Australia since 2026-10-16; only its ENTSO-E and EIA parts wait for their keys. ReliefWeb is keyless
  since 2026-10-16: it reads ReliefWeb's own weekly export on HDX plus IFRC GO appeals. Live with keys: OpenAQ
  stations, AIS (AIS was listed as dormant here and is not — measured 26 then 53
  vessels through the real adapter on 2026-09-05). NASA FIRMS went keyless on 2026-10-16:
  prod's key drew HTTP 400 for five weeks, so Active fires reads the keyless global
  24 h files. Canonical env-var names live in `docs/API_KEYS.md` —
  use those names, never invent one (the README used to say `WINDY_KEY`; it is
  `WINDY_WEBCAMS_API_KEY`).
- **AISStream allows 3 subscribed sockets per ACCOUNT and 3 open sockets per IP, and
  production holds one (2026-10-28).** A 4th is refused on the spot (close 1006, zero
  messages, measured). Every dev server that runs with `AISSTREAM_API_KEY` set and is
  asked for `/eye` or `/api/signals/ais` opens another, so **run a dev server keyless**:
  `AISSTREAM_API_KEY= npx next dev -p <port>` (Next keeps an empty process env var over
  `.env.local`). Without the key `/api/eye/vessels` still serves Digitraffic's Finnish and
  Baltic waters and says `stream: "off"`. The one socket subscribes to the WHOLE WORLD,
  Class A and B, five message types: measured 88 messages and 49 KB a second, 11,583
  vessels positioned in 4 minutes (1,956 held over 20 minutes by the 11 chokepoint boxes
  it replaced). The console layer filters that back to what it always showed
  (`mergeVessels`' chokepoint test, `consoleStream` dropping Class B, cap 1,200).
  BarentsWatch stays off until its two env vars exist; `lib/eye/vesselFeed.ts` then asks
  it for Norway's box by itself.

## State of play
See `ROADMAP.md` and `docs/superpowers/research/2026-08-09-competitive-sweep.md`.
