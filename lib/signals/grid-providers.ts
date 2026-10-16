// Grid-load readings from operators other than ENTSO-E. Each provider returns plain
// readings; lib/signals/entsoe.ts (GRID_LOAD_SOURCE) turns them into features. The
// parsers are pure and each has a captured fixture.
//
// Why these exist (2026-10-16): the layer was ENTSO-E only and gated on a token
// nobody had requested, so it served nothing for four months. Four of the feeds below
// are keyless and were live that day, so the layer now shows Great Britain, France,
// Denmark and Australia with no key at all. EIA-930 (the US, about 50 balancing
// authorities) needs a free key, EIA_API_KEY, and stays dormant until it is set.
//
//   Elexon      GB national demand outturn, 5-min. Licence to use BMRS open data.
//   RTE         France consumption, 15-min (éCO2mix on ODRÉ). Licence Ouverte v2.0.
//   Energinet   DK1 and DK2, 5-min. CC BY 4.0. Load is derived, see parseEnerginet.
//   AEMO        Australia's five NEM regions, 5-min. AEMO copyright permissions.
//   EIA-930     US balancing authorities, hourly. Public domain (US government).
//   NESO        GB generation mix (not load) from the Carbon Intensity API. CC BY 4.0.

import { aemoAnchor, dkAnchor, eiaAnchor, FR_ANCHOR, GB_ANCHOR, type GridAnchor } from "@/lib/signals/grid-zones.data";

/** One operator reading of electricity demand in one area. */
export interface GridReading {
  /** Stable feature id, e.g. "grid:elexon:GB". */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Average demand over the reading's interval, MW. */
  mw: number;
  /** Epoch ms of the interval the reading is for. */
  observedAt: number;
  /** Who published it, as shown to the reader. */
  source: string;
  /** Extra props for the dossier (a generation mix, a region code). */
  extra?: Record<string, unknown>;
}

/** A reading older than this is not shown: the layer is "now", not "today". */
export const MAX_READING_AGE_MS = 6 * 3600_000;

const reading = (id: string, anchor: GridAnchor, mw: number, observedAt: number, source: string, extra?: Record<string, unknown>): GridReading | null =>
  Number.isFinite(mw) && mw > 0 && Number.isFinite(observedAt)
    ? { id, name: anchor.name, lat: anchor.lat, lon: anchor.lon, mw: Math.round(mw), observedAt, source, ...(extra ? { extra } : {}) }
    : null;

// --- Elexon (GB) -----------------------------------------------------------------

export const ELEXON_URL = "https://data.elexon.co.uk/bmrs/api/v1/demand/outturn/summary";
export const ELEXON_CREDIT = "Contains BMRS data © Elexon Limited copyright and database right 2026";

/** Pure: Elexon's demand outturn summary → the newest GB reading. */
export function parseElexon(rows: { startTime?: string; demand?: number }[]): GridReading | null {
  let best: { t: number; mw: number } | null = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = Date.parse(r.startTime ?? "");
    if (Number.isFinite(t) && typeof r.demand === "number" && (!best || t > best.t)) best = { t, mw: r.demand };
  }
  return best ? reading("grid:elexon:GB", GB_ANCHOR, best.mw, best.t, "Elexon (BMRS)") : null;
}

// --- NESO generation mix (GB companion) --------------------------------------------

export const NESO_URL = "https://api.carbonintensity.org.uk/generation";

/** Pure: the Carbon Intensity API's generation mix → "wind 40%, gas 27%, …" (largest first). */
export function parseNesoMix(json: { data?: { from?: string; to?: string; generationmix?: { fuel?: string; perc?: number }[] } }): { mix: string; window: string } | null {
  const mix = (json?.data?.generationmix ?? [])
    .filter((m) => m.fuel && typeof m.perc === "number" && m.perc > 0)
    .sort((x, y) => (y.perc ?? 0) - (x.perc ?? 0))
    .map((m) => `${m.fuel} ${Math.round(m.perc!)}%`);
  if (mix.length === 0) return null;
  return { mix: mix.join(", "), window: `${json.data?.from ?? "?"} to ${json.data?.to ?? "?"}` };
}

// --- RTE (France) --------------------------------------------------------------------

export const RTE_URL =
  "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records?order_by=date_heure%20desc&where=consommation%20is%20not%20null&limit=1";

/** Pure: the newest éCO2mix record → France's consumption. */
export function parseRte(json: { results?: { date_heure?: string; consommation?: number | null }[] }): GridReading | null {
  const r = json?.results?.[0];
  if (!r || typeof r.consommation !== "number") return null;
  return reading("grid:rte:FR", FR_ANCHOR, r.consommation, Date.parse(r.date_heure ?? ""), "RTE éCO2mix");
}

// --- Energinet (Denmark) -------------------------------------------------------------

export const ENERGINET_URL = "https://api.energidataservice.dk/dataset/ElectricityProdex5MinRealtime?limit=4&sort=Minutes5UTC%20desc";

type EnerginetRow = Record<string, string | number | null | undefined>;

const PRODUCTION = ["ProductionLt100MW", "ProductionGe100MW", "OffshoreWindPower", "OnshoreWindPower", "SolarPower"] as const;
const EXCHANGES = ["ExchangeGreatBelt", "ExchangeGermany", "ExchangeNetherlands", "ExchangeGreatBritain", "ExchangeNorway", "ExchangeSweden", "BornholmSE4"] as const;

/**
 * Pure: Energinet's 5-minute production and exchange per price area → load.
 *
 * Energinet publishes no consumption figure here, so load is DERIVED: production
 * plus net exchange, where a positive exchange is an import. Checked on 2026-10-16
 * 20:00 UTC: DK1 2,624 MW + DK2 1,517 MW = 4,141 MW, against 4,096 MW from the
 * national PowerSystemRightNow sum (production + Exchange_Sum) at 20:02. The props
 * say "derived" so nobody reads it as a metered figure.
 */
export function parseEnerginet(json: { records?: EnerginetRow[] }): GridReading[] {
  const newest = new Map<string, EnerginetRow>();
  for (const r of json?.records ?? []) {
    const area = String(r.PriceArea ?? "");
    const t = Date.parse(`${r.Minutes5UTC}Z`);
    const prev = newest.get(area);
    if (!prev || t > Date.parse(`${prev.Minutes5UTC}Z`)) newest.set(area, r);
  }
  const out: GridReading[] = [];
  for (const [area, r] of newest) {
    const anchor = dkAnchor(area);
    if (!anchor) continue;
    const num = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : 0);
    const produced = PRODUCTION.reduce((s, k) => s + num(k), 0);
    const imported = EXCHANGES.reduce((s, k) => s + num(k), 0);
    const rd = reading(`grid:energinet:${area}`, anchor, produced + imported, Date.parse(`${r.Minutes5UTC}Z`), "Energinet", {
      method: "derived: production plus net imports",
    });
    if (rd) out.push(rd);
  }
  return out;
}

// --- AEMO (Australia) ----------------------------------------------------------------

export const AEMO_URL = "https://visualisations.aemo.com.au/aemo/apps/api/report/ELEC_NEM_SUMMARY";

/** Pure: AEMO's NEM summary → one reading per region. SETTLEMENTDATE is AEST (UTC+10, no DST). */
export function parseAemo(json: { ELEC_NEM_SUMMARY?: { SETTLEMENTDATE?: string; REGIONID?: string; TOTALDEMAND?: number }[] }): GridReading[] {
  const out: GridReading[] = [];
  for (const r of json?.ELEC_NEM_SUMMARY ?? []) {
    const anchor = aemoAnchor(r.REGIONID ?? "");
    if (!anchor || typeof r.TOTALDEMAND !== "number") continue;
    // The interval ENDS at SETTLEMENTDATE (AEMO's convention); it is the reading's time.
    const t = Date.parse(`${r.SETTLEMENTDATE}+10:00`);
    const rd = reading(`grid:aemo:${r.REGIONID}`, anchor, r.TOTALDEMAND, t, "AEMO", { region: r.REGIONID });
    if (rd) out.push(rd);
  }
  return out;
}

// --- EIA-930 (United States) ---------------------------------------------------------

export const EIA_URL = "https://api.eia.gov/v2/electricity/rto/region-data/data/";

/** The query, without the key. 300 rows covers the newest hours of every respondent. */
export function eiaQuery(key: string): string {
  const p = new URLSearchParams();
  p.set("api_key", key);
  p.set("frequency", "hourly");
  p.append("data[0]", "value");
  p.append("facets[type][]", "D");
  p.append("sort[0][column]", "period");
  p.append("sort[0][direction]", "desc");
  p.set("length", "300");
  return `${EIA_URL}?${p.toString()}`;
}

/**
 * Pure: EIA-930 demand rows → the newest reading per balancing authority. A value is
 * MWh for the hour, which is the hour's average MW. `period` is the hour in UTC
 * ("2026-10-16T19"). Aggregate regions are not in the anchor table and are skipped.
 */
export function parseEia(json: { response?: { data?: { period?: string; respondent?: string; value?: string | number }[] } }): GridReading[] {
  const newest = new Map<string, { t: number; mw: number }>();
  for (const r of json?.response?.data ?? []) {
    const code = String(r.respondent ?? "");
    if (!eiaAnchor(code)) continue;
    const t = Date.parse(`${r.period}:00:00Z`);
    const mw = Number(r.value);
    if (!Number.isFinite(t) || !Number.isFinite(mw)) continue;
    const prev = newest.get(code);
    if (!prev || t > prev.t) newest.set(code, { t, mw });
  }
  const out: GridReading[] = [];
  for (const [code, { t, mw }] of newest) {
    const rd = reading(`grid:eia:${code}`, eiaAnchor(code)!, mw, t, "EIA-930", { balancingAuthority: code });
    if (rd) out.push(rd);
  }
  return out;
}

// --- fetch helpers ---------------------------------------------------------------------

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** GET a JSON body, or null on any failure. Never throws. */
export async function getJson<T>(url: string, ms = 15_000): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
