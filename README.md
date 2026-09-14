<p align="center">
  <img src="docs/screenshots/hero.png" width="820" alt="Provenance: a night satellite globe carrying live undersea cables, satellites, earthquakes and country-instability signals">
</p>

<h1 align="center">Provenance</h1>
<p align="center">A live map of the world's open data, where every dot says who published it and how it knows.</p>

<p align="center">
  <a href="https://provenance-online.com"><img src="https://img.shields.io/badge/live-provenance--online.com-2ea44f" alt="Live at provenance-online.com"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-AGPL--3.0-blue" alt="Licensed AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" alt="Next.js 15">
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/MapLibre%20GL-v5-1a73e8" alt="MapLibre GL v5">
  <img src="https://img.shields.io/badge/unit%20tests-3%2C854-2ea44f" alt="3,854 unit tests">
</p>

## TL;DR

- **What it is:** a free, live globe of public data. It shows about 20,000 official road cameras, 70,698 webcams, aircraft, satellites and 33 signal layers, for example earthquakes, wildfires and undersea cables.
- **Why it is different:** every dot names who published it, how the number was made, and what it cannot tell you.
- **Try it:** [provenance-online.com](https://provenance-online.com). The core map needs no key and no login. To run it locally: `npm install && npm run dev`.
- **When a source fails:** the layer shows an empty set or its last good data. It never shows invented data. On 2026-09-14, satellites and 4 signal layers were empty.
- **Licence:** AGPL-3.0 for the code. Each data source keeps its own terms.

<details>
<summary><b>Production check, 2026-09-14</b>: what the live site returned, and the open issues</summary>

_Status: live at [provenance-online.com](https://provenance-online.com) and runs locally with no keys. Coverage is real but partial and depends on public upstreams staying open, so here is what production actually returned on **2026-09-14**, against `462f125`:_

| Check | Result |
|---|---|
| all 34 `GET /api/signals/<id>` | **34 of 34 answered `200`**. 30 returned data and 4 were empty: ReliefWeb (needs an approved `appname`, which is a free registration and not a key), ENTSO-E grid load (needs a free key), NASA FIRMS active fires (its key is set, and it still returned 0 rows) and Ransomware.live victims (keyless, 0 rows) |
| `GET /api/coverage` | **20,011 cameras, 19,827 of them online**, the same total on three reads 75 s apart. 16 of 17 feeds answered. NZTA was stale and served its last good 313 cameras |
| `GET /api/planes` | **3,000 aircraft**, a proportional spatial sample capped from at least 4,106 seen. Only 1 of the 4 type batches answered on that read, so the upstream figure is a lower bound |
| `GET /api/satellites` | **0 satellites**. The route answered `celestrak_unavailable` on two reads about three minutes apart |
| webcam layer | **70,698 webcams** in 196 static tiles under `public/webcams/`, harvested from Windy on 2026-09-05. `GET /api/webcams`, the live fallback, returned 1,609 |
| `npx vitest list` | **3,854 tests across 378 files** collected. This counts the suite and does not run it |

All four empty layers still answered `200` with an empty set, which is the contract: a dormant or failing upstream degrades to an honest blank, never a 5xx and never invented data. The same contract is why satellites read 0 instead of an error page. Two of the blanks are not explained yet: FIRMS has its key and Ransomware.live needs none, so neither one is waiting on configuration.

**Why the camera count is one number again.** On Vercel, `/api/coverage` gave a range: four reads 70 s apart on 2026-08-18 returned 12,866, 13,066, 13,266 and 12,866. Every serverless instance kept its own copy of the camera cache, and each request reached whichever instance the router picked. Production now runs as one Node process on AWS Lightsail (`deploy/provenance.service`), so one read gives one number, and three reads 75 s apart returned the same 20,011. One caveat remains: a feed that fails keeps its last good cameras, so a total can include a stale feed. The NZTA row above is that case.

**Open issues, stated plainly.** Satellites and aircraft have the live gaps shown in the table, and neither is diagnosed yet. Castle Rock 511, which fans out to ten US and Canadian 511 systems, answered 12,771 cameras on this read. In August it answered about 6,200 to 6,600, and part of that gap was our own code: a uniform 10-second per-feed timeout in `lib/sources/registry.ts`, applied to an adapter that needed about 18.5 s warm and about 40 s cold. The feed now has its own 60 s budget. Whether 12,771 is everything those systems publish has not been measured. Best-accuracy photo geolocation wants a local GeoCLIP sidecar, without which `/locate` falls back to a vision-model estimate.

Every figure above will drift, which is why each one is dated and pinned to a commit rather than left floating. `CLAUDE.md` holds the command to re-measure each one, and [`docs/API_KEYS.md`](docs/API_KEYS.md) holds the canonical env-var names.

</details>

## ✨ Features

Governments, space agencies, seismologists and UN clusters publish an enormous amount of live data for free, in formats almost nobody can read. Provenance renders **37 live layers on one globe**, and every layer carries the body that published it, how its numbers were arrived at, and what it *cannot* tell you.

- **Globe to map in one view.** A satellite Earth flattens into a street or topographic map as you zoom.
- **Every layer is attributed.** Each one states its publisher, its method, a confidence class and a limitation.
- **Truncation is declared.** A capped response says how many rows existed and how it chose the rows you see.
- **Official road cameras, no key.** The cameras come directly from the agencies that operate them, one dot for each camera.
- **Aircraft and satellites.** Live ADS-B positions worldwide. Your browser calculates the satellite orbits.
- **A console for analysts** at `/app`: a widget catalogue, presets, shareable layouts, country dossiers and CSV or GeoJSON export.
- **A landing page that cannot drift.** No count is typed into it. Each figure comes from a committed data file.

<details>
<summary><b>How each feature works</b>, with the sources and figures</summary>

- **One continuous globe-to-map engine** - a single MapLibre `projection: 'globe'` instance shows a satellite Earth and flattens into a satellite, street or topographic map as you zoom. No cross-fade seam, one WebGL context. 3D mode calls `map.setTerrain()` against AWS `terrarium` raster-DEM tiles from zoom 6 (`TERRAIN_MIN_ZOOM`), because terrain crashes MapLibre's depth pass while the map is still a globe.
- **37 layers, each independently attributed** - four core layers (cameras, webcams, aircraft, satellites) plus 33 global-signal layers, each opt-in and drawn as its own hazard pin: earthquakes (USGS and EMSC), wildfires, volcanoes, storms and floods (NASA EONET), GDACS disaster alerts, tropical cyclones, NASA FIRMS active fires, aurora and space weather (NOAA), rocket launches, undersea cables and their landing stations, GPS jamming, nuclear plants, airports, ports, national internet outages (IODA), cloud-provider outages, GDELT conflict and protest coverage, air quality (Open-Meteo plus OpenAQ stations), UK street crime, cyber command-and-control and ransomware (abuse.ch, Ransomware.live), forced displacement (UNHCR), ReliefWeb emergencies, ENTSO-E grid load, military ADS-B and AIS ships, Ukraine air-raid alerts. A 34th source, the composite Country Instability Index, is registered and documented but is deliberately **not** a map layer: it has no pin of its own and instead feeds the Brief, the Country Instability widget and the country dossier.
- **Every layer says how it knows** - each of the 34 carries a provenance card: what a single pin actually *is*, the method behind it, a confidence class (today 11 official, 9 reported, 7 measured, 5 modelled, 2 derived) and a limitation that is never allowed to be empty. There is no "not documented yet" fallback, because `tests/unit/signals-explain.test.ts` fails the build when a layer is registered without one.
- **Truncation is declared, not hidden** - an endpoint that caps its response says so in a coverage record: how many rows existed upstream, how many are here, and how the survivors were chosen. On 2026-09-14, UK crime returned 1,500 of 11,181 that way, GPS jamming 400 of 475, rocket launches 30 of 363, and aircraft 3,000 of at least 4,106 (a spatial sample, so every region keeps its share).
- **17 camera feeds, 26 agency networks, 11 countries, keyless** - the actual agency feeds (TfL, Caltrans, SCDOT, Finland Digitraffic, Castle Rock 511, Oregon TripCheck, DriveBC, NZTA, Iceland, Estonia, Traffic Scotland, CET-SP Sao Paulo, two Serbian operators - MUP border crossings and JP Putevi Srbije toll plazas - BIHAMK in Bosnia and Herzegovina, ACT in Puerto Rico, and Houston TranStar, the first network added by discovery rather than by hand). Feeds and networks are not the same count here, because Castle Rock alone carries ten separate 511 deployments (Florida, Georgia, New York, Idaho, Louisiana, New England, Ontario, Alberta, Nova Scotia, New Brunswick), which is what takes 17 feeds to 26 agencies. All of it is normalised into one `Camera` shape and drawn as one dot per camera at every zoom - no count badges, no aggregation. Cameras clustered until 2026-09-03; the badges covered a measured 51.9% of the Europe rectangle at world zoom, which is a poor trade for hiding a circle layer the GPU draws without complaint. Each camera opens its live still or HLS video through a closed proxy that takes a camera **id**, never an arbitrary URL, resolves it behind a host allowlist and caches at that source's own cadence. A feed that fails keeps its last-good cameras instead of silently deleting its region.
- **Aircraft and satellites** - live ADS-B from adsb.lol, pulled worldwide by ICAO type in four paced requests and capped as a proportional spatial sample so every region keeps its share, with breadcrumb trails and route enrichment fetched on click; satellites propagated in the browser from CelesTrak TLEs with SGP4, so the server never ticks orbits and the constellation moves at frame rate.
- **A terminal-style console** - a dense OSINT shell at `/app`: 65 widget types in a ⌘K catalogue, seven presets that rearrange the workspace and re-skin the map layers in one tap, 13 monitor variants, a drag-and-snap widget grid, and any layout shareable as a `?c=` URL. A first visit opens the Globe preset, which is the map with no widgets in front of it. Every layer and every widget is one ⌘K entry away. Countries are clickable for a sourced dossier (UK FCDO travel advice, the instability index with each contributing layer linked, and the signals active there), and every widget dumps its visible rows as CSV or GeoJSON.
- **A landing page that cannot drift** - the hero globe at `/` draws every registered signal layer from the same `SOURCE_CATALOG` the app renders from, so adding an adapter updates it with no marketing-side edit. No count is typed into the page. Each one is read from a committed data file that is either pinned by a test, generated from a production run, or quoted from one published study.

</details>

## 📸 Screenshots

<p align="center">
  <img src="docs/screenshots/streets.png" width="900" alt="The Streets board: a full-bleed live map open on a pre-drawn circle over the densest cluster of live cameras measured, prompting you to draw your own area before any camera-wall tiles appear">
</p>

**Streets** is a board of camera walls you compose yourself. Every tile holds a *list* of live views rather than one, so `47/60` is a slot cycling through the sixtieth camera it was given - sixty road cameras added in a single drag of a box across London. Search a place, paste a YouTube link, or arm a tile and pick straight off the map.

<details>
<summary><b>What a tile says about the road</b>, and what it refuses to say</summary>

Each tile also states the conditions where its camera stands, and the interesting part is what it refuses to say. Where a road-weather station publishes a surface state and that reading survives every disqualification rule, the tile shows the operator's own word for it. Everywhere else it derives a line from air weather and says `from air` in the line itself, reporting rainfall rather than a road state - `rain 1h`, never `wet`, because an hour of rain does not tell you whether a surface is wet, frozen or already dry. Measured live on 2026-09-03: of 19,808 cameras, 912 carry a surface field and **649 survive every rule, which is 3.3%**. A reading from a station over 10 km away, or one the operator has flagged stale or faulty, is refused rather than downgraded, so a camera with a distant station shows *less* than one that never had a station at all. Open the tile and the panel discloses exactly what was refused and whose rule refused it - the 10 km limit is ours, the staleness verdicts are the operator's.

</details>

| The console at `/app`: brief, hazards and the live map | Cameras over London, before clustering was removed on 2026-09-03 |
|---|---|
| ![The Provenance OSINT terminal showing what's abnormal, disasters, world headlines and a dark world map](docs/screenshots/console.png) | ![Camera clusters over London on the dark basemap](docs/screenshots/london.png) |
| Every camera opens its live frame, attributed | The landing page's argument, in one section |
| ![A live TfL camera on the A406 with its source, coordinates and refresh cadence](docs/screenshots/camera.png) | ![Every dot has a receipt: a raw USGS earthquake record beside the pin it becomes](docs/screenshots/receipt.png) |

## 🛠 Stack

Next.js 15 (App Router) · TypeScript · React 19 · MapLibre GL JS v5 · hls.js · satellite.js (SGP4) · h3-js · react-grid-layout · zod · posthog-js · Vitest · Playwright · self-hosted on AWS Lightsail (Node behind Caddy) and served through Cloudflare.

<details>
<summary><b>All data and tile sources</b> (keyless first)</summary>

TfL · Caltrans · SCDOT · Finland Digitraffic · Castle Rock 511 · Oregon TripCheck · DriveBC · NZTA · Iceland · Estonia · Traffic Scotland · CET-SP (Sao Paulo) · MUP Srbije · JP Putevi Srbije · BIHAMK · ACT (Puerto Rico) · Houston TranStar · Windy webcams · adsb.lol · adsb.fi · adsbdb · CelesTrak · USGS · EMSC · NASA EONET · NASA FIRMS · GDACS · NOAA · IODA · Open-Meteo · OpenAQ · GDELT · data.police.uk · abuse.ch · Ransomware.live · UNHCR · ReliefWeb · ENTSO-E · TeleGeography · The Space Devs · OurAirports · OpenStreetMap (Overpass) · gpsjam.org · alerts.com.ua · AISStream.io · UK FCDO (gov.uk) · CoinGecko · Frankfurter/ECB · Esri World Imagery · OpenFreeMap (OpenMapTiles) · CARTO (label fonts) · OpenTopoMap · Natural Earth · AWS Terrain Tiles.

</details>

## 🚀 Run

```bash
npm install
npm run dev                 # landing page at http://localhost:3000, console at /app
# production build:
npm run build && npm run start
npm test                    # 3,854 tests across 378 files (Vitest), counted on 462f125
npx vitest list             # enumerate the suite without running it
```

No API keys are needed for the core map. Optional keys unlock the dormant extras, and the canonical names live in [`docs/API_KEYS.md`](docs/API_KEYS.md) (`WINDY_WEBCAMS_API_KEY`, `FIRMS_MAP_KEY`, `OPENAQ_API_KEY`, `RELIEFWEB_APPNAME`, `ENTSOE_API_TOKEN`, `AISSTREAM_API_KEY`, `FINNHUB_API_KEY`, `FRED_API_KEY`). A local GeoCLIP sidecar improves `/locate` accuracy.

## 🧠 How it works

```
app/(site)/page.tsx ─── the landing page: the hero globe draws every signal layer from
                        SOURCE_CATALOG; its figures come from committed data files
app/(console)/app/ ──── the console shell
  └── components/WorldMap.tsx ─ one maplibregl.Map (projection: 'globe')
        basemap registry (satellite / streets / topo) + 3D terrain
        per-hazard signal icons + clickable Natural Earth country layer
  ├── lib/sources/*      one adapter per camera feed -> Camera (zod), merged + last-good
  ├── lib/signals/*      one adapter + one registry entry per source (34, 33 of them map layers)
  ├── lib/signals/explain.ts   the provenance card for every layer, enforced by a test
  ├── lib/planes/*       spatial sampler, trails + enrichment (the adsb.lol type pull is lib/sources/adsb.ts)
  ├── lib/satellites/*   CelesTrak TLE -> SGP4 propagation on a client tick
  ├── lib/geo/*          Natural Earth borders, advisory + instability dossier
  ├── lib/proxy/*        closed image + HLS proxies (host allowlist, per-source cache)
  └── lib/console/*      widget registry (65 types), 7 presets, shareable ?c= layouts
API routes:  /api/cameras · /api/camera · /api/coverage · /api/status · /api/planes
             /api/satellites · /api/signals/[id] · /api/proxy · /api/hls · /api/webcams
             /api/news · /api/brief · /api/markets · /api/advisory · /api/recon
             /api/near · /api/geocode · /api/flight · /api/geolocate · /api/og
```

Adding a camera source or a signal layer is one adapter file, one registry entry and a fixture test. A signal layer then appears on the map, in the rail, in the widget catalogue and on the landing page's hero globe with no further edits. The normalisation layer, the proxy that fronts every image, and the rule that a failing upstream resolves to an empty set or the last good answer are the core of the project.

## Licence

Copyright © 2026 011-sam-110.

Provenance is free software licensed under the **[GNU Affero General Public License v3.0](LICENSE)** (`AGPL-3.0-only`).

You may use, study, modify and redistribute it. The condition is reciprocity: if you distribute a modified version, **or run one as a network service**, you must make your source available to its users under the same licence. That network clause (section 13) is the reason this licence was chosen over MIT: the natural way to reuse this project is to host it, and a licence that only bound redistribution would not reach that.

Concretely, the running app links to this repository from the console header and the site footer. Those links are how section 13's offer of source is served, so they are a licence obligation rather than decoration.

### The data is not covered by this licence

The AGPL covers **this codebase only**. Every upstream feed keeps its own separate terms, and some require attribution that is reproduced in the app: TfL Open Data, Windy.com webcams, OpenFreeMap, OpenMapTiles, CARTO and OpenStreetMap basemaps, NASA EONET and FIRMS, USGS, GDACS, TeleGeography and adsb.lol, among others. Redistributing this code does not grant you any right to their data, so check each source before relying on it.

### Third-party code

None. No code was copied from any other project; `koala73/worldmonitor` was read for factual endpoint information only, which is not copyrightable.

## History

The repository used to be called `TrafficNerd-V2` and the product was briefly called OpenData. Both are now **Provenance**. It is the web rewrite of [TrafficNerd v1](https://github.com/011-sam-110/TrafficNerd), which was a London-only terminal app.
