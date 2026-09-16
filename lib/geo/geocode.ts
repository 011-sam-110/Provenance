// Keyless place-search normalization.
//
// The /api/geocode route proxies Photon (Komoot's OSM geocoder). Photon is the
// keyless option that is *legal to wire to a search box*: Nominatim's usage policy
// explicitly forbids type-ahead/autocomplete, while Photon is built for it (see
// docs/superpowers/research/outdoor-sources.md §6 — "the only keyless +
// autocomplete-legal option"). Photon returns a GeoJSON FeatureCollection with
// [lon,lat] coordinates and OSM properties; this pure normalizer flattens each
// feature to the thin { name, lat, lon, type, bbox? } shape the UI flies to.

export interface GeocodeResult {
  /** Human, disambiguating label, e.g. "Ben Nevis, Highland, United Kingdom". */
  name: string;
  lat: number;
  lon: number;
  /** OSM class/value hint, e.g. "peak", "city", "distillery". */
  type?: string;
  /**
   * ISO 3166-1 alpha-2, upper-cased, as Photon reports it.
   *
   * Surfaced separately from `name` because the label is LOCALISED - Photon writes
   * "Normandie", "Deutschland", "Espana" - so matching a country by searching the
   * label only works if the caller happens to hold the same spelling Photon chose.
   * A code has one spelling. lib/news/places.ts checks a pinned place against this.
   */
  countryCode?: string;
  /** [west, south, east, north] — present only when the feature carries an extent. */
  bbox?: [number, number, number, number];
}

interface PhotonProps {
  name?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  county?: string;
  city?: string;
  district?: string;
  postcode?: string;
  /** Photon order: [minLon, maxLat, maxLon, minLat] = [west, north, east, south]. */
  extent?: number[];
}

interface PhotonFeature {
  geometry?: { type?: string; coordinates?: number[] };
  properties?: PhotonProps;
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

/** Build a disambiguating label: the place name plus its city/state/country context. */
function buildLabel(p: PhotonProps): string {
  const primary = p.name || p.city || p.county || p.state || p.country || "";
  const context: string[] = [];
  for (const part of [p.city, p.state, p.country]) {
    if (part && part !== primary && !context.includes(part)) context.push(part);
  }
  return [primary, ...context].filter(Boolean).join(", ");
}

/** Photon extent [W,N,E,S] → GeoJSON-style bbox [west, south, east, north]. */
function toBbox(extent: number[] | undefined): GeocodeResult["bbox"] {
  if (!Array.isArray(extent) || extent.length !== 4) return undefined;
  const [w, n, e, s] = extent;
  if (![w, n, e, s].every((v) => Number.isFinite(v))) return undefined;
  return [w, s, e, n];
}

/**
 * Flatten a Photon FeatureCollection to normalized results. Pure + defensive:
 * tolerates any non-conforming input (returns []), drops features with
 * missing/out-of-range coordinates, and caps the output at `limit`.
 */
export function normalizePhoton(json: unknown, limit = 8): GeocodeResult[] {
  const features = (json as PhotonResponse | null | undefined)?.features;
  if (!Array.isArray(features)) return [];

  const out: GeocodeResult[] = [];
  for (const f of features) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lon, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const p = f.properties ?? {};
    const name = buildLabel(p);
    if (!name) continue;

    out.push({
      name,
      lat,
      lon,
      type: p.osm_value || p.type || p.osm_key || undefined,
      countryCode: p.countrycode ? p.countrycode.trim().toUpperCase() : undefined,
      bbox: toBbox(p.extent),
    });
    if (out.length >= limit) break;
  }
  return out;
}
