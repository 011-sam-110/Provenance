import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { ENTSOE_ZONES, zoneByEic, type EntsoeZone } from "@/lib/signals/entsoe-zones.data";
import { degraded, observed } from "@/lib/signals/outcome";
import {
  AEMO_URL,
  eiaQuery,
  ELEXON_CREDIT,
  ELEXON_URL,
  ENERGINET_URL,
  getJson,
  MAX_READING_AGE_MS,
  NESO_URL,
  parseAemo,
  parseEia,
  parseElexon,
  parseEnerginet,
  parseNesoMix,
  parseRte,
  RTE_URL,
  type GridReading,
} from "@/lib/signals/grid-providers";

// Electricity grid load: live total demand (MW) per grid area, from the operators
// that publish it. ENTSO-E's Transparency Platform covers about 24 European bidding
// zones and needs a free token (ENTSOE_API_TOKEN); EIA-930 covers US balancing
// authorities and needs a free key (EIA_API_KEY). Elexon (GB), RTE (France),
// Energinet (Denmark) and AEMO (Australia) are keyless, so the layer shows data with
// no key at all. See lib/signals/grid-providers.ts for each feed and its licence.
//
// Where an operator publishes its own area directly (GB, France, Denmark), that
// reading replaces ENTSO-E's copy of the same area: it is fresher, and GB's data has
// not reached ENTSO-E since Brexit.
//
// ENTSO-E's API returns XML keyed by 16-char EIC "domain" codes, one zone per
// request, so that part fans out over the principal zones and takes the most recent
// load point from each. Token: register at https://transparency.entsoe.eu then email
// transparency@entsoe.eu (subject "Restful API access") from the registered address.

const ENDPOINT = "https://web-api.tp.entsoe.eu/api";

export const ENTSOE_ATTRIBUTION = "Grid-load data © ENTSO-E Transparency Platform";

/** The layer credit: every operator whose terms ask to be named. */
export const GRID_LOAD_ATTRIBUTION = [
  ENTSOE_ATTRIBUTION,
  ELEXON_CREDIT,
  "RTE éCO2mix (Licence Ouverte v2.0)",
  "Source: Energinet",
  "© AEMO",
  "Source: U.S. Energy Information Administration",
  "GB generation mix: NESO Carbon Intensity API (CC BY 4.0)",
].join(" · ");

/** ENTSO-E zones an operator-direct reading replaces when it answered. */
export const REPLACED_BY_OPERATOR: Readonly<Record<string, string[]>> = {
  "10YGB----------A": ["grid:elexon:GB"],
  "10YFR-RTE------C": ["grid:rte:FR"],
  "10Y1001A1001A65H": ["grid:energinet:DK1", "grid:energinet:DK2"],
};

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

/** Log-scaled: ~50 GW (France/Germany peak) ≈ max radius, ~1 GW small zone ≈ mid. */
function loadMagnitude(mw: number): number {
  return Math.min(10, Math.max(2, Math.round(Math.log10(mw + 1) * 20) / 10));
}

/** Pure: one reading → its marker. */
export function readingFeature(r: GridReading): SignalFeature {
  const gw = r.mw / 1000;
  return {
    id: r.id,
    lat: r.lat,
    lon: r.lon,
    title: `${r.name} — ${gw.toFixed(1)} GW load`,
    signalId: "grid-load",
    color: "#f59e0b",
    ts: new Date(r.observedAt).toISOString(),
    props: {
      zone: r.name,
      load: `${r.mw.toLocaleString("en-US")} MW`,
      source: r.source,
      observedAt: new Date(r.observedAt).toISOString(),
      ...(r.extra ?? {}),
      magnitude: loadMagnitude(r.mw),
    },
  };
}

/** Pure: build one ENTSO-E zone's load marker (load in MW). */
export function loadFeature(zone: EntsoeZone, mw: number, observedAt?: number): SignalFeature {
  const f = readingFeature({
    id: `entsoe:${zone.eic}`,
    name: zone.name,
    lat: zone.lat,
    lon: zone.lon,
    mw,
    observedAt: observedAt ?? Date.now(),
    source: "ENTSO-E",
  });
  // ENTSO-E's document carries the time of each point, but this reader keeps only the
  // quantity, so it does not claim a reading time it did not parse.
  if (observedAt == null) {
    delete f.ts;
    delete f.props?.observedAt;
  }
  return f;
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

/**
 * Pure: merge ENTSO-E's zone features with the operator readings. An ENTSO-E zone
 * whose operator answered directly is dropped (REPLACED_BY_OPERATOR), and a reading
 * older than MAX_READING_AGE_MS is not shown.
 */
export function mergeGridLoad(entsoe: SignalFeature[], readings: GridReading[], now: number = Date.now()): SignalFeature[] {
  const fresh = readings.filter((r) => now - r.observedAt <= MAX_READING_AGE_MS);
  const have = new Set(fresh.map((r) => r.id));
  const kept = entsoe.filter((f) => {
    const eic = f.id.startsWith("entsoe:") ? f.id.slice("entsoe:".length) : "";
    return !(REPLACED_BY_OPERATOR[eic] ?? []).some((id) => have.has(id));
  });
  return [...kept, ...fresh.map(readingFeature)];
}

/** ENTSO-E wants UTC timestamps as yyyyMMddHHmm. */
function entsoeStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/** ENTSO-E zones, or null when no token is set or no zone answered. */
async function fetchEntsoe(): Promise<SignalFeature[] | null> {
  const token = (process.env.ENTSOE_API_TOKEN ?? "").trim();
  if (!token) return null; // dormant until the security token is set
  const now = Date.now();
  const periodStart = entsoeStamp(new Date(now - 3 * 3600_000)); // last 3h window
  const periodEnd = entsoeStamp(new Date(now));
  const results = await Promise.all(
    ENTSOE_ZONES.map(async (z) => {
      try {
        const url =
          `${ENDPOINT}?documentType=A65&processType=A16&outBiddingZone_Domain=${z.eic}` +
          `&periodStart=${periodStart}&periodEnd=${periodEnd}&securityToken=${encodeURIComponent(token)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        // null ⇒ this zone never answered; { mw: null } ⇒ it answered with no
        // reading. normalizeGridLoad skips both, but only the outer fetch can
        // say whether the read succeeded, so the two must stay distinct.
        if (!res.ok) return null;
        return { eic: z.eic, mw: parseLatestLoad(await res.text()) };
      } catch {
        return null;
      }
    }),
  );
  const answered = results.filter((r): r is { eic: string; mw: number | null } => r !== null);
  return answered.length ? normalizeGridLoad(answered) : null;
}

/** EIA-930 readings, or null when no key is set or EIA did not answer. */
async function fetchEia(): Promise<GridReading[] | null> {
  const key = (process.env.EIA_API_KEY ?? "").trim();
  if (!key) return null; // dormant until the free key is set
  const json = await getJson<Parameters<typeof parseEia>[0]>(eiaQuery(key), 20_000);
  return json ? parseEia(json) : null;
}

/** Elexon's GB reading with NESO's generation mix beside it (the mix is not load). */
async function fetchGb(): Promise<GridReading[] | null> {
  const [rows, mix] = await Promise.all([
    getJson<Parameters<typeof parseElexon>[0]>(ELEXON_URL),
    getJson<Parameters<typeof parseNesoMix>[0]>(NESO_URL),
  ]);
  const gb = rows ? parseElexon(rows) : null;
  if (!gb) return rows ? [] : null;
  const m = mix ? parseNesoMix(mix) : null;
  return [m ? { ...gb, extra: { ...(gb.extra ?? {}), generationMix: m.mix, generationMixWindow: m.window } } : gb];
}

const keyless = async <T>(url: string, parse: (j: T) => GridReading[] | GridReading | null): Promise<GridReading[] | null> => {
  const json = await getJson<T>(url);
  if (!json) return null;
  const r = parse(json);
  return r == null ? [] : Array.isArray(r) ? r : [r];
};

export const GRID_LOAD_SOURCE: SignalSource = {
  id: "grid-load",
  // A bidding zone, a balancing authority or a market region.
  precision: "area",
  label: "Electricity grid load",
  group: "Infrastructure",
  color: "#f59e0b",
  // ENTSO-E and EIA are hourly at best; the keyless five-minute feeds could go
  // faster, but 30 min keeps the load on every upstream low.
  refreshMs: 30 * 60 * 1000,
  attribution: GRID_LOAD_ATTRIBUTION,
  async fetch() {
    try {
      const [entsoe, eia, gb, fr, dk, au] = await Promise.all([
        fetchEntsoe(),
        fetchEia(),
        fetchGb(),
        keyless(RTE_URL, parseRte),
        keyless(ENERGINET_URL, parseEnerginet),
        keyless(AEMO_URL, parseAemo),
      ]);
      const readers = [gb, fr, dk, au, eia];
      // Every keyless operator refusing (and no keyed one set or answering) is an
      // upstream failure, not a world with no electricity demand.
      if (readers.every((r) => r === null) && entsoe === null) return degraded("no operator answered");
      const readings = readers.flatMap((r) => r ?? []);
      return observed(mergeGridLoad(entsoe ?? [], readings));
    } catch {
      return degraded("fetch failed");
    }
  },
};
