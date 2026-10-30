// Pure source-link resolution for the signal dossier (components/SignalDetail.tsx).
//
// Product rule (owner directive): EVERY signal dossier must show its data source as
// a CLICKABLE link to the real upstream. Two honest cases:
//   • the feature carries a deep `link` to the exact record (an earthquake event
//     page, a submarine-cable page, a news article) → we prefer it (scope "record");
//   • it does not — most country-aggregated layers publish no per-row permalink —
//     so we fall back to the provider's dataset / home page (scope "provider").
//
// Provider pages are held in ONE keyed table below (by registry signal id). A unit
// test asserts EVERY registered signal id resolves to ≥1 https link, so no dossier
// can ship sourceless. Composite layers (the Country Instability Index) are DERIVED
// from several upstreams and carry no single canonical source, so they declare the
// full contributing set — all shown as links and flagged as a derived estimate.
//
// No DOM, no fetch — fully unit-testable.

export type SourceScope = "record" | "provider";

/**
 * A licence that obliges us to LINK it, not merely to name the provider.
 *
 * CC BY 4.0 asks for three things: appropriate credit, a link to the licence, and an
 * indication of whether changes were made. Naming the provider satisfies the first
 * only. Open-Meteo publishes its API data under CC BY 4.0 ("API data are offered
 * under Attribution 4.0 International"), so a bare "Open-Meteo" chip left us
 * nearly-conformant rather than conformant.
 *
 * Only declare this where the upstream's own terms ask for a licence link. Most of
 * the table does not: USGS and NOAA are US-government public domain, GDELT asks for
 * a citation plus a link to gdeltproject.org (which the provider chip already is),
 * and OGL v3 sources are covered by the site-wide OGL notice on the landing page.
 * Adding it everywhere would be noise, and noise is how a real obligation gets
 * missed.
 */
export interface SourceLicence {
  /** Short licence name shown on the chip, e.g. "CC BY 4.0". */
  label: string;
  /** Canonical licence deed URL — this is the link the licence actually requires. */
  url: string;
}

export const CC_BY_4_0: SourceLicence = {
  label: "CC BY 4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
};

export interface ResolvedSource {
  /** Absolute https URL to open in a new tab. */
  href: string;
  /** Short provider name, e.g. "USGS", "UNHCR", "adsb.lol". */
  label: string;
  /** "record" = deep permalink to THIS event; "provider" = the dataset / home page. */
  scope: SourceScope;
  /** Present only when the upstream's terms require the licence itself to be linked. */
  licence?: SourceLicence;
}

interface Provider {
  label: string;
  url: string;
  licence?: SourceLicence;
}

/**
 * Provider dataset / home page per registry signal id. All keyless, honest and
 * stable. The label is the short provider name shown on the dossier's Source row.
 */
export const SIGNAL_PROVIDER_URLS: Record<string, Provider> = {
  // Several catalogues feed this layer; a quake's record chip names the one shown
  // (`recordLabel`, from props.catalogue), so this entry is the fallback only.
  earthquakes: { label: "USGS", url: "https://earthquake.usgs.gov/" },
  // The four hazard layers merge several primaries since 2026-10-16. Most features carry
  // their own record `link`; these are the fallbacks, named for the main input.
  wildfires: {
    label: "NIFC WFIGS",
    url: "https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-incident-locations-current",
  },
  volcanoes: { label: "USGS Volcano Hazards Program", url: "https://www.usgs.gov/programs/VHP" },
  severeStorms: { label: "NOAA SPC storm reports", url: "https://www.spc.noaa.gov/climo/reports/today.html" },
  floods: { label: "GDACS", url: "https://www.gdacs.org/" },
  gdacs: { label: "GDACS", url: "https://www.gdacs.org/" },
  // JTWC, JMA and CMA storms name their own agency on the record chip (`recordLabel`).
  "tropical-cyclones": { label: "NOAA NHC", url: "https://www.nhc.noaa.gov/" },
  "cyclone-forecasts": { label: "NOAA NHC", url: "https://www.nhc.noaa.gov/gtwo.php" },
  "tsunami-alerts": { label: "NOAA Tsunami Warning Centers", url: "https://www.tsunami.gov/" },
  // USGS and JMA alerts name their own agency on the record chip (`recordLabel`).
  "volcano-alerts": { label: "USGS Volcano Hazards Program", url: "https://www.usgs.gov/programs/VHP" },
  "cems-activations": { label: "Copernicus EMS", url: "https://mapping.emergency.copernicus.eu/activations/" },
  // NWS and ECCC alerts name their own service on the record chip (`recordLabel`).
  "weather-warnings": { label: "NOAA NWS", url: "https://www.weather.gov/" },
  "fire-active": { label: "NASA FIRMS", url: "https://firms.modaps.eosdis.nasa.gov/" },
  aurora: { label: "NOAA SWPC", url: "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast" },
  "space-weather": { label: "NOAA SWPC", url: "https://www.swpc.noaa.gov/" },
  "geomag-stations": { label: "FMI R-index", url: "https://space.fmi.fi/MIRACLE/RWC/r-index/en/" },
  launches: { label: "The Space Devs", url: "https://thespacedevs.com/" },
  cables: { label: "TeleGeography", url: "https://www.submarinecablemap.com/" },
  "cable-landings": { label: "TeleGeography", url: "https://www.submarinecablemap.com/" },
  ukraineAlerts: { label: "alerts.in.ua", url: "https://alerts.in.ua/" },
  // War sources. Each row credits the upstream; losses-ru and war-news also carry a
  // link per feature (the record, the post).
  "war-zones": { label: "DeepState", url: "https://deepstatemap.live/en" },
  "frontline-changes": { label: "DeepState", url: "https://deepstatemap.live/en" },
  "losses-ru": { label: "WarSpotting", url: "https://ukr.warspotting.net/" },
  "losses-ua": { label: "LostArmour", url: "https://lostarmour.info/" },
  gpsJamming: { label: "gpsjam.org", url: "https://gpsjam.org/" },
  gpsJammingLive: { label: "adsb.lol", url: "https://adsb.lol/" },
  "cable-routes": { label: "NOAA MarineCadastre / EMODnet", url: "https://marinecadastre.gov/" },
  "gnss-notams": { label: "EUROCONTROL AUGUR", url: "https://augur.eurocontrol.int/" },
  nuclear: { label: "OpenStreetMap", url: "https://www.openstreetmap.org/" },
  airports: { label: "OurAirports", url: "https://ourairports.com/" },
  ports: { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/List_of_busiest_ports_by_cargo_tonnage" },
  "internet-outages": { label: "IODA", url: "https://ioda.inetintel.cc.gatech.edu/" },
  // Each feature deep-links to the vendor's own incident via `link`; this is the
  // fallback when a vendor reports a degraded indicator with no open incident post.
  "cloud-status": { label: "Vendor status pages", url: "https://www.githubstatus.com/" },
  // Each alert and advice feature deep-links its own record; a UCDP event has no
  // per-event page, so the release's download page is the source.
  // Each record links its own department's dataset; this is the fallback.
  // Each filing or notice links its own record; these are the fallbacks.
  "cyber-disclosures": { label: "SEC EDGAR", url: "https://efts.sec.gov/LATEST/search-index?q=%22Item%201.05%22&forms=8-K" },
  "cyber-attackers": { label: "SANS ISC DShield", url: "https://isc.sans.edu/block.html" },
  "crime-us": { label: "City police open data", url: "https://data.sfgov.org/d/wg3w-h783" },
  conflict: { label: "UCDP", url: "https://ucdp.uu.se/downloads/", licence: CC_BY_4_0 },
  protests: { label: "U.S. Embassy alerts", url: "https://www.usembassy.gov/" },
  acled: { label: "ACLED", url: "https://acleddata.com/" },
  airquality: {
    label: "Open-Meteo",
    url: "https://open-meteo.com/en/docs/air-quality-api",
    licence: CC_BY_4_0,
  },
  "air-quality-stations": { label: "OpenAQ", url: "https://openaq.org/" },
  crime: { label: "data.police.uk", url: "https://data.police.uk/" },
  "cyber-ransomware": { label: "Ransomware.live", url: "https://www.ransomware.live/" },
  // UNHCR's dataset terms (clause 4) ask for a link to the terms themselves.
  displacement: {
    label: "UNHCR",
    url: "https://www.unhcr.org/refugee-statistics/",
    licence: {
      label: "CC BY 4.0 (UNHCR terms)",
      url: "https://www.unhcr.org/what-we-do/data-and-publications/data-and-statistics/terms-use-datasets",
    },
  },
  "food-security": { label: "WFP HungerMap", url: "https://hungermap.wfp.org/" },
  reliefweb: { label: "ReliefWeb", url: "https://reliefweb.int/" },
  "grid-load": { label: "ENTSO-E and grid operators", url: "https://transparency.entsoe.eu/" },
  "military-air": { label: "adsb.lol", url: "https://adsb.lol/" },
  // OGN data are ODbL, which asks that the licence be named alongside the data.
  gliders: {
    label: "Open Glider Network",
    url: "https://www.glidernet.org/",
    licence: { label: "ODbL", url: "https://opendatacommons.org/licenses/odbl/1-0/" },
  },
  ais: { label: "AISStream, Digitraffic, BarentsWatch", url: "https://aisstream.io/" },
  // Each road notice links its own operator (feature.link, named by props.agency), so
  // these show only for a row without one. The credits each operator's terms ask for
  // are in the layers' attribution (lib/signals/roads.ts).
  "road-works": { label: "TfL", url: "https://tfl.gov.uk/traffic/status/" },
  "road-incidents": { label: "TfL", url: "https://tfl.gov.uk/traffic/status/" },
  "road-closures": { label: "TfL", url: "https://tfl.gov.uk/traffic/status/" },
  "road-speed": { label: "DATA.GOV.HK (Transport Department)", url: "https://data.gov.hk/en/" },
};

/**
 * Record links on a host that belongs to a DIFFERENT named provider than the layer's.
 *
 * A layer that merges two networks (military-air: adsb.lol and adsb.fi) deep-links
 * each row to the map of the network whose position it draws. Without this table an
 * adsb.fi row would wear the layer's provider name, "adsb.lol", on a link to
 * adsb.fi, and its provider chip would point at adsb.lol's home page. adsb.fi's terms
 * require a citation AND a link to its home page, so for these hosts both the record
 * chip and the provider chip come from here. Exact hostnames only.
 */
export const RECORD_HOST_PROVIDERS: Record<string, Provider> = {
  "globe.adsb.fi": { label: "adsb.fi", url: "https://adsb.fi/" },
};

/**
 * Composite layers (derived, no single upstream): the full set of contributing
 * providers. Shown as multiple provider links + a "derived estimate" flag.
 */
export const SIGNAL_COMPOSITE_SOURCES: Record<string, Provider[]> = {
  // No geocoder and no upstream of its own: the coordinates are committed tables in this
  // repo and the headlines are the publishers'. The dataset the centroids were generated
  // from is credited because "a table in our repo" is not a source a reader can check.
  // Curated from the reporting each site cites (lib/signals/forces-near-nato.data.ts).
  "forces-near-nato": [
    { label: "RFE/RL Radio Svoboda", url: "https://www.svoboda.org/" },
    { label: "UNITED24 Media", url: "https://united24media.com/" },
    { label: "Kyiv Post", url: "https://www.kyivpost.com/" },
    { label: "UA.NEWS", url: "https://ua.news/en" },
  ],
  // Many outlets and channels; each post links its own.
  "war-news": [
    { label: "Kyiv Post", url: "https://www.kyivpost.com/" },
    { label: "Telegram public channels", url: "https://t.me/" },
  ],
  "headline-places": [
    { label: "Country centroids (eesur/country-codes-lat-long)", url: "https://github.com/eesur/country-codes-lat-long" },
  ],
  instability: [
    { label: "UCDP", url: "https://ucdp.uu.se/downloads/" },
    { label: "INFORM (EC JRC)", url: "https://drmkc.jrc.ec.europa.eu/inform-index" },
    { label: "FEWS NET", url: "https://fews.net/" },
    { label: "World Bank WGI", url: "https://www.worldbank.org/en/publication/worldwide-governance-indicators" },
    { label: "UNHCR", url: "https://www.unhcr.org/refugee-statistics/" },
    { label: "GDELT", url: "https://www.gdeltproject.org/" },
    { label: "IODA", url: "https://ioda.inetintel.cc.gatech.edu/" },
  ],
};

/** True for an absolute http(s) URL. */
export function isHttpUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\//i.test(v.trim());
}

/** Bare hostname (no protocol / www.) as a last-resort provider label. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Signal id → composite? (derived from several upstreams). */
export function isCompositeSignal(signalId: string | undefined): boolean {
  return Boolean(signalId && SIGNAL_COMPOSITE_SOURCES[signalId]);
}

/**
 * Resolve the clickable source link(s) for a signal dossier. Deep record permalink
 * first (when the feature carries one), then the provider dataset/home page — or,
 * for a composite layer, every contributing provider. Never fabricates a link; the
 * provider table + composite table are the only non-record hrefs it can emit.
 */
export function resolveSignalSources(input: {
  signalId?: string;
  /** Deep permalink to this exact record, if the adapter set feature.link. */
  link?: unknown;
  /** Optional provider URL threaded from the adapter's SignalSource.sourceUrl. */
  sourceUrl?: unknown;
  /**
   * Who published THIS record, when a layer reads several publishers (the earthquakes
   * layer: USGS, EMSC, GeoNet, INGV…). Names the record chip, and replaces the layer's
   * one provider chip, which would name a publisher this record did not come from.
   */
  recordLabel?: unknown;
}): ResolvedSource[] {
  const id = (input.signalId ?? "").trim();
  const out: ResolvedSource[] = [];
  const seen = new Set<string>();

  const push = (s: ResolvedSource) => {
    if (seen.has(s.href)) return;
    seen.add(s.href);
    out.push(s);
  };

  const composite = SIGNAL_COMPOSITE_SOURCES[id];
  const recordProvider = isHttpUrl(input.link) ? RECORD_HOST_PROVIDERS[hostOf(input.link).toLowerCase()] : undefined;
  const provider: Provider | undefined =
    composite?.[0] ??
    recordProvider ??
    (isHttpUrl(input.sourceUrl)
      ? { label: hostLabel(input.sourceUrl), url: input.sourceUrl }
      : SIGNAL_PROVIDER_URLS[id]);

  // 1. Deep record permalink (preferred) — the exact upstream page for THIS event.
  // It carries the provider's licence too: the obligation attaches to the data, and
  // a record link can be the ONLY chip shown (step 2 suppresses a provider chip on
  // the same host), so hanging the licence off the provider entry alone would drop
  // it exactly when the deep link works.
  const recordLabel = typeof input.recordLabel === "string" && input.recordLabel.trim() ? input.recordLabel.trim() : null;
  if (isHttpUrl(input.link)) {
    if (recordLabel) push({ href: input.link, label: recordLabel, scope: "record" });
    else push({ href: input.link, label: provider?.label ?? hostLabel(input.link), scope: "record", licence: provider?.licence });
  }

  // 2. Provider dataset / home page(s). A composite shows all contributors; a plain
  //    layer shows its one provider — but not when a record link already points to
  //    the same host (that would just duplicate it).
  const recordHosts = new Set(out.map((s) => hostOf(s.href)));
  if (composite) {
    for (const p of composite)
      push({ href: p.url, label: p.label, scope: "provider", licence: p.licence });
  } else if (provider && !recordHosts.has(hostOf(provider.url)) && !(recordLabel && out.length > 0)) {
    push({ href: provider.url, label: provider.label, scope: "provider", licence: provider.licence });
  }

  return out;
}
