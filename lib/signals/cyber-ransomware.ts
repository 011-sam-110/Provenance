import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { countMagnitude, groupByCountry } from "@/lib/signals/aggregate";
import { degraded, observed } from "@/lib/signals/outcome";
import { fallbackWorth, httpGet } from "@/lib/signals/httpGet";

// Recent ransomware victims — Ransomware.live. Aggregates the public leak-site claims
// of the last days by victim COUNTRY (ISO-2), so the map shows where organisations are
// being hit right now, with the active gangs and sectors. Country-coded only (no street
// address), so one marker per country at its centroid, sized by victim count.
//
// WHY PROD SHOWED NOTHING FOR FIVE WEEKS (audited 2026-10-16). Prod got `http 404` from
// the legacy `api.ransomware.live/v2/recentvictims` while the same URL answered 200 with
// 100 victims from every IPv4 vantage point tried, provenance-1 included. The host has
// an AAAA record and its own API page says the free API has "No IPv6 support"; the
// failures began the day after prod moved to a host with IPv6. So a 404, or a failure
// to connect, is retried once over IPv4 (`family: 4`, lib/signals/httpGet.ts). The
// first try stays on fetch, so the adapter's failure path can be tested without a network.
//
// TWO ENDPOINTS. ransomware.live's terms say the legacy host is kept "for compatibility
// purposes only", and the supported one is `api-pro.ransomware.live` with a free
// personal key (RANSOMWARE_LIVE_API_KEY, sent as `X-API-KEY`). With the key, the PRO
// endpoint is used; without it, the legacy endpoint keeps the layer alive. Both return
// the same row fields (`victim`, `group`, `activity`, `attackdate`, `country`).

const LEGACY_ENDPOINT = "https://api.ransomware.live/v2/recentvictims";
const PRO_ENDPOINT = "https://api-pro.ransomware.live/victims/recent";
const UA = "Provenance/2.0 (+https://github.com/011-sam-110/Provenance)";
const TIMEOUT_MS = 15_000;
/** The env var that switches the layer to the supported PRO endpoint. */
export const RANSOMWARE_LIVE_KEY_ENV = "RANSOMWARE_LIVE_API_KEY";

export const RANSOMWARE_LIVE_ATTRIBUTION = "Source: Ransomware.live";

export interface RwRow {
  victim?: string;
  group?: string; // ransomware gang / leak-site name
  activity?: string | null; // victim sector
  attackdate?: string; // ISO timestamp
  country?: string; // ISO-3166 alpha-2 ("" when unknown)
}

/** Magenta/purple ramp by the number of victims in a country. */
export function ransomwareColor(n: number): string {
  if (n >= 15) return "#581c87";
  if (n >= 6) return "#7e22ce";
  if (n >= 2) return "#9333ea";
  return "#a855f7";
}

function latestDate(rows: RwRow[]): string | undefined {
  let best = 0;
  for (const r of rows) {
    const t = r.attackdate ? Date.parse(r.attackdate) : NaN;
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best ? new Date(best).toISOString().slice(0, 10) : undefined;
}

/** Pure: rows that carry no usable country, and so cannot be placed on the map. */
export function unplacedCount(rows: RwRow[]): number {
  return rows.filter((r) => !centroidByIso2(String(r.country ?? "").trim().toUpperCase())).length;
}

/** Pure: Ransomware.live rows → one aggregated SignalFeature per country (with a centroid). */
export function normalizeRansomware(rows: RwRow[]): SignalFeature[] {
  const out: SignalFeature[] = [];
  const unplaced = unplacedCount(rows);
  // Said in each dossier, because a claim with no country is not a claim that did not happen.
  const windowNote =
    unplaced > 0
      ? `Of the ${rows.length} newest claims, ${unplaced} name no country and are not on the map.`
      : undefined;
  for (const [cc, list] of groupByCountry(rows, (r) => r.country)) {
    const ctr = centroidByIso2(cc);
    if (!ctr) continue;
    const groups = [...new Set(list.map((r) => r.group).filter(Boolean))] as string[];
    // The upstream writes "Not Found" for an unknown sector; that is not a sector.
    const sectors = [...new Set(list.map((r) => r.activity).filter((a) => a && a !== "Not Found"))] as string[];
    out.push({
      id: `cyber-ransomware:${cc}`,
      lat: ctr.lat,
      lon: ctr.lon,
      title: `${ctr.name} — ${list.length} ransomware victim${list.length === 1 ? "" : "s"}`,
      signalId: "cyber-ransomware",
      countryIso3: ctr.iso3,
      color: ransomwareColor(list.length),
      props: {
        country: ctr.name,
        victims: list.length,
        gangs: groups.length ? groups.join(", ") : "—",
        sectors: sectors.length ? sectors.slice(0, 6).join(", ") : "—",
        latestClaim: latestDate(list) ?? "—",
        magnitude: countMagnitude(list.length),
        ...(windowNote ? { windowNote } : {}),
      },
    });
  }
  return out;
}

/**
 * Pure: the rows inside either endpoint's body. The legacy endpoint answers a bare
 * array; the PRO one is documented by field, not by envelope, so a `victims` / `data`
 * / `results` wrapper is accepted too. Anything else is `null` (a bad body, not "none").
 */
export function rowsFromBody(body: unknown): RwRow[] | null {
  if (Array.isArray(body)) return body as RwRow[];
  if (body && typeof body === "object") {
    for (const k of ["victims", "data", "results"]) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as RwRow[];
    }
  }
  return null;
}

/** Pure: which endpoint to call, with which headers; the IPv4 retry uses the same. */
export function ransomwareRequest(key: string | undefined): {
  url: string;
  headers: Record<string, string>;
  keyed: boolean;
  /** The address family of the retry (see the header). */
  retryFamily: 4;
} {
  const keyed = typeof key === "string" && key.trim().length > 0;
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/json" };
  if (keyed) headers["X-API-KEY"] = key!.trim();
  return { url: keyed ? PRO_ENDPOINT : LEGACY_ENDPOINT, headers, keyed, retryFamily: 4 };
}

/** Low-level connect failures worth one more try over IPv4. */
const RETRY_V4_CODES = ["ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT"];

/** Pure: does this first answer call for the IPv4 retry? */
export function retryOverIpv4(status: number | "connect-failed"): boolean {
  return status === 404 || status === "connect-failed";
}

export const CYBER_RANSOMWARE_SOURCE: SignalSource = {
  id: "cyber-ransomware",
  // A count for each country, placed on a centroid.
  precision: "country",
  label: "Ransomware victims",
  group: "Cyber threat",
  color: "#9333ea",
  refreshMs: 1_800_000, // the terms forbid polling faster than every 30 minutes
  attribution: RANSOMWARE_LIVE_ATTRIBUTION,
  sourceUrl: "https://www.ransomware.live/", // provider dataset for the dossier's clickable source

  // Real scalar: recent ransomware victims claimed in that country (not the radius proxy).
  // Calm ≈ a single victim; extreme ≈ the ramp's top bucket (a country under a wave).
  metric: { field: "victims", domain: [1, 15] },
  async fetch() {
    try {
      const { url, headers, keyed, retryFamily } = ransomwareRequest(process.env.RANSOMWARE_LIVE_API_KEY);
      const via = keyed ? "pro" : "legacy";
      let status: number | "connect-failed";
      let body = "";
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
        status = res.status;
        if (status === 200) body = await res.text();
      } catch (err) {
        if (!fallbackWorth(err, RETRY_V4_CODES)) return degraded(`${via}: fetch failed`);
        status = "connect-failed";
      }
      if (retryOverIpv4(status)) {
        const v4 = await httpGet(url, { headers, family: retryFamily, timeoutMs: TIMEOUT_MS });
        if (!v4) return degraded(`${via}: fetch failed`);
        status = v4.status;
        body = v4.body;
      }
      if (status !== 200) return degraded(`${via}: http ${status}`);
      const rows = rowsFromBody(JSON.parse(body));
      if (!rows) return degraded(`${via}: bad json`);
      return observed(normalizeRansomware(rows));
    } catch {
      return degraded("fetch failed");
    }
  },
};
