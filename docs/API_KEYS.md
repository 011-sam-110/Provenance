# TrafficNerd‑V2 — API keys & access tokens

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
| `AISSTREAM_API_KEY` | **Ships (AIS chokepoints)** — real-time vessels at Hormuz/Suez/Malacca/… | ✅ live |
| `OPENAQ_API_KEY` | **Air quality — stations** — real PM2.5 from ~25.8k OpenAQ monitors | ✅ live |
| `FIRMS_MAP_KEY` | **Active fires** — NASA VIIRS thermal detections | ✅ live |
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
| 1 | **AISStream.io** | Real‑time global ship tracking (named vessels, Hormuz/Suez) | Free, no card, WebSocket | `AISSTREAM_API_KEY` |
| 2 | **ENTSO‑E Transparency** | EU electricity‑grid load / generation mix / cross‑border flows / outages | Free w/ registration | `ENTSOE_API_TOKEN` |
| 3 | **OpenAQ** | Real air‑quality **station** measurements (upgrades the modelled CAMS layer) | Free | `OPENAQ_API_KEY` |
| 4 | **UCDP** (Uppsala) | Geocoded conflict events + fatalities (structural conflict history) | Free token | `UCDP_API_TOKEN` |
| 5 | **ACLED** | Real‑time armed‑conflict & protest events w/ actor attribution | Free — **must activate API access** | `ACLED_EMAIL` + `ACLED_PASSWORD` |
| 6 | **NASA FIRMS** | VIIRS/MODIS thermal active‑fire detections | Free MAP_KEY | `FIRMS_MAP_KEY` |
| 7 | **ReliefWeb** (OCHA) | Humanitarian situation reports + disaster declarations | Free *approved appname* (not a secret) | `RELIEFWEB_APPNAME` |

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
6. **NASA FIRMS** — request a free **MAP_KEY** at
   <https://firms.modaps.eosdis.nasa.gov/api/area/> (instant, just an email).

---

## 2 · Optional enhancements (free, but we already have a keyless equivalent)

| Source | Adds | Why optional | Env var |
|--------|------|--------------|---------|
| **Electricity Maps** | Live carbon/grid mix outside the EU | ENTSO‑E already covers EU grid | `ELECTRICITYMAPS_API_KEY` |
| **Cloudflare Radar** | A second internet‑outage vantage | We already corroborate via keyless **IODA + RIPEstat** | `CLOUDFLARE_API_TOKEN` |

- **Electricity Maps** — free tier at <https://www.electricitymaps.com/free-tier-api>.
- **Cloudflare Radar** — any free Cloudflare account → My Profile → API Tokens → token
  with **Radar Read**: <https://developers.cloudflare.com/radar/get-started/>.

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


## `.env.local` template

Copy this into `.env.local`, fill what you have, leave the rest blank (blank = dormant):

```dotenv
# --- Intelligence layers (free) ---
AISSTREAM_API_KEY=
ENTSOE_API_TOKEN=
OPENAQ_API_KEY=
UCDP_API_TOKEN=
ACLED_EMAIL=
ACLED_PASSWORD=
FIRMS_MAP_KEY=
RELIEFWEB_APPNAME=

# --- Optional enhancements ---
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
```

> These env‑var names are the contract — when I build each key‑gated adapter it reads
> exactly these names, so the moment you paste a value the layer goes live with no code
> change. Nothing here blocks the keyless layers, which keep shipping in parallel.
