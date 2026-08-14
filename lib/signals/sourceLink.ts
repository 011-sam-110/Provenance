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
  earthquakes: { label: "USGS", url: "https://earthquake.usgs.gov/" },
  wildfires: { label: "NASA EONET", url: "https://eonet.gsfc.nasa.gov/" },
  volcanoes: { label: "NASA EONET", url: "https://eonet.gsfc.nasa.gov/" },
  severeStorms: { label: "NASA EONET", url: "https://eonet.gsfc.nasa.gov/" },
  floods: { label: "NASA EONET", url: "https://eonet.gsfc.nasa.gov/" },
  gdacs: { label: "GDACS", url: "https://www.gdacs.org/" },
  "tropical-cyclones": { label: "NOAA NHC", url: "https://www.nhc.noaa.gov/" },
  "fire-active": { label: "NASA FIRMS", url: "https://firms.modaps.eosdis.nasa.gov/" },
  "emsc-quakes": { label: "EMSC", url: "https://www.seismicportal.eu/" },
  aurora: { label: "NOAA SWPC", url: "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast" },
  "space-weather": { label: "NOAA SWPC", url: "https://www.swpc.noaa.gov/" },
  launches: { label: "The Space Devs", url: "https://thespacedevs.com/" },
  cables: { label: "TeleGeography", url: "https://www.submarinecablemap.com/" },
  "cable-landings": { label: "TeleGeography", url: "https://www.submarinecablemap.com/" },
  gpsJamming: { label: "gpsjam.org", url: "https://gpsjam.org/" },
  nuclear: { label: "OpenStreetMap", url: "https://www.openstreetmap.org/" },
  airports: { label: "OurAirports", url: "https://ourairports.com/" },
  ports: { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/List_of_busiest_ports_by_cargo_tonnage" },
  "internet-outages": { label: "IODA", url: "https://ioda.inetintel.cc.gatech.edu/" },
  // Each feature deep-links to the vendor's own incident via `link`; this is the
  // fallback when a vendor reports a degraded indicator with no open incident post.
  "cloud-status": { label: "Vendor status pages", url: "https://www.githubstatus.com/" },
  "faa-airports": { label: "FAA NAS status", url: "https://nasstatus.faa.gov/" },
  conflict: { label: "GDELT", url: "https://www.gdeltproject.org/" },
  protests: { label: "GDELT", url: "https://www.gdeltproject.org/" },
  acled: { label: "ACLED", url: "https://acleddata.com/" },
  weather: { label: "Open-Meteo", url: "https://open-meteo.com/", licence: CC_BY_4_0 },
  airquality: {
    label: "Open-Meteo",
    url: "https://open-meteo.com/en/docs/air-quality-api",
    licence: CC_BY_4_0,
  },
  "air-quality-stations": { label: "OpenAQ", url: "https://openaq.org/" },
  crime: { label: "data.police.uk", url: "https://data.police.uk/" },
  "cyber-c2": { label: "abuse.ch", url: "https://feodotracker.abuse.ch/" },
  "cyber-ransomware": { label: "Ransomware.live", url: "https://www.ransomware.live/" },
  displacement: { label: "UNHCR", url: "https://www.unhcr.org/refugee-statistics/" },
  "food-security": { label: "WFP HungerMap", url: "https://hungermap.wfp.org/" },
  reliefweb: { label: "ReliefWeb", url: "https://reliefweb.int/" },
  "grid-load": { label: "ENTSO-E", url: "https://transparency.entsoe.eu/" },
  "military-air": { label: "adsb.lol", url: "https://adsb.lol/" },
  ais: { label: "AISStream", url: "https://aisstream.io/" },
};

/**
 * Composite layers (derived, no single upstream): the full set of contributing
 * providers. Shown as multiple provider links + a "derived estimate" flag.
 */
export const SIGNAL_COMPOSITE_SOURCES: Record<string, Provider[]> = {
  instability: [
    { label: "ACLED", url: "https://acleddata.com/" },
    { label: "WFP HungerMap", url: "https://hungermap.wfp.org/" },
    { label: "UNHCR", url: "https://www.unhcr.org/refugee-statistics/" },
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
  const provider: Provider | undefined =
    composite?.[0] ??
    (isHttpUrl(input.sourceUrl)
      ? { label: hostLabel(input.sourceUrl), url: input.sourceUrl }
      : SIGNAL_PROVIDER_URLS[id]);

  // 1. Deep record permalink (preferred) — the exact upstream page for THIS event.
  // It carries the provider's licence too: the obligation attaches to the data, and
  // a record link can be the ONLY chip shown (step 2 suppresses a provider chip on
  // the same host), so hanging the licence off the provider entry alone would drop
  // it exactly when the deep link works.
  if (isHttpUrl(input.link)) {
    const label = provider?.label ?? hostLabel(input.link);
    push({ href: input.link, label, scope: "record", licence: provider?.licence });
  }

  // 2. Provider dataset / home page(s). A composite shows all contributors; a plain
  //    layer shows its one provider — but not when a record link already points to
  //    the same host (that would just duplicate it).
  const recordHosts = new Set(out.map((s) => hostOf(s.href)));
  if (composite) {
    for (const p of composite)
      push({ href: p.url, label: p.label, scope: "provider", licence: p.licence });
  } else if (provider && !recordHosts.has(hostOf(provider.url))) {
    push({ href: provider.url, label: provider.label, scope: "provider", licence: provider.licence });
  }

  return out;
}
