# TrafficNerd v2 — Product Requirements Document

> **A live 3D globe of the world's open traffic cameras.**
> Spin the Earth, watch ~10,000+ government traffic cameras from every continent light up, click any one for a live view — all in the browser, sourced only from feeds that are *published for public reuse*.

- **Status:** Draft / approved design — pre-implementation
- **Date:** 2026-06-26
- **Repo:** `011-sam-110/TrafficNerd-V2` (separate from v1)
- **Predecessor:** [TrafficNerd v1](https://github.com/011-sam-110/TrafficNerd) — a London-only Textual **terminal** app over the TfL JamCam network
- **Canonical design doc:** this file is the single source of truth (mirrored at `docs/superpowers/specs/2026-06-26-trafficnerd-v2-design.md`)

---

## 1. Background & why v2

TrafficNerd **v1** is a polished terminal (TUI) traffic-ops console for **London only**, built on the free **TfL JamCam** API (~900 cameras). It renders camera images as inline/block-art in the terminal, plots them on an ASCII map, estimates congestion from frame-to-frame pixel diffs, and offers a "Situation Room" dashboard. It is genuinely clever, but two things cap its reach:

1. **It's a terminal app** — image fidelity depends on the terminal's graphics protocol, and it'll never be something you just send someone a link to.
2. **It's one city.** The whole world publishes open traffic cameras; v1 sees 0.x% of them.

**v2** keeps the *spirit* of v1 (live cameras + spatial intelligence + an ops-console feel) but re-platforms it as a **web app** and **goes global**, with the homepage being a **massive rotating 3D globe** (Google-Earth energy) studded with cameras from everywhere that openly allows it.

This is, deliberately, a **deployed portfolio showpiece**: a genuinely-working live site with honest coverage, built on a recruiter-legible stack, demonstrating real engineering (a normalization layer over ~25 heterogeneous government feeds, an image proxy, spatial queries, scheduled ingestion) — not a mockup.

---

## 2. Goals & non-goals

### Goals
- A **3D globe homepage** (Globe.GL / three.js) that loads ~10k+ camera points spanning every continent and *feels* alive (rotation, glow, congestion heat, zoom-to-camera).
- A **normalization layer** that turns ~25 incompatible open feeds into one `Camera` shape — adding a country is adding one file.
- **Click → live camera** view with metadata, nearby cameras, congestion, and (where available) video stream.
- Re-imagine **v1's strongest intelligence** for the web: congestion heat, a Situation Room, watch+alerts, compare.
- **Structural legal compliance**: every image carries its required license + attribution; only consent-published feeds are ever used.
- **Deployed live**, honest, and cheap to run.

### Non-goals (v2)
- ❌ Not a terminal app (v1 stays as-is; v2 is a separate repo).
- ❌ No face / licence-plate recognition. Ever. (Privacy is the bright line that makes these feeds legitimate.)
- ❌ No scraping of unsecured/private cameras (Insecam-class sites) — out of scope permanently.
- ❌ Not "infinite scale" — curated, real coverage over a marketing number.
- ❌ No user accounts / auth in MVP (watch-lists and favourites persist client-side).
- ❌ Terminal-only gimmicks from v1 are dropped (see §10).

---

## 3. Locked product decisions

| Decision | Choice | Rationale |
|---|---|---|
| Globe rendering | **Globe.GL / three.js** ("GitHub globe" look) | Client-side, free, high wow-factor, no per-tile API cost |
| Project intent | **Deployed portfolio showpiece** | Honest, resume-grade, genuinely working |
| Feature scope | **Globe-first; re-imagine v1's best, drop the rest** | Lead with discovery; port only what translates to web |
| Launch coverage | **Maximal** (keyless + free-key + family adapters) | ~10k+ cameras; the impressive engineering *is* the breadth |
| Backend topology | **Approach A** — Next.js full-stack on Vercel + managed PostGIS + Vercel Cron + edge image-proxy | One clean repo, recognizable stack, low cost |

---

## 4. Personas & primary use cases

- **The curious visitor** lands on the globe, spins it, clicks Tokyo… finds it's dark, clicks Hong Kong, sees live traffic. *Use case: discovery / "wow."*
- **The commuter / local** searches their city or road and watches a specific junction. *Use case: targeted live view + watch/alerts.*
- **The ops voyeur** opens the Situation Room — a wall of live feeds for a region with a "most-congested now" rail. *Use case: dashboard.*
- **The recruiter / engineer** reads the Sources page and the code, and sees a real, honest, well-engineered system. *Use case: credibility.*

---

## 5. Architecture (Approach A)

Single **Next.js 15 (App Router, TypeScript)** application deployed on **Vercel**.

```
┌─ Front end (Globe.GL / three.js + React) ───────────────────────────┐
│  globe · region/camera detail · search · situation room · sources   │
└──────────────▲────────────────────────────▲────────────────────────┘
       /api/cameras?bbox=   /api/camera/:id   /api/proxy   /api/congestion
               │                   │              │             │
┌──────────────┴───────────────────┴──────────────┴─────────────┴─────┐
│  API routes (serverless / edge)                                      │
│   • registry reads — PostGIS bbox + text search                      │
│   • image PROXY  ← the ONLY path images reach the browser            │
│   • congestion / availability for the "hot set" only                 │
├──────────────────────────────────────────────────────────────────────┤
│  Registry builder  (Vercel Cron — one staggered job per source)      │
│   adapters → normalize (zod) → upsert PostGIS → publish JSON tiles    │
├──────────────────────────────────────────────────────────────────────┤
│  Source adapters  (lib/sources/*) — common interface                 │
│   tfl · digitraffic · hongkong · nsw · qld · nz · caltrans · chart ·  │
│   ohgo · ibi511(host→~20 states+ON/AB) · lta · wsdot · tripcheck ·    │
│   trafikverket · its-korea · tdx · arcgis-hub(url→IA/MI/IL/FL/TX/MA)· │
│   drivebc · quebec                                                    │
├──────────────────────────────────────────────────────────────────────┤
│  Postgres + PostGIS (Neon/Supabase free tier)  +  key store (secrets)│
└──────────────────────────────────────────────────────────────────────┘
```

### Two deliberate boundaries
1. **Registry layer** — *all* ~10k cameras' locations + metadata. Cheap, cron-refreshed, and published as **static JSON region-tiles** so the globe's first paint is instant. Read path: PostGIS bbox/search.
2. **Live layer** — availability + congestion, computed **only for the bounded "hot set"** the user is actually viewing (never all 10k). This keeps cost bounded and the product honest about where live data actually exists.

### Documented fallback (Approach B)
If Vercel serverless time/bandwidth limits ever bite on ingestion or proxying, the escape hatch is to move the **registry builder + image proxy** to an always-on worker (the existing VPS `sam@81.133.67.228`, or Fly/Railway), keeping the Next.js front end on Vercel. Recorded here so it's a deliberate option, not a rewrite.

---

## 6. Data model

The normalization target every adapter produces:

```ts
interface Camera {
  id: string;                 // stable: `${source}:${nativeId}`
  source: string;             // 'tfl' | 'digitraffic' | ...
  country: string;            // ISO-3166 alpha-2
  region?: string;            // state / province / borough
  name: string;
  lat: number;
  lon: number;
  road?: string;
  direction?: string;
  imageUrl?: string;          // direct JPEG, OR null if it must be resolved per-request
  streamUrl?: string;         // HLS/RTSP/MJPEG where the source provides it
  mediaType: 'jpeg' | 'video' | 'both';
  refreshSeconds: number;     // source's stated update cadence — caps our poll rate
  license: string;            // 'CC-BY-4.0' | 'OGL' | 'public-domain' | 'SG-ODL' | ...
  attribution: string;        // exact required credit string, shown with every image
  available: boolean;         // last-known
  lastSampledAt?: string;     // ISO timestamp
}
```

A separate **`Source`** record (one per provider) holds the cross-cutting policy so credits and throttles are *data, not hardcode*:

```ts
interface Source {
  id: string;                 // 'digitraffic'
  name: string;               // 'Fintraffic Digitraffic'
  homepage: string;
  license: string;
  attribution: string;        // canonical credit string
  rateLimit: { calls: number; perSeconds: number };
  needsKey: boolean;
  proxyHeaders?: Record<string,string>;  // e.g. Referer, Digitraffic-User
  imageUrlExpires?: boolean;  // true → resolve fresh per request (LTA S3, Windy)
  status: 'ok' | 'degraded' | 'down';    // updated by the cron job
}
```

### Adapter interface
```ts
interface SourceAdapter {
  id: string;
  meta: Source;
  fetchRegistry(): Promise<Camera[]>;          // locations + metadata (cheap, cron'd)
  resolveImage?(cam: Camera): Promise<string>; // only for token/S3-expiry sources
}
```

**Two parameterized families do the heavy lifting:**
- `ibi511(host)` — one code path covers ~20 US states + Ontario & Alberta (same REST shape).
- `arcgisHub(featureServerUrl)` — one reader covers every ArcGIS-Hub location source (Iowa, Michigan, Illinois, Florida, Texas, Massachusetts, …).

All adapter output is validated with **zod** before it touches the database — a malformed feed fails loudly in its own job, never silently corrupts the registry.

---

## 7. Source catalog (verified survey, 2026-06-26)

Compiled from live fetches of provider docs/specs. Endpoints listed are only those confirmed against real documentation; anything not confirmed is marked **UNVERIFIED** and must be checked against one live response before that adapter ships. **There is no global standard delivering camera image URLs** — the normalization layer in §6 is the project's core engineering.

Legend — **Access:** JSON / GeoJSON / XML / DATEX (DATEX II XML) / CSV / scrape. **Redist:** ✅ allowed (with attribution) · ⚠️ gated/conditional · ❌ no · ? unverified.

| Region | Provider | ~#cams | Access | Key? | Media | Redist | Endpoint / docs |
|---|---|---|---|---|---|---|---|
| UK London | **TfL JamCams** | ~900 | JSON | optional | JPEG (S3) + 10s MP4 | ✅ attrib | `api.tfl.gov.uk/Place/Type/JamCam` |
| Ireland | TII | 100s | DATEX + portal | likely no | JPEG | ✅ CC BY 4.0 | `data.tii.ie` |
| Finland | **Fintraffic Digitraffic** | 470+ | JSON + JPEG | no (hdr) | JPEG ~10min | ✅ CC BY 4.0 | `tie.digitraffic.fi/api/weathercam/v1/stations` |
| Norway | Statens vegvesen | 100s | DATEX/WFS | register | JPEG | ✅ NLOD | `dataut.vegvesen.no/.../webkamera` |
| Sweden | Trafikverket | ? | XML POST | free key | JPEG | ✅ (verify) | `api.trafikinfo.trafikverket.se/v2/data.json` |
| Denmark | Vejdirektoratet | ~417 | DATEX | register | JPEG | ? | `du-portal…vd.dk/data/61` |
| Germany | Autobahn GmbH | sparse | JSON | no | JPEG (`imageurl`) | ? | `verkehr.autobahn.de/o/autobahn/{road}/services/webcam` |
| Singapore | **LTA DataMall** | ~90 | JSON | free key | JPEG 1–5min (S3, 5min expiry) | ✅ SG-ODL | `datamall2.mytransport.sg/ltaodataservice/Traffic-Imagesv2` |
| Hong Kong | **Transport Dept** | 200+ | JPEG/XML | no | JPEG 320×240 ~2min | ✅ attrib | `tdcctv.data.one.gov.hk/<ID>.JPG` |
| Taiwan | TDX (MOTC) | 1000s | JSON OAuth2 | free key | vid (RTSP/HLS) + JPEG | ✅ attrib | `tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/...` |
| S. Korea | ITS NTIC | 1000s | JSON/XML | free key | HLS + JPEG ~30s | ✅ KOGL (verify) | `openapi.its.go.kr:9443/cctvInfo` |
| AU NSW | **Live Traffic NSW** | 100s | GeoJSON | no (live feed) | JPEG ~60s | ✅ CC BY | `api.transport.nsw.gov.au/v1/live/cameras` |
| AU QLD | **QLDTraffic** | ? | GeoJSON | public key | JPEG | ✅ CC BY 4.0 AU | `api.qldtraffic.qld.gov.au/v1/webcams?apikey=` |
| AU WA | Main Roads WA | ? | ArcGIS | no | ? | ✅ CC BY | `catalogue.data.wa.gov.au/.../mrwa-traffic-cameras` |
| New Zealand | **NZTA Waka Kotahi** | 100+ | REST→**XML** | no | JPEG | ✅ CC BY 4.0 | `trafficnz.info/service/traffic/rest/4` |
| USA WA | **WSDOT** | statewide | JSON+ArcGIS | free key | JPEG only | ✅ cite | `wsdot.wa.gov/Traffic/api/HighwayCameras/...GetCamerasAsJson` |
| USA CA | **Caltrans CWWP2** | 1000s | CSV/JSON/ArcGIS | no | JPEG + stream | ✅ "no charge" | `cwwp2.dot.ca.gov/documentation/cctv/cctv.htm` |
| USA OH | **OHGO** | 1300+ | JSON+Swagger | free key | JPEG ~5s | ✅ public domain | `publicapi.ohgo.com/docs/v1/cameras` |
| USA MD | **CHART** | 100s | JSON+ArcGIS | no | JPEG+vid | ✅ open | `chart.maryland.gov/DataFeeds/GetCamerasJson` |
| USA OR | TripCheck | statewide | JSON/XML | free key | JPEG | ✅ free | `apiportal.odot.state.or.us` |
| USA multi | **ibi511 family** (NY,GA,AZ,UT,CT,ID,LA,WI) | per-state | JSON/XML | free key | JPEG `Url`+`VideoUrl` | ⚠️ per-ToS, 10/60s | `<host>/api/getcameras?key=&format=` |
| USA multi | **ArcGIS Hubs** (IA,MI,IL,FL,TX,MA) | 1000s | GeoJSON | no | JPEG (locations) | ✅ (attrib varies) | `gis-*.opendata.arcgis.com` |
| USA NYC | NYC DOT TMC | ~900 | JSON (undoc) | no | JPEG | ? | `webcams.nyctmc.org/api/cameras` |
| Canada ON | **Ontario 511** | ? | JSON/XML | no | JPEG (`Views[].Url`) | ✅ OGL-ON | `511on.ca/api/v2/get/cameras` |
| Canada AB | **Alberta 511** | ? | JSON/XML | no | JPEG | ? | `511.alberta.ca/api/v2/get/cameras` |
| Canada BC | **DriveBC** | ? | CSV | no | JPEG | ✅ OGL-BC | `catalogue.data.gov.bc.ca/dataset/6b39a910-…` |
| Canada QC | **Québec 511** | ? | WFS→GeoJSON | no | vid/JPEG | ✅ CC BY 4.0 | `ws.mapserver.transports.gouv.qc.ca/swtq?...typename=ms:infos_cameras` |
| Aggregator | Windy Webcams | — | JSON | free key | JPEG (token, 10min) | ⚠️ display+backlink only | `api.windy.com/webcams/docs` |
| Prior art | OpenTrafficCamMap | ~7,515 | JSON (GitHub) | no | varies | ✅ MIT | `github.com/AidanWelch/OpenTrafficCamMap` |

**Hard-excluded (never integrated):**
- **France** (Sytadin/Bison Futé) — reproduction explicitly prohibited.
- **Netherlands** (NDW/Rijkswaterstaat) — no camera imagery exists (privacy; ANPR only).
- **Japan** (JARTIC/NEXCO) — no open-licensed image API.
- **National Highways England** — Crown © / partner-gated, not open.
- **Insecam-class sites** — unsecured private cameras scraped without consent. Out of scope permanently (unethical and likely illegal).

> **Prior art to study, not copy:** `AidanWelch/OpenTrafficCamMap` (MIT) is the closest existing project — a crowdsourced ~7.5k-camera JSON DB keyed by country code. Worth mining for its data model and as a coverage cross-check; v2's differentiator is the live globe + normalization + intelligence layer, not the raw list.

---

## 8. Globe & front-end UX

### Homepage — the globe *is* the product
- **Globe.GL** textured Earth, gentle auto-rotation, ~10k points from the cached registry tiles.
- **Aggregation: none, and that is the decision.** This originally called for points to cluster into glowing country/region nodes with counts when zoomed out. Superseded 2026-09-03: every camera is its own dot at every zoom. The badges were measured covering 51.9% of the Europe rectangle at world zoom, so the aggregation intended to make the map readable was the thing making it unreadable. ~19k circles are cheap; what is expensive is ~19k symbols, so the detailed icon layer hands over from the dots at z11 instead of z5.
- **Colour = congestion heat** (blue → red) **only where live data exists; neutral grey otherwise** (honest about partial coverage).
- **Hover** → tooltip (name · road · source). **Click** → camera flies to centre, detail panel opens.
- **Live stat overlay:** *"10,4xx cameras · 23 sources · 14 countries · live."*
- **Search** (city / road / source) flies the camera there; **continent/country quick-jumps** for navigation.

### Camera detail
- **Live image via `/api/proxy`**, auto-refreshing at the source's `refreshSeconds`, with the **required attribution + license badge always visible** (e.g. *"Source: Fintraffic / digitraffic.fi — CC BY 4.0"*).
- **Video** played with **hls.js** where the source provides a stream (Taiwan, Korea); JPEG otherwise.
- Metadata (location, road, direction, source, last-updated) + **nearby cameras** (PostGIS, clickable).
- **Congestion** readout — per-refresh image-diff score `[▓▓▓░░] BUSY` + sparkline (v1's signature, computed server-side for the hot set only).

### Re-imagined v1 intelligence
- **Situation Room** route — a CCTV-style wall of N live cameras (a saved set or a chosen region) + a mini globe-heat panel + a "most-congested now" rail + a source/availability status strip. Optional **Director auto-cut** toggle (cycles to the busiest) as a stretch.
- **Watch + alerts** — toggle a camera; a background poll fires a browser notification + in-app toast on scene change.
- **Compare** — pin one camera, open a second, side-by-side, both refreshing.

### Supporting pages
- **Sources / About** — every source with its license, required attribution, camera count, last-refresh, and live status. This is simultaneously the **legal-compliance surface** and an **honesty showcase** for recruiters ("here's exactly where every pixel comes from").
- **Region pages** (post-MVP, SEO) — `/region/[country]`.

---

## 9. Image proxy, caching, rate limits & keys

The image proxy is the single most important backend component and is deliberately a **closed** proxy.

- **`/api/proxy` takes a camera id, not an arbitrary URL.** It resolves id → source → real image URL (or calls `resolveImage` for token/S3 sources), then fetches and returns the bytes.
- **Host allowlist** derived from the `Source` table — any non-registered host is rejected. This prevents the proxy becoming an open relay / SSRF vector.
- Sets correct **`Referer`/headers**, **upgrades http→https** (mixed content on legacy hosts like old DriveBC), and **relaxes CORS** so the browser (and any canvas/diff work) is happy.
- **Caches each image at the source's `refreshSeconds`** (Vercel edge cache / KV) — we never poll a source faster than it updates. This respects rate limits *and* slashes bandwidth (we only proxy a camera while someone is actually viewing it).
- **Expiring URLs** (LTA DataMall S3 ≈5 min, Windy tokens ≈10 min) are resolved fresh per request and **never cached as URLs**.
- The **congestion sampler reuses the bytes the proxy already fetched** — fetch once, diff + serve.

**Rate limiting & keys:** a per-source **token-bucket** seeded from `Source.rateLimit` (ibi511 10/60s, Illinois Gateway 1/5min, QLD 100/min, Digitraffic 60/min/IP), with cron ingestion **staggered** across sources. Keyed sources read keys from **Vercel secrets**; `.env.example` documents every required key and where to register for it.

> **CORS reality:** per-host CORS behaviour is largely undocumented across government feeds — the design assumes **"no CORS"** everywhere and routes all imagery through the proxy. `<img src>` of a remote JPEG is CORS-exempt and *might* work directly, but the moment we need bytes (caching, change-detection, watermarking) CORS applies and most hosts send no `Access-Control-Allow-Origin`. The proxy removes the guesswork.

---

## 10. Legal, licensing & ethics

Compliance is **structural, not best-effort**:

1. **Attribution + license are required fields** on every `Camera`/`Source`. The image component *cannot render without showing them*. The Sources page aggregates all credits.
2. **Attribution is per-source and is NOT public domain** for most feeds — OGL (UK/Ontario/BC), CC BY (Ireland, Finland, NSW, QLD, NZ, Québec…), SG-ODL (Singapore) all require credit strings; TfL needs *"Powered by TfL Open Data."* US **federal** works are public domain, but **state** DOT feeds frequently require a key + acknowledgment (PA, IL, Iowa).
3. **Rate limits & token expiry are honored** (see §9) — never poll faster than a source's stated refresh; never cache expiring URLs.
4. **"Visible on a public map" ≠ "licensed to re-host."** Windy is display + mandatory backlink only (scenic supplement at most, not a primary traffic source); Massachusetts/Virginia imagery is partner-gated.
5. **Privacy is the bright line.** Open DOT cameras are deliberately low-res / no-plates and published *for reuse by the operator* — that consent is what makes them legitimate. **No face/plate recognition, ever**; takedown requests honored.
6. **Verify-before-ship.** Every UNVERIFIED item in §7 (several counts/licenses, exact image-URL patterns for TII/Sweden/Ontario, Germany's live coverage, Iowa's changing video format) is confirmed against one live response before that adapter is published.

**Dropped from v1 (terminal-only gimmicks):** ASCII map art, thermal/phosphor/noir colour palettes, Braille network graph, radar-sweep startup.
**Deferred to post-MVP (roadmap, not built first):** time-lapse + ghost mode (needs stored frames = storage cost), globe lasso/geofence multi-select, GIF export.

---

## 11. Resilience & error handling

- **Per-source cron isolation** — each source's ingestion job is independent and try/caught. One bad/changed feed marks *its* `Source.status = degraded` (surfaced on the About page) and keeps the last-known registry rows; it **cannot** break other sources, wipe the registry, or fail the build.
- **Camera image failure** → "camera unavailable" placeholder + `available=false`.
- **Empty/slow globe** → graceful skeleton + the static registry tiles always render even if the live layer is down.
- **Schema drift** → zod validation rejects malformed adapter output at the job boundary, loudly.

---

## 12. Testing strategy

- **Recorded-fixture adapter tests** — every adapter has a captured real response (JSON/XML/GeoJSON) checked into `tests/fixtures/`, and a test asserting it normalizes to a valid `Camera[]` (zod). This is how ~25 adapters stay honest and CI stays **deterministic** (no live calls in CI).
- **Proxy tests** — allowlist enforcement, SSRF rejection, mixed-content upgrade, cache headers, expiring-URL resolution.
- **Geo tests** — haversine / bbox / aggregation (ported from v1's pure-Python geo tests).
- **E2E (Playwright)** — globe loads → search flies to a city → camera opens (image via proxy) → compare → watch toggle.
- **Optional live "source-health" smoke** — a separate, non-CI script that hits live endpoints to catch upstream breakage (kept out of the deterministic test run).

---

## 13. Non-functional requirements / success criteria

- **Fast first paint** — globe interactive quickly via static registry tiles; smooth with ~10k points (aggregation + GPU point layer).
- **Honest** — every number on the site reflects real data; the About page shows real per-source counts + status; congestion heat only where live data exists.
- **Deployed live** on Vercel (custom domain optional); runs within free/cheap tiers.
- **Resume-legible** — Next 15 + TypeScript + PostGIS + Vercel Cron + the adapter pattern + a security-conscious image proxy are the headline talking points.
- **Extensible** — adding a country/source is one adapter file + one fixture test.

---

## 14. Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router), TypeScript, React |
| Globe / 3D | Globe.GL (three.js) |
| Video | hls.js (stream sources) |
| Validation | zod |
| DB / spatial | Postgres + PostGIS (Neon or Supabase free tier) |
| Cache | Vercel edge cache / KV |
| Scheduling | Vercel Cron (one staggered handler per source) |
| HTTP | native `fetch` (+ XML parser for NZ/Sweden/HK) |
| Hosting | Vercel |
| Testing | Vitest (unit) + Playwright (e2e) |
| Image diff | sharp / pixelmatch (server-side congestion) |

---

## 15. Phased roadmap (build order)

- **P0 — Skeleton.** Next 15 app + Globe.GL homepage + image proxy + camera detail, **TfL-only**. Prove the end-to-end pipeline and **deploy** it.
- **P1 — Keyless spread.** Add Finland, Hong Kong, NSW, QLD, NZ, Caltrans, Maryland, Canada (ON/AB/BC/QC) + PostGIS registry + Vercel Cron + bbox queries + globe aggregation. The globe lights up worldwide.
- **P2 — Keyed + families.** Key store; `ibi511` family (~20 states + ON/AB), Singapore LTA, WSDOT, Oregon, Sweden, Korea, Taiwan, `arcgisHub` US states → **~10k cameras**.
- **P3 — Intelligence.** Congestion sampler + globe heat, Situation Room, watch+alerts, compare, search.
- **P4 — Polish + deferred.** Sources/About page, region/SEO pages; optional time-lapse, director mode, lasso-select.

---

## 16. Repo layout

```
TrafficNerd-V2/
├── app/                      # Next.js App Router
│   ├── (globe)/              # homepage globe
│   ├── camera/[id]/          # camera detail
│   ├── situation/            # Situation Room
│   ├── sources/              # Sources / About (legal surface)
│   └── api/                  # cameras · camera/[id] · proxy · congestion · cron/[source]
├── lib/
│   ├── sources/              # one adapter per source/family + registry/types + zod schemas
│   ├── geo/                  # haversine · bbox · aggregation
│   ├── proxy/                # image proxy · cache · allowlist · token-bucket
│   └── congestion/           # image-diff sampler
├── components/               # Globe · CameraPanel · SituationRoom · AttributionBadge · ...
├── db/                       # PostGIS schema + migrations
├── tests/
│   ├── fixtures/             # one captured real response per source
│   ├── unit/                 # adapter + proxy + geo tests
│   └── e2e/                  # Playwright
├── docs/superpowers/specs/2026-06-26-trafficnerd-v2-design.md
├── .env.example              # every required key + where to register
└── PRD.md                    # this document (canonical)
```

---

## 17. Open questions / verify-before-ship checklist

- [ ] Confirm exact direct-JPEG URL patterns for **TII (Ireland)**, **Sweden Trafikverket**, **Ontario 511** (the documented `Url` may be an HTML viewer route, not a `.jpg`).
- [ ] Confirm **Germany Autobahn** live coverage (probes returned empty for some roads) and image-reuse license.
- [ ] Confirm **Iowa** ArcGIS video-format change (May-2026 advisory) and several camera counts marked UNVERIFIED in §7.
- [ ] Decide whether **Windy** is worth integrating at all (display+backlink-only; mostly scenic) — likely **no** for a traffic-focused product.
- [ ] Confirm CORS behaviour per source empirically (assumption: none → proxy everything).
- [ ] Custom domain? (optional, post-deploy.)

---

## 18. Rejected alternatives

| Option | Why rejected |
|---|---|
| **Cesium + Google 3D Tiles** globe | Heaviest; needs API keys + metered cost. Globe.GL gives the wow at zero per-tile cost. |
| **MapLibre globe projection** | Great for map UX but less "wow globe"; chosen look is the glowing GitHub-globe. |
| Separate ingestion service from day 1 (Approach B) | More ops + two deploys; kept as a documented fallback only. |
| Static-only, no DB (Approach C) | Weaker "live system" story; spatial search pushed to client. Borrowed only the static-tiles idea for fast first paint. |
| Client-side direct image fetch (no proxy) | Breaks on CORS / hotlink / mixed-content / expiring URLs; no caching or rate-limit control; SSRF-free but functionally unworkable. |
| Face / plate recognition, ML congestion | Privacy red line + unnecessary; image-diff congestion is enough and zero-legal-risk. |
| Insecam / unsecured-camera sources | Unethical and likely illegal — permanent hard exclusion. |
| User accounts/auth in MVP | Not needed; watch-lists persist client-side. |

---

*TrafficNerd v2 — built on open data, credited at the source, honest about its coverage.*
