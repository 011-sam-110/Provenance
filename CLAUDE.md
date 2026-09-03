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
> returns 4 hits and **all four are comments** naming the competitor as a fact — in
> `i18n/catalog.ts`, `monitors.ts`, `sources/keyRequirements.ts` and `api/og/route.tsx`
> (that last one documents the literal it replaced). Those are allowed. What is banned is
> the name in a **user-visible string**, and there are none. Expect the grep to be noisy;
> read each hit before "fixing" it.

## Build gate
- Roadmap: `ROADMAP.md` (driven by the `/goal` milestone loop — one gated milestone per invocation)
- Gate: `npx tsc --noEmit && npm test`   (full check: `npm run build`)
- UI evidence: Playwright screenshots to `persona-shots/`
- Commit: one commit per milestone, `M<n>: <name>`, **solo attribution** (matches every existing commit — no co-author trailer)
- PR: fresh branch + PR per milestone/group. Sampo live-merges and deletes branches fast → always branch off the latest `main` and open a new PR for follow-ons.

## Shape
- **`/` is the marketing site, `/app` is the console.** `app/(site)/` holds the landing
  page (its own layout loads the three marketing typefaces so `/app` never downloads
  them); `app/(console)/app/` holds the shell. `/` forwards any request carrying `?v=`
  or `?c=` to `/app` with the query intact — shared links and OG cards were minted
  against `/`, so removing that shim breaks every link anyone has already sent.
- `components/marketing/*` — landing page only. ONE scroll subscriber
  (`ScrollGround.tsx`) publishes CSS custom properties; nothing else may add a scroll
  listener and nothing may set React state per frame. `.pv-*` tokens in
  `app/provenance.css`, scoped to `.pv-root` so they cannot reach the console.
- The hero is a full-bleed **night stage** (`HeroStage` → `HeroGlobe`), not a plate
  beside the copy. The ground ramp runs **night → day → night**: `--pv-g` starts at
  1, lifts across the hero, and plunges back behind the Adapter panel. `.pv-night`
  is server-rendered in `(site)/layout.tsx` so a cold load does not flash daylight.
  The sticky bar reads `--pv-bar-g` (the ground *directly beneath it*), not `--pv-g`
  — it is the one element that can straddle two grounds at once.
- The hero globe renders **every registered signal layer**, drained into three
  aggregated MapLibre sources (points / lines / fills) exactly like `WorldMap`. The
  layer list is read from `SOURCE_CATALOG` in the server component and passed down
  as a prop — never imported into the client, or all ~39 adapters land in the
  browser bundle. Adding an adapter adds it to the globe with no edit to the hero.
- `zoomToFill()` in `HeroGlobe` uses a MEASURED constant, not a derivation:
  MapLibre's globe is a perspective render, so apparent diameter is not linear in
  2^z. `verify-provenance.mjs` asserts the fill ratio so an upgrade that moves it
  fails loudly instead of quietly reframing the hero.
- The source wall + counts are generated from `SOURCE_CATALOG` via `lib/marketing/wall.ts`.
  Adding an adapter adds a card. Never type a count into the landing page.
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
- `lib/signals/*` — one adapter + one `registry.ts` entry per global-signal layer (35 registered).
- `lib/console/*` — widget registry, presets (**7 boards** in `presets.ts`), store, share (`?c=` layout URL).
  `shellLayoutStore` (`store.ts`) is the ONLY layout the app renders. `variantStore`'s
  `layoutOverrides` slot is not drawn by anything — do not write a new feature to it
  (the Source Catalog's ＋ used to, which is why it silently did nothing).
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

## Numbers, and how to re-check them
Never quote a count from memory — every figure below was measured, and each rots.
Re-measure before putting a number in a README, a CV or a PR description.

| Claim | Value | How it was checked (2026-08-10) |
|---|---|---|
| Cameras | 19,328 total / 19,112 online | `GET /api/coverage` on prod |
| Camera feeds | 17 feeds (16 adapters + 1 discovered), 25 agency networks, 11 countries | `CAMERA_FEED_COUNT` in `lib/sources/registry.ts`; countries = distinct `country: "XX"` literals across `lib/sources/*.ts`. **Pinned** by `tests/unit/claude-md-counts.test.ts`, so unlike the rows below it this one cannot silently rot — it was wrong twice before that test existed (11/7 stated against a tree holding 12/8, then 14/9). |
| Signal layers | 35 registered; 24 returning data, 11 empty | `GET /api/signals/<id>` for every id in `SIGNALS` |
| Console boards | 7 (2026-08-15) | `BUILTIN_PRESETS` in `lib/console/presets.ts`. `tests/unit/console-presets.test.ts` pins the exact id list, and `tests/unit/tour-board-copy.test.ts` fails if the guided tour states a different number — so this row cannot silently rot. |
| Monitor variants | 13 | `BUILTIN_VARIANTS` in `lib/variants/builtins.ts` |
| Widget types | 71 registered (2026-08-15) | `listWidgetTypes()` after importing `lib/console/widgets`. NOTE: `tests/unit/widget-explainers.test.ts` does **not** assert this count — it asserts `> 40` and id uniqueness, plus a trust card for every registered type. Nothing fails when this number drifts, so re-measure it rather than trusting the table. |
| Unit tests | 1,414 cases / 215 files (2026-08-11) | `npx vitest list` (collects without running — safe alongside other agents) |

## Live-source notes (verified 2026-08-10, these change)
- **Aircraft come from OpenSky, not adsb.lol.** `lib/sources/opensky.ts` pulls one global
  `/states/all` snapshot behind Next's Data Cache. adsb.lol is still used, but only for
  the `military-air` signal layer. On the 2026-08-10 check prod `/api/planes` returned
  `{"count":0}` twice while OpenSky `/states/all` answered 200 with ~1 MB of state
  vectors from a home IP — consistent with the anonymous credit cap being hit on the
  deployment's IP and there being no last-good snapshot to serve. Worth a look.
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
- **`/api/planes` still returns `{"count":0}` in prod** (re-checked 2026-08-11, after the
  coverage work landed). The cap is now honest, but the layer is empty: OpenSky's
  anonymous credit cap appears to be hit on the deployment's IP, and there is no last-good
  snapshot to fall back on. The honest fix is a persisted last-good snapshot and/or
  credentials — not a louder error. Still open.
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
- Key-gated layers dormant in prod: ACLED, ReliefWeb, ENTSO-E grid, AIS. Live with keys:
  NASA FIRMS, OpenAQ stations. Canonical env-var names live in `docs/API_KEYS.md` —
  use those names, never invent one (the README used to say `WINDY_KEY`; it is
  `WINDY_WEBCAMS_API_KEY`).

## State of play
See `ROADMAP.md` and `docs/superpowers/research/2026-08-09-competitive-sweep.md`.
