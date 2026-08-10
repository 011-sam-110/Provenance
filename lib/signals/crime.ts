import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { applyCap } from "@/lib/signals/coverage";

// UK street-level crime — keyless data.police.uk. The richest open, geocoded crime
// feed available without a key (England, Wales & Northern Ireland; Police Scotland
// is not part of this dataset). It is a MONTHLY aggregate, ~2 months in arrears, so
// features carry NO `ts` (a monthly count is not a real-time event — the time-window
// filter never hides it; `month` rides in the dossier instead). We pull a 1-mile
// radius around several major city centres for the latest published month, merge,
// dedupe and cap. Confirmed live 2026-06-27 (latest month then: 2026-04).

const STREET_ENDPOINT = "https://data.police.uk/api/crimes-street/all-crime";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const POLICE_UK_ATTRIBUTION =
  "Crime data © data.police.uk, Open Government Licence v3.0";

/** City centres sampled (England & Wales — the keyless dataset's coverage). */
const CRIME_CITIES: { name: string; lat: number; lng: number }[] = [
  { name: "London", lat: 51.5074, lng: -0.1278 },
  { name: "Manchester", lat: 53.4808, lng: -2.2426 },
  { name: "Birmingham", lat: 52.4862, lng: -1.8904 },
  { name: "Leeds", lat: 53.8008, lng: -1.5491 },
  { name: "Liverpool", lat: 53.4084, lng: -2.9916 },
  { name: "Bristol", lat: 51.4545, lng: -2.5879 },
];

/** Total markers kept after merge (each city can return 1–5k points/month). */
export const CRIME_CAP = 1500;

/** Crime category slug → (label, colour). Grouped: violence red, property orange,
 *  disorder/other amber, fallback slate. */
const CATEGORY: Record<string, { label: string; color: string }> = {
  "violent-crime": { label: "Violence & sexual offences", color: "#dc2626" },
  robbery: { label: "Robbery", color: "#dc2626" },
  "possession-of-weapons": { label: "Possession of weapons", color: "#dc2626" },
  burglary: { label: "Burglary", color: "#ea580c" },
  "vehicle-crime": { label: "Vehicle crime", color: "#ea580c" },
  "bicycle-theft": { label: "Bicycle theft", color: "#f97316" },
  "theft-from-the-person": { label: "Theft from the person", color: "#f97316" },
  shoplifting: { label: "Shoplifting", color: "#f97316" },
  "other-theft": { label: "Other theft", color: "#f97316" },
  "criminal-damage-arson": { label: "Criminal damage & arson", color: "#f59e0b" },
  drugs: { label: "Drugs", color: "#a16207" },
  "public-order": { label: "Public order", color: "#ca8a04" },
  "anti-social-behaviour": { label: "Anti-social behaviour", color: "#eab308" },
  "other-crime": { label: "Other crime", color: "#64748b" },
};

export function crimeCategory(slug: string): { label: string; color: string } {
  return CATEGORY[slug] ?? { label: slug.replace(/-/g, " "), color: "#64748b" };
}

interface CrimeRow {
  category?: string;
  location?: { latitude?: string; longitude?: string; street?: { name?: string } | null } | null;
  outcome_status?: { category?: string } | null;
  id?: number | string;
  month?: string;
}

/**
 * Pure: data.police.uk rows → SignalFeature[]. Dedupes by crime id and skips rows
 * with a null/garbled location (the API returns location:null for some records).
 */
export function normalizeCrime(rows: CrimeRow[]): SignalFeature[] {
  const out: SignalFeature[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const loc = r.location;
    if (!loc) continue;
    const lat = loc.latitude == null ? Number.NaN : Number(loc.latitude);
    const lon = loc.longitude == null ? Number.NaN : Number(loc.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const id = (r.id ?? "").toString().trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const { label, color } = crimeCategory(r.category ?? "other-crime");
    const street = loc.street?.name?.trim() || "Unknown street";
    out.push({
      id: `ukpolice:${id}`,
      lat,
      lon,
      title: `${label} — ${street}`,
      signalId: "crime",
      color,
      props: {
        category: label,
        street,
        outcome: r.outcome_status?.category?.trim() || "Under investigation",
        month: r.month ?? "—",
      },
    });
  }
  return out;
}

/**
 * Pure: trim the merged multi-city set to the render cap, recording what that hid.
 *
 * The merged list is in CITY-QUERY order (London first), not ranked — a monthly
 * crime count has no severity scalar to rank by — so the cap is a positional cut,
 * and the recorded rule says so. Six city centres routinely merge to well over
 * 1,500 records, which is exactly why "1,500 crimes" must not read as a total.
 */
export function capCrime(features: SignalFeature[], cap = CRIME_CAP): SignalFeature[] {
  return applyCap(features, cap, {
    noun: "crime records",
    rule: "the first found in city order (London, Manchester, Birmingham, Leeds, Liverpool, Bristol) — not a ranking",
  });
}

export const UK_CRIME_SOURCE: SignalSource = {
  id: "crime",
  label: "UK street crime",
  group: "Civic safety",
  color: "#9333ea",
  refreshMs: 6 * 60 * 60 * 1000, // monthly data; a 6-hour cache is more than enough
  attribution: POLICE_UK_ATTRIBUTION,
  async fetch() {
    try {
      // Each city in parallel; omitting `date` makes the API use the latest month.
      const perCity = await Promise.all(
        CRIME_CITIES.map(async (c) => {
          try {
            const res = await fetch(`${STREET_ENDPOINT}?lat=${c.lat}&lng=${c.lng}`, {
              headers: { "User-Agent": UA, Accept: "application/json" },
              signal: AbortSignal.timeout(20_000),
            });
            if (!res.ok) return [] as CrimeRow[];
            return (await res.json()) as CrimeRow[];
          } catch {
            return [] as CrimeRow[];
          }
        }),
      );
      const merged = perCity.flat();
      return capCrime(normalizeCrime(merged));
    } catch {
      return [];
    }
  },
};
