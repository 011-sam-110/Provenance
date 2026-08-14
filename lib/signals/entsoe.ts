import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { ENTSOE_ZONES, zoneByEic, type EntsoeZone } from "@/lib/signals/entsoe-zones.data";
import { degraded, observed } from "@/lib/signals/outcome";

// European electricity grid — ENTSO-E Transparency. Live total load (electricity
// demand, MW) per bidding zone: a real-time read on each country's grid, and the
// substrate for spotting demand spikes / shortfalls. The API returns XML keyed by
// 16-char EIC "domain" codes, one zone per request, so the adapter fans out over
// the principal zones, parses the most recent load point from each, and plots one
// marker per zone. Key-gated: reads ENTSOE_API_TOKEN (free Web API security token,
// emailed on request); dormant (→ []) until set.
//
// Token: register at https://transparency.entsoe.eu then email transparency@entsoe.eu
// (subject "Restful API access") from the registered address.

const ENDPOINT = "https://web-api.tp.entsoe.eu/api";

export const ENTSOE_ATTRIBUTION = "Grid-load data © ENTSO-E Transparency Platform";

/** Pure: a GL_MarketDocument (Total Load, A65) XML → the latest load in MW, or null. */
export function parseLatestLoad(xml: string): number | null {
  if (typeof xml !== "string" || !xml) return null;
  // The document carries one <quantity> per time point; the last is the most recent.
  const matches = xml.match(/<quantity>\s*([\d.]+)\s*<\/quantity>/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const m = last.match(/<quantity>\s*([\d.]+)\s*<\/quantity>/);
  if (!m) return null;
  const mw = Number(m[1]);
  return Number.isFinite(mw) && mw > 0 ? Math.round(mw) : null;
}

/** Pure: extract the bidding-zone EIC from the document, if present. */
export function parseZoneEic(xml: string): string | null {
  const m = xml.match(/outBiddingZone_Domain\.mRID[^>]*>\s*([^<\s]+)\s*</);
  return m ? m[1] : null;
}

/** Pure: build one zone's load marker (load in MW). */
export function loadFeature(zone: EntsoeZone, mw: number): SignalFeature {
  const gw = mw / 1000;
  return {
    id: `entsoe:${zone.eic}`,
    lat: zone.lat,
    lon: zone.lon,
    title: `${zone.name} — ${gw.toFixed(1)} GW load`,
    signalId: "grid-load",
    color: "#f59e0b",
    props: {
      zone: zone.name,
      load: `${mw.toLocaleString()} MW`,
      // Log-scaled: ~50 GW (France/Germany peak) ≈ max radius, ~1 GW small zone ≈ mid.
      magnitude: Math.min(10, Math.max(2, Math.round(Math.log10(mw + 1) * 20) / 10)),
    },
  };
}

/** Pure: combine per-zone parse results into features (skips zones with no reading). */
export function normalizeGridLoad(results: { eic: string; mw: number | null }[]): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const r of results) {
    if (r.mw == null || !(r.mw > 0)) continue;
    const zone = zoneByEic(r.eic);
    if (!zone) continue;
    out.push(loadFeature(zone, r.mw));
  }
  return out;
}

/** ENTSO-E wants UTC timestamps as yyyyMMddHHmm. */
function entsoeStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

export const GRID_LOAD_SOURCE: SignalSource = {
  id: "grid-load",
  label: "Electricity grid load (ENTSO-E)",
  group: "Infrastructure",
  color: "#f59e0b",
  refreshMs: 30 * 60 * 1000,
  attribution: ENTSOE_ATTRIBUTION,
  async fetch() {
    const token = (process.env.ENTSOE_API_TOKEN ?? "").trim();
    if (!token) return degraded("no key"); // dormant until the security token is set
    const now = Date.now();
    const periodStart = entsoeStamp(new Date(now - 3 * 3600_000)); // last 3h window
    const periodEnd = entsoeStamp(new Date(now));
    try {
      const results = await Promise.all(
        ENTSOE_ZONES.map(async (z) => {
          try {
            const url =
              `${ENDPOINT}?documentType=A65&processType=A16&outBiddingZone_Domain=${z.eic}` +
              `&periodStart=${periodStart}&periodEnd=${periodEnd}&securityToken=${encodeURIComponent(token)}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
            // null ⇒ this zone never answered; { mw: null } ⇒ it answered with no
            // reading. normalizeGridLoad skips both, but only the outer fetch can
            // say whether the LAYER read succeeded, so the two must stay distinct.
            if (!res.ok) return null;
            return { eic: z.eic, mw: parseLatestLoad(await res.text()) };
          } catch {
            return null;
          }
        }),
      );
      const answered = results.filter((r): r is { eic: string; mw: number | null } => r !== null);
      // Every zone refusing is an upstream failure, not a continent with no demand.
      if (answered.length === 0) return degraded("no zone answered");
      return observed(normalizeGridLoad(answered));
    } catch {
      return degraded("fetch failed");
    }
  },
};
