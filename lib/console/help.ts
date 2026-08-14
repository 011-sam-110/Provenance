// Widget help — the text behind the "?" affordance on every widget frame.
//
// TWO LAYERS, ONE CONTRACT.
//   1. A widget declares a short `help` ({ what, source }) in its registry entry —
//      the opening line and source credit of the ? popover.
//   2. Underneath it sits the TRUST CARD: what a row actually is, how the number
//      was arrived at, confidence, coverage, and what it CANNOT tell you.
//
// lib/signals/explain.ts guarantees that card for every registered SIGNAL layer,
// and the widget type id `signal:<layer>` resolves straight through to it. The
// BESPOKE widgets — cameras, aviation, satellites, headlines, markets, live news,
// anomaly, events, locate and the six recon tools — are not signal layers, so
// until this file existed they fell through to `resolveWidgetHelp`'s generic
// one-liner. On the default board that meant the card reached 2 of 8 widgets:
// worse than the competitor's 8-of-20 that the whole feature is positioned
// against. WIDGET_EXPLAINERS below closes the hole, and
// tests/unit/widget-explainers.test.ts fails the build when a REGISTERED widget
// type has no entry — the same zero-fallback guarantee the signal layers get.
//
// HOUSE RULES (lib/signals/explain.ts's, unchanged — read them there):
//   • `limitations` is never empty, and it says the unflattering thing.
//   • `confidence` describes the DATA's provenance, not our uptime.
//   • No marketing voice. A limitation written to sound reassuring is worse than
//     no limitation at all.
//   • Describe what the widget ACTUALLY does. Several entries below exist because
//     writing them turned up help text that was wrong (a military flag that never
//     fires, a routing source that shut down, a geolocation vendor we do not use).

import { explainerFor, type Confidence, type LayerExplainer } from "@/lib/signals/explain";
import { ROLLUP_WIDGET_PREFIX, SOURCE_WIDGET_PREFIX } from "@/lib/console/sourceWidgets";
import { rollupExplainer, sourceExplainer } from "@/lib/console/sourceCards";

/** What a widget declares for its ? popover. */
export interface WidgetHelp {
  /** One or two plain sentences: what the panel shows and why it's useful. */
  what: string;
  /** Where the data comes from (upstream provider / feed), when there's one to name. */
  source?: string;
}

/**
 * A bespoke widget's trust card. Identical in shape to a signal layer's
 * explainer — deliberately, so the same card component renders both — except that
 * `id` is a WIDGET TYPE id (`cameras`, `recon:bgp`) rather than a signal id.
 */
export type WidgetExplainer = LayerExplainer;

/** The resolved, render-ready help for a frame's ? popover. */
export interface ResolvedHelp {
  title: string;
  what: string;
  source?: string;
  /** The trust card, when one exists for this widget type. */
  explainer?: LayerExplainer;
}

// ---------------------------------------------------------------------------
// The bespoke widgets' trust cards. One entry per registered non-signal widget
// type id. Grouped to match the widget catalogue's categories.
// ---------------------------------------------------------------------------

const WIDGET_EXPLAINERS: WidgetExplainer[] = [
  // --- Synthesis ------------------------------------------------------------
  {
    id: "anomaly",
    whatItShows:
      "A row is one item from a monitored layer that scored above the \"routine\" floor — the earthquake, disaster alert, cyclone, flood, wildfire, geomagnetic reading, country score or internet outage unusual enough to be worth looking at first.",
    method:
      "Each item's severity is its own layer's declared metric rescaled to 0–1 (or, where a layer declares none, its raw magnitude over a 0–10 proxy). Anything below 0.45 is dropped as routine; the rest are ranked by 70% severity plus 30% a recency weight that steps down from 1 (under an hour old) to 0.3 (older than three days). Undated items are weighted 0.4.",
    confidence: "derived",
    coverage:
      "Eight curated layers — USGS earthquakes, GDACS alerts, NHC cyclones, floods, wildfires, space weather, the instability index and internet outages — trimmed to the current map scope.",
    limitations: [
      "\"Abnormal\" here means high on its own layer's scale, which is not the same as important. A strong earthquake in open ocean outranks a moderate one under a city, because nothing in this ranking knows about people.",
      "It ranks across layers that share no unit. A Kp index, an earthquake magnitude and a 0–100 country score are all squashed onto 0–1 and compared with each other; 0.8 from two different layers is not the same thing.",
      "It scans eight layers out of the 37 on this map. Conflict, protests, ransomware, cyber command-and-control, displacement and everything else are never considered, so a quiet panel is not a quiet map.",
      "A layer whose upstream is dark simply contributes nothing to the ranking. The freshness chip reports how many of the eight answered; the list itself gives no sign that one is missing.",
      "Items carrying neither a metric nor a magnitude score zero and can never surface, however serious they are.",
    ],
  },

  // --- Events ---------------------------------------------------------------
  {
    id: "events",
    whatItShows:
      "A row is one normalised event — a USGS earthquake, a GDACS multi-hazard alert or an active NOAA cyclone — with a severity tier S0–S4, a place name, and an escalation to the top of the list when its modelled impact radius reaches an asset you have added.",
    method:
      "Three signal feeds are normalised into one event model, filtered to the current map scope and time window, then sorted by tier, recency or distance. The tier is an interim shared ramp over each source's 0–10 normalised magnitude (≥8 = S4, ≥6 = S3, ≥4 = S2, ≥2 = S1), and the raw value behind it is kept on the event rather than hidden.",
    confidence: "official",
    coverage:
      "Three sources only: earthquakes (USGS), disasters (GDACS) and tropical cyclones (NOAA NHC). Wildfires, floods, volcanoes and conflict are on the map as their own layers but are NOT in this feed.",
    limitations: [
      "The severity tier is one crude 0–10 ramp applied across three very different hazard types. It is explicitly an interim scale, not an exposure- or impact-weighted one, so an S3 quake and an S3 cyclone are not comparable statements about harm.",
      "\"Direct Operational Threat\" is a proximity flag, not a damage assessment. The impact radius is a coarse lookup from event type, tier and magnitude — a 700 km circle for a magnitude-7 quake — and it models nothing about terrain, building stock or the actual hazard footprint.",
      "Only three feeds reach this panel, so an empty list means those three are quiet. Wildfires, floods and volcanoes are elsewhere on the map and their absence here is not calm.",
      "Location precision varies per source and is carried on the event: GDACS and cyclone rows are admin- or centroid-level, so a pin can sit on a country's middle rather than the event.",
      "The place name is best-effort — the source's own field where it has one, otherwise the tail of the headline after a dash. It is frequently a region, sometimes a fragment of a sentence.",
      "Filters hide rows silently apart from the \"N hidden\" counter, and the alert rules run over the unfiltered set, so what you are notified about and what you can see are not the same list.",
    ],
  },

  // --- Cameras --------------------------------------------------------------
  {
    id: "cameras",
    whatItShows:
      "A tile is one public road or street camera the map has loaded, showing its current picture. The count in the header is every camera in the merged registry, not the six tiles on screen.",
    method:
      "Eleven public transport-agency feeds are merged server-side into one registry; each tile then pulls that camera's own snapshot or stream through our proxy, and a feed the operator marks unavailable raises an offline alert.",
    confidence: "official",
    coverage:
      "Seven countries: the UK (TfL, Traffic Scotland), the US (Caltrans, SCDOT, Castle Rock, TripCheck), Canada (DriveBC), Finland, Estonia, Iceland and New Zealand. Nowhere else has a single camera.",
    limitations: [
      "This is a road-camera network, not global CCTV. Most of the world has no coverage at all, so an empty region means we have no feed there — never that nothing is happening there.",
      "A tile is a still refreshed on the operator's cadence, or a stream that runs seconds behind. It is not a guaranteed view of the instant you are looking at it.",
      "\"Went offline\" is the operator's own availability flag, copied through unmodified. A camera flagged available can still serve a frozen, black or hours-old frame.",
      "The grid shows the first six cameras in registry order — not the six nearest you, not the six most interesting, and not a sample of anything.",
      "The cameras map layer owns the fetch, and switching it off stops the refresh WITHOUT clearing what was already loaded — so the grid keeps showing the last tiles it had, with no indication they have stopped updating.",
    ],
  },

  // --- Aviation / space -----------------------------------------------------
  {
    id: "aviation",
    whatItShows:
      "A row is an aircraft that was broadcasting an ADS-B position in the last snapshot, with its callsign, a guessed type and its reported altitude in kilometres.",
    method:
      "Read from OpenSky's single global /states/all snapshot, which aircraft transponders feed. Altitude and squawk are the aircraft's own reported values, and squawks 7500/7600/7700 raise a critical alert. The TYPE is not broadcast and not looked up — it is our own guess from altitude, speed and on-ground state, which is why the dossier renders it as \"· est.\".",
    confidence: "measured",
    coverage:
      "Worldwide by construction — one global snapshot rather than a swept grid — but only where volunteer receivers hear the aircraft. Good over Europe and North America, thin over oceans, deserts and much of Africa and Asia.",
    limitations: [
      "Gaps are receiver coverage, not empty sky. An aircraft with no receiver in range does not exist in this feed, and there is no way to tell that case from an aircraft that is not flying.",
      "Aircraft that do not want to be seen switch the transponder off or broadcast a false identity, so the flights most worth watching are the ones most likely to be missing.",
      "There is NO military flag on this panel. The alert rule supports one, but OpenSky carries no military classification, so that alert can never fire here — military traffic appears only on the separate Military aircraft signal layer.",
      "OpenSky's anonymous tier is credit-capped, so one snapshot is shared across the whole deployment and refreshed roughly every four minutes. Rows are minutes old by design, and on a bad day the panel serves the last good snapshot rather than nothing.",
      "The list is capped at 200 rows out of everything airborne, sorted by altitude or callsign. It is a slice, never a census.",
      "No origin, destination, registration or operator is carried here; the aircraft dossier fetches those separately when you open one.",
    ],
  },
  {
    id: "satellites",
    whatItShows:
      "A row is a satellite from a CelesTrak catalogue group with its type and current altitude — a position your browser is calculating right now, not one anybody has just measured.",
    method:
      "The orbital element set is downloaded once, then every position is propagated locally with SGP4 (satellite.js) on a ten-second tick, so the list moves without polling a server.",
    confidence: "modelled",
    coverage:
      "Whatever CelesTrak publishes for the selected group. The default \"visual\" group is a few hundred bright, easily-seen objects — not the tens of thousands of tracked items in the full catalogue.",
    limitations: [
      "These positions are PROPAGATED, not observed. SGP4 drifts from reality as the element set ages, and nothing in this panel tells you how old the elements it is propagating from actually are.",
      "The freshness chip reads \"local\" because there is no repeat fetch to go stale. If the element download happened hours ago the panel still looks perfectly live.",
      "It shows where an object is, never what it is doing: no manoeuvres, no payload status, no imaging passes, no re-entry or conjunction warnings.",
      "Classified and unpublished objects are absent by design, and the default group deliberately shows only a bright subset of what is up there.",
      "Altitude comes from the propagated position, not from an operator-published orbit, and inherits every bit of the propagation's error.",
    ],
  },

  // --- Markets / news -------------------------------------------------------
  {
    id: "markets",
    whatItShows:
      "A row is a quoted level for a crypto asset, a commodity future, an FX pair, a US equity or ETF, or a rate/volatility index, with its change and a sparkline built from the samples this browser has recorded.",
    method:
      "Five keyless sections, one upstream each: CoinGecko for crypto, Yahoo Finance's daily chart endpoint for commodities, equities and rate indices, and Frankfurter/ECB for FX. A Finnhub key swaps equities to real-time quotes and a FRED key swaps the macro rows to the official series; neither is required.",
    confidence: "reported",
    coverage:
      "Eight crypto assets, six commodity futures, eight FX pairs against the dollar, six US equities/ETFs and four US rate or volatility series. That list is the whole of it — no order books, no depth, no other exchanges.",
    limitations: [
      "This is not a trading feed. Free endpoints sit behind a server cache of at least a minute and the panel polls every two minutes, so a price here can be several minutes behind the market. Do not trade on it.",
      "ECB reference rates are published once per working day. An FX row is a daily fixing that carries no change figure at all, and it does not move at weekends.",
      "The change column is not one period. Crypto is a 24-hour move; the Yahoo-sourced rows are the session's move against the previous close. They sit in the same list and read as though they were comparable.",
      "Sparklines are drawn from values THIS browser has seen while the panel was open, not from real price history. A fresh session shows a short line that means very little.",
      "Yahoo's chart endpoint is undocumented and unsupported for this use. When it declines a symbol that row silently disappears rather than showing an error.",
    ],
  },
  {
    id: "headlines",
    whatItShows:
      "A line is a news STORY — one or more headlines about the same event, collapsed together — showing the lead headline, the outlet that ran it, how many other sources ran it, and how long ago.",
    method:
      "Six world RSS feeds plus one public Telegram channel are fetched server-side on a five-minute cache, merged and de-duplicated, then clustered in the browser: titles are reduced to significant tokens and greedily grouped by Jaccard overlap, requiring at least two shared tokens.",
    confidence: "reported",
    coverage:
      "BBC, Al Jazeera, NPR, The Guardian, DW and France 24 world feeds, plus the Liveuamap Telegram channel. Six English-language outlets and one OSINT monitor — that is the entire world view in this panel.",
    limitations: [
      "Six English-language newsrooms is a narrow window on the world. What they do not cover does not exist here, and their editorial priorities silently become this panel's priorities.",
      "A \"+3\" is a count of outlets that ran the story, not corroboration. Four papers syndicating the same wire copy look identical to four independent confirmations.",
      "Clustering is text similarity over headline words. It splits one event across two rows when the wording differs, and occasionally fuses two unrelated stories that share vocabulary.",
      "Liveuamap is an OSINT aggregator scraped from its public web preview, not an edited newsroom. It appears in the same list with nothing to distinguish it beyond its source name.",
      "The age is the publisher's own timestamp; feeds that omit a parseable date land at zero and show no age at all, which is not the same as being new.",
      "Headlines are not geocoded here, so nothing in this panel is placed on the map.",
    ],
  },
  {
    id: "news",
    whatItShows:
      "A live 24/7 news television channel embedded in the panel — the broadcaster's own stream, playing as a backdrop while you work the map.",
    method:
      "Nothing is derived or measured. The panel embeds the broadcaster's public YouTube live stream, or plays a .m3u8 URL you paste yourself. Buffering, ads and availability are the platform's.",
    confidence: "official",
    coverage:
      "Twelve preset channels — Al Jazeera English, DW, France 24, Sky News, Euronews, CNA, TRT World, NHK World, ABC (AU), Bloomberg TV, NASA TV and ISS Live — plus any YouTube or HLS URL you add.",
    limitations: [
      "This is a television channel, not a data layer. Nothing in it is plotted, searchable, alertable or checked by us in any way.",
      "The header word \"live stream\" names the medium, not a freshness we can observe. We cannot tell whether the player is actually playing, so a dead or geo-blocked stream still says it.",
      "Channels are registered by YouTube CHANNEL id and resolved to whatever that channel is streaming now, so a broadcaster restarting a stream no longer breaks the preset. Without a YOUTUBE_API_KEY that resolution is switched off and the panel falls back to a pinned video id, which does rot — 8 of the 12 pinned ids were already dead when audited on 2026-08-14.",
      "Several of these are state-funded broadcasters. The panel presents every channel identically and makes no editorial distinction between them.",
      "Playback depends on YouTube, so regional blocking, ads and platform outages all apply and none of them surface as an error here.",
    ],
  },

  {
    id: "livecams-brazil",
    whatItShows:
      "Live cameras across Brazil — beaches, city centres, the BR-101, ports and airports — streamed 24/7 on YouTube by local broadcasters, embedded in the panel.",
    method:
      "Nothing is derived or measured. We register a broadcaster's CHANNEL id and ask YouTube which video that channel is streaming right now, then embed it. Stream titles are the broadcaster's own words, shown verbatim.",
    // NOT "official". The news panel earns that word because broadcasters are
    // institutions; these are private individuals and small local media. What was
    // actually checked is the channel list, by hand — which is "reported".
    confidence: "reported",
    coverage:
      "32 independent Brazilian channels, carrying 100 live streams between them when the list was captured on 2026-08-14. Both numbers move: broadcasters start and stop cameras without notice.",
    limitations: [
      "These are private individuals and local media, NOT government camera feeds. Nobody guarantees a camera stays up, points the same way, or is where its title says.",
      "No coordinates. YouTube attaches none, so nothing here is plotted on the map, and the panel deliberately asserts no city or category of its own — deriving those from titles was tried and got a Cubatão train labelled Natal.",
      "The header word \"live stream\" names the medium, not a freshness we can observe. We cannot tell whether the player is actually playing.",
      "The channel list was assembled by searching YouTube in Portuguese and reading the results. It is a sample of what exists, not an inventory of it.",
      "Without a YOUTUBE_API_KEY the panel falls back to a last-known stream that may have ended, and says so rather than presenting it as current.",
      "Playback depends on YouTube, so ads, regional blocking and platform outages all apply and none surface as an error here.",
    ],
  },

  // --- Tools: photo geolocation ---------------------------------------------
  {
    id: "locate",
    whatItShows:
      "A ranked list of guesses at where a photo you supplied was taken — each a coordinate, a reverse-geocoded place name and the model's own confidence — with the globe flown to the top one.",
    method:
      "The image is sent to a geolocation model: a GeoCLIP geo-embedding sidecar when one is configured, otherwise a vision LLM through the configured gateway. Each returned coordinate is reverse-geocoded to a place name with Photon.",
    confidence: "modelled",
    coverage:
      "Anywhere the model is willing to guess, which is everywhere and nowhere in particular. It does far better on distinctive, heavily-photographed places than on generic interiors, forest, farmland or open water.",
    limitations: [
      "Every result is an ESTIMATE from visual cues. Nothing here reads EXIF, and there is no GPS anywhere in the pipeline for it to check itself against.",
      "The percentage is the model's own self-assessment. Models are routinely confident and wrong, so 90% here is not a 90% chance of being right — it is not calibrated against anything.",
      "Candidates deliberately land at a regional zoom. Reading a pin as a street address is a misuse of it, and the model gives no error radius.",
      "Both backends are configuration-gated. With no GeoCLIP sidecar and no gateway key the widget returns a plain \"not configured\" message and no estimates at all — an empty result is not a failed match.",
      "It will happily estimate a location from someone's personal photo. Nothing in the tool checks whether you should be doing that, and a confidence score is not consent.",
    ],
  },

  // --- Tools: passive OSINT recon -------------------------------------------
  // All six share one target and are strictly passive: every lookup goes to a
  // third party, never to the target itself. Say so, and say what that costs.
  {
    id: "recon:dns",
    whatItShows:
      "The DNS records a domain currently resolves to — A, AAAA, MX, NS, TXT, CNAME, SOA and CAA — each with its value and TTL.",
    method:
      "One DNS-over-HTTPS query per record type to Cloudflare's public resolver, proxied through our own route and cached for five minutes. Nothing is ever sent to the target.",
    confidence: "official",
    coverage: "Domain names only. IP and ASN targets are refused with a message rather than guessed at.",
    limitations: [
      "This is what Cloudflare's resolver sees, from where it sits. Geo-steered and split-horizon DNS mean a resolver in another country can legitimately return completely different answers.",
      "Answers can be up to their TTL out of date at the resolver, and our own five-minute cache sits on top of that. A record changed minutes ago may not appear.",
      "Records point at infrastructure, not at people. A CDN or hosting-provider address tells you who fronts the domain, not who runs it.",
      "Only those eight record types are queried. SRV, PTR, DNSKEY and the rest are absent because we never asked, not because they do not exist.",
    ],
  },
  {
    id: "recon:whois",
    whatItShows:
      "Registration facts for a domain or IP — registrar or regional registry, holder, country, key dates, nameservers and status codes — as published by whichever authority is responsible for it.",
    method:
      "A single RDAP query bootstrapped through rdap.org, which redirects to the authoritative registry or RIR. RDAP is the structured successor to WHOIS; every field shown is theirs, unmodified.",
    confidence: "official",
    coverage:
      "Domains and IPs whose registry serves RDAP — near-complete for IPs and gTLDs. A number of country-code TLDs still publish no RDAP at all.",
    limitations: [
      "Registrant identity is usually redacted. Between GDPR and privacy services, the holder shown is very often the privacy proxy rather than whoever is actually behind the domain.",
      "The dates describe the REGISTRATION, not the site. A domain registered in 2003 may have changed hands five times and now run something completely unrelated.",
      "A ccTLD with no RDAP returns an empty result that looks exactly like a domain that does not exist. The tool cannot tell you which it was.",
      "Fields vary registry to registry, so a blank row usually means that registry does not publish that field, not that the field is empty.",
    ],
  },
  {
    id: "recon:certs",
    whatItShows:
      "Subdomains of a target enumerated from every TLS certificate ever logged for it, with a count and the most recent certificates' issuers and validity dates.",
    method:
      "One query to crt.sh, which indexes the public Certificate Transparency logs that certificate authorities are required to publish. Names are read from certificate subjects and SANs; nothing is probed.",
    confidence: "official",
    coverage:
      "Domains with publicly-trusted certificates. Names covered only by a private or internal CA never enter Certificate Transparency and are invisible here.",
    limitations: [
      "A name in a certificate is not a live host. Most of these subdomains no longer resolve, and the list includes hosts decommissioned years ago with no way to tell them apart.",
      "It finds what was CERTIFICATED. Internal hosts, anything behind a wildcard certificate and anything using a private CA are all missing from the result.",
      "A single wildcard entry hides every name underneath it behind one row.",
      "crt.sh is one volunteer-run service and is frequently slow or briefly down. A failed lookup shows as no results, which looks identical to a domain with no certificates.",
      "The list is capped at 40 displayed subdomains, so a large estate is truncated without the full set being available here.",
    ],
  },
  {
    id: "recon:bgp",
    whatItShows:
      "The autonomous system behind an IP or ASN — holder name, allocating registry, whether it is currently announced in the global routing table, the reverse DNS, and the prefixes involved.",
    method:
      "RIPEstat, the RIPE NCC's public data API: network-info, prefix-overview and reverse DNS for an IP; as-overview and announced-prefixes for an ASN. At most 50 prefixes are carried through and the panel lists the first 8 of them, with the true upstream total printed beside it.",
    confidence: "measured",
    coverage:
      "IPv4 and IPv6 addresses and AS numbers globally, as seen by RIPE's route collectors. A domain target is resolved to an address first.",
    limitations: [
      "Routing is a view from RIPE's collectors, not the truth everywhere. What your own network sees can differ, and hijacks and route leaks are precisely the cases where those views disagree.",
      "The ASN holder name comes from registry records, which are frequently years out of date and often name a parent company rather than whoever operates the network.",
      "Announcing an address tells you who routes it, not who owns the service on it. A hosting provider's ASN says nothing about its tenant.",
      "Large networks announce thousands of prefixes — Cloudflare's AS13335 announces over 5,000 — and the panel lists eight. The real total is printed beside them, but what you can read is a sample, in no meaningful order.",
      "There is no history here, only the current view — no route changes, no past announcements, no withdrawal timeline.",
    ],
  },
  {
    id: "recon:ports",
    whatItShows:
      "Ports, service fingerprints, hostnames and CVE identifiers that Shodan has already recorded for a host — a lookup of somebody else's scan results, not a scan.",
    method:
      "One request to Shodan's keyless InternetDB, which returns its pre-indexed record for an IP. A domain target is first resolved to its first A record via Cloudflare DNS-over-HTTPS.",
    confidence: "reported",
    coverage:
      "IPv4 addresses Shodan has scanned and indexed. Hosts it has never reached — anything firewalled against it, and most of IPv6 — have no record at all.",
    limitations: [
      "This is HISTORICAL. An InternetDB record comes from Shodan's last scan, which can be days or weeks old: a port listed here may be long closed, and one open right now may be missing.",
      "No record is not the same as no exposure. A host Shodan has never indexed returns an empty result identical to a properly hardened one.",
      "The CVEs are inferred from banner and product fingerprints, not confirmed. They mean a version known to be vulnerable, not a vulnerability that is present or reachable.",
      "A domain is reduced to its FIRST A record only, so services on any other address behind that name are silently never examined.",
      "Nothing here touches the target from us. That is the point of a passive tool, but it also means you are trusting a third party's stale view rather than checking.",
    ],
  },
  {
    id: "recon:threat",
    whatItShows:
      "A reputation read on a host: the tags and known-vulnerability list Shodan's InternetDB carries for it, alongside the additional threat-intel providers and which of them are locked for want of a key.",
    method:
      "The keyless baseline is InternetDB's tags and vulns for the resolved IP. Seven keyed providers — VirusTotal, AbuseIPDB, GreyNoise, AlienVault OTX, Pulsedive, IPQualityScore and abuse.ch — are shown as slots and queried only when their key is set; a locked slot is never filled in with a guess. Which slots appear depends on the target: an IP shows all seven, a domain shows four (IPQualityScore and the IP-only providers drop out).",
    confidence: "reported",
    coverage:
      "IPv4 addresses Shodan has indexed. A domain is resolved to its first A record before lookup, and only the providers whose keys are configured contribute anything.",
    limitations: [
      "\"No InternetDB tags or CVEs\" is not a clean bill of health. It means one free dataset has nothing on this address, which is the ordinary answer for most of the internet.",
      "Reputation attaches to an ADDRESS, not to an operator. Shared hosting, CDNs and cloud ranges mean an address can be flagged because of a neighbour, and can be reassigned to somebody innocent tomorrow.",
      "Without keys this is a single source. The locked slots are shown as locked precisely so an empty panel is not mistaken for several providers agreeing that a host is clean.",
      "The tags are Shodan's categorisation of its own scan data, not adjudicated threat intelligence. There is no confidence score and no date on any of them.",
      "Nothing here is evidence of compromise or of intent. It is a starting point for a person to check, and treating a tag as a verdict is how false positives get someone blocked.",
    ],
  },
];

const BY_TYPE_ID = new Map(WIDGET_EXPLAINERS.map((e) => [e.id, e]));

/** Every bespoke widget explainer, in declaration order. */
export function allWidgetExplainers(): WidgetExplainer[] {
  return WIDGET_EXPLAINERS;
}

/**
 * The trust card for a WIDGET TYPE id.
 *
 * Three families, each guaranteed complete by its own test:
 *   • `signal:<layer>`  → the signal registry's explainer (tests/unit/signals-explain)
 *   • `rollup:<group>` / `source:<id>` → GENERATED from the source catalog, because
 *     the widgets themselves are (lib/console/sourceCards.ts)
 *   • everything else   → the hand-written WIDGET_EXPLAINERS above
 *
 * Returns `undefined` rather than a "not documented yet" placeholder — that
 * placeholder is exactly how a trust card ends up blank on most of a board, and
 * the coverage test makes the undefined case unreachable for anything registered.
 */
export function widgetExplainerFor(typeId: string | undefined): LayerExplainer | undefined {
  if (!typeId) return undefined;
  if (typeId.startsWith("signal:")) return explainerFor(typeId.slice("signal:".length));
  if (typeId.startsWith(ROLLUP_WIDGET_PREFIX)) {
    return rollupExplainer(typeId.slice(ROLLUP_WIDGET_PREFIX.length), typeId);
  }
  if (typeId.startsWith(SOURCE_WIDGET_PREFIX)) {
    return sourceExplainer(typeId.slice(SOURCE_WIDGET_PREFIX.length), typeId);
  }
  return BY_TYPE_ID.get(typeId);
}

/** Widget type ids whose trust card is generated rather than hand-written. */
export function isGeneratedCardId(typeId: string): boolean {
  return (
    typeId.startsWith("signal:") ||
    typeId.startsWith(ROLLUP_WIDGET_PREFIX) ||
    typeId.startsWith(SOURCE_WIDGET_PREFIX)
  );
}

/** Registered widget type ids with no trust card. The build fails when non-empty. */
export function undocumentedWidgetTypeIds(registeredTypeIds: string[]): string[] {
  return registeredTypeIds.filter((id) => !widgetExplainerFor(id));
}

/** Bespoke explainers whose widget is no longer registered (a renamed/removed widget). */
export function orphanedWidgetExplainerIds(registeredTypeIds: string[]): string[] {
  const registered = new Set(registeredTypeIds);
  return WIDGET_EXPLAINERS.map((e) => e.id).filter((id) => !registered.has(id));
}

/**
 * Resolve a widget's help for display: the declared one-line `what` + `source`,
 * plus the trust card for its type.
 *
 * The `what` falls back to the explainer's `whatItShows` before it falls back to a
 * generic line keyed off the title, so a widget that declares no help still says
 * something real. Nothing is invented about a source we don't know.
 */
export function resolveWidgetHelp(type: { id?: string; title: string; help?: WidgetHelp }): ResolvedHelp {
  const help = type.help;
  const explainer = widgetExplainerFor(type.id);
  return {
    title: type.title,
    what: help?.what ?? explainer?.whatItShows ?? `A live monitor panel: ${type.title}.`,
    source: help?.source,
    explainer,
  };
}

/** Short, honest "what this group is" line per signal group (drives generic signal help). */
const GROUP_BLURB: Record<string, string> = {
  Synthesis: "A cross-layer read of the most abnormal signals right now, ranked so you can triage at a glance.",
  "Natural hazards": "Live natural-hazard events worldwide — the kind that move fast and matter on the ground.",
  "Space weather": "Space-weather conditions — solar activity, geomagnetic storms and where aurora is likely.",
  Space: "Objects and activity overhead — satellites and launches you can track in near-real time.",
  Infrastructure: "The physical and network backbone — subsea cables, power grids and connectivity outages.",
  Intel: "Open-source intelligence distilled from the global news stream, mapped to where it's happening.",
  Conflict: "Armed-conflict and security incidents, plotted as they're reported.",
  Environment: "Environmental conditions and stress — air quality, wildfires and climate signals.",
  "Civic safety": "Reported civic-safety and policing incidents (coverage is region-specific).",
  "Cyber threat": "Cyber-threat activity — command-and-control, ransomware and network abuse in the open record.",
  "Human cost": "The human cost of crises — displacement and humanitarian need.",
  Military: "Military movements and activity visible in open, keyless feeds.",
  Maritime: "Maritime traffic and where the world's shipping chokepoints are congesting.",
  Weather: "Current weather and severe-weather watches.",
};

/**
 * Build help for a generic signal widget from its source. The `what` describes the
 * layer's group in plain language; the `source` names the mandatory upstream credit
 * the source already carries — so the ? note is accurate without a hand-written entry
 * per layer. The trust card underneath comes from lib/signals/explain.ts.
 */
export function signalHelp(source: { label: string; group: string; attribution: string }): WidgetHelp {
  const blurb = GROUP_BLURB[source.group] ?? `A live global signal layer (${source.group}).`;
  return { what: `${source.label} — ${blurb}`, source: source.attribution };
}

/** Re-exported so a consumer of the ? popover needs only this module. */
export type { Confidence, LayerExplainer };
