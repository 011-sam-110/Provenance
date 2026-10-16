import { request as httpsRequest, type RequestOptions } from "node:https";
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { countMagnitude, groupByCountry } from "@/lib/signals/aggregate";
import { degraded, observed } from "@/lib/signals/outcome";

// Recent ransomware victims — Ransomware.live. Aggregates the public leak-site claims
// of the last days by victim COUNTRY (ISO-2), so the map shows where organisations are
// being hit right now, with the active gangs and sectors. Country-coded only (no street
// address), so one marker per country at its centroid, sized by victim count.
//
// WHY PROD SHOWED NOTHING FOR FIVE WEEKS (audited 2026-10-16). Prod got `http 404` from
// the legacy `api.ransomware.live/v2/recentvictims` while the same URL answered 200 with
// 100 victims from every IPv4 vantage point tried, provenance-1 included. The host has
// an AAAA record and its own API page says the free API has "No IPv6 support"; the
// failures began the day after prod moved to a host with IPv6. So every request here
// goes out over IPv4 (`family: 4`), whichever endpoint it is.
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

/** Pure: which endpoint to call, and how. Always IPv4 (see the header). */
export function ransomwareRequest(key: string | undefined): { url: string; options: RequestOptions; keyed: boolean } {
  const keyed = typeof key === "string" && key.trim().length > 0;
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/json" };
  if (keyed) headers["X-API-KEY"] = key!.trim();
  return {
    url: keyed ? PRO_ENDPOINT : LEGACY_ENDPOINT,
    options: { method: "GET", family: 4, headers, timeout: TIMEOUT_MS },
    keyed,
  };
}

/** GET over node:https, so the address family can be pinned. Never throws. */
function getIpv4(url: string, options: RequestOptions): Promise<{ status: number; body: string } | null> {
  return new Promise((resolve) => {
    try {
      const req = httpsRequest(url, options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => resolve(null));
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", () => resolve(null));
      req.end();
    } catch {
      resolve(null);
    }
  });
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
      const { url, options, keyed } = ransomwareRequest(process.env.RANSOMWARE_LIVE_API_KEY);
      const res = await getIpv4(url, options);
      const via = keyed ? "pro" : "legacy";
      if (!res) return degraded(`${via}: fetch failed`);
      if (res.status !== 200) return degraded(`${via}: http ${res.status}`);
      const rows = rowsFromBody(JSON.parse(res.body));
      if (!rows) return degraded(`${via}: bad json`);
      return observed(normalizeRansomware(rows));
    } catch {
      return degraded("fetch failed");
    }
  },
};
