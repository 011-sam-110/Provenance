# Marketing foundation: shareable OG cards + brand single-source

Date: 2026-07-11
Status: implemented (this PR), follow-ons noted
Branch: feat/marketing-foundation

## Why

"Should we start advertising?" became a strategy question. Findings from reviewing
the live product and a failed first Reddit attempt:

- The product is strong and demos well, but its demand is **event-driven**: it spikes
  when something breaks (a quake, an outage, a conflict) and people search "live map of
  X". The best free marketing is being the map people reach for and share in that moment.
- A single Bluesky bot is a fine tributary, not the main river. The compounding lever is
  infrastructure that makes **every share, everywhere, an advert**: rich link previews
  (OG cards) plus embeddable deep links. That same infrastructure powers a future event
  auto-poster, Show HN, and newsjacking.
- Two blockers recur and are the owner's to decide: the name (the live app says
  "OpenData", the intended domain is worldmonitor.app) and pointing that domain.

Full channel plan: `docs/marketing/README.md`.

## Scope of this PR (the foundation)

Pure code, shippable and verifiable with no account and without the name decision:

1. `lib/brand.ts` — single source of truth for display name, tagline, headline, pitch,
   accent, Ko-fi, and the canonical site URL (env-resolved). One edit to rename.
2. `lib/share/shareMeta.ts` — PURE `viewToShareMeta(view)`: turns a deep-link view
   (which board, via `?v=`) into a title, description, accent, and OG-card query.
   Unit-tested, same idiom as `lib/share/url.ts`.
3. `app/api/og/route.tsx` — dynamic 1200x630 OG card via `next/og` (Satori). Purely
   presentational; reads `t`/`s`/`c`. A future caller (the auto-poster) can pass an
   explicit event headline via `t`/`s`.
4. `app/page.tsx` — now a server component (ConsoleShell is the client boundary) with
   `generateMetadata` deriving a per-view title + OG/Twitter tags from `?v=`.
5. `app/layout.tsx` — brand-driven metadata defaults, `metadataBase`, and a default OG/
   Twitter card. `app/manifest.ts` and `lib/events/alerting.ts` moved onto BRAND (the
   latter fixes a leftover "World Monitor" string from an earlier rename).

## Key decisions

- **Rendered card, not a live-map screenshot.** OG images render on demand for a crawler;
  Satori has no canvas/WebGL and a headless browser cannot run in the OG route. A branded
  card carrying the headline is the standard approach and a large win over today's zero
  preview. A real-map thumbnail can come later, pre-rendered.
- **Parse `?v=` inline in the server component**, not via `decodeViewState`. That codec
  builds Sets over the layer/basemap/signal registries at import; pulling it into the RSC
  graph crashed SSR ("function is not iterable"). The card only needs the board id.
- **Name kept as "OpenData"** (the current deliberate brand) rather than a unilateral
  rebrand. Everything reads from BRAND now, so switching to "World Monitor" is one line.
- **Bluesky first** for the auto-poster: free bot-friendly API, links not suppressed,
  right audience. Telegram is a fast follow; X is paid, link-suppressed, and suspension-
  prone on new accounts, so deferred.

## Verification

- `npx tsc --noEmit` clean. `npm test` 922 passing (adds 6 share-meta tests).
- Live dev server: `/api/og` and `/api/og?t=...&c=...` return 200 image/png and render
  correctly (checked visually). `/` and `/?v=aviation` return 200 with the correct
  `<title>`, an absolute `og:image` pointing at `/api/og?...`, and `twitter:card`.

## Deferred / next (not in this PR)

- Embeddable `/embed` iframe view (completes the "every share is an advert" loop).
- Bluesky event auto-poster (needs a Bluesky account + app password).
- Programmatic SEO pages ("live X map").
- Centralize remaining copy strings onto BRAND (StatusBar wordmark + Ko-fi title,
  tour.ts, notifications.ts, SettingsPanel.tsx).
- Latent: `lib/share/url.ts` is not server-safe (registry init under RSC). Worth a proper
  fix only if it is ever needed server-side.

## Handoffs (need the owner)

- Decide the name and reconcile it with the domain (worldmonitor.app vs "OpenData").
- Point worldmonitor.app in Vercel, then set `NEXT_PUBLIC_SITE_URL` (or rely on
  `VERCEL_PROJECT_PRODUCTION_URL`). Until then, OG links use the vercel.app URL.
- Create the Bluesky account for the auto-poster.
- Post the Show HN (`docs/marketing/show-hn.md`) and warm an aged Reddit account.
