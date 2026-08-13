<p align="center">
  <img src="docs/screenshots/hero.jpg" width="820" alt="OpenData: a satellite world map with live cameras, aircraft and global hazard signals in a customisable console">
</p>

<h1 align="center">OpenData</h1>
<p align="center">A live satellite globe of the world's open traffic cameras, aircraft, satellites and global signals, in the browser.</p>

<p align="center">
  <a href="https://traffic-nerd-v2.vercel.app"><img src="https://img.shields.io/badge/live-traffic--nerd--v2.vercel.app-2ea44f" alt="Live at traffic-nerd-v2.vercel.app"></a>
  <img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" alt="Next.js 15">
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/MapLibre%20GL-v5-1a73e8" alt="MapLibre GL v5">
  <img src="https://img.shields.io/badge/unit%20tests-950%2B-2ea44f" alt="950+ unit tests">
</p>

Spin a satellite Earth and watch **~19,000 government traffic cameras**, live aircraft and orbiting satellites light up on one MapLibre globe. The globe morphs continuously into a flat satellite or street map as you zoom, so you can click any camera for its live image or HLS video, or any country for a sourced dossier. On top sit **35 opt-in "global signal" layers** (earthquakes, wildfires, disaster alerts, conflict, undersea cables, cyber threats and more), each a per-hazard pin on the map, arranged in a customisable widget console with live news, markets and a photo-geolocation tool. Every feed is sourced from data published for public reuse, is keyless or uses your own key, and carries its required attribution.

This is the web rewrite of [TrafficNerd v1](https://github.com/011-sam-110/TrafficNerd), which was a London-only terminal app. The repository is still named `TrafficNerd-V2`; the product is **OpenData**.

## What this has that the alternatives don't

- **11 government camera networks, keyless.** Not a webcam directory — the actual DOT/agency feeds (TfL, Caltrans, SCDOT, Finland Digitraffic, Castle Rock 511, Oregon TripCheck, DriveBC, NZTA, Iceland, Estonia, Traffic Scotland), normalised into one `Camera` shape behind an SSRF-safe proxy.
- **Native map clustering.** ~19k points go through MapLibre's own GeoJSON clustering (`cluster: true`), not a client-side loop, so London at zoom 4 stays a single readable cluster.
- **SGP4 in the browser.** Satellites are propagated client-side from CelesTrak TLEs with `satellite.js` — the server never ticks orbits, so the constellation moves at frame rate with no polling.
- **Real terrain, not a shaded overlay.** 3D mode calls `map.setTerrain()` against AWS's `terrarium` raster-DEM tiles (it engages at zoom ≥ 6, where MapLibre's globe projection hands over to mercator).
- **Your data leaves with you.** Every widget and dossier can dump its visible rows as CSV or GeoJSON through pure, unit-tested serialisers in `lib/export.ts`.
- **Localised.** EN / ES / FR, with the catalogue as an explicit seam rather than a scattering of hard-coded strings.

## ✨ Features

- **One continuous globe-to-map engine** — a single MapLibre `projection: 'globe'` instance morphs a spinning satellite Earth into a flat satellite or street map on zoom: no cross-fade seam, one WebGL context. Satellite imagery is the default basemap, with Light and Topographic a tap away and an optional 3D-terrain mode.
- **~19,000 live cameras across 11 keyless networks** — government road cameras across the UK, US, Canada, Finland, New Zealand, Iceland and Estonia, clustered on the map, each opening its live still or HLS video. One of those adapters (Castle Rock 511) fans out to nine separate state and provincial traveller-information systems, so the 11 adapters cover 19 agencies.
- **Aircraft and satellites** — live ADS-B aircraft from **OpenSky Network**'s global `/states/all` snapshot, with breadcrumb trails and route/airframe enrichment fetched on click from adsbdb; and satellites propagated in the browser from CelesTrak TLEs with SGP4 (`satellite.js`).
- **35 global signal layers** — opt-in and attributed, most keyless, each drawn as its own hand-made hazard pin: a composite Country Instability Index, earthquakes (USGS, EMSC), wildfires / volcanoes / storms / floods (NASA EONET), GDACS disaster alerts, tropical cyclones, NASA FIRMS active fires, aurora and space weather (NOAA), rocket launches, undersea cables and their landing stations, GPS jamming, nuclear plants, airports, ports, national internet outages (IODA), GDELT conflict and protests, ACLED conflict events, weather and air quality (Open-Meteo + OpenAQ stations), UK street crime (data.police.uk), cyber command-and-control and ransomware (abuse.ch, Ransomware.live), forced displacement (UNHCR), food security (WFP), ReliefWeb emergencies, ENTSO-E grid load, military ADS-B (adsb.lol) and AIS ships. Adding one is a single adapter file plus a fixture test.
- **Clickable countries with a sourced dossier** — bundled Natural Earth borders outline and label every country on the satellite and topographic basemaps (which carry no labels of their own). Clicking one opens identity facts plus three live sections: the **UK FCDO's own travel advice** for that country (gov.uk, keyless — labelled as one government's advice to its own nationals, not a neutral risk index), the Country Instability Index (flagged as a derived estimate, with each contributing layer linked), and the country-coded signals currently active there. Every number links to the upstream it came from.
- **A customisable widget console** — a fixed centre stage (3D globe, 2D map or a world clock) framed by resizable, collapsible panels of live monitor cards. The ⌘K catalogue holds around 50 widgets: eight core cards (Aviation, Events, Cameras, Satellites, Markets, Headlines, News, Locate), an anomaly-triage card, six passive-OSINT recon tools (DNS, WHOIS, certificates, BGP, ports, threat), and one generated monitor per signal layer. **Six boards** — World Overview, Situation Room, Earth Systems, Air · Sea · Space, Markets & Cyber and Tools — rearrange the whole console *and* re-skin the map layers in one tap, and any layout is shareable as a `?c=` URL. Thirteen "monitor variants" re-weight which layers are lit.
- **Live world context** — a breaking-news banner and headline ticker over six world RSS feeds (BBC, Al Jazeera, NPR, The Guardian, DW, France 24) plus one public Telegram OSINT channel; and a multi-section markets panel with keyless crypto (CoinGecko), FX (Frankfurter / ECB) and index quotes (Yahoo Finance), which extends to equities and macro rates if you add a free Finnhub or FRED key.
- **Photo geolocation** (`/locate`) — estimate where a photo was taken from its visual cues and plot ranked candidates on their own map, with every result labelled an estimate, not GPS truth.
- **Closed, SSRF-safe proxies** — `/api/proxy` takes a camera *id* (never an arbitrary URL), resolves it behind a host allowlist, upgrades mixed content and caches at each source's refresh cadence; `/api/hls` fronts the live video streams the same way.

## 📏 Status and honest coverage

_Live on Vercel at [traffic-nerd-v2.vercel.app](https://traffic-nerd-v2.vercel.app), and runs locally with no setup._ Every core feed is keyless. Coverage is real but partial, and it depends on upstream public APIs staying open — so here is what a live check of production on **2026-08-10** actually returned:

| Check | Result |
|---|---|
| `GET /api/coverage` | **19,328 cameras, 19,112 online**, across all 11 sources |
| All 35 `GET /api/signals/<id>` | **35/35 returned HTTP 200.** 24 had features; 11 were empty |
| `GET /api/satellites` | 157 satellites |
| `GET /api/planes` | **0** — see below |

The eleven empty layers break down as: **four dormant awaiting a free key** (ACLED, ReliefWeb, ENTSO-E grid load, AIS ships); **two dark because GDELT's `/api/v2/geo/geo` endpoint is currently returning 404** (conflict, protests — the rest of GDELT's host is up); and **five that returned nothing at that moment** (volcanoes, floods, tropical cyclones, aurora, food security) — a quiet season or an empty upstream window, not individually diagnosed. Every one of them still answered `200` with an empty set, which is the point: a dead upstream degrades to an honest blank, never a 5xx and never invented data.

**Known open issues, stated plainly:**

- **The aircraft layer was empty at the time of that check.** OpenSky's anonymous tier is credit-capped, and the app deliberately pulls one shared global snapshot for the whole deployment rather than polling per visitor. `/api/planes` returned `{"count":0}` twice while OpenSky's `/states/all` answered `200` with ~1 MB of state vectors from a home IP — consistent with the cap being hit on the deployment's IP with no last-good snapshot to fall back on. Under investigation.
- **`ships` and `weather` are placeholders in the core layer rail**, shown as disabled "soon" rows. (AIS ships and Open-Meteo weather do ship as *signal* layers — the rail entries are a separate, unbuilt basemap treatment.)
- Best-accuracy photo geolocation wants a local GeoCLIP sidecar; without it `/locate` falls back to a vision-model estimate.
- A handful of extras need your own free key and stay dormant without one: global webcams (Windy), NASA FIRMS fires, ACLED conflict events, OpenAQ stations, ReliefWeb, ENTSO-E grid, AIS ships. FIRMS and OpenAQ are keyed and live in production; the other four are not.

Every number on this page was measured against the running code or live production on 2026-08-10, and every one of them will drift. `docs/API_KEYS.md` holds the canonical env-var names; `CLAUDE.md` holds the commands to re-measure each figure.

## 📸 Screenshots

| Cameras over London on satellite imagery | Country borders, names and live hazard pins |
|---|---|
| ![Live cameras clustered over London on satellite imagery](docs/screenshots/cameras.jpg) | ![Country borders and names with earthquake, wildfire and conflict pins across Europe](docs/screenshots/countries.jpg) |
| Every camera opens its live image, attributed | `/locate`: estimate where a photo was taken, keyless |
| ![Piccadilly Circus live TfL camera with attribution and metadata](docs/screenshots/camera.jpg) | ![Photo geolocation page](docs/screenshots/locate.jpg) |

## 🛠 Stack

Next.js 15 (App Router) · TypeScript · React 19 · MapLibre GL JS v5 · hls.js · satellite.js (SGP4) · h3-js · zod · Vitest · Playwright · deployed on Vercel.

Data and tiles are keyless: TfL · Caltrans · SCDOT · Finland Digitraffic · Castle Rock 511 · Oregon TripCheck · DriveBC · NZTA · Iceland · Estonia · Traffic Scotland · OpenSky Network · adsb.lol · adsbdb · CelesTrak · USGS · EMSC · NASA EONET · GDACS · NOAA · IODA · Open-Meteo · GDELT · data.police.uk · abuse.ch · Ransomware.live · UNHCR · WFP · UK FCDO (gov.uk) · CoinGecko · Frankfurter/ECB · Esri World Imagery · CARTO Positron · OpenTopoMap · Natural Earth · AWS Terrain Tiles.

## 🚀 Run

```bash
npm install
npm run dev                 # http://localhost:3000
# production build:
npm run build && npm run start
npm test                    # 956 unit tests across 191 files (Vitest), collected 2026-08-10
npx vitest list             # enumerate the suite without running it
```

No API keys are required for the core map. Optional keys unlock the dormant extras — the canonical names are in [`docs/API_KEYS.md`](docs/API_KEYS.md) (`WINDY_WEBCAMS_API_KEY`, `FIRMS_MAP_KEY`, `ACLED_EMAIL` + `ACLED_PASSWORD`, `OPENAQ_API_KEY`, `RELIEFWEB_APPNAME`, `ENTSOE_API_TOKEN`, `AISSTREAM_API_KEY`, `FINNHUB_API_KEY`, `FRED_API_KEY`) — and a local GeoCLIP sidecar improves `/locate` accuracy.

## 🧠 How it works

```
app/page.tsx ── components/WorldMap.tsx ──── one maplibregl.Map (projection: 'globe')
                  │   basemap registry (Satellite default / Light / Topographic) + 3D terrain
                  │   per-hazard signal icons + clickable Natural Earth country layer
                  ├── lib/sources/*     one adapter per camera feed -> Camera (zod), merged + cached
                  ├── lib/signals/*     one adapter + one registry entry per signal layer
                  │                      (points, lines and polygons, all data-driven)
                  ├── lib/planes/*      OpenSky global snapshot + adsbdb enrichment + trails
                  ├── lib/satellites/*  CelesTrak TLE -> SGP4 propagation on a client tick
                  ├── lib/geo/*         Natural Earth borders, advisory + instability dossier
                  ├── lib/proxy/*       closed image + HLS proxies (host allowlist, per-source cache)
                  └── lib/console/*     the widget console (centre stage + monitor-card panels,
                                         6 boards, shareable ?c= layouts)
API routes:  /api/cameras · /api/coverage · /api/planes · /api/satellites · /api/signals/[id]
             /api/proxy · /api/hls · /api/geolocate · /api/news · /api/markets · /api/advisory
             /api/recon · /api/near · /api/geocode · /api/flight · /api/webcams
```

Adding a camera source or a signal layer is one adapter file plus a fixture test; the normalisation layer, and the proxy that fronts every image, are the core of the project.

## Licence

Copyright © 2026 Sam Poplett.

Provenance is free software licensed under the **[GNU Affero General Public License v3.0](LICENSE)** (`AGPL-3.0-only`).

You may use, study, modify and redistribute it. The condition is reciprocity: if you distribute a modified version, **or run one as a network service**, you must make your source available to its users under the same licence. That network clause (section 13) is the reason this licence was chosen over MIT — the natural way to reuse this project is to host it, and a licence that only bound redistribution would not reach that.

Concretely, the running app links to this repository from the console header and the site footer. Those links are how section 13's offer of source is served, so they are a licence obligation rather than decoration.

### The data is not covered by this licence

The AGPL covers **this codebase only**. Every upstream feed keeps its own separate terms, and some require attribution that is reproduced in the app: TfL Open Data, Windy.com webcams, CARTO and OpenStreetMap basemaps, NASA EONET and FIRMS, USGS, GDACS, TeleGeography, adsb.lol and OpenSky, among others. Redistributing this code does not grant you any right to their data — check each source before relying on it.

### Third-party code

None. No code was copied from any other project; `koala73/worldmonitor` was read for factual endpoint information only, which is not copyrightable.
