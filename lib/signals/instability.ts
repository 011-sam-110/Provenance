import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { COUNTRY_CENTROIDS, centroidByIso2, centroidByIso3, centroidByName, type CountryCentroid } from "@/lib/signals/country-centroids.data";
import { CONFLICT_SOURCE } from "@/lib/signals/gdelt";
import { INTERNET_OUTAGES_SOURCE } from "@/lib/signals/internet-outages";
import { isVerifiedShutdown } from "@/lib/signals/pulse-shutdowns";
import { degraded, observed } from "@/lib/signals/outcome";

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
//   • CONSERVATIVE. A missing factor contributes 0 (denominator is the full
//     weight set), so sparse data UNDER-states rather than crying wolf. We show
//     factor coverage ("3/4 factors") so the user sees the basis — AND, when
//     coverage is partial, the score is presented as an explicit FLOOR (title
//     gets a "≥", `props.scoreBasis` is "floor" not "measured") rather than a
//     plain number that could pass for a full-coverage measurement. A missing
//     factor still counts as 0 (nothing is renormalised away), so this stays a
//     lower bound: the true pressure can only be equal or higher.
//   • SHOWS ITS WORK. Every country lists each factor's contribution and the top
//     drivers. No black box — you can see exactly why a score is what it is.
//
// Factors (each normalised to 0..1, then weighted):
//   conflict (GDELT article volume)   0.40   — the heaviest weight, and the
//                                                 weakest evidence, which is why it
//                                                 is capped. Sums GDELT's own
//                                                 conflict layer (CAMEO 18/19/20,
//                                                 QuadClass 4) per country. This is
//                                                 MEDIA COVERAGE VOLUME, not
//                                                 casualties, and it is confounded
//                                                 by media-market size — measured
//                                                 2026-08-11 its raw top country was
//                                                 the United States, on domestic-
//                                                 enforcement coverage, not a war
//                                                 zone. So it runs on a dampened,
//                                                 HARD-CAPPED ramp (max 0.55) that
//                                                 can never alone claim "extreme".
//                                                 ACLED used to supply this factor
//                                                 as a fatality count and was
//                                                 removed on 2026-09-05: the account
//                                                 issues a valid OAuth token and
//                                                 then answers 403 to every read, so
//                                                 it had already been falling
//                                                 through to GDELT on every cycle.
//                                                 Deleting it changed no score.
//   food insecurity (FEWS NET IPC 3+)  0.25   — share of the population in IPC phase 3
//                                                 or worse (acute hunger). WFP HungerMap
//                                                 supplied this until its keyless URL
//                                                 began answering 401.
//   displacement-from (UNHCR origin)   0.25   — people displaced FROM the country
//   internet outages (IODA severity)   0.10   — shutdowns track unrest/crackdowns
// ============================================================================

export type FactorKey = "conflict" | "food" | "displacement" | "outages";
/** Which upstream produced the `conflict` raw value. GDELT is the only one left
 *  (ACLED removed 2026-09-05, see the header) — the type is kept as a named
 *  one-member union so the breakdown keeps labelling the proxy explicitly, and so
 *  adding a real fatality source back is a widening rather than a re-plumbing. */
export type ConflictSource = "gdelt";

export const FACTOR_WEIGHTS: Record<FactorKey, number> = {
  conflict: 0.4,
  food: 0.25,
  displacement: 0.25,
  outages: 0.1,
};

const FACTOR_LABEL: Record<FactorKey, string> = {
  conflict: "armed conflict",
  food: "food insecurity",
  displacement: "displacement",
  outages: "internet outages",
};

/** Human label for a factor. The conflict factor is named explicitly as an
 *  article-volume proxy so a reader never mistakes press coverage for a
 *  casualty count. */
export function factorLabel(key: FactorKey, conflictSource: ConflictSource = "gdelt"): string {
  if (key === "conflict" && conflictSource === "gdelt") return "armed conflict (GDELT article-volume proxy)";
  return FACTOR_LABEL[key];
}

const TOTAL_WEIGHT = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
/** Suppress the noise floor — countries below this score aren't plotted. */
export const CII_MIN_SCORE = 8;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Raw factor value → 0..1 sub-score. Each ramp is documented and deliberately conservative. */
export function normalizeFactor(key: FactorKey, raw: number, conflictSource: ConflictSource = "gdelt"): number {
  if (!(raw > 0)) return 0;
  switch (key) {
    case "food":
      return clamp01(raw / 0.5); // share of the population in IPC 3+; 50%+ = max
    case "displacement":
      return clamp01(Math.log10(1 + raw) / 7); // people displaced-from; ~10M = max
    case "outages":
      return clamp01(Math.log10(1 + raw) / 6); // IODA severity score; ~1e6 = max
    case "conflict":
      // Article-volume proxy, summed per country from GDELT's own conflict layer
      // (see gdeltConflictFactor()). Looser ramp (needs more evidence to move) AND
      // hard-capped — "well covered by the press" is not "many people died", so this
      // can never alone push a country into "extreme" territory. The cap is why the
      // index tops out well below 100 on today's inputs; that is the ramp being
      // honest, not a bug to tune away.
      return Math.min(0.55, clamp01(Math.log10(1 + raw) / 4.5));
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

const FACTOR_COUNT = Object.keys(FACTOR_WEIGHTS).length; // 4 — the coverage denominator

export interface CountryInput {
  iso3: string;
  /** Raw factor values (prevalence 0..1 for food; counts otherwise). Absent = no data. */
  factors: Partial<Record<FactorKey, number>>;
  /** Which upstream produced `factors.conflict`, when present. Defaults to
   *  "gdelt" when omitted (e.g. synthetic fixtures), matching the only
   *  single-source behaviour. Ignored when there is no conflict factor. */
  conflictSource?: ConflictSource;
}

/**
 * Pure: per-country raw factors → scored SignalFeature[] (one marker per country ≥ threshold).
 *
 * COVERAGE HONESTY: the score is always the conservative sum (missing factors
 * count as 0, never renormalised away — see the design-principles note at the
 * top of the file). When coverage is FULL (4/4 factors), that sum is a real
 * composite measurement and is presented as a plain number. When coverage is
 * PARTIAL, the identical arithmetic instead yields a FLOOR — a lower bound on
 * a number we could not fully measure — and every surface this function
 * controls says so explicitly: the title gets a "≥" and a "(floor, N/4
 * factors)" suffix, `props.coverage` spells out "floor, not a full
 * measurement", and `props.scoreBasis` carries a machine-readable
 * "measured" | "floor" tag. A reader (or a downstream consumer that only
 * prints `props.score`) still sees the same digit either way, but nothing
 * this module emits calls a floor a measurement.
 */
export function computeInstability(inputs: CountryInput[]): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const row of inputs) {
    const ctr = centroidByIso3((row.iso3 ?? "").toUpperCase());
    if (!ctr) continue;

    const conflictSource = row.conflictSource ?? "gdelt";
    const contributions: { key: FactorKey; norm: number; weighted: number; label: string }[] = [];
    for (const key of Object.keys(FACTOR_WEIGHTS) as FactorKey[]) {
      const raw = row.factors[key];
      if (typeof raw !== "number" || !(raw > 0)) continue;
      const norm = key === "conflict" ? normalizeFactor(key, raw, conflictSource) : normalizeFactor(key, raw);
      if (norm <= 0) continue;
      contributions.push({ key, norm, weighted: norm * FACTOR_WEIGHTS[key], label: factorLabel(key, conflictSource) });
    }
    if (contributions.length === 0) continue; // zero coverage: no defensible score, no feature

    // Conservative: divide by the FULL weight set, so missing factors pull the
    // score down rather than being silently renormalised away.
    const score = Math.round((contributions.reduce((a, c) => a + c.weighted, 0) / TOTAL_WEIGHT) * 100);
    if (score < CII_MIN_SCORE) continue;

    const fullCoverage = contributions.length === FACTOR_COUNT;
    const coverage = fullCoverage
      ? `${contributions.length}/${FACTOR_COUNT} factors`
      : `${contributions.length}/${FACTOR_COUNT} factors — floor, not a full measurement (missing factors count as 0)`;

    const drivers = [...contributions].sort((a, b) => b.weighted - a.weighted).map((c) => c.label);

    const breakdown: Record<string, string> = {};
    for (const c of contributions) breakdown[c.label] = `${Math.round(c.norm * 100)}%`;

    const title = fullCoverage
      ? `${ctr.name} — instability ${score}/100`
      : `${ctr.name} — instability ≥${score}/100 (floor, ${contributions.length}/${FACTOR_COUNT} factors)`;

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
        coverageFactors: contributions.length,
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
async function foodFactor(): Promise<Map<string, number>> {
  const end = new Date();
  const start = new Date(end.getTime() - FEWS_WINDOW_DAYS * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const json = await getJson<FewsPopulationRow[]>(
    `https://fdw.fews.net/api/ipcpopulationsize/?format=json&fields=simple&start_date=${day(start)}&end_date=${day(end)}`,
    30_000,
  );
  return foodFromFewsNet(Array.isArray(json) ? json : []);
}

/** People displaced FROM each country (refugees+asylum-seekers+IDPs), by ISO-3, from UNHCR origin stats. */
async function displacementFactor(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const year = new Date().getUTCFullYear() - 1;
  const fetchYear = async (y: number) =>
    getJson<{ items?: { coo_iso?: string; refugees?: number | string; asylum_seekers?: number | string; idps?: number | string }[] }>(
      `https://api.unhcr.org/population/v1/population/?limit=1000&yearFrom=${y}&yearTo=${y}&coo_all=true`,
    );
  let json = await fetchYear(year);
  if (!json?.items?.length) json = await fetchYear(year - 1); // latest year may be unpublished
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  for (const r of json?.items ?? []) {
    const iso3 = (r.coo_iso ?? "").toUpperCase();
    if (!centroidByIso3(iso3)) continue; // drop aggregate rows ("-", "UNK", …)
    const total = num(r.refugees) + num(r.asylum_seekers) + num(r.idps);
    if (total > 0) out.set(iso3, (out.get(iso3) ?? 0) + total);
  }
  return out;
}

/**
 * Internet-outage severity by ISO-3, from the internet-outages layer itself.
 *
 * It used to read IODA's /outages/summary on its own, which counted outages that had
 * ended many hours before and a prober burst that hit 52 countries at once (measured
 * 2026-10-16). Reading the layer gives this factor the same cleaned set the map
 * shows: current events only, bursts removed. The raw value is IODA's own score for
 * the country (the largest current event), the same quantity the ramp was built for,
 * or VERIFIED_SHUTDOWN_RAW (the top of the ramp) for a verified Pulse shutdown.
 */
export const VERIFIED_SHUTDOWN_RAW = 1e6;

async function outageFactor(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const f of await INTERNET_OUTAGES_SOURCE.fetch()) {
    // A shutdown Pulse has confirmed or the government has acknowledged is the thing
    // this factor exists to track (crackdowns, not cable cuts), so it takes the top
    // of the ramp. Unconfirmed Pulse rows do not move the index.
    if (isVerifiedShutdown(f)) {
      const iso3 = centroidByIso2(String(f.props?.countryCode ?? ""))?.iso3;
      if (iso3) out.set(iso3, Math.max(out.get(iso3) ?? 0, VERIFIED_SHUTDOWN_RAW));
      continue;
    }
    if (f.props?.source != null) continue; // another tier's row, not an IODA score
    const iso3 = f.countryIso3;
    const score = Number(f.props?.outageScore ?? 0);
    if (iso3 && score > 0) out.set(iso3, Math.max(out.get(iso3) ?? 0, score));
  }
  return out;
}

/**
 * Conflict factor: sums GDELT's already-normalised conflict layer (CAMEO
 * 18/19/20, QuadClass 4) per country, by article volume. Reuses
 * `CONFLICT_SOURCE.fetch()` — the same fetch, window cache and normaliser the
 * standalone `conflict` map layer uses — rather than a second GDELT fetcher.
 * Keyless, and since ACLED's removal this is the sole provider of the 0.40 weight.
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

async function gdeltConflictFactor(): Promise<Map<string, number>> {
  return conflictArticlesByIso3(await CONFLICT_SOURCE.fetch());
}

/** Conflict raw values by ISO-3, plus the upstream that produced them (always GDELT
 *  since ACLED's removal — the shape is kept so the breakdown still names its source). */
async function conflictFactor(): Promise<{ values: Map<string, number>; source: ConflictSource }> {
  return { values: await gdeltConflictFactor(), source: "gdelt" };
}

/** Merge the per-factor maps into one CountryInput list keyed by ISO-3. */
export function mergeFactors(
  maps: { key: FactorKey; values: Map<string, number> }[],
  conflictSource: ConflictSource = "gdelt",
): CountryInput[] {
  const byIso = new Map<string, CountryInput>();
  for (const { key, values } of maps) {
    for (const [iso3, raw] of values) {
      let row = byIso.get(iso3);
      if (!row) {
        row = { iso3, factors: {} };
        byIso.set(iso3, row);
      }
      row.factors[key] = raw;
      if (key === "conflict") row.conflictSource = conflictSource;
    }
  }
  return [...byIso.values()];
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
  refreshMs: 60 * 60 * 1000, // composite of slow-moving inputs; hourly is ample
  attribution: "Composite — GDELT article volume · FEWS NET (IPC population in phase 3+) · UNHCR · IODA",
  metric: { field: "score", domain: [0, 100] }, // 0-100 composite → ranked score bar (green→dark-red)
  async fetch() {
    try {
      const [food, displacement, outages, conflict] = await Promise.all([
        foodFactor(),
        displacementFactor(),
        outageFactor(),
        conflictFactor(),
      ]);
      const inputs = mergeFactors(
        [
          { key: "food", values: food },
          { key: "displacement", values: displacement },
          { key: "outages", values: outages },
          { key: "conflict", values: conflict.values },
        ],
        conflict.source,
      );
      // Not one country row from ANY of the four factor upstreams. A partial read
      // is normal here and stays a floor (see the coverage note above), but zero
      // rows across all four is a dead composite, not a calm world.
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
