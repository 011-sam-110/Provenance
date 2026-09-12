# CLAUDE.md — Provenance (repo `Provenance`)

A Next.js 15 single-page global situational-awareness map. **Product name: Provenance.**
**Prod domain: `provenance-online.vercel.app`** — that is the only domain we ship on.
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
- `components/marketing/*` — landing page only. ONE scroll subscriber
  (`GlobeStage.tsx`) publishes CSS custom properties; nothing else may add a scroll
  listener and nothing may set React state per frame. `.pv-*` tokens in
  `app/provenance.css`, scoped to `.pv-root` so they cannot reach the console.
- **The whole page is ONE night, and the globe is its only stage.** `GlobeStage`
  mounts a single fixed `HeroGlobe` behind every section and choreographs it from a
  rAF loop: it writes `--pv-globe-x/y/scale/alpha` on `.pv-stage`, and calls
  `controls.focus(lon, lat, label)` / `controls.rest()` as the reader enters and
  leaves a stepped section. There is no second globe and no remount — a step change
  is an `easeTo`, not a new map.
  The old **night → day → night** ground ramp is GONE, along with `--pv-g`,
  `--pv-bar-g` and the sticky bar that straddled two grounds. `.pv-night` is still
  server-rendered in `(site)/layout.tsx` but is now a no-op alias: `provenance.css`'s
  base tokens ARE the night set. The class stays because `/privacy` keys off it.
- **Pin labels are built from the same rows the copy prints.** `page.tsx` derives
  every `focus()` label from the record the section renders beside it, so the globe
  cannot caption a figure the text does not say. Do not hand-write a pin label.
- The hero globe renders **every registered signal layer**, drained into three
  aggregated MapLibre sources (points / lines / fills) exactly like `WorldMap`. The
  layer list is read from `SOURCE_CATALOG` in the server component and passed down
  as a prop — never imported into the client, or all ~39 adapters land in the
  browser bundle. Adding an adapter adds it to the globe with no edit to the hero.
- `zoomToFill()` in `HeroGlobe` uses a MEASURED constant, not a derivation:
  MapLibre's globe is a perspective render, so apparent diameter is not linear in
  2^z. `verify-provenance.mjs` asserts the fill ratio so an upgrade that moves it
  fails loudly instead of quietly reframing the hero.
- **Never type a count into the landing page.** `lib/marketing/wall.ts` and the source
  wall it fed are gone; the rule outlived them. Every figure on `/` now comes from one
  of three committed files, each of which can be re-derived:
  `coverage-audit.data.ts` (GENERATED by `scripts/gen-landing-audit.mjs` from a
  production run of `scripts/country-event-breakdown.mts` — never hand-edit it, and it
  carries its own `AUDIT_MEASURED_AT`, which the page prints beside every figure taken
  from it), `camera-facts.data.ts` and `repo-facts.data.ts` (measured, each pinned by a
  test that recomputes it), and `surveillance.data.ts` (one published study, at one
  scope, with the verbatim quote behind every row recorded in `docs/LANDING_SOURCES.md`).
  That doc also lists the figures REMOVED from the first draft because no source carried
  them — read it before adding a number, it is the more useful half.
- `app/` — routes + API. `app/api/*` are internal Next handlers (no user auth):
  `cameras`, `camera`, `coverage`, `planes`, `flight`, `satellites`, `signals/[id]`,
  `webcams`, `webcam-image`, `markets`, `news`, `brief`, `advisory`, `recon`, `geocode`,
  `near`, `geolocate`, `proxy`, `hls`, `discord`, `telegram`.
- `components/WorldMap.tsx` — the single MapLibre globe→2D instance; all layers are data-driven.
- `components/shell/*` — thin console chrome (StatusBar, CommandPalette, BreakingBanner, panels).
- `components/console/*` — the widget workspace (segments + centre stage + resizable widget frames).
- `lib/sources/*` — one adapter per camera feed → `Camera` (zod), merged in `registry.ts` (17 feeds).
  Sixteen are hand-written adapters; the seventeenth was admitted through discovery and shares
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
- **`CAMERA_FEED_COUNT` is `16 + ADMITTED_FEEDS.length`.** It is **17** today: Houston
  TranStar was admitted on 2026-08-20, the first network to reach the map through discovery
  rather than a hand-written adapter. When it moves, the two pinning tests go red until this
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
- `lib/signals/*` — one adapter + one `registry.ts` entry per source (**34 registered, 33 of them map layers**).
  A source may set `dataOnly: true` (see `types.ts`) meaning registered + fetchable but NOT a
  map layer: no catalog entry, no rail row, no pin, unreachable from monitors/variants/`?sig=`.
  Layer-facing code reads **`MAP_SIGNALS`**; the route, `/api/status` and the explainers read
  `SIGNALS`. Importing `SIGNALS` into something that draws or lists layers silently turns every
  data-only source back into a layer. Today the only one is the Country Instability Index.
- `lib/console/*` — widget registry, presets (**7 presets** in `presets.ts`), store, share (`?c=` layout URL).
  **A preset is the whole workspace**: core layers + signal layers + the board that reads
  them, and the Sources rail's tiles and the ⌘K Profiles list drive the same seven. There is
  no `lib/monitors.ts` any more — its six layer-only "monitors" merged in here.
  `shellLayoutStore` (`store.ts`) is the ONLY layout the app renders. `variantStore`'s
  `layoutOverrides` slot is not drawn by anything — do not write a new feature to it
  (the Source Catalog's ＋ used to, which is why it silently did nothing).
- **The console top bar EXPANDS on hover, Apple-style** — `components/terminal/TerminalHeader.tsx`
  + `NavPanel.tsx`, state in `lib/console/navPanel.ts`, per-scene memory in
  `lib/console/sceneChrome.ts`. **Hover previews, click commits**: hovering a board tab
  grows the whole bar into that board's quick settings + a widget show/hide list without
  switching board; clicking still calls `applyPreset` exactly as before. **Scene = board =
  preset**, one thing — `sceneId` IS a `ConsolePreset.id`; do not invent a second concept.
  Hiding is a **paint-time filter** (`visibleWidgets`, applied at two render sites), never a
  layout mutation: a hidden widget keeps its slot, its config and its place in the capacity
  count. Chrome is a **sibling store** (`tn.console.sceneChrome.v1`), deliberately orthogonal
  to `boards.ts`, so Reset and `?c=` links needed no changes — which also means share links
  do NOT carry hidden state. Full write-up, including the two subscription traps that made
  this silently do nothing while every unit test stayed green: `docs/CONSOLE_NAV.md`.
- `lib/variants/*` — the top-left "variant" switcher (13 built-in monitor profiles in `variants/builtins.ts`).
- `lib/i18n/*` — EN/ES/FR catalog + store.
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
- Calm light identity; `.tn-*` CSS tokens in `app/globals.css`.
- **ONE typeface: Inter, everywhere — with one route-scoped exception.** Loaded once, self-hosted by next/font in
  `app/layout.tsx`, published as `--tn-font-sans` on `<html>`. Nothing else loads a
  font — `(site)/layout.tsx` reads that same variable rather than loading its own copy.
  The role tokens (`--tn-mono`, `--tn-sans`, `--tn-title`, `--tnx-font-*`, `--pv-*`) all
  survive and all resolve to it, so a `font-family:` rule almost never needs editing;
  repoint the token instead. **Losing the mono face means the digits no longer align on
  their own**: `.tn-terminal` sets `font-variant-numeric: tabular-nums` and it inherits
  to the whole console, but anything rendering OUTSIDE that skin (the public camera
  pages, `/admin`, `/locate`, `/`) has to ask for it per rule. Two surfaces are NOT
  Inter and cannot cheaply be: `app/api/og/route.tsx` (Satori needs font bytes) and
  MapLibre's own labels (`MAP_LABEL_FONT` is served by the basemap's glyph server).
  **The exception is Permanent Marker**, loaded by `(site)/layout.tsx` as
  `--pv-font-marker` and used only for the graffiti scrawled over the surveillance
  section. It is loaded in the ROUTE GROUP, not the root layout, so `/app` never
  downloads it, and it is credited in the footer beside Inter. One marketing face, one
  route group, one credit — do not let a second one in on this precedent.

## Numbers, and how to re-check them
Never quote a count from memory — every figure below was measured, and each rots.
Re-measure before putting a number in a README, a CV or a PR description.

| Claim | Value | How it was checked (2026-08-10) |
|---|---|---|
| Cameras | 19,328 total / 19,112 online | `GET /api/coverage` on prod |
| Camera feeds | 17 feeds (16 adapters + 1 discovered), 26 agency networks, 11 countries | `CAMERA_FEED_COUNT` in `lib/sources/registry.ts`; countries = distinct `country: "XX"` literals across `lib/sources/*.ts`. **Pinned** by `tests/unit/claude-md-counts.test.ts`, so unlike the rows below it this one cannot silently rot — it was wrong twice before that test existed (11/7 stated against a tree holding 12/8, then 14/9). Agencies went 25 → 26 on 2026-09-05 with Louisiana DOTD, which is a tenth **system inside the existing `castlerock` feed**, not a feed of its own — which is exactly why feeds did not move. |
| Signal layers | **34 registered (33 map layers + 1 data-only); 32 returning data, 2 empty** (2026-09-08) | Every `SIGNALS[i].fetch()` run against the live upstreams with prod's key set. The 2 empties are ReliefWeb and ENTSO-E grid load — not broken adapters. NOTE (2026-09-08): ReliefWeb is NOT key-gated. `api.reliefweb.int/v1` answers `410 Gone` ("decommissioned, use v2") and v2 answers `403 AccessDeniedHttpException: You are not using an approved appname`. An appname is a FREE registration at apidoc.reliefweb.int/parameters#appname, so this one is unblockable by asking, not by paying. |
| Console presets | 7 (2026-09-07) | `BUILTIN_PRESETS` in `lib/console/presets.ts`, pinned by `console-presets.test.ts` (id list, and by `readme-counts.test.ts` against the README's "seven presets"). Went 7 → 2 on 2026-09-04 and back to 7 now, but they are not the same seven and not the same kind of thing: a preset is the whole workspace (core layers + signal layers + board), because `lib/monitors.ts` merged into this file. Globe is still deliberately empty. **Ground** and **Calm** — two of the six old monitors — are retired rather than converted; both were subtractive layer states meaning "cameras", which is what Streets already is. |
| Cards per rail | max 4 | `MAX_CARDS_PER_RAIL` in `presets.ts`. A board with more cards than one rail shows **spreads to a second rail** rather than scrolling — Infrastructure is left+right, Intel and World are two rails each. Pinned at 1280x620, 1440x820 and 1920x1000. |
| Monitor variants | 13 | `BUILTIN_VARIANTS` in `lib/variants/builtins.ts` |
| Widget types | 65 registered (2026-09-08) | `listWidgetTypes()` after importing `lib/console/widgets`. Was 71 until the `cameras` grid was retired in favour of `camslot`. NOTE: `tests/unit/widget-explainers.test.ts` does **not** assert this count — it asserts `> 40` and id uniqueness, plus a trust card for every registered type. THIS table's copy is unpinned and rots silently; the README's copy of the same figure is pinned by `tests/unit/readme-counts.test.ts`, which is what caught the retirement. Re-measure rather than trusting this row. |
| Unit tests | **3,814 cases / 374 files (2026-09-12)** | `npx vitest list` (collects without running — safe alongside other agents). This row said **1,414 / 215** until today, measured 2026-08-11: the suite had **more than doubled** while the table went on stating the old figure. Exactly the silent rot the header of this section warns about, and a reminder that "unpinned" here means "will be wrong", not "might be". |

## Live-source notes (verified 2026-08-10, these change)
- **Aircraft come from adsb.lol, not OpenSky.** OpenSky was removed on licensing grounds
  (`lib/sources/opensky.ts` `fetchAircraftOnce` keeps the reasoning; the filename is a
  named follow-up). The live path is `lib/sources/adsb.ts` `fetchAdsbTypePull` behind
  Next's Data Cache (`planes-aircraft-v5`, revalidate 240 s). adsb.lol also serves the
  `military-air` signal layer, from the same per-IP rate-limit bucket.
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
  as one or two dense discs. `lib/sources/adsb.ts` now pulls `/v2/type/{list}` in four
  paced batches (226 designators, ~9,100 positioned aircraft) and `lib/planes/sample.ts`
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
- Key-gated layers dormant in prod: ReliefWeb, ENTSO-E grid. Live with keys: NASA FIRMS,
  OpenAQ stations, AIS (AIS was listed as dormant here and is not — measured 26 then 53
  vessels through the real adapter on 2026-09-05). Canonical env-var names live in `docs/API_KEYS.md` —
  use those names, never invent one (the README used to say `WINDY_KEY`; it is
  `WINDY_WEBCAMS_API_KEY`).

## State of play
See `ROADMAP.md` and `docs/superpowers/research/2026-08-09-competitive-sweep.md`.
