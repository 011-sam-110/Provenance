import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso3 } from "@/lib/signals/country-centroids.data";
import { countMagnitude } from "@/lib/signals/aggregate";

// Food insecurity by country — WFP HungerMap LIVE.
//
// THIS LAYER IS DORMANT. HungerMap used to be keyless; it is not any more. Every
// route that carries the food-security numbers now refuses an unauthenticated
// caller, checked 2026-08-10:
//
//   api.hungermapdata.org/v1/foodsecurity/country            → 401 {"message":"Unauthorized"}
//   api.hungermapdata.org/v2/foodsecurity/country            → 404 {"message":"Not Found"}
//   api.hungermapdata.org/v2/adm0data.json                   → 503 {"message":"Service Unavailable"}
//   <ifc-gateway>/prod/adm0data.json  (the host hungermap.wfp.org itself calls)
//                                                            → 403 {"message":"Missing Authentication Token"}
//   <ifc-gateway>/prod/adm0/fcs.json                         → 403 {"message":"Missing Authentication Token"}
//   cdn.hungermapdata.org/hungermap/adm0data.json            → 403 AccessDenied
//
// The CDN still serves BOUNDARY GEOMETRY keylessly (adm1_labels.geojson, 200 /
// 428 KB) but no food-security values, so it cannot stand in. Mirrors were checked
// too and none carries the HungerMap nowcast:
//   • HDX CKAN `package_search?q=hungermap` → 1 result, an unrelated OCHA-Iraq CSV.
//   • HDX HAPI /api/v2/food-security/food-security → 403 {"error":"Invalid app
//     identifier"}; it validates a registered identifier, so it is key-gated too.
//
// Rather than render zero and look like a calm world, the layer emits ONE labelled
// status notice saying why it is dark. That placeholder is deliberately not a
// reading: it has no prevalence value, so the monitor row shows a plain dot rather
// than an invented metric bar, and its title and props say so in words.
//
// The pure upstream→domain mapping below is kept intact and still unit-tested, so
// the layer wakes up unchanged the moment a credential exists.

const ENDPOINT = "https://api.hungermapdata.org/v1/foodsecurity/country";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** Env var holding a WFP HungerMap credential. Unset in every environment today. */
export const HUNGERMAP_KEY_ENV = "HUNGERMAP_API_KEY";

export const HUNGERMAP_ATTRIBUTION = "Food-security data © WFP HungerMap LIVE";

interface HmMetric {
  people?: number;
  prevalence?: number; // 0–1 share of population
}
interface HmCountry {
  country?: { iso3?: string; name?: string };
  date?: string;
  dataType?: string; // "PREDICTION" | "FORECAST" | "ACTUAL DATA" …
  metrics?: { fcs?: HmMetric; rcsi?: HmMetric };
}

/** Yellow→deep-red ramp by the share of the population with insufficient food. */
export function foodInsecurityColor(prevalence: number): string {
  if (prevalence >= 0.4) return "#7f1d1d";
  if (prevalence >= 0.25) return "#dc2626";
  if (prevalence >= 0.15) return "#ea580c";
  if (prevalence >= 0.05) return "#f59e0b";
  return "#fbbf24";
}

/** Pure: HungerMap payload → one SignalFeature per country with a real FCS reading. */
export function normalizeFoodSecurity(json: { body?: { countries?: HmCountry[] } }): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const c of json.body?.countries ?? []) {
    const iso3 = (c.country?.iso3 ?? "").toUpperCase();
    const ctr = centroidByIso3(iso3);
    if (!ctr) continue;
    const fcs = c.metrics?.fcs;
    const people = typeof fcs?.people === "number" ? fcs.people : 0;
    if (people <= 0) continue;
    const prevalence = typeof fcs?.prevalence === "number" ? fcs.prevalence : 0;
    const pct = Math.round(prevalence * 100);
    out.push({
      id: `food:${iso3}`,
      lat: ctr.lat,
      lon: ctr.lon,
      title: `${ctr.name} — ${people.toLocaleString()} food-insecure (${pct}%)`,
      signalId: "food-security",
      color: foodInsecurityColor(prevalence),
      props: {
        country: ctr.name,
        insufficientFood: people.toLocaleString(),
        prevalence: `${pct}%`,
        prevalencePct: pct, // real FCS prevalence as a finite number (drives the metric bar)
        ...(typeof c.metrics?.rcsi?.prevalence === "number"
          ? { crisisCoping: `${Math.round(c.metrics.rcsi.prevalence * 100)}%` }
          : {}),
        basis: c.dataType ?? "—",
        asOf: c.date ?? "—",
        magnitude: countMagnitude(people / 100_000),
      },
    });
  }
  return out;
}

/** Stable id of the dormancy notice, so callers can tell it from a real reading. */
export const FOOD_SECURITY_NOTICE_ID = "food-security:unavailable";

/** True when a feature is the dormancy placeholder rather than a country reading. */
export function isFoodSecurityNotice(f: SignalFeature): boolean {
  return f.id === FOOD_SECURITY_NOTICE_ID;
}

/**
 * Pure: the single labelled placeholder this layer shows while it has no data
 * source. Carries NO prevalence/magnitude — nothing here can be mistaken for a
 * measurement, and the metric bar stays blank because the field is absent.
 */
export function foodSecurityNotice(reason: string): SignalFeature {
  return {
    id: FOOD_SECURITY_NOTICE_ID,
    // 0,0 is not a location claim — it is the conventional "no position" point,
    // and the title/props say as much wherever this is rendered.
    lat: 0,
    lon: 0,
    title: "Food insecurity — no data: WFP HungerMap is no longer public",
    signalId: "food-security",
    color: "#64748b", // slate — a status marker, deliberately outside the severity ramp
    link: "https://hungermap.wfp.org/",
    props: {
      status: "STATUS NOTICE — not a measurement",
      whatThisMeans: "This layer has no readings to show. It is not reporting zero hunger.",
      reason,
      upstream: `${ENDPOINT} → 401 Unauthorized`,
      keylessCheck: "2026-08-10 — v1/v2 API, WFP's own gateway, the CDN and HDX all refused or lacked the data",
      needsEnvVar: HUNGERMAP_KEY_ENV,
      position: "0, 0 — placeholder, this notice has no real location",
    },
  };
}

export const FOOD_SECURITY_SOURCE: SignalSource = {
  id: "food-security",
  label: "Food insecurity",
  group: "Human cost",
  color: "#ea580c",
  refreshMs: 6 * 60 * 60 * 1000, // a daily-ish nowcast; 6-hour cache is ample
  attribution: HUNGERMAP_ATTRIBUTION,
  sourceUrl: "https://hungermap.wfp.org/", // WFP HungerMap LIVE (dossier source)

  // Share of the population with insufficient food consumption (FCS). ~5% is an
  // unremarkable baseline; ≥50% (e.g. Afghanistan) is a full-blown food emergency.
  // The dormancy notice omits this field, so it renders as a dot, not a bar.
  metric: { field: "prevalencePct", domain: [5, 50], unit: " %" },

  async fetch() {
    const key = process.env[HUNGERMAP_KEY_ENV];
    if (!key) {
      return [foodSecurityNotice(`No ${HUNGERMAP_KEY_ENV} is set, and WFP withdrew the keyless feed.`)];
    }
    // NOTE: the auth SCHEME is unverified — we hold no HungerMap credential to test
    // with. The 401 body is API Gateway's authorizer shape, so a bearer token is the
    // likely form; if a real key arrives and this still fails, try `x-api-key`. Either
    // way the failure path is the honest notice, never a throw and never a fake point.
    try {
      const res = await fetch(ENDPOINT, {
        headers: { "User-Agent": UA, Accept: "application/json", Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return [foodSecurityNotice(`${HUNGERMAP_KEY_ENV} is set but WFP rejected it (HTTP ${res.status}).`)];
      }
      const json = (await res.json()) as { body?: { countries?: HmCountry[] } };
      const features = normalizeFoodSecurity(json);
      return features.length
        ? features
        : [foodSecurityNotice("WFP accepted the request but returned no country readings.")];
    } catch {
      return [foodSecurityNotice("WFP HungerMap could not be reached.")];
    }
  },
};
