# CLAUDE.md — OpenData (repo `TrafficNerd-V2`)

A Next.js 15 single-page global situational-awareness map. **Product name: OpenData.**
**Prod domain: `traffic-nerd-v2.vercel.app`** — that is the only domain we ship on.
Deployed product = `origin/main`.

> **Naming guard.** `worldmonitor.app` / "World Monitor" is a **competitor**
> (`koala73/worldmonitor`, **AGPL-3.0**), not us. Never write it as our domain, our
> product name, or in user-visible strings — their README reserves branding rights, and
> AGPL §13 triggers on network interaction, so lifting any of their *code* would force
> OpenData to relicense. Read their repo for **facts only** (endpoint URLs, cadences).
> `simplifaisoul/osiris` is **MIT** and may be copied **with** an attribution header.
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
- The source wall + counts are generated from `SOURCE_CATALOG` via `lib/marketing/wall.ts`.
  Adding an adapter adds a card. Never type a count into the landing page.
- `app/` — routes + API. `app/api/*` are internal Next handlers (no user auth):
  `cameras`, `camera`, `coverage`, `planes`, `flight`, `satellites`, `signals/[id]`,
  `webcams`, `webcam-image`, `markets`, `news`, `brief`, `advisory`, `recon`, `geocode`,
  `near`, `geolocate`, `proxy`, `hls`, `discord`, `telegram`.
- `components/WorldMap.tsx` — the single MapLibre globe→2D instance; all layers are data-driven.
- `components/shell/*` — thin console chrome (StatusBar, CommandPalette, BreakingBanner, panels).
- `components/console/*` — the widget workspace (segments + centre stage + resizable widget frames).
- `lib/sources/*` — one adapter per camera feed → `Camera` (zod), merged in `registry.ts` (11 feeds).
- `lib/signals/*` — one adapter + one `registry.ts` entry per global-signal layer (35 registered).
- `lib/console/*` — widget registry, presets (**6 boards** in `presets.ts`), store, share (`?c=` layout URL).
  `shellLayoutStore` (`store.ts`) is the ONLY layout the app renders. `variantStore`'s
  `layoutOverrides` slot is not drawn by anything — do not write a new feature to it
  (the Source Catalog's ＋ used to, which is why it silently did nothing).
- `lib/variants/*` — the top-left "variant" switcher (13 built-in monitor profiles in `variants/builtins.ts`).
- `lib/i18n/*` — EN/ES/FR catalog + store.

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
| Camera feeds | 11 adapters, 7 countries | `lib/sources/registry.ts` |
| Signal layers | 35 registered; 24 returning data, 11 empty | `GET /api/signals/<id>` for every id in `SIGNALS` |
| Console boards | 6 | `BUILTIN_PRESETS` in `lib/console/presets.ts` |
| Monitor variants | 13 | `BUILTIN_VARIANTS` in `lib/variants/builtins.ts` |
| Widget types | 69 registered (2026-08-11) | `listWidgetTypes()` after importing `lib/console/widgets` — asserted in `tests/unit/widget-explainers.test.ts` |
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
- **`/api/planes` still returns `{"count":0}` in prod** (re-checked 2026-08-11, after the
  coverage work landed). The cap is now honest, but the layer is empty: OpenSky's
  anonymous credit cap appears to be hit on the deployment's IP, and there is no last-good
  snapshot to fall back on. The honest fix is a persisted last-good snapshot and/or
  credentials — not a louder error. Still open.
- Key-gated layers dormant in prod: ACLED, ReliefWeb, ENTSO-E grid, AIS. Live with keys:
  NASA FIRMS, OpenAQ stations. Canonical env-var names live in `docs/API_KEYS.md` —
  use those names, never invent one (the README used to say `WINDY_KEY`; it is
  `WINDY_WEBCAMS_API_KEY`).

## State of play
See `ROADMAP.md` and `docs/superpowers/research/2026-08-09-competitive-sweep.md`.
