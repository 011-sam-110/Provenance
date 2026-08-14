import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso3 } from "@/lib/signals/country-centroids.data";
import { markCoverage } from "@/lib/signals/coverage";
import { degraded, observed } from "@/lib/signals/outcome";

// Humanitarian disasters — ReliefWeb (UN OCHA). The authoritative register of
// active humanitarian emergencies (conflict, flood, drought, epidemic, cyclone,
// complex emergencies) with the affected country and an official situation-report
// link. Key-gated: ReliefWeb's API requires a registered (free) `appname` — not a
// secret, but the API 403s without an approved one — so the adapter reads
// RELIEFWEB_APPNAME and stays dormant (→ []) until it's set.
//
// Request an appname: https://apidoc.reliefweb.int/parameters#appname

const ENDPOINT = "https://api.reliefweb.int/v2/disasters";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** Page size asked of ReliefWeb, sorted newest-changed first. */
export const RELIEFWEB_PAGE_LIMIT = 100;

export const RELIEFWEB_ATTRIBUTION = "Humanitarian data © ReliefWeb (UN OCHA)";

interface RwCountry {
  iso3?: string;
  name?: string;
  primary?: boolean;
  location?: { lat?: number; lon?: number };
}
interface RwDisaster {
  id?: string | number;
  fields?: {
    name?: string;
    status?: string; // "alert" | "current" | "past"
    glide?: string;
    primary_country?: RwCountry;
    country?: RwCountry[];
    type?: { name?: string; code?: string }[];
    date?: { created?: string; changed?: string };
    url?: string;
  };
}

/** ReliefWeb disaster-type code → colour. */
export function disasterColor(code: string): string {
  switch (code.toUpperCase()) {
    case "EQ": return "#b45309"; // earthquake
    case "TC": return "#7e22ce"; // tropical cyclone
    case "FL": return "#2563eb"; // flood
    case "FF": return "#1d4ed8"; // flash flood
    case "DR": return "#a16207"; // drought
    case "EP": return "#0d9488"; // epidemic
    case "CE": return "#dc2626"; // complex emergency (conflict)
    case "AC": return "#ea580c"; // technological / other accident
    case "WF": return "#c2410c"; // wildfire
    case "VO": return "#9a3412"; // volcano
    default: return "#64748b";
  }
}

/** Active disasters get a bigger marker; alerts biggest. */
function statusMagnitude(status: string): number {
  switch (status) {
    case "alert": return 7;
    case "current": return 5;
    default: return 3;
  }
}

/**
 * Pure: ReliefWeb /v2/disasters payload → SignalFeature[] (one per located
 * disaster). The query is paged at `limit`; a full page means there are more
 * current emergencies than the map is showing, and the payload says so.
 */
export function normalizeReliefWeb(
  json: { data?: RwDisaster[] },
  limit = RELIEFWEB_PAGE_LIMIT,
): SignalFeature[] {
  const rows = json.data ?? [];
  const out: SignalFeature[] = [];
  for (const d of rows) {
    const f = d.fields;
    if (!f) continue;
    const pc = f.primary_country;
    // Prefer ReliefWeb's own country location; fall back to our centroid by ISO-3.
    let lat = pc?.location?.lat;
    let lon = pc?.location?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") {
      const c = centroidByIso3((pc?.iso3 ?? "").toUpperCase());
      if (!c) continue;
      lat = c.lat;
      lon = c.lon;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = String(d.id ?? f.glide ?? f.name ?? "").trim();
    if (!id) continue;
    const types = (f.type ?? []).map((t) => t.name).filter(Boolean) as string[];
    const primaryType = f.type?.[0];
    const status = (f.status ?? "current").toLowerCase();
    const country = pc?.name?.trim() || "Unknown";
    out.push({
      id: `reliefweb:${id}`,
      lat,
      lon,
      title: f.name?.trim() || `${country} emergency`,
      signalId: "reliefweb",
      color: disasterColor(primaryType?.code ?? ""),
      ts: f.date?.changed ?? f.date?.created ?? undefined,
      link: f.url,
      props: {
        emergency: f.name?.trim() || "—",
        country,
        status,
        types: types.length ? types.join(", ") : "—",
        ...(f.glide ? { glide: f.glide } : {}),
        updated: f.date?.changed ?? f.date?.created ?? "—",
        magnitude: statusMagnitude(status),
      },
    });
  }
  return markCoverage(out, {
    noun: "emergencies",
    rule: "the most recently updated",
    upstream: { limit, count: rows.length },
  });
}

export const RELIEFWEB_SOURCE: SignalSource = {
  id: "reliefweb",
  label: "Humanitarian emergencies (ReliefWeb)",
  group: "Human cost",
  color: "#dc2626",
  refreshMs: 60 * 60 * 1000,
  attribution: RELIEFWEB_ATTRIBUTION,
  async fetch() {
    const appname = (process.env.RELIEFWEB_APPNAME ?? "").trim();
    if (!appname) return degraded("no key"); // dormant until an approved appname is set
    try {
      const url =
        `${ENDPOINT}?appname=${encodeURIComponent(appname)}&profile=full&limit=${RELIEFWEB_PAGE_LIMIT}` +
        `&filter[field]=status&filter[value][]=current&filter[value][]=alert` +
        `&sort[]=date.changed:desc`;
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return degraded(`http ${res.status}`);
      const json = (await res.json()) as { data?: RwDisaster[] };
      // Marked on the array normalizeReliefWeb already carries coverage on — the
      // two side channels use different symbols, so neither overwrites the other.
      return observed(normalizeReliefWeb(json));
    } catch {
      return degraded("fetch failed");
    }
  },
};
