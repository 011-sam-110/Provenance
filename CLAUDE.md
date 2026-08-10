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
> Known leftovers in code (not yet fixed, out of scope for docs work):
> `lib/export.ts:47` names every CSV/GeoJSON download `worldmonitor-*`, and
> `lib/events/alerting.ts:186` sends `"World Monitor — Disasters & Events"` as an alert
> source. Both are user-visible. Fix them when touching those files.

## Build gate
- Roadmap: `ROADMAP.md` (driven by the `/goal` milestone loop — one gated milestone per invocation)
- Gate: `npx tsc --noEmit && npm test`   (full check: `npm run build`)
- UI evidence: Playwright screenshots to `persona-shots/`
- Commit: one commit per milestone, `M<n>: <name>`, **solo attribution** (matches every existing commit — no co-author trailer)
- PR: fresh branch + PR per milestone/group. Sampo live-merges and deletes branches fast → always branch off the latest `main` and open a new PR for follow-ons.

## Shape
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
| Unit tests | 956 cases / 191 files | `npx vitest list` (collects without running — safe alongside other agents) |

## Live-source notes (verified 2026-08-10, these change)
- **Aircraft come from OpenSky, not adsb.lol.** `lib/sources/opensky.ts` pulls one global
  `/states/all` snapshot behind Next's Data Cache. adsb.lol is still used, but only for
  the `military-air` signal layer. On the 2026-08-10 check prod `/api/planes` returned
  `{"count":0}` twice while OpenSky `/states/all` answered 200 with ~1 MB of state
  vectors from a home IP — consistent with the anonymous credit cap being hit on the
  deployment's IP and there being no last-good snapshot to serve. Worth a look.
- **GDELT's `/api/v2/geo/geo` is 404ing**, so the `conflict` and `protests` layers return
  an empty set. Dormant-safe behaviour is working (200 + `[]`, never a 5xx), but the
  layers are dark. `api.gdeltproject.org/api/v2/doc/doc` answers 429, so the host is up.
- Key-gated layers dormant in prod: ACLED, ReliefWeb, ENTSO-E grid, AIS. Live with keys:
  NASA FIRMS, OpenAQ stations. Canonical env-var names live in `docs/API_KEYS.md` —
  use those names, never invent one (the README used to say `WINDY_KEY`; it is
  `WINDY_WEBCAMS_API_KEY`).

## State of play
See `ROADMAP.md` and `docs/superpowers/research/2026-08-09-competitive-sweep.md`.
