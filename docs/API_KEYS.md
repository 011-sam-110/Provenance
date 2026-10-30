# Provenance — API keys & access tokens

Every layer in this app is **keyless-first**: it works with no keys at all. The keys
below only *unlock additional layers* (or upgrade a modelled layer to real
measurements). Each source is **free** — most are instant signup, a few need a short
registration or an email request. Until a key is set, its layer stays **dormant**
(renders nothing, never errors).

> **How to give me the keys:** fill in the values, or just paste them back to me and
> I'll wire them in. **Never commit real keys.** They all go in **`.env.local`** at the
> project root (already git‑ignored). All are **server‑only** — none are exposed to the
> browser (no `NEXT_PUBLIC_` prefix), so the keys never leave the server.

---

## 0 · Status — what's live now

Keys you've already given me are wired in `.env.local` and **live locally**:

| Key | Layer it powers | State |
|-----|-----------------|-------|
| `AISSTREAM_API_KEY` | **Ships (AIS chokepoints)** — real-time vessels at Hormuz/Suez/Malacca/…; and **God's eye view** (`/eye`) — vessels anywhere in the world, Class A and B | ✅ live |
| `OPENAQ_API_KEY` | **Air quality — stations** — real PM2.5 from ~25.8k OpenAQ monitors | ✅ live |
| `ACLED_EMAIL` + `ACLED_PASSWORD` | **Conflict events** + the conflict factor of the Index | ⏳ dormant — login works but the account's **API read access isn't activated yet** (returns 403). Activate it on myACLED and it goes live with no code change. |

**Keyless layers added this session — already live, no key needed:** Internet
outages (IODA), Space weather (NOAA SWPC), Tropical cyclones (NHC), and the
flagship **Country Instability Index** (composited from food/displacement/outages,
verified live across 170 countries). The Index currently caps ~49/100 because the
conflict factor (ACLED) is dormant — activating ACLED opens it to the full range.
Every layer now shows a live **freshness dot** in the rail (the trust spine).

---

## 1 · Intelligence layers — get these (all free)

| # | Source | Unlocks | Free tier | Env var(s) |
|---|--------|---------|-----------|-----------|
| 1 | **AISStream.io** | Real‑time global ship tracking (named vessels, Hormuz/Suez for the console; the whole world, small craft included, for God's eye view) | Free, no card, WebSocket | `AISSTREAM_API_KEY` |
| 2 | **ENTSO‑E Transparency** | Grid load for about 20 continental European bidding zones (GB, France and Denmark are keyless from their own operators) | Free w/ registration | `ENTSOE_API_TOKEN` |
| 3 | **OpenAQ** | Real air‑quality **station** measurements (upgrades the modelled CAMS layer) | Free | `OPENAQ_API_KEY` |
| 4 | **UCDP** (Uppsala) | Geocoded conflict events + fatalities (structural conflict history) | Free token | `UCDP_API_TOKEN` |
| 5 | **ACLED** | Real‑time armed‑conflict & protest events w/ actor attribution | Free — **must activate API access** | `ACLED_EMAIL` + `ACLED_PASSWORD` |
| 6 | ~~**NASA FIRMS**~~ | **No key needed since 2026-10-16.** The Active fires layer reads the keyless FIRMS global 24 h files. `FIRMS_MAP_KEY` is no longer read. | — | — |
| 7 | ~~**ReliefWeb**~~ (OCHA) | **No key needed since 2026-10-16.** Its API refuses any appname it has not approved, so the layer reads ReliefWeb's own weekly export on HDX (CC BY 4.0) plus the keyless IFRC GO appeals API. `RELIEFWEB_APPNAME` is no longer read. | — | — |
| 8 | **ISOC Pulse** | Verified intentional internet shutdowns in the Internet outages layer (IODA stays keyless) | Free account, **non-commercial use only** | `ISOC_PULSE_API_KEY` |
| 9 | **EIA (U.S. Energy Information Administration)** | Grid load for about 50 US balancing authorities (EIA-930, hourly), and megawatts offline per US nuclear plant, daily (the keyless NRC report already gives each unit's % power) | Free, instant, email only | `EIA_API_KEY` |
| 10 | **BarentsWatch** (Kystverket) | Norwegian coastal AIS for the Barents Sea / North Cape box of the Ships layer, and for God's eye view along the Norwegian coast | Free API client, no card; NLOD | `BARENTSWATCH_CLIENT_ID` + `BARENTSWATCH_CLIENT_SECRET` |
| — | **Ransomware.live PRO** | The supported endpoint for the Ransomware victims layer (the keyless legacy one is compatibility-only) | Free personal key | `RANSOMWARE_LIVE_API_KEY` |
| — | **alerts.in.ua** | Ukraine air-raid alerts, down to raion and hromada level | Free token (form, 1 to 7 days) | `ALERTS_IN_UA_TOKEN` |

### Where to get each

1. **AISStream.io** — sign up at <https://aisstream.io>, create an API key on the
   dashboard. (Live vessel positions over a free WebSocket; coverage is terrestrial
   AIS, ~200 km offshore, so mid‑ocean is patchy.)
2. **ENTSO‑E** — register at <https://transparency.entsoe.eu> → after confirming your
   account, email **transparency@entsoe.eu** with subject *"Restful API access"* from
   your registered address; they reply with a **Web API security token** (usually < 1
   business day).
3. **OpenAQ** — register at <https://explore.openaq.org> (or <https://openaq.org>) and
   generate an API key in your account. (v3 sends it as the `X‑API‑Key` header.)
4. **UCDP** — request a free API access token via the UCDP API docs at
   <https://ucdp.uu.se> (the GED REST API now needs an `x‑ucdp‑access‑token` header).
5. **ACLED** — register a free myACLED account at <https://acleddata.com/register>,
   then **activate API access** in your dashboard (accept the access agreement /
   select an access type). Auth is an OAuth2 password grant (your email + password,
   `scope=authenticated`). ⚠️ Until API access is activated the read returns
   `403 "Access denied"` even though login succeeds — the layer stays dormant.
6. **NASA FIRMS** — nothing to get. Prod served zero fires for five weeks because
   FIRMS answered `400 Invalid MAP_KEY.` to the key on the box, so the layer moved to
   the keyless files at `firms.modaps.eosdis.nasa.gov/data/active_fire/` (same columns).
8. **ISOC Pulse** — create a free account at <https://pulse.internetsociety.org>, then
   generate an API token (sent as a Bearer token to `pulse-api.internetsociety.org`).
   Pulse's terms allow **non-commercial use only**, forbid redistribution, and require
   the credit "Provided by Internet Society", which every Pulse pin carries. If
   Provenance ever charges, this feed needs written permission or must go.
9. **EIA** — register at <https://www.eia.gov/opendata/register.php> (name and email;
   the key arrives at once). EIA data is US public domain; credit "Source: U.S. Energy
   Information Administration". `DEMO_KEY` works for a quick test only (tight rate limit).
10. **BarentsWatch** — create a personal account at <https://www.barentswatch.no>, then
   *My page* → create an API client. The layer uses the OAuth client-credentials grant
   with scope `ais` against `id.barentswatch.no`. Data is under NLOD.

---

## 2 · Optional enhancements (free, but we already have a keyless equivalent)

| Source | Adds | Why optional | Env var |
|--------|------|--------------|---------|
| **Electricity Maps** | Live carbon/grid mix outside the EU | ENTSO‑E already covers EU grid | `ELECTRICITYMAPS_API_KEY` |
| **Cloudflare Radar** | A second internet‑outage vantage | Keyless **IODA** already gives several vantage points (BGP, probing, telescope). Nothing in the outage layer calls RIPEstat: it is used only by `/api/recon/bgp` | `CLOUDFLARE_API_TOKEN` |
| **India CPCB** (data.gov.in) | PM2.5 at CPCB's Indian stations in the air-quality layers (24 h averages) | AirNow already carries the US Embassy monitors in New Delhi and Mumbai | `DATA_GOV_IN_KEY` |

- **Electricity Maps** — free tier at <https://www.electricitymaps.com/free-tier-api>.
- **Cloudflare Radar** — any free Cloudflare account → My Profile → API Tokens → token
  with **Radar Read**: <https://developers.cloudflare.com/radar/get-started/>.
- **US EIA** — email-only form at <https://www.eia.gov/opendata/register.php> (free, no
  card). EIA's public `DEMO_KEY` works for a test but is rate-limited; do not deploy it.
- **India CPCB** — register at <https://data.gov.in>, then copy the API key from My
  Account. The adapter reads resource `3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69` (real-time
  AQI) and makes no request without the key. Licence: Government Open Data License - India.

---

## 3 · Already wired, currently dormant (set these to switch existing features on)

| Feature | What it needs | Env var(s) |
|---------|---------------|-----------|
| **Photo geolocation** (`/locate`) vision fallback | freellmapi.co gateway (you own it) | `FREELLMAPI_BASE_URL`, `FREELLMAPI_KEY` |
| **Photo geolocation** GeoCLIP backend (best accuracy) | run `scripts/geolocate_service.py`, point the app at it | `GEOLOCATE_GEOCLIP_URL` (+ optional `GEOLOCATE_BACKEND=geoclip\|llm`) |
| **Windy webcams** layer | Windy API keys (you said these are already in `.env.local`) | `WINDY_WEBCAMS_API_KEY`, `WINDY_MAP_FORECAST_API_KEY` |
| **Live channel resolution** (news presets + the ISS panel) | YouTube Data API v3 key — see below | `YOUTUBE_API_KEY` |
| **Traffic dashboard** (`/admin/analytics`, development only) | A Vercel API token plus the project and team ids — see below | `VERCEL_ANALYTICS_TOKEN`, `VERCEL_ANALYTICS_PROJECT_ID`, `VERCEL_ANALYTICS_TEAM_ID` |

### `VERCEL_ANALYTICS_*` — what it does and does not buy you

`/admin/analytics` reads Vercel's Web Analytics query API and renders the traffic this
site actually receives. It **404s in production** and is a development-only view.

Pageview collection itself needs no key at all — it is done by the `<Analytics />`
script already mounted in `app/layout.tsx`. These three variables only let the dashboard
*read the numbers back*. Without them the page renders a labelled empty state naming the
missing variables; it never renders a chart of zeroes.

- `VERCEL_ANALYTICS_TOKEN` — create at [vercel.com/account/tokens](https://vercel.com/account/tokens), scoped to the team. Read-only use. Never sent to the browser.
- `VERCEL_ANALYTICS_PROJECT_ID` and `VERCEL_ANALYTICS_TEAM_ID` — from the project's **Settings** page. Not secrets, but not hardcoded either, so a self-hoster points the dashboard at their own project.

**What the plan refuses.** Measured against the live API on 2026-08-19, quoted verbatim:

| Asked for | Status | Vercel's answer |
|---|---|---|
| Custom events (`track()`) | 402 | `Accessing Analytics custom events requires an Enterprise or Pro plan.` |
| UTM dimensions | 402 | `UTM dimensions require an Enterprise plan or the Web Analytics Plus add-on.` |
| Anything older than 31 days | 400 | `Invalid request: the hobby plan only grants access to the latest 31 days of data.` |

So on the current Hobby plan the dashboard covers pageviews, routes, referrers,
countries, devices and browsers, over a rolling 31-day window — and nothing else. The
page states this itself rather than leaving an empty panel to imply zero traffic.

### `YOUTUBE_API_KEY` — why this one is not optional polish

Pinned YouTube **video** ids rot. Audited 2026-08-14: **8 of the 12 news presets were
already dead** ("Video unavailable", "this live stream recording is not available", one
gone private), and the ISS panel had been rendering *"Error 153 — Video player
configuration error"* since YouTube retired the `embed/live_stream?channel=` endpoint.

Channel ids are durable, but resolving one to its current live video needs this key.
Without it the console falls back to the pinned ids — i.e. exactly today's behaviour,
no worse — so nothing breaks while it is missing.

Getting it (~2 minutes, free, **no billing account required**):

1. console.cloud.google.com → create or pick a project
2. **APIs & Services → Library** → "YouTube Data API v3" → **Enable**
3. **APIs & Services → Credentials** → **Create credentials → API key**
4. **Edit** the key → **API restrictions → Restrict key → YouTube Data API v3**.
   Leave *Application restrictions* as **None** — it is called server-side, so an
   HTTP-referrer or IP restriction would break it.
5. `.env.local` → `YOUTUBE_API_KEY=…`, and the same in Vercel → Environment Variables

Quota: 10,000 units/day free. The resolver is built to fit well inside that — it
validates every known stream in a single 1-unit call and only pays the expensive
100-unit search for channels that actually rotated, costing roughly 1,900 units/day at
the measured rotation rate. `/api/youtube-live` publishes `quotaSpent` so this can be
checked rather than assumed.

---

## 4 · Markets & macro (Task #12 — BUILT)

The Markets panel is now multi-section. **Crypto (CoinGecko) and FX (Frankfurter /
ECB) are keyless and live already.** The rest are wired and **dormant** — each
section renders a quiet "add KEY" note until set, then goes live with no code change:

| Source | Unlocks | Env var | State |
|--------|---------|---------|-------|
| **Finnhub** | Equities (SPY/QQQ/DIA/AAPL/MSFT/NVDA quotes) | `FINNHUB_API_KEY` | dormant |
| **FRED** (St. Louis Fed) | Macro/rates (10-Yr, Fed Funds, unemployment, VIX) | `FRED_API_KEY` | dormant |
| **freellmapi.co** (your gateway) | AI daily brief, grounded in the Instability Index | `FREELLMAPI_BASE_URL` + `FREELLMAPI_KEY` | dormant |

- **Finnhub** — free key at <https://finnhub.io/register> (instant).
- **FRED** — free key at <https://fredaccount.stlouisfed.org/apikeys>.
- **freellmapi** — base URL + key from your own dashboard (also powers the `/locate` vision fallback).

Alpha Vantage / FMP aren't used (Finnhub + FRED cover equities + macro). Polymarket,
Fear & Greed, World Bank, Eurostat, OECD SDMX remain keyless options if we expand further.

---

## 4b - Fault alerts to the owner (BUILT, dormant until set)

Some faults stop a source until a person looks at it. Today there is one: CelesTrak's
usage policy says software must stop at its first non-200 answer and report it to a
person, so `lib/sources/celestrak.ts` stops all its calls until the server restarts.
`lib/ops/notify.ts` sends that report as one Telegram message.

| Var | What it is |
|---|---|
| `OPS_TELEGRAM_BOT_TOKEN` | A bot token from `@BotFather`. Free. It may be the feedback prompt's bot. |
| `OPS_TELEGRAM_CHAT_ID` | The owner's chat. Free. |

Unset, the fault goes to the server log only (`journalctl -u provenance`), and the
source still stops. They are separate from `FEEDBACK_TELEGRAM_*` because setting those
mounts the feedback prompt for every visitor.

---

## 5 - Feedback prompt (BUILT, dormant until set)

The in-console feedback prompt asks a sampled third of people who have actually used
the console what they do, what is useful, and for a 1-10 rating, plus an optional email
so Sam can arrange a call. Responses arrive as a Telegram message.

| Var | What it is |
|---|---|
| `FEEDBACK_TELEGRAM_BOT_TOKEN` | A bot token from `@BotFather`. Free. |
| `FEEDBACK_TELEGRAM_CHAT_ID` | The destination chat. Free. |

**These are the DEPLOYMENT'S own credentials, and that makes them different from
`/api/telegram`.** That route relays a token the visitor supplies in the request body,
so its worst case is that someone messages themselves. `/api/feedback` spends the
deployment's token, which makes it an unauthenticated write path into the owner's chat.
It is defended with a body-size cap enforced before the body is read, a strict field
whitelist, a same-origin check, a honeypot, a minimum dwell, and a best-effort per-IP
limit - best-effort because Fluid Compute instances are ephemeral and plural.

With either var unset the route is inert and the prompt never mounts, so an unconfigured
deploy shows no dead form.


## 6 - Private endpoint (BUILT, dormant until set)

One unlisted path behind one password, for showing unreleased work on the live site
without it being public. Both halves are required; with either unset the path does not
exist at all — not a 401, not a login form, a plain 404. That is the normal state for
every preview build and every fork, so it has to be the safe direction.

| Var | What it is |
|---|---|
| `PRIVATE_PREVIEW_SLUG` | The secret path segment, served at `/<slug>`. **At least 16 characters**, `A-Z a-z 0-9 _ -` only. |
| `PRIVATE_PREVIEW_PASSWORD` | The password the form asks for. At least 8 characters. |

**THE SLUG IS A SECRET AND CANNOT LIVE IN THE REPOSITORY.** This repo is public
(AGPL-3.0-only, on GitHub), so a path written into the source is published with a commit
date next to it. Both values come from the environment and neither has a default.
`readPrivateConfig` refuses a slug shorter than 16 characters rather than serving a
barely-hidden endpoint, because the slug is the first of the two factors.

Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(15).toString('base64url'))"
```

**It is NOT the maintenance gate and does not share its cookie.** The maintenance
curtain (`MAINTENANCE_MODE` + `MAINTENANCE_PASSWORD`) covers the whole site during a
rebuild and everyone with the code is meant to get in. This is the opposite shape, so
the cookie (`pv_private`) and the hash prefix are both distinct: the same password set
on both produces two different cookie values, and letting someone through a maintenance
window does not silently hand them the private endpoint too. When maintenance is armed
it wins, and the private path is down with everything else.

**What it is not: authentication.** No accounts, no lockout, no audit trail — one shared
password over one unlisted path. That is proportionate to "let a few people look at an
unreleased board" and is not proportionate to anything holding personal data. If it ever
needs real resistance, the place for it is a Vercel Firewall rule on `/api/private`,
not a middleware-shaped limiter that costs an invocation to say no.

**Scope, stated plainly:** the gate hides a URL, not a fact. Anything also reachable on
a public route is still public; this only controls who can reach it *at this path*.

## 7 - Accounts (IN PROGRESS - do not set before launch)

| Variable | Where it goes | Public? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | GitHub Actions **variable** (build step of `deploy.yml`) AND the box's `/srv/provenance/shared/.env` | yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | GitHub Actions **variable** AND the box's `.env` | yes, by design |
| `SUPABASE_SECRET_KEY` | the box's `.env` only | **no** |

The two public values are inlined into the browser bundle at build time, so they must be
in the build. They are ALSO needed on the box at runtime, because `/api/status` reads
`process.env` on the server to report the capability. With either public value unset there
is no sign-in and nothing about the console changes. Full setup: `docs/ACCOUNTS.md`.

## 8 - Source relay (BUILT, dormant until set)

Some upstreams refuse this server or need a scraper: CelesTrak firewalls the production IP,
and a few operators publish only an HTML page or a session portal. provenance-1 reads them
(the `sources` package in the NewsScraper repo) and pushes one signed snapshot per feed to
`POST /api/relay/<feed>` (`lib/relay`). The app keeps each feed's last good snapshot in
process memory; the sender refills it after a restart.

| Var | What it is |
|---|---|
| `RELAY_SIGNING_SECRET` | Self-issued HMAC secret, 32+ characters, the SAME value as `RELAY_SIGNING_SECRET` in `~/.config/provenance-sources/sources.env` on provenance-1. Separate from `NEWS_INGEST_SECRET` on purpose. |

Unset, every push answers 401 (never a 5xx) and the relayed feeds read as "no relay yet".
The feed ids, schemas and size caps are in `lib/relay/feeds.ts`.

## 8 - Camera networks (BUILT, dormant until set)

Each of these is one camera feed in `lib/sources/registry.ts`, named by its `keyId`. While
its credential is missing the registry does not ask it, it holds no cameras, and
`/api/coverage` lists it under `feeds.dormant` instead of reporting an outage. The moment
the value is set the feed goes live on the next refresh, with no code change. Every one is
free. None of these values ever reaches a browser: the Basic credentials and the Ottawa
certificate are added by `/api/proxy` on the server (`lib/proxy/allowlist.ts`).

| Network | Env var(s) | How to get it |
|---------|------------|---------------|
| Tyne and Wear UTMC (North East England) | `NE_UTMC_USER` + `NE_UTMC_PASS` | Free, self-serve: an account at netraveldata.co.uk (username and email). The account's username and password are the HTTP Basic credentials for /api/v2/cctv/*. |
| City of Ottawa | `OTTAWA_CAMERA_CERT` | Free: the Certificate Request Form on traffic.ottawa.ca/en/opendata; the City emails the certificate. It is added to image requests on the server only. |
| Manitoba 511 | `MANITOBA_511_KEY` | Free: a My511 account on manitoba511.ca, then a developer key from /developers/doc. |
| 511 Newfoundland and Labrador | `NL_511_KEY` | Free: a My511 account on 511nl.ca, then a developer key from /developers/doc. |
| 511 Yukon | `YUKON_511_KEY` | Free: a My511 account on 511yukon.ca, then a developer key from /developers/doc. |
| DARS and DRSI via NAP Slovenia | `NAP_SLOVENIA_USER` + `NAP_SLOVENIA_PASS` | Free: a B2B account at nap.si/en/registration (name, organisation, address, phone). The account's username and password are the HTTP Basic credentials. |

Two credentials named in the same audit are NOT wired yet, on purpose:
`TRAFFIC_SCOTLAND_FTP_USER` / `TRAFFIC_SCOTLAND_FTP_PASS` need an FTP mirror on the box
before an adapter can read them, and `TRAFFIC_WALES_KEY` needs the DATEX feed URL that
Traffic Wales sends with the approval, which is not published.

## 9 - IP location radius (NOT BUILT, waits on the key)

The IP location tool ("Locate network" in the search box, `app/api/recon/geo`) reads
MaxMind's GeoLite2 data through RIPEstat, with no key. RIPEstat publishes no accuracy
radius, so the map draws the country. A circle needs the GeoLite2 City file, and that
file needs a free MaxMind account. No code reads these two values yet: the step that
downloads the file and draws the circle reads them when it ships.

| Var | What it is |
|---|---|
| `MAXMIND_ACCOUNT_ID` | The account ID of a free GeoLite account on maxmind.com. The sign-up asks you to accept the GeoLite EULA. |
| `MAXMIND_LICENSE_KEY` | A licence key made under that account (Manage License Keys). |

Set both on the box with `deploy/set-maxmind-key.sh`, from your own terminal:
`scp deploy/set-maxmind-key.sh provenance:/tmp/` then
`ssh -t provenance sudo bash /tmp/set-maxmind-key.sh`. It reads the key from a hidden
prompt, checks the pair with MaxMind before it writes, and changes only these two lines
of `/srv/provenance/shared/.env`. Two rules come with the data and are not optional:
show the credit "This product includes GeoLite Data created by MaxMind, available from
https://www.maxmind.com" wherever its answers are shown (the network dossier does), and
delete a downloaded file within 30 days of a newer release.

## `.env.local` template

Copy this into `.env.local`, fill what you have, leave the rest blank (blank = dormant):

```dotenv
# --- Private endpoint (blank = the path does not exist) ---
# Slug must be >=16 chars of [A-Za-z0-9_-]; generate with
#   node -e "console.log(require('crypto').randomBytes(15).toString('base64url'))"
PRIVATE_PREVIEW_SLUG=
PRIVATE_PREVIEW_PASSWORD=

# --- Intelligence layers (free) ---
AISSTREAM_API_KEY=
ENTSOE_API_TOKEN=
OPENAQ_API_KEY=
UCDP_API_TOKEN=
ACLED_EMAIL=
ACLED_PASSWORD=
ISOC_PULSE_API_KEY=
EIA_API_KEY=
BARENTSWATCH_CLIENT_ID=
BARENTSWATCH_CLIENT_SECRET=
ALERTS_IN_UA_TOKEN=
RANSOMWARE_LIVE_API_KEY=

# --- Optional enhancements ---
DATA_GOV_IN_KEY=
ELECTRICITYMAPS_API_KEY=
CLOUDFLARE_API_TOKEN=

# --- Already-wired dormant features ---
FREELLMAPI_BASE_URL=
FREELLMAPI_KEY=
GEOLOCATE_GEOCLIP_URL=
GEOLOCATE_BACKEND=
WINDY_WEBCAMS_API_KEY=
WINDY_MAP_FORECAST_API_KEY=

# --- Markets/macro (Task #12, BUILT — crypto+FX already live keyless; these unlock the rest) ---
FINNHUB_API_KEY=
FRED_API_KEY=

# --- Feedback prompt (BUILT - the deployment's OWN bot, not the visitor's) ---
FEEDBACK_TELEGRAM_BOT_TOKEN=
FEEDBACK_TELEGRAM_CHAT_ID=

# --- Fault alerts to the owner (BUILT - e.g. CelesTrak stopped at a non-200) ---
OPS_TELEGRAM_BOT_TOKEN=
OPS_TELEGRAM_CHAT_ID=

# --- Source relay (BUILT - shared HMAC secret with the provenance-1 sender) ---
RELAY_SIGNING_SECRET=

# --- Camera networks (BUILT, dormant until set; see section 8) ---
NE_UTMC_USER=
NE_UTMC_PASS=
OTTAWA_CAMERA_CERT=
MANITOBA_511_KEY=
NL_511_KEY=
YUKON_511_KEY=
NAP_SLOVENIA_USER=
NAP_SLOVENIA_PASS=

# --- Accounts (in progress - do not set before launch) ---
# NEXT_PUBLIC_SUPABASE_URL=
# NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
# SUPABASE_SECRET_KEY=
```

> These env‑var names are the contract — when I build each key‑gated adapter it reads
> exactly these names, so the moment you paste a value the layer goes live with no code
> change. Nothing here blocks the keyless layers, which keep shipping in parallel.
