// IP location: where MaxMind's free GeoLite2 data places the network behind an IP,
// read through RIPEstat's keyless `maxmind-geo-lite` data call. PURE: no fetch, no
// React, so the upstream-to-domain mapping is unit-tested against captured fixtures.
//
// FOUR RULES, and none of them is a style preference:
//
//   1. A location is an AREA, never a point. RIPEstat publishes no accuracy radius, so
//      a city answer is NAMED in the dossier and the map draws its COUNTRY. A circle
//      needs a published radius (`radiusKm`, from the GeoLite2 City file, a later step)
//      and never a guessed one.
//   2. A country-only answer is the country, never its centre point. MaxMind gives the
//      country's centre when it knows no city: for the US that is 37.751, -97.822, a
//      reservoir in Kansas. The default before it was a farm in Potwin, Kansas, whose
//      family was harassed for years because of it (reported in 2016). `countryOnly`
//      marks the answer, and nothing downstream may draw its point.
//   3. Country "?" or the point (0, 0) means "not known". RIPEstat answers 1.1.1.1 with
//      country "?" at 0, 0, which is the sea off West Africa. That is not a place, and
//      the location is dropped.
//   4. The result is the network's registered place, not where a person is. Every
//      surface that shows it carries NOT_A_PERSON.

import { detectKind, normalizeTarget } from "@/lib/recon/target";

/** The fixed line every surface of this tool shows. */
export const NOT_A_PERSON = "Approximate network location. It is not where a person is.";

/** The credit MaxMind asks for when GeoLite data is shown to people outside us. */
export const GEOLITE_CREDIT =
  "This product includes GeoLite Data created by MaxMind, available from https://www.maxmind.com.";

/** RIPEstat's `maxmind-geo-lite` answer, only the fields this tool reads. */
export interface RipeGeoResponse {
  status?: string;
  data?: {
    located_resources?: {
      resource?: string;
      locations?: {
        country?: string;
        city?: string;
        resources?: string[];
        latitude?: number;
        longitude?: number;
        covered_percentage?: number;
      }[];
    }[];
    result_time?: string;
  };
}

export interface GeoLocation {
  /** ISO 3166 alpha-2, upper case. */
  country: string;
  /** The city the source names, or "" when it names none. */
  city: string;
  /** The source's own point. NEVER drawn: see rules 1 and 2 above. */
  lat: number;
  lon: number;
  /** Share of the looked-up address space this answer covers, 0 to 100. */
  coveredPct: number;
  /** The prefixes the answer was made for. */
  prefixes: string[];
  /** True when the source knows only the country (rule 2). */
  countryOnly: boolean;
  /** The accuracy radius in km, or null when the source publishes none. */
  radiusKm: number | null;
}

export interface GeoResult {
  ok: boolean;
  /** What was typed, normalised. */
  target: string;
  /** The IP that was located: the target itself, or a domain's first A record. */
  ip?: string;
  /** Set when the target was a domain, so the dossier can say what it resolved to. */
  resolvedFrom?: string;
  locations: GeoLocation[];
  /** Where the answer came from. */
  source: "geolite2-ripestat";
  /** The date of the MaxMind data RIPEstat served (its `result_time`), when given. */
  dataDate?: string;
  reason?: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Rule 3: a location that is not a place. */
function unknownPlace(country: string, lat: number, lon: number): boolean {
  if (!/^[A-Z]{2}$/.test(country)) return true;
  return lat === 0 && lon === 0;
}

/** Pure: one RIPEstat answer to the locations it holds, and the date of its data. */
export function parseRipeGeo(json: RipeGeoResponse | null | undefined): { locations: GeoLocation[]; dataDate?: string } {
  const out: GeoLocation[] = [];
  const resources = Array.isArray(json?.data?.located_resources) ? json!.data!.located_resources! : [];
  for (const r of resources) {
    for (const l of Array.isArray(r?.locations) ? r.locations : []) {
      const country = typeof l?.country === "string" ? l.country.trim().toUpperCase() : "";
      const lat = num(l?.latitude);
      const lon = num(l?.longitude);
      if (lat === null || lon === null || unknownPlace(country, lat, lon)) continue;
      const city = typeof l?.city === "string" ? l.city.trim() : "";
      out.push({
        country,
        city,
        lat,
        lon,
        coveredPct: Math.max(0, Math.min(100, num(l?.covered_percentage) ?? 0)),
        prefixes: Array.isArray(l?.resources) ? l.resources.filter((p): p is string => typeof p === "string") : [],
        countryOnly: city === "",
        radiusKm: null,
      });
    }
  }
  out.sort((a, b) => b.coveredPct - a.coveredPct);
  const dataDate = typeof json?.data?.result_time === "string" ? json.data.result_time : undefined;
  return { locations: out, dataDate };
}

/** What the search box may hand to this tool: an IP or a domain, never a place name. */
export function networkTargetOf(query: string): { kind: "ip" | "domain"; value: string } | null {
  const kind = detectKind(query);
  if (kind !== "ip" && kind !== "domain") return null;
  return { kind, value: normalizeTarget(query, kind) };
}

/**
 * Cloud and CDN networks, by origin ASN. An address in one of these is a server in a
 * data centre, and its location is the data centre's, not the location of whoever owns
 * the site (ox.ac.uk answers from Amazon in Stockholm). A short, named list, not a
 * classifier: an ASN that is not on it says nothing either way.
 */
export const HOSTING_ASNS: Readonly<Record<number, string>> = {
  16509: "Amazon",
  14618: "Amazon",
  15169: "Google",
  396982: "Google Cloud",
  13335: "Cloudflare",
  54113: "Fastly",
  8075: "Microsoft",
  20940: "Akamai",
  16625: "Akamai",
  63949: "Akamai (Linode)",
  14061: "DigitalOcean",
  24940: "Hetzner",
  16276: "OVH",
  20473: "Vultr",
  31898: "Oracle Cloud",
};

/** The cloud or CDN name for an ASN, or null when it is not on the list. */
export function hostingNetwork(asn: number | null | undefined): string | null {
  if (typeof asn !== "number") return null;
  return HOSTING_ASNS[asn] ?? null;
}

/** One plain sentence: what the source says, in the dossier's own words. */
export function verdictOf(locations: readonly GeoLocation[], countryName: (iso2: string) => string): string {
  if (locations.length === 0) return "MaxMind has no location for this address.";
  if (locations.length > 1) {
    const names = [...new Set(locations.map((l) => countryName(l.country)))];
    return `MaxMind splits this network over ${locations.length} places, in ${names.join(", ")}.`;
  }
  const [l] = locations;
  if (l.countryOnly) return `MaxMind knows only the country: ${countryName(l.country)}.`;
  return `MaxMind places this network in ${l.city}, ${countryName(l.country)}.`;
}
