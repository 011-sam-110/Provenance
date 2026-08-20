/**
 * Where candidates come from: national and municipal open-data catalogues.
 *
 * WHY CATALOGUES RATHER THAN A CRAWLER. This project's admission policy says a source
 * must be operator-primary and must carry a licence we can name. A catalogue entry
 * gives both by construction — it is published BY the agency that runs the cameras,
 * and CKAN, Socrata and ArcGIS Hub all carry a licence field. A web crawl gives
 * neither, and would mostly find aggregators, because aggregators are what rank for
 * "traffic cameras".
 *
 * The three shapes below cover most of the public sector: CKAN is the default for
 * European national portals, Socrata for US cities and states, ArcGIS Hub for anything
 * that already runs Esri (which is most departments of transportation).
 *
 * Every function here is a PURE parser over a response body. Fetching lives in
 * `scripts/discover-cameras.mjs` so the parsers can be tested against saved fixtures
 * without a network.
 */

/** One dataset a catalogue returned, normalised across the three catalogue shapes. */
export interface CatalogueHit {
  /** Which portal answered, as its base URL. */
  portal: string;
  /** The catalogue's own id for the dataset, for re-querying. */
  datasetId: string;
  title: string;
  description?: string;
  /** The publishing organisation as the catalogue records it. */
  publisher?: string;
  /** The licence string the catalogue records. Copied verbatim, never normalised. */
  license?: string;
  licenseUrl?: string;
  /** The human page for the dataset, shown to the reviewer. */
  landingPage?: string;
  resources: CatalogueResource[];
}

export interface CatalogueResource {
  url: string;
  /** The catalogue's own format label ("JSON", "GeoJSON", "Esri REST"). */
  format?: string;
  name?: string;
}

/**
 * CKAN portals worth asking. Each is a government open-data catalogue with a public,
 * keyless `package_search` API.
 *
 * This list is a starting point and is expected to grow — adding one is a line here
 * and nothing else, which is the reason the probe is catalogue-shaped rather than
 * portal-shaped. Portals that require a key, or that answer only over a rate-limited
 * private endpoint, are deliberately absent: discovery that needs a credential is a
 * credential this repo would have to hold.
 */
export const CKAN_PORTALS: Array<{ base: string; country: string; name: string }> = [
  { base: "https://data.gov.uk", country: "GB", name: "data.gov.uk" },
  { base: "https://catalog.data.gov", country: "US", name: "data.gov (US)" },
  { base: "https://open.canada.ca/data", country: "CA", name: "Open Government Canada" },
  { base: "https://data.gov.ie", country: "IE", name: "data.gov.ie" },
  { base: "https://www.opendata.nhs.scot", country: "GB", name: "Scottish open data" },
  { base: "https://opendata.swiss", country: "CH", name: "opendata.swiss" },
  { base: "https://www.data.gouv.fr", country: "FR", name: "data.gouv.fr" },
  { base: "https://data.overheid.nl/data", country: "NL", name: "data.overheid.nl" },
  { base: "https://www.dati.gov.it/opendata", country: "IT", name: "dati.gov.it" },
  { base: "https://data.gov.au/data", country: "AU", name: "data.gov.au" },
  { base: "https://catalogue.data.govt.nz", country: "NZ", name: "data.govt.nz" },
  { base: "https://www.avoindata.fi/data", country: "FI", name: "avoindata.fi" },
  { base: "https://data.norge.no", country: "NO", name: "data.norge.no" },
];

/** The queries each portal is asked. Kept small: every term costs a round trip. */
export const CAMERA_QUERIES = [
  "traffic camera",
  "cctv camera",
  "webcam",
  "road camera",
] as const;

/** Build a keyless CKAN search URL. `rows` is CKAN's page size. */
export function ckanSearchUrl(base: string, query: string, rows = 25): string {
  const b = base.replace(/\/+$/, "");
  return b + "/api/3/action/package_search?q=" + encodeURIComponent(query) + "&rows=" + rows;
}

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

/** An email is not an organisation name, but its domain is a better clue than nothing. */
function stripMailto(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const addr = v.replace(/^mailto:/i, "").trim();
  const domain = addr.split("@")[1];
  return domain || addr || undefined;
}

/** Parse a CKAN `package_search` body into hits. Returns [] for any unexpected shape. */
export function parseCkanSearch(body: unknown, portal: string): CatalogueHit[] {
  const result = (body as { result?: { results?: unknown } } | null)?.result?.results;
  if (!Array.isArray(result)) return [];
  const out: CatalogueHit[] = [];
  for (const raw of result) {
    if (raw == null || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    const id = asString(d.name) ?? asString(d.id);
    const title = asString(d.title) ?? id;
    if (!id || !title) continue;
    const org = d.organization as Record<string, unknown> | undefined;
    const resources: CatalogueResource[] = [];
    if (Array.isArray(d.resources)) {
      for (const r of d.resources) {
        if (r == null || typeof r !== "object") continue;
        const rr = r as Record<string, unknown>;
        const url = asString(rr.url);
        if (!url) continue;
        resources.push({ url, format: asString(rr.format), name: asString(rr.name) });
      }
    }
    out.push({
      portal,
      datasetId: id,
      title,
      description: asString(d.notes),
      publisher: asString(org?.title as string) ?? asString(org?.name as string),
      license: asString(d.license_title) ?? asString(d.license_id),
      licenseUrl: asString(d.license_url),
      landingPage: portal.replace(/\/+$/, "") + "/dataset/" + id,
      resources,
    });
  }
  return out;
}

/** Socrata's cross-domain discovery API, one keyless endpoint covering every domain. */
export function socrataSearchUrl(query: string, limit = 25): string {
  return "https://api.us.socrata.com/api/catalog/v1?q=" + encodeURIComponent(query) + "&limit=" + limit;
}

export function parseSocrataCatalog(body: unknown): CatalogueHit[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: CatalogueHit[] = [];
  for (const raw of results) {
    if (raw == null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const res = r.resource as Record<string, unknown> | undefined;
    const meta = r.metadata as Record<string, unknown> | undefined;
    const id = asString(res?.id as string);
    const title = asString(res?.name as string);
    const domain = asString(meta?.domain as string);
    if (!id || !title || !domain) continue;
    // The Socrata JSON export URL is derivable from the dataset id, which is why this
    // parser can produce a machine-readable resource where the catalogue lists none.
    out.push({
      portal: "https://" + domain,
      datasetId: id,
      title,
      description: asString(res?.description as string),
      publisher: asString((r.classification as Record<string, unknown>)?.domain_category as string) ?? domain,
      license: asString(res?.license as string),
      landingPage: asString(r.link as string) ?? "https://" + domain + "/d/" + id,
      resources: [{ url: "https://" + domain + "/resource/" + id + ".json?$limit=1000", format: "JSON" }],
    });
  }
  return out;
}

/** ArcGIS Hub's dataset search. Keyless, JSON:API shaped. */
export function arcgisHubSearchUrl(query: string, size = 25): string {
  return "https://hub.arcgis.com/api/v3/datasets?q=" + encodeURIComponent(query) + "&page%5Bsize%5D=" + size;
}

export function parseArcgisHub(body: unknown): CatalogueHit[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: CatalogueHit[] = [];
  for (const raw of data) {
    if (raw == null || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    const attrs = d.attributes as Record<string, unknown> | undefined;
    const id = asString(d.id as string);
    const title = asString(attrs?.name as string);
    if (!id || !title) continue;
    // `url` is the FeatureServer layer itself. Appending a query makes it a fetchable
    // JSON endpoint; `f=json` + `outFields=*` + `outSR=4326` is the only ArcGIS
    // incantation this pipeline needs, and outSR=4326 is what keeps the coordinate in
    // degrees instead of Web Mercator metres.
    const server = asString(attrs?.url as string);
    const resources: CatalogueResource[] = server
      ? [
          {
            url: server.replace(/\/+$/, "") + "/query?where=1%3D1&outFields=*&outSR=4326&f=json&resultRecordCount=1000",
            format: "Esri REST",
            name: "FeatureServer query",
          },
        ]
      : [];
    out.push({
      portal: "https://hub.arcgis.com",
      datasetId: id,
      title,
      description: asString(attrs?.description as string),
      // `source` is the publishing organisation's own name ("Caltrans", "Lexington-
      // Fayette Urban County Government"); `orgContactEmail` is a mailbox and was what
      // this read first, which put "mailto:spatial@nzta.govt.nz" in the name field of
      // every ArcGIS candidate the first live run produced.
      publisher:
        asString(attrs?.source as string) ??
        asString(attrs?.owner as string) ??
        stripMailto(asString(attrs?.orgContactEmail as string)),
      license: asString(attrs?.license as string),
      landingPage: "https://hub.arcgis.com/datasets/" + id,
      resources,
    });
  }
  return out;
}

/**
 * Catalogue licence values that are not a licence.
 *
 * ArcGIS Hub answers `"none"` or `"custom"` in its licence field for most datasets, and
 * both are the ABSENCE of a stated licence rather than the name of one. Copying them
 * into a camera's `license` string would put the word "none" on a public attribution
 * line, which reads as a claim that the operator granted nothing — and "custom" reads
 * as a licence that exists and cannot be found. Neither is what the publisher said.
 */
const NON_LICENCES = new Set(["none", "custom", "other", "unknown", "n/a", "na", "-", "notspecified", "not specified"]);

/**
 * The licence string that ships, and the raw value kept beside it.
 *
 * Where the catalogue states nothing usable this returns the same honest form the
 * `cetsp` adapter uses — naming the publisher and saying plainly that no licence is
 * stated — with the catalogue's own word in brackets so a reviewer can check what was
 * actually there. A licence nobody granted is worse than an absent one.
 */
export function licenceStatement(raw: string | undefined, publisher: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed && !NON_LICENCES.has(trimmed.toLowerCase())) return trimmed;
  const who = publisher?.trim() || "the publisher";
  return trimmed
    ? who + " states no licence for this data (catalogue records: " + trimmed + ")"
    : who + " states no licence for this data";
}

/** Formats this pipeline can actually parse. Anything else is a document, not a feed. */
const MACHINE_FORMATS = /^(?:json|geojson|esri\s*rest|arcgis|api|rest|wfs|ogcapi)/i;

export function machineReadable(res: CatalogueResource): boolean {
  if (MACHINE_FORMATS.test(res.format ?? "")) return true;
  return /\.(?:json|geojson)(?:$|\?)|\/FeatureServer|\/MapServer|\/api\//i.test(res.url);
}

/**
 * Does this dataset sound like live cameras?
 *
 * Catalogues answer "traffic camera" with traffic COUNTS, camera ENFORCEMENT notices
 * and speed-camera locations, none of which carry a picture. The negative list is
 * doing more work than the positive one, and it is a coarse filter by design: a false
 * negative loses a candidate, a false positive costs a reviewer three seconds.
 */
export function looksLikeCameraDataset(hit: CatalogueHit): boolean {
  const hay = (hit.title + " " + (hit.description ?? "")).toLowerCase();
  const positive = /\b(?:cctv|camera|webcam|live\s*image|traffic\s*cam)\b/.test(hay);
  if (!positive) return false;
  const negative =
    /\b(?:speed\s*camera|safety\s*camera|enforcement|bus\s*lane|red\s*light|penalty|fine|prosecut|counts?|counters?|counting|surveys?|anpr|number\s*plate)\b/.test(
      hay,
    );
  return !negative;
}

/** Rank hits so a reviewer meets the most promising first. Pure, deterministic. */
export function scoreHit(hit: CatalogueHit): number {
  const hay = (hit.title + " " + (hit.description ?? "")).toLowerCase();
  let score = 0;
  if (/\blive\b/.test(hay)) score += 2;
  if (/\bcctv\b/.test(hay)) score += 2;
  if (/\bimage|snapshot|feed|stream\b/.test(hay)) score += 2;
  if (/\bcamera locations?\b/.test(hay)) score += 1;
  score += hit.resources.filter(machineReadable).length;
  if (hit.license) score += 1;
  return score;
}
