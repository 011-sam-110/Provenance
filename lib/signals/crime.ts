import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { applyCap } from "@/lib/signals/coverage";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

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

/**
 * City centres sampled (England, Wales and Northern Ireland — the keyless dataset's
 * coverage; Police Scotland does not publish to it, so Glasgow and Edinburgh answer 0).
 *
 * MANCHESTER IS NOT HERE ON PURPOSE. Measured 2026-10-16: a city-centre query returns
 * 2 rows for August and 6 for July, because Greater Manchester Police's street-level
 * data is effectively missing from data.police.uk. Every city below answered 1,200 to
 * 4,200 rows for the same month.
 */
export const CRIME_CITIES: { name: string; lat: number; lng: number }[] = [
  { name: "London", lat: 51.5074, lng: -0.1278 },
  { name: "Birmingham", lat: 52.4862, lng: -1.8904 },
  { name: "Leeds", lat: 53.8008, lng: -1.5491 },
  { name: "Liverpool", lat: 53.4084, lng: -2.9916 },
  { name: "Bristol", lat: 51.4545, lng: -2.5879 },
  { name: "Sheffield", lat: 53.3811, lng: -1.4701 },
  { name: "Newcastle", lat: 54.9783, lng: -1.6178 },
  { name: "Nottingham", lat: 52.9548, lng: -1.1581 },
  { name: "Leicester", lat: 52.6369, lng: -1.1398 },
  { name: "Cardiff", lat: 51.4816, lng: -3.1791 },
  { name: "Belfast", lat: 54.5973, lng: -5.9301 },
];

/** Parallel city queries, attempts per city, and the pause before a retry (see fetch). */
const CRIME_CONCURRENCY = 2;
const CRIME_ATTEMPTS = 3;
const CRIME_RETRY_MS = 1_500;

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
 * Pure: the outcome line for one record.
 *
 * A null `outcome_status` is NOT "under investigation". Anti-social behaviour has no
 * outcomes in this dataset at all, so every ASB row arrives with null; reading that as
 * "Under investigation" put a false status on 35% of what prod showed (527 of 1,500).
 */
export function crimeOutcome(category: string | undefined, outcome: CrimeRow["outcome_status"]): string {
  const stated = outcome?.category?.trim();
  if (stated) return stated;
  return category === "anti-social-behaviour"
    ? "No outcome recorded (anti-social behaviour has no outcomes in this dataset)"
    : "No outcome recorded";
}

/**
 * Pure: data.police.uk rows → SignalFeature[]. Dedupes by crime id and skips rows
 * with a null/garbled location (the API returns location:null for some records).
 * `city` names the sampled city the rows came from, so the cap can share by city.
 */
export function normalizeCrime(rows: CrimeRow[], city?: string): SignalFeature[] {
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
        outcome: crimeOutcome(r.category, r.outcome_status),
        month: r.month ?? "—",
        ...(city ? { city } : {}),
      },
    });
  }
  return out;
}

/**
 * Pure: trim the merged multi-city set to the render cap, recording what that hid.
 *
 * The cap is SHARED BY CITY: one record from each city in turn, in the order the
 * cities were sampled, until the cap is reached. It used to be a positional cut of the
 * merged list, and London alone returns about 4,000 rows a month, so all 1,500 markers
 * on prod sat inside one square mile of central London (measured 2026-10-16) on a layer
 * labelled "UK street crime". A monthly crime count has no severity to rank by, so this
 * is still not a ranking, and the recorded rule says so.
 */
export function capCrime(features: SignalFeature[], cap = CRIME_CAP): SignalFeature[] {
  const byCity = new Map<string, SignalFeature[]>();
  for (const f of features) {
    const key = String(f.props?.city ?? "");
    let list = byCity.get(key);
    if (!list) {
      list = [];
      byCity.set(key, list);
    }
    list.push(f);
  }
  const lists = [...byCity.values()];
  const interleaved: SignalFeature[] = [];
  for (let i = 0; interleaved.length < features.length; i++) {
    for (const list of lists) if (i < list.length) interleaved.push(list[i]!);
  }
  return applyCap(interleaved, cap, {
    noun: "crime records",
    rule: "an equal share for each sampled city, one record from each in turn — not a ranking",
  });
}

export const UK_CRIME_SOURCE: SignalSource = {
  id: "crime",
  // data.police.uk moves every record to a nearby anonymous map point ("On or near X Street").
  precision: "area",
  label: "UK street crime",
  group: "Civic safety",
  color: "#9333ea",
  refreshMs: 6 * 60 * 60 * 1000, // monthly data; a 6-hour cache is more than enough
  attribution: POLICE_UK_ATTRIBUTION,
  async fetch() {
    try {
      // Omitting `date` makes the API use the latest month. `null` = that city's query
      // FAILED, `[]` = it answered with no crimes.
      //
      // TWO AT A TIME, WITH A RETRY. data.police.uk rate-limits by IP and answers 429 to a
      // burst: all eleven cities fired at once lost five of them on 2026-10-16, and the
      // old six-city burst is how prod lost Bristol. Two workers and a retry after a pause
      // fit inside the limit; the whole read still takes a few seconds once every 6 hours.
      const perCity: (SignalFeature[] | null)[] = new Array(CRIME_CITIES.length).fill(null);
      const readCity = async (c: (typeof CRIME_CITIES)[number]): Promise<SignalFeature[] | null> => {
        for (let attempt = 0; attempt < CRIME_ATTEMPTS; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, CRIME_RETRY_MS * attempt));
          try {
            const res = await fetch(`${STREET_ENDPOINT}?lat=${c.lat}&lng=${c.lng}`, {
              headers: { "User-Agent": UA, Accept: "application/json" },
              signal: AbortSignal.timeout(20_000),
            });
            if (res.status === 429 || res.status >= 500) continue;
            if (!res.ok) return null;
            const rows = (await res.json()) as CrimeRow[];
            return Array.isArray(rows) ? normalizeCrime(rows, c.name) : null;
          } catch (err) {
            // A timeout is worth another try; any other failure is not, and retrying it
            // would only make a dead upstream slower to report.
            if ((err as Error)?.name !== "TimeoutError") return null;
          }
        }
        return null;
      };
      let next = 0;
      await Promise.all(
        Array.from({ length: CRIME_CONCURRENCY }, async () => {
          while (next < CRIME_CITIES.length) {
            const i = next++;
            perCity[i] = await readCity(CRIME_CITIES[i]!);
          }
        }),
      );
      const failed = CRIME_CITIES.filter((_, i) => perCity[i] === null).map((c) => c.name);
      if (failed.length === CRIME_CITIES.length) return degraded("all city queries failed");
      // De-duplicate across cities (two 1-mile circles can overlap) before the cap.
      const seen = new Set<string>();
      const merged = perCity.flatMap((rows) => rows ?? []).filter((f) => !seen.has(f.id) && seen.add(f.id) !== undefined);
      const capped = capCrime(merged);
      // A city that failed is a GAP, not a city with no crime. Prod lost Bristol this way
      // without a word, because one surviving city counted as a full read.
      if (failed.length > 0) {
        // A published reason stays short (the outcome test holds 80 characters).
        const named = `${failed.length} of ${CRIME_CITIES.length} cities failed: ${failed.join(", ")}`;
        return degradedWith(capped, named.length <= 80 ? named : `${failed.length} of ${CRIME_CITIES.length} cities failed`);
      }
      return observed(capped);
    } catch {
      return degraded("read failed");
    }
  },
};
