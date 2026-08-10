# Competitive sweep + improvement plan — 2026-08-09

Six parallel agents investigated **worldmonitor.app** and **osirisai.live** (live sites
*and* both source repos), our own live production build, our codebase, and both public
issue trackers. This file is the durable output. **Read this instead of re-running the
sweep.**

Sampo's decisions for this work:
1. Investigate, then build **P0/P1 only**; everything else stays a documented backlog.
2. The OpenData Redesign is a **reference**, not a mandate to rebuild the shell.
3. Review target = **live Vercel prod**.
4. Keys: assume they arrive — build live, log every key to `NEEDED-APIS.txt` (repo root,
   deliberately untracked; `docs/API_KEYS.md` is the tracked one).

---

## 0. LICENCES — binding on all build work

| Repo | Licence | Rule |
|---|---|---|
| `koala73/worldmonitor` | **AGPL-3.0-only** | **Copy nothing.** AGPL §13 triggers on network interaction; any lifted code forces OpenData to relicense and publish. Read for FACTS only — endpoint URLs, cadences, methodology. Facts and API URLs are not copyrightable. Nobody opens their tree while writing an adapter. |
| `simplifaisoul/osiris` | **MIT** (branch `master`) | Lifting allowed. Add `THIRD_PARTY_LICENSES.md` with the verbatim MIT block, and header each derived file `// Adapted from OSIRIS (github.com/simplifaisoul/osiris), MIT. Copyright (c) 2026 simplifaisoul.` |

Scale, verified via api.github.com: worldmonitor **80,191 stars / 11,985 forks / 340 open
issues**, created 2026-01-08. osiris **7,533 / 1,546**, created 2026-05-12.
Their fork count is *not* adoption — their own issue #3741 audited it: 8,733 of 8,743
forks had issues disabled, arriving in 400–600/day bursts. Inert.

---

## 1. DONE THIS SESSION — the P0

**The centre stage rendered blank in production for every first-time visitor.**
Fixed on branch `fix/blank-centre-stage` (commit `085aab5`, pushed, **PR not opened — `gh`
is 401**). Open it at:
`https://github.com/011-sam-110/TrafficNerd-V2/compare/main...fix/blank-centre-stage`

Cause: `lib/geolocate/useGeolocate.ts` returned `result?.candidates ?? []` — a fresh array
on every render. `result` is null until a photo is uploaded, i.e. always on a first visit.
The
Locate widget (on the default board) reports its export payload from an effect keyed on
that array → `report()` → `setReport` → re-render → new `[]` → infinite loop. React's
"Maximum update depth exceeded" is stripped in production builds, so it was silent; the
saturated update queue starved the Suspense retry that mounts the lazily-imported
`<WorldMap>`. The module resolved; its body never ran once.

This single bug explains the whole "0 cameras · 0 planes · 0 satellites" cascade — those
feeds are children *inside* WorldMap. Post-fix the same build reports ~18,000 cameras.

Also in that commit: a real loading state for the stage (it fell back to `null`, which is
why a dead map looked like a slow one), a regression test on the array identity, and a
`next.config.ts` alias removing satellite.js's `#wasm-*` entry points (investigated as a
suspect, cleared, but it kills a real `topLevelAwait` build warning; nothing uses those
exports).

Gates: tsc clean · vitest **917/917** · `next build` green · verified on a local prod
server (canvas present, `.world-map` mounted, 18,330 cameras).

---

## 2. THE STRATEGIC READ

**Our planned wedge — "honest + calm" — is already half-occupied.** worldmonitor invented
the per-layer explainability card: `CURATED V1` badge → description → SOURCE → FRESHNESS →
CONFIDENCE → LIMITATIONS (bulleted) → RELATED chips → GROUNDED IN repo paths. It is
genuinely good.

**But they finished 8 of 20 layers.** The other twelve — including Pipelines, Undersea
Cables, Nuclear Sites, AI Data Centers, Sanctions, Military Bases — return a fallback
admitting "a curated source and confidence card has not been added yet".

**So our wedge is CONSISTENCY, not novelty:** the same card on all 35 of our layers, zero
fallbacks. Cheap for us, and visibly better at their own game.

Their dashboard is also neither honest nor calm, all evidence-backed:
- A free user silently gets **137 of 288 sources** and no AI summarisation. Console-only:
  `[App] Free tier: reconciled 57 gate-owned source disable(s)`. The UI never says so.
- **11 of 20 layer toggles are capped** — clicking does nothing. No toast, no upsell.
- Alerts are word-frequency spikes labelled HIGH: `"oil" Trending - 9 mentions in 2h`.
  They reported "16 HIGH PRIORITY"; all noise.
- Hormuz shows disruption **80/RED** beside **Congestion: Normal**, **0 warnings**,
  **0 transits today**, on a threat baseline self-declared >120 days stale.
- Cross-surface contradictions: cables "20" vs "86"; bases "150+" vs "220+"; "56 map
  layers" — max 29 observed in one deployment.
- No basemap attribution on their 2D view. Mobile rewrites the URL to `?lat=NaN&lon=NaN`.
- Their own status page at capture: health 37.253%, 24h uptime 87.5%.

**PLAYBACK: we are not behind — nobody has shipped it.** Their `Historical Playback`
widget is fully built in the DOM (toggle, 0–100 slider, `⏮ ◀ LIVE ▶ ⏭`) with its container
set to **`display:none`** for a free visitor. What ships is a 6-button recency filter that
only affects earthquakes, weather, protests and outages — and it is **pure client-side
array filtering**; `grep -rln "timeRange" api server` in their tree returns nothing. Their
maintainer closed #2437: *"timeRange filter concept is deferred… Requires storing in DB a
ton of things - currently low value."* Our ROADMAP filed this as an XL gap where we trail.
It is an open goal. **Do not build a TSDB** — theirs is a precomputed array under one
Redis key.

**Maintainer commitments = durable openings** (all closed `not_planned`):
- #354 mobile: *"Very unfriendly. Honestly, not sure if I will ever put the time to
  improve it."* The market leader has publicly declined mobile.
- #3176: *"not interested in more war monitors"* — regional/civic/infrastructure data is
  outside their appetite.
- #5499–#5512: 14 ToS/scraping objections, all not_planned, no reply.
- #3729 magic weights: not_planned. Methodology opacity is a choice, not a backlog item.

**Where the evidence CONTRADICTS us:** "calm / anti-overload" is *not* supported by their
issue tracker. Of 345 third-party issues, ~4 ask for simplification while **29 ask for
more sources**. The overwhelmed cohort churns silently (our HN evidence). Pitch calm to
the people who left; pitch **honesty, keyless, no-account** to the people who stayed.

---

## 3. RANKED BUILD PLAN

### P0 — correctness and credibility. Do these first.

| # | Item | Why | Where |
|---|---|---|---|
| 1 | ~~Blank centre stage~~ | **DONE** — `085aab5` | — |
| 2 | **MapLibre style-load error handler + backoff retry + visible fallback** | We have **no `map.on('error')` and no retry anywhere**, and our basemap is a remote style URL. One flaky fetch = permanent black rectangle. This is the single most-reported failure across BOTH competitors (their #1031, osiris **#250**, the only high-reaction open osiris issue). Hours of work. | `components/WorldMap.tsx:~1066` |
| 3 | **Freshness chip must reflect real last-success age** | `freshLabel()` derives from `refreshMs`, so a frozen upstream still reads "live", and most widgets hardcode `"live"`. **We cannot market honesty while this lies.** Data already exists in `lib/freshness.ts` — it is unwired. | `lib/freshness.ts`, widget frames |
| 4 | **`/api/status` + "locked — needs key" badges** | 6 of 35 layers are key-gated and render silently empty, indistinguishable from a dead feed or a genuinely quiet one. Their users filed this exact complaint (#5829, #6149). Closes ROADMAP M4 `[~]`. | new route + `SourceCatalog` |
| 5 | **Distinguish empty / lagging / stale / down / dormant per layer** | Our `fetch() → []` convention is applied so uniformly that a dead upstream, a timeout, a missing key and a quiet feed all look identical. 8 keyless layers were zero at capture; only 3 were honestly quiet. | `lib/sources/freshKind.ts` exists — surface it |
| 6 | **Fix the layers that are actually broken** | GDELT conflict + protests → upstream **404** for our query shape (a world monitor with no conflict layer). Aurora → NOAA returns **200 / 920 KB**, we render nothing (our bug). Nuclear → Overpass answers in 21.6 s, our route times out at 11.9 s. WFP HungerMap → now **401**, no longer keyless. `/api/webcams` → 0. `/api/brief` → `{"brief":null,"dormant":false}`. Rocket-launch rows all read "· 0s". | `lib/signals/*` |
| 7 | **Country dossier is unreachable** | The instability pin sits on every country centroid and intercepts the click (`signal-icons` above `country-fill`). README advertises the dossier; you cannot open it. | `WorldMap.tsx` click-guard |
| 8 | **ACLED 403** | Our flagship Instability Index carries a **0.40-weight** conflict factor that is dormant, capping it at ~49/100. Account activation, not a new key. Top of `NEEDED-APIS.txt`. | account action |
| 9 | **Mobile shell** | Two widget columns render on top of each other; unusable. The responsive CSS targets `.tn-rail`, which no longer exists. **Do not claim mobile until fixed** — but note the market leader has *declined* mobile, so this is uncontested ground. | `ConsoleWorkspace` fixed-px columns |
| 10 | **Docs hygiene** | `CLAUDE.md` line 3 says "prod domain **worldmonitor.app**" — that is the competitor's domain and product name, and their README reserves branding rights. `README.md` still says "TrafficNerd", claims ~12,000 cameras (really ~17–19k), 33 layers (35 registered / 23 with data), "nine field presets" (there are **six**, differently named), and adsb.lol for planes (code uses OpenSky). | `CLAUDE.md`, `README.md` |

### P1 — the competitive gap. High value per day.

| # | Item | Notes |
|---|---|---|
| 11 | **Per-layer source/freshness/confidence/limitations card on ALL 35 layers** | The wedge. They did 8 of 20. Zero fallbacks. |
| 12 | **Coverage denominator on the face of every score** | Their `CACHED · 20/35 sources` is the best honesty detail in their product. We already have `coverage: "3/4 factors"` — generalise it. |
| 13 | **Two clocks on every derived number** | "Generated 3m ago · newest source 1.2h old". |
| 14 | **Numbers ON the markers** | `M4.5` on quakes, `FL350` on aircraft, `35 kts` on storms. Magnitude readable with no click and no legend. |
| 15 | **A legend** | Neither competitor has one, and with 35 layers sharing glyphs a pin's meaning is not guessable in ours either. Closes half of M16. |
| 16 | **Mount the orphaned time-window control** | The filter engine ALREADY runs — `WorldMap.tsx:308-313` filters signals through `withinWindow`. Only the control is unmounted. One import turns on a whole capability. |
| 17 | **Visible working time slider / playback** | Where we beat them outright (see §2). Theirs is `display:none`; their maintainer deferred it. Don't build a TSDB. |
| 18 | **Four proven keyless camera adapters** | Competitor-verified counts: **Taiwan THB 2,165 · Utah UDOT 2,068 (same IBI/Castle Rock platform our adapter already paginates) · Austria ASFINAG 1,834 (our notes say "registration-gated" — RE-CHECK, they got 1,834 keyless) · Hong Kong data.gov.hk 1,013**. ~7,000 cameras, 7→11 countries. |
| 19 | **IMF PortWatch chokepoints** | `services9.arcgis.com/weJ1QsnbMYJlCHdG/.../Daily_Chokepoints_Data/FeatureServer/0/query` — **verified 200, keyless**. The dataset behind their flagship product. Upgrades our AIS-sample widget to authoritative daily-transit-vs-baseline. |
| 20 | **Cloud/SaaS status board** | ~24 vendor Statuspage hosts on one uniform `/api/v2/summary.json` contract (GitHub/OpenAI/Cloudflare/Anthropic/Datadog verified 200; Stripe/Slack/AWS are bespoke — 404). One adapter, zero keys, a whole widget. |
| 21 | **FAA ground stops** + **NWS severe-weather polygons** | `nasstatus.faa.gov/api/airport-status-information` (200) and `api.weather.gov/alerts/active?area=XX` (200, needs a descriptive UA). Our polygon path already exists via `gpsjam.ts`. |
| 22 | **RainViewer radar** | `api.rainviewer.com/public/weather-maps.json` (200). Highest visual impact per hour; replaces our stubbed "soon" weather radar. `WINDY_MAP_FORECAST_API_KEY` is already set and unused. |
| 23 | **AI digest with a keyless heuristic fallback** | Osiris's best idea (MIT, liftable): compute a `Digest {summaryLine, facts[], highlights[]}` in pure code FIRST, then let a model turn it into prose only if a key exists. `generatedBy: 'gemini' \| 'analyst'` is returned so the UI can label it honestly. **The numbers are identical either way — the button always works with zero keys.** Do NOT copy their "Palantir FDE crossed with a CIA PDB analyst" persona; wrong for our identity and it invites overconfidence. Add what they lack: citations (we have `lib/signals/sourceLink.ts`), freshness in the model's context, and a validator rejecting any number not in the digest. |
| 24 | **Background-tab poll suppression** | Three lines, biggest CPU/quota win available. LIFT from osiris `page.tsx:426-433` (MIT). |
| 25 | **Adaptive cache-control** | `no-store` when a result looks broken, so a partial outage can't get pinned in the CDN. LIFT osiris `cctv/route.ts:590-592`. |
| 26 | **Fix our BGP recon route** | `app/api/recon/bgp/route.ts:10` calls `api.bgpview.io`, which is **shut down**. Swap to RIPEstat `as-overview`. |
| 27 | **Entity link graph** | The highest-value thing in the osiris repo, fully keyless and MIT: Wikidata SPARQL + RIPEstat + OpenSanctions, aircraft → ICAO prefix → airline → HQ → CEO → parent, every resolver cross-linked to OFAC. |
| 28 | **Instability index rigour** | Non-compensatory aggregation (`score = weightedMean × (1 − α(1 − minFactor))`), exponential time decay on conflict, a versioned formula constant with a doc-drift test, and a Spearman validation harness against INFORM/HDI/WorldRiskIndex. **Neither competitor validates their instability index** — theirs is 31 hand-picked countries with 62 hand-written coefficients and hard floors. Ours is already more defensible; validation would put us clearly ahead. Also **rename our `cii:` id prefix** — CII is *their* headline brand. |

### P2 — backlog (do not start without Sampo)
Public API + docs page · MCP server · crawlable per-country/chokepoint reference corpus ·
`llms.txt` + OpenAPI · Dockerfile (their self-hosting is 8 issues of pain; ours would be
`npm install && npm run dev`, zero keys) · content translation + RTL (**neither competitor
does it** — 8 requests) · SSE/WebSocket push · digest/PDF SitRep · desktop app (**45 issues
of their pain — deliberately avoid**).

---

## 4. THINGS THAT ARE *NOT* OPPORTUNITIES — corrections to earlier assumptions
- **Map tech is not an angle.** They already run MapLibre 5.16 + deck.gl 9.2.
- **Their secret hygiene is good.** No committed secrets in either repo. The one `pk_live_`
  Clerk key is a *publishable* key, designed to ship. Do not call it a leak.
- **Their test suite is healthy** — 1,359 test files, 3 skipped, 31 CI workflows.
- **"340 open issues" is not 340 unmet needs** — 203 (87%) are the owner's own engineering
  tickets. The real customer corpus is 345 third-party issues, only 17 still open.
- **Don't claim "users hate their paywall"** — only 5 thin issues, mostly waitlist plumbing.
- **Don't relitigate border disputes** (their #658) — we use the same CARTO/OSM/Natural
  Earth upstreams; reuse their correct explanation.

## 5. Our existing lead — don't undersell it
11 government camera networks (Caltrans, TfL, DriveBC, NZTA, SCDOT, Traffic Scotland,
Iceland, Estonia, Castle Rock ×9, TripCheck, Digitraffic) — **zero hits for any of these in
worldmonitor's tree**; their only webcam source is key-gated Windy, and osiris's "17,000+"
is ~200 hardcoded + 601 generated of which ~48% have no image URL. Plus: native clustering
(osiris discards 90% of flights before render), client-side SGP4 at 1 Hz (theirs
fetch-once-and-freeze), real terrain DEM, `?c=` share layouts, CSV/GeoJSON export, i18n
scaffolding, free alerting with no account, and 37 media queries vs their
"your screen is too small" modal.

Two sources already on *their* roadmap are already live for us (NOAA SWPC space weather,
IODA internet outages).

---

## 6. Artifacts
Raw agent reports, screenshots and probe JSON:
`%LOCALAPPDATA%\Temp\claude\C--Users-sampo\701044da-206e-4471-bf49-9c0a856a14ce\scratchpad\recon\`
(`worldmonitor/`, `osiris/`, `ours/`, `wm-src/`, `osiris-src/`, `wm-issues/`,
`design/INVENTORY.md`, `ORCHESTRATOR-NOTES.md`). Temp — copy anything worth keeping.

---

# ADDENDUM — 2026-08-10 re-audit. Several conclusions above are now WRONG.

An independent three-agent re-audit (live visual + repo/docs) found both rivals had
moved hard since the sweep. **Read this section before acting on anything above.**

## Assumptions from the sweep that no longer hold

| Sweep said | Actually, on 2026-08-10 |
|---|---|
| "The market leader has publicly declined mobile" (#354) | #354 was closed **COMPLETED**, not not_planned. worldmonitor ships a proper tabbed mobile shell, and so does osiris (390×844, no horizontal overflow, bottom tab bar). **Mobile is no longer uncontested ground.** |
| "Neither competitor has a legend" | worldmonitor now has a legend, a CII colour ramp (0/31/51/66/81/100) and a categorised MAP LAYERS GUIDE that even states the time filter's true scope. |
| "Numbers ON the markers" is an opening | Theirs already print M5.6 on quakes, 40 kts on storms, 24 NM² areas and named naval formations. |
| "Neither competitor does i18n / RTL" (8 requests) | worldmonitor ships 24+ languages **with Arabic RTL**. |
| "Their alerts are word-frequency spikes labelled HIGH" | Replaced by entity-grounded "Intelligence Findings" with evidence and a recommended action, plus a 7-day severity histogram with a trend verdict. |
| "11 government camera networks — zero hits in their tree" | osiris now ships ~30 country CCTV adapters: **17,384 cameras, 39 named agency feeds, 82 countries**, viewable URL on 100% of records. Our ~19k across 11 feeds / 7 countries is no longer a breadth lead. |
| Their explainability card: 8 of 20 layers | Now **11 of 36**. Still the hole we exploit, but they are filling it. |

## What they shipped that we do not have at all
- **worldmonitor**: a 213-endpoint public REST API (OpenAPI 3.1, 936 KB), a 60-tool MCP
  server with a keyless sandbox, a **515 KB public data-source catalogue** recording each
  upstream's license posture and attribution (a direct hardening of our own wedge), a
  machine-readable health contract at `/api/health?compact=1` (258 checks, a real staleness
  taxonomy), SEC EDGAR corporate intelligence, global tender data, a China desk, and
  prediction-market forecasting with Brier scoring. 687 commits in a month.
- **osiris**: a real public **docs site** — 55 keyless endpoints, in-page request runner,
  cURL/JS/Python tabs — plus live per-sub-layer counts on every toggle, self-documenting
  400s (`{"error":"Invalid type. Allowed: aircraft, vessel, …"}`), and machine-readable
  key-gate disclosure with a `hint` telling you exactly which token to set and where.
- **osiris also independently built our keyless-AI-digest idea** and labels it
  `HEURISTIC ANALYST` — the same honest-generator design we shipped this round.

## Where we are still genuinely ahead
Both rivals have concrete honesty defects that we do not:
- osiris renders **"LIVE SAT-LINK / ACTIVE / RECORDING"** over a single JPEG fetched once
  and unchanged five minutes later.
- osiris's flagship country-risk index is 20 hardcoded countries whose severity label is
  not a function of its own score (Israel 100 = HIGH, Syria 82.0 = CRITICAL).
- worldmonitor's explainability card is still absent on 25 of 36 layers.
- Ours: 37 of 37 layers documented with a build-failing test, per-widget freshness derived
  from observed last-success, render caps disclosed as caps, and a capability report that
  separates keyless / configured / locked / upgradable.

**Strategic read: the honesty wedge survives; the feature-breadth lead does not.** Treat
"we have more cameras" and "they have no mobile / no legend / no i18n" as retired claims.
