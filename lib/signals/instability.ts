import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { COUNTRY_CENTROIDS, centroidByIso2, centroidByIso3, centroidByName, type CountryCentroid } from "@/lib/signals/country-centroids.data";
import { CONFLICT_SOURCE } from "@/lib/signals/gdelt";
import { INTERNET_OUTAGES_SOURCE } from "@/lib/signals/internet-outages";
import { isVerifiedShutdown } from "@/lib/signals/pulse-shutdowns";
import { degraded, observed } from "@/lib/signals/outcome";
import {
  fetchInformRisk,
  fetchInformSeverity,
  fetchIodaCriticalAlerts,
  fetchPopulation,
  fetchUcdpFatalities,
  fetchWgiPoliticalStability,
  structuralBaseline,
} from "@/lib/signals/instability-inputs";

// ============================================================================
// Country Instability Index (CII) — the synthesis layer, the "real product".
//
// Most monitors show you raw dots. The CII answers the actual question — *which
// countries are under the most pressure right now* — by combining several
// independent signals into one transparent, per-country score (0–100).
//
// Design principles (this is what makes it trustworthy, not just another index):
//   • HONEST INPUTS. We use displacement by country of *origin* (people fleeing
//     FROM a place), NOT country of asylum — hosting refugees (Germany, Türkiye)
//     is not instability. Ransomware victim counts are deliberately EXCLUDED:
//     they track digital-economy size (US/UK top the list), not instability.
//   • CONSERVATIVE. A factor with no data contributes 0 (denominator is the full
//     weight set), so sparse data UNDER-states rather than crying wolf. We show
//     factor coverage ("5/7 factors") so the user sees the basis — AND, when
//     coverage is partial, the score is presented as an explicit FLOOR (title
//     gets a "≥", `props.scoreBasis` is "floor" not "measured").
//     COVERAGE counts the factors whose upstream MEASURED the country, and a measured
//     zero counts: UCDP recording no deaths in a country is a measurement, not a gap.
//     The global upstreams (UCDP, INFORM Severity, UNHCR, GDELT, IODA) measure every
//     country when they answer; FEWS NET (~38 countries) and the structural sources
//     cover only the countries they list.
//   • SHOWS ITS WORK. Every country lists each factor's contribution and the top
//     drivers. No black box — you can see exactly why a score is what it is.
//
// Factors (each normalised to 0..1, then weighted). Rebuilt on 2026-10-16, when the
// index ranked Barbados above Russia and Israel because two of its four factors fed
// nothing (WFP answered 401; the GDELT read had a parse bug) and the two left had ramps
// that gave almost every country a score:
//   conflict     0.30  UCDP Candidate GED: fatalities ("best") in the newest two monthly
//                      releases (~60 days). 10 deaths → 0, 100 → 0.33, 10,000 → 1.
//   severity     0.25  INFORM Severity Index (1-10), the worst crisis in the country.
//   food         0.15  FEWS NET: share of the population in IPC phase 3 or worse; 50% = 1.
//   structural   0.15  INFORM Risk (0-10) and World Bank WGI Political Stability, averaged.
//   displacement 0.10  UNHCR people displaced FROM the country, as a share of its
//                      population (10% = 1), and only from 10,000 people up. The old ramp
//                      (log of the head count) gave 100 asylum seekers 28%.
//   attention    0.03  GDELT conflict-coded article volume, HARD-CAPPED at 0.55: press
//                      coverage, not casualties (the US tops it on domestic stories).
//   outages      0.02  IODA CRITICAL country alerts in the last 24 h; 4 alerts = 1, and a
//                      shutdown ISOC Pulse has verified is 1 on its own. The
//                      old summary score gave ~55 countries a flat ~57% for routine blips.
// ============================================================================

export type FactorKey = "conflict" | "severity" | "food" | "structural" | "displacement" | "attention" | "outages";

export const FACTOR_WEIGHTS: Record<FactorKey, number> = {
  conflict: 0.3,
  severity: 0.25,
  food: 0.15,
  structural: 0.15,
  displacement: 0.1,
  attention: 0.03,
  outages: 0.02,
};

const FACTOR_LABEL: Record<FactorKey, string> = {
  conflict: "armed conflict (UCDP fatalities)",
  severity: "crisis severity (INFORM)",
  food: "food insecurity",
  structural: "structural risk (INFORM Risk, WGI)",
  displacement: "displacement",
  attention: "conflict coverage (GDELT article volume)",
  outages: "internet outages",
};

/** Human label for a factor, as it appears in `drivers` and the breakdown. The GDELT
 *  term is named as article volume so press coverage never reads as a casualty count. */
export function factorLabel(key: FactorKey): string {
  return FACTOR_LABEL[key];
}

const TOTAL_WEIGHT = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
/** Suppress the noise floor — countries below this score aren't plotted. */
export const CII_MIN_SCORE = 8;
/** Fewer people displaced FROM a country than this is not a displacement signal. */
export const DISPLACEMENT_FLOOR = 10_000;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Raw factor value → 0..1 sub-score. Each ramp is documented and deliberately conservative. */
export function normalizeFactor(key: FactorKey, raw: number): number {
  if (!(raw > 0)) return 0;
  switch (key) {
    case "conflict":
      return clamp01((Math.log10(1 + raw) - 1) / 3); // fatalities, ~60 days
    case "severity":
      return clamp01(raw / 10); // INFORM Severity Index 1..10
    case "food":
      return clamp01(raw / 0.5); // share of the population in IPC 3+; 50%+ = max
    case "structural":
      return clamp01(raw); // already 0..1 (structuralBaseline)
    case "displacement":
      return clamp01(raw / 0.1); // displaced-from as a share of population; 10%+ = max
    case "attention":
      // Article volume. Hard-capped: "well covered by the press" is not "many people
      // died", so it can never alone push a country into "extreme" territory.
      return Math.min(0.55, clamp01(Math.log10(1 + raw) / 4.5));
    case "outages":
      return clamp01(raw / 4); // critical IODA alerts in 24 h
  }
}

/** Instability score → colour ramp (calm green → extreme dark-red). */
export function instabilityColor(score: number): string {
  if (score >= 85) return "#7f1d1d";
  if (score >= 70) return "#dc2626";
  if (score >= 50) return "#ea580c";
  if (score >= 30) return "#f59e0b";
  if (score >= 15) return "#eab308";
  return "#84cc16";
}

const FACTOR_COUNT = Object.keys(FACTOR_WEIGHTS).length; // 7 — the coverage denominator

export interface CountryInput {
  iso3: string;
  /** Raw factor values. A number (0 included) = the upstream measured this country.
   *  Absent = no data for it. */
  factors: Partial<Record<FactorKey, number>>;
}

/**
 * Pure: per-country raw factors → scored SignalFeature[] (one per country ≥ threshold).
 *
 * The score is always the conservative sum (factors without data count as 0, never
 * renormalised away). With every factor measured it is a composite measurement, shown
 * as a plain number. With any factor missing the same arithmetic is a FLOOR, and every
 * surface this function controls says so: a "≥" and "(floor, N/7 factors)" in the
 * title, "floor, not a full measurement" in `props.coverage`, and
 * `props.scoreBasis: "floor"`.
 */
export function computeInstability(inputs: CountryInput[]): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const row of inputs) {
    const ctr = centroidByIso3((row.iso3 ?? "").toUpperCase());
    if (!ctr) continue;

    let measured = 0;
    const contributions: { key: FactorKey; norm: number; weighted: number; label: string }[] = [];
    for (const key of Object.keys(FACTOR_WEIGHTS) as FactorKey[]) {
      const raw = row.factors[key];
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      measured++;
      const norm = normalizeFactor(key, raw);
      if (norm <= 0) continue;
      contributions.push({ key, norm, weighted: norm * FACTOR_WEIGHTS[key], label: factorLabel(key) });
    }
    if (contributions.length === 0) continue; // nothing above zero: no defensible score, no feature

    const score = Math.round((contributions.reduce((a, c) => a + c.weighted, 0) / TOTAL_WEIGHT) * 100);
    if (score < CII_MIN_SCORE) continue;

    const fullCoverage = measured === FACTOR_COUNT;
    const coverage = fullCoverage
      ? `${measured}/${FACTOR_COUNT} factors`
      : `${measured}/${FACTOR_COUNT} factors — floor, not a full measurement (missing factors count as 0)`;

    const drivers = [...contributions].sort((a, b) => b.weighted - a.weighted).map((c) => c.label);

    const breakdown: Record<string, string> = {};
    for (const c of contributions) breakdown[c.label] = `${Math.round(c.norm * 100)}%`;

    const title = fullCoverage
      ? `${ctr.name} — instability ${score}/100`
      : `${ctr.name} — instability ≥${score}/100 (floor, ${measured}/${FACTOR_COUNT} factors)`;

    out.push({
      id: `cii:${ctr.iso3}`,
      lat: ctr.lat,
      lon: ctr.lon,
      title,
      signalId: "instability",
      countryIso3: ctr.iso3,
      color: instabilityColor(score),
      props: {
        country: ctr.name,
        score,
        // Machine-readable companion to the prose above — "floor" means this
        // score is a lower bound (partial coverage), not a measurement.
        scoreBasis: fullCoverage ? "measured" : "floor",
        coverageFactors: measured,
        drivers: drivers.join(" › "),
        ...breakdown,
        coverage,
        magnitude: Math.min(10, Math.max(2, score / 10)),
      },
    });
  }
  // Densest pressure first (helps the dossier list + any "top N" consumer).
  return out.sort((a, b) => Number(b.props?.score ?? 0) - Number(a.props?.score ?? 0));
}

// --- factor collection (thin, dormant-safe fetches) -------------------------

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** name → ISO-3, for matching upstream country names (built once from the centroid set).
 *  Now used only by iso3FromGdeltPlace(); it predates that and was written for ACLED. */
const NAME_TO_ISO3 = (() => {
  const m = new Map<string, string>();
  for (const c of COUNTRY_CENTROIDS) m.set(c.name.toLowerCase(), c.iso3);
  // A few upstream spellings that differ from the centroid dataset.
  const alias: Record<string, string> = {
    "democratic republic of congo": "COD",
    "democratic republic of the congo": "COD",
    "republic of congo": "COG",
    "syria": "SYR",
    "russia": "RUS",
    "iran": "IRN",
    "tanzania": "TZA",
    "bolivia": "BOL",
    "venezuela": "VEN",
    "moldova": "MDA",
    "laos": "LAO",
    "south korea": "KOR",
    "north korea": "PRK",
    "vietnam": "VNM",
    "myanmar": "MMR",
  };
  for (const [k, v] of Object.entries(alias)) if (!m.has(k)) m.set(k, v);
  return m;
})();

function iso3ByName(name: string | undefined): string | undefined {
  const n = (name ?? "").trim().toLowerCase();
  return n ? NAME_TO_ISO3.get(n) : undefined;
}

/**
 * GDELT country-name spellings that don't literally match our centroid dataset
 * (which mostly follows ISO 3166 long-forms). Checked before falling back to
 * `iso3ByName`/NAME_TO_ISO3 in `iso3FromGdeltPlace` below. Found by aggregating
 * a real 300-feature prod sample of /api/signals/conflict on 2026-08-11 and
 * diffing its trailing place tokens against the centroid names.
 */
const GDELT_NAME_ALIAS: Record<string, string> = {
  libya: "LBY", // centroid name is "Libyan Arab Jamahiriya"
  taiwan: "TWN", // centroid name is "Taiwan, Province of China"
  "west bank": "PSE",
  "gaza strip": "PSE",
  palestine: "PSE",
  "vietnam, republic of": "VNM", // GDELT's historical GNS entry (former South Vietnam)
};

/**
 * GDELT's ActionGeo_FullName is "City, ADM1, Country" (or a bare "Country").
 * The country is usually the LAST comma-separated segment, but a few official
 * ISO long-forms embed a comma inside the country name itself (e.g. the
 * centroid dataset's own "Korea, Republic of"), so this tries the longest
 * plausible suffix first (up to 3 comma-separated segments) and shortens until
 * something resolves, rather than assuming exactly one segment.
 */
export function iso3FromGdeltPlace(place: string): string | undefined {
  const parts = (place ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (let take = Math.min(3, parts.length); take >= 1; take--) {
    const candidate = parts.slice(parts.length - take).join(", ");
    const alias = GDELT_NAME_ALIAS[candidate.toLowerCase()];
    if (alias) return alias;
    const iso = iso3ByName(candidate);
    if (iso) return iso;
  }
  return undefined;
}

async function getJson<T>(url: string, ms = 18_000): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** One country row of FEWS NET's `ipcpopulationsize` endpoint (fields=simple). */
export interface FewsPopulationRow {
  country_code?: string;
  phase?: string;
  scenario?: string;
  reporting_date?: string;
  pct_population_min?: number | string | null;
  pct_population_max?: number | string | null;
}

/**
 * Pure: FEWS NET country rows → share of the population (0..1) in IPC phase 3 or worse,
 * by ISO-3. Only the "Current Situation" (CS) scenario counts, and per country only the
 * newest reporting month. FEWS NET publishes the share as a band ("45 to 50 %"), so the
 * value is the band's midpoint. A row without a band is skipped, never guessed.
 */
export function foodFromFewsNet(rows: FewsPopulationRow[]): Map<string, number> {
  const newest = new Map<string, { date: string; share: number }>();
  for (const r of rows ?? []) {
    if (r?.phase !== "3+" || r?.scenario !== "CS") continue;
    const c = centroidByIso2(String(r.country_code ?? "").toUpperCase());
    const lo = Number(r.pct_population_min);
    const hi = Number(r.pct_population_max);
    const date = String(r.reporting_date ?? "");
    if (!c || !date || r.pct_population_min == null || r.pct_population_max == null) continue;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) continue;
    const prev = newest.get(c.iso3);
    if (prev && prev.date >= date) continue;
    newest.set(c.iso3, { date, share: (lo + hi) / 200 });
  }
  const out = new Map<string, number>();
  for (const [iso3, v] of newest) if (v.share > 0) out.set(iso3, v.share);
  return out;
}

/** Days of FEWS NET reports to ask for. Country briefs come monthly; 150 days reaches
 *  the last brief of a country that skipped a few months. */
const FEWS_WINDOW_DAYS = 150;

/**
 * Food insecurity by ISO-3: the share of each country's population in IPC phase 3+
 * (Crisis or worse), from FEWS NET. Keyless. The country-level endpoint is ~0.3 MB;
 * the per-area `ipcphase` endpoint the audit first named is ~26 MB and ~45 s for the
 * same window, so this reads the country figure FEWS NET itself publishes.
 * Replaced WFP HungerMap on 2026-10-16: its keyless URL answers 401.
 */
async function foodFactor(): Promise<Map<string, number> | null> {
  const end = new Date();
  const start = new Date(end.getTime() - FEWS_WINDOW_DAYS * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const json = await getJson<FewsPopulationRow[]>(
    `https://fdw.fews.net/api/ipcpopulationsize/?format=json&fields=simple&start_date=${day(start)}&end_date=${day(end)}`,
    30_000,
  );
  return Array.isArray(json) ? foodFromFewsNet(json) : null;
}

/**
 * The outage factor's raw value for a verified shutdown: the top of the outages ramp
 * (raw / 4, so 4 = 1).
 */
export const VERIFIED_SHUTDOWN_RAW = 4;

/**
 * Internet outages by ISO-3: IODA CRITICAL country alerts in the last 24 h, plus a
 * shutdown the Internet Society's Pulse has verified (or the government has
 * acknowledged). The verified shutdown is the thing this factor exists to track
 * (crackdowns, not cable cuts), so it takes the top of the ramp. Unconfirmed Pulse
 * rows do not move the index. Pulse is read through the internet-outages layer, which
 * holds its read for 6 h and stays empty while ISOC_PULSE_API_KEY is unset.
 */
async function outageFactor(): Promise<Map<string, number> | null> {
  const [alerts, layer] = await Promise.all([
    fetchIodaCriticalAlerts(),
    INTERNET_OUTAGES_SOURCE.fetch().catch((): SignalFeature[] => []),
  ]);
  const shutdowns = layer.filter(isVerifiedShutdown);
  if (!alerts && shutdowns.length === 0) return null;
  const out = new Map(alerts ?? []);
  for (const f of shutdowns) {
    const iso3 = centroidByIso2(String(f.props?.countryCode ?? ""))?.iso3;
    if (iso3) out.set(iso3, Math.max(out.get(iso3) ?? 0, VERIFIED_SHUTDOWN_RAW));
  }
  return out;
}

/**
 * Attention factor: sums GDELT's already-normalised conflict layer (CAMEO 18/19/20,
 * QuadClass 4) per country, by article volume. Reuses `CONFLICT_SOURCE.fetch()` — the
 * same fetch, window cache and normaliser the `conflict` map layer uses. Until
 * 2026-10-16 this was the whole 0.40 conflict factor; UCDP fatalities are now.
 */
export function conflictArticlesByIso3(feats: SignalFeature[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of feats) {
    if (f.props?.status === "unavailable") continue; // the dormant-notice placeholder, not an event
    // Since PR #96 (2026-08-14) the conflict layer emits ONE feature per country, with
    // `countryIso3` and `props.country` and no `props.place`. Reading `place` alone made
    // every feature resolve to no country, so this factor fed nothing on prod (0 of 172
    // rows, measured 2026-10-16). `place` stays as the last fallback for a per-place shape.
    const iso3 =
      (typeof f.countryIso3 === "string" ? centroidByIso3(f.countryIso3.toUpperCase())?.iso3 : undefined) ??
      (typeof f.props?.country === "string" ? centroidByName(f.props.country)?.iso3 : undefined) ??
      iso3FromGdeltPlace(String(f.props?.place ?? ""));
    const articles = Number(f.props?.articles ?? 0);
    if (iso3 && articles > 0) out.set(iso3, (out.get(iso3) ?? 0) + articles);
  }
  return out;
}

/** People displaced FROM each country (refugees + asylum-seekers + IDPs + oip), by
 *  ISO-3, from UNHCR origin stats. Null when UNHCR could not be read. */
async function displacedFromFactor(): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  const year = new Date().getUTCFullYear() - 1;
  type Row = { coo_iso?: string; refugees?: number | string; asylum_seekers?: number | string; idps?: number | string; oip?: number | string };
  const fetchYear = async (y: number) =>
    getJson<{ items?: Row[] }>(`https://api.unhcr.org/population/v1/population/?limit=1000&yearFrom=${y}&yearTo=${y}&coo_all=true`);
  let json = await fetchYear(year);
  if (!json?.items?.length) json = await fetchYear(year - 1); // latest year may be unpublished
  if (!json?.items?.length) return null;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  for (const r of json.items) {
    const iso3 = (r.coo_iso ?? "").toUpperCase();
    if (!centroidByIso3(iso3)) continue; // drop aggregate rows ("-", "UNK", …)
    const total = num(r.refugees) + num(r.asylum_seekers) + num(r.idps) + num(r.oip);
    if (total > 0) out.set(iso3, (out.get(iso3) ?? 0) + total);
  }
  return out;
}

/**
 * Pure: people displaced FROM each country + population → displaced share (0..1+).
 * UNHCR reports every country of origin, so a country with a population and no row,
 * or fewer than DISPLACEMENT_FLOOR people, is a measured 0. A country with no
 * population figure gets no value (it cannot be made a share).
 */
export function displacementShare(displaced: Map<string, number>, population: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [iso3, pop] of population) {
    if (!(pop > 0)) continue;
    const n = displaced.get(iso3) ?? 0;
    out.set(iso3, n >= DISPLACEMENT_FLOOR ? n / pop : 0);
  }
  return out;
}

/**
 * Merge the per-factor maps into one CountryInput list keyed by ISO-3. A `global`
 * factor's upstream measures every country, so a country it does not list gets a
 * measured 0 for it (UCDP with no deaths there, INFORM Severity with no crisis there).
 */
export function mergeFactors(maps: { key: FactorKey; values: Map<string, number>; global?: boolean }[]): CountryInput[] {
  const byIso = new Map<string, CountryInput>();
  for (const { key, values } of maps) {
    for (const [iso3, raw] of values) {
      let row = byIso.get(iso3);
      if (!row) {
        row = { iso3, factors: {} };
        byIso.set(iso3, row);
      }
      row.factors[key] = raw;
    }
  }
  for (const { key, global } of maps) {
    if (!global) continue;
    for (const row of byIso.values()) if (row.factors[key] === undefined) row.factors[key] = 0;
  }
  return [...byIso.values()];
}

// --- slow inputs: cached, last-good on failure --------------------------------

const HOUR = 60 * 60 * 1000;
const memo = new Map<string, { at: number; value: Map<string, number> }>();

/** Serve a slow input from memory for `ttl`, refresh after, keep the last good copy
 *  when a refresh fails. Monthly and annual files do not need an hourly download. */
async function cached(key: string, ttl: number, load: () => Promise<Map<string, number> | null>): Promise<Map<string, number> | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  let value: Map<string, number> | null = null;
  try {
    value = await load();
  } catch {
    value = null;
  }
  if (value && value.size > 0) {
    memo.set(key, { at: Date.now(), value });
    return value;
  }
  return hit?.value ?? null;
}

async function attentionFactor(): Promise<Map<string, number> | null> {
  const m = conflictArticlesByIso3(await CONFLICT_SOURCE.fetch());
  return m.size ? m : null;
}

export const INSTABILITY_SOURCE: SignalSource = {
  // Not a map layer — see `dataOnly` in lib/signals/types.ts. Still fetched by the
  // Brief, the Country Instability widget, the Strategic Risk panel and the dossier.
  dataOnly: true,
  id: "instability",
  // A composite score for each country.
  precision: "country",
  label: "Country Instability Index",
  group: "Synthesis",
  color: "#dc2626",
  refreshMs: 60 * 60 * 1000, // GDELT and IODA move hourly; the slow inputs are cached
  attribution:
    "Composite — UCDP Candidate GED (CC BY 4.0) · INFORM Severity and INFORM Risk (EC JRC, CC BY 4.0) · FEWS NET (IPC population in phase 3+) · World Bank WGI and population (CC BY 4.0) · UNHCR (CC BY 4.0) · GDELT article volume · IODA",
  metric: { field: "score", domain: [0, 100] }, // 0-100 composite → ranked score bar (green→dark-red)
  async fetch() {
    try {
      const [conflict, severity, food, inform, wgi, displacedFrom, population, attention, outages] = await Promise.all([
        cached("ucdp", 24 * HOUR, fetchUcdpFatalities),
        cached("inform-severity", 24 * HOUR, fetchInformSeverity),
        cached("fews", 12 * HOUR, foodFactor),
        cached("inform-risk", 24 * HOUR, fetchInformRisk),
        cached("wgi", 24 * HOUR, fetchWgiPoliticalStability),
        cached("unhcr-origin", 24 * HOUR, displacedFromFactor),
        cached("population", 24 * HOUR, fetchPopulation),
        attentionFactor(),
        outageFactor(),
      ]);
      const structural = inform || wgi ? structuralBaseline(inform, wgi) : null;
      const displacement = displacedFrom && population ? displacementShare(displacedFrom, population) : null;
      const maps: { key: FactorKey; values: Map<string, number> | null; global?: boolean }[] = [
        { key: "conflict", values: conflict, global: true },
        { key: "severity", values: severity, global: true },
        { key: "food", values: food },
        { key: "structural", values: structural },
        { key: "displacement", values: displacement },
        { key: "attention", values: attention, global: true },
        { key: "outages", values: outages, global: true },
      ];
      const inputs = mergeFactors(
        maps.filter((m): m is { key: FactorKey; values: Map<string, number>; global?: boolean } => !!m.values),
      );
      // Not one country row from ANY upstream: a dead composite, not a calm world.
      if (inputs.length === 0) return degraded("no upstream data");
      return observed(computeInstability(inputs));
    } catch {
      return degraded("fetch failed");
    }
  },
};

/** Resolve a country centroid from an ISO-3 (re-exported for any CII consumer). */
export function centroidForCii(iso3: string): CountryCentroid | undefined {
  return centroidByIso3(iso3.toUpperCase());
}
