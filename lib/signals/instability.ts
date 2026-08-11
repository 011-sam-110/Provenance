import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { COUNTRY_CENTROIDS, centroidByIso2, centroidByIso3, type CountryCentroid } from "@/lib/signals/country-centroids.data";
import { ACLED_SOURCE } from "@/lib/signals/acled";
import { CONFLICT_SOURCE } from "@/lib/signals/gdelt";

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
//   conflict (ACLED fatalities, 30d)   0.40   — the strongest signal, but ACLED
//                                                 is key-gated (dormant with no
//                                                 creds, or a 403 until the
//                                                 account is activated). When
//                                                 ACLED has nothing this cycle,
//                                                 the factor falls back to GDELT
//                                                 (keyless, article-volume of its
//                                                 own conflict layer, CAMEO
//                                                 18/19/20 QuadClass 4) — see
//                                                 conflictFactor() below. GDELT is
//                                                 a WEAKER, noisier proxy (media
//                                                 coverage volume, not casualties
//                                                 — confounded by media-market
//                                                 size; measured 2026-08-11 its
//                                                 raw top country was the United
//                                                 States on domestic-enforcement
//                                                 coverage, not a war zone), so it
//                                                 is normalised on a dampened,
//                                                 HARD-CAPPED ramp that can never
//                                                 alone claim "extreme" the way an
//                                                 ACLED fatality count can, and
//                                                 every score it touches is
//                                                 labelled with its source.
//   food insecurity (WFP prevalence)   0.25   — acute hunger, instability accelerant
//   displacement-from (UNHCR origin)   0.25   — people displaced FROM the country
//   internet outages (IODA severity)   0.10   — shutdowns track unrest/crackdowns
// ============================================================================

export type FactorKey = "conflict" | "food" | "displacement" | "outages";
/** Which upstream produced the `conflict` raw value. Governs both its
 *  normalisation ramp and its label in the breakdown. */
export type ConflictSource = "acled" | "gdelt";

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

/** Human label for a factor, source-aware: the GDELT conflict fallback is
 *  named explicitly so a reader never mistakes an article-volume proxy for
 *  the ACLED fatality count it stands in for. */
export function factorLabel(key: FactorKey, conflictSource: ConflictSource = "acled"): string {
  if (key === "conflict" && conflictSource === "gdelt") return "armed conflict (GDELT article-volume proxy)";
  return FACTOR_LABEL[key];
}

const TOTAL_WEIGHT = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
/** Suppress the noise floor — countries below this score aren't plotted. */
export const CII_MIN_SCORE = 8;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Raw factor value → 0..1 sub-score. Each ramp is documented and deliberately conservative. */
export function normalizeFactor(key: FactorKey, raw: number, conflictSource: ConflictSource = "acled"): number {
  if (!(raw > 0)) return 0;
  switch (key) {
    case "food":
      return clamp01(raw / 0.5); // prevalence; 50%+ of the population insecure = max
    case "displacement":
      return clamp01(Math.log10(1 + raw) / 7); // people displaced-from; ~10M = max
    case "outages":
      return clamp01(Math.log10(1 + raw) / 6); // IODA severity score; ~1e6 = max
    case "conflict":
      if (conflictSource === "gdelt") {
        // Article-volume proxy, summed per country from GDELT's own conflict
        // layer (see gdeltConflictFactor()). Looser ramp (needs more evidence
        // to move) AND hard-capped below the ACLED ceiling — "well covered by
        // the press" is not "many people died", so this can never alone push a
        // country into "extreme" territory the way a fatality count can.
        return Math.min(0.55, clamp01(Math.log10(1 + raw) / 4.5));
      }
      return clamp01(Math.log10(1 + raw) / 3); // ACLED fatalities/30d; ~1000 = max
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
   *  "acled" when omitted (e.g. synthetic fixtures), matching the original
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

    const conflictSource = row.conflictSource ?? "acled";
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

/** name → ISO-3, for matching ACLED's country names (built once from the centroid set). */
const NAME_TO_ISO3 = (() => {
  const m = new Map<string, string>();
  for (const c of COUNTRY_CENTROIDS) m.set(c.name.toLowerCase(), c.iso3);
  // A few ACLED spellings that differ from the centroid dataset.
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

/** Food-insecurity prevalence (0..1) by ISO-3, from WFP HungerMap. */
async function foodFactor(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const json = await getJson<{ body?: { countries?: { country?: { iso3?: string }; metrics?: { fcs?: { prevalence?: number } } }[] } }>(
    "https://api.hungermapdata.org/v1/foodsecurity/country",
  );
  for (const c of json?.body?.countries ?? []) {
    const iso3 = (c.country?.iso3 ?? "").toUpperCase();
    const p = c.metrics?.fcs?.prevalence;
    if (iso3 && typeof p === "number" && p > 0) out.set(iso3, p);
  }
  return out;
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

/** Internet-outage severity by ISO-3, from IODA's country summary. */
async function outageFactor(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const until = Math.floor(Date.now() / 1000);
  const from = until - 24 * 3600;
  const json = await getJson<{ data?: { scores?: { overall?: number }; entity?: { code?: string; type?: string } }[] }>(
    `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/summary?from=${from}&until=${until}&entityType=country&limit=200`,
  );
  for (const r of json?.data ?? []) {
    if (r.entity?.type !== "country") continue;
    const c = centroidByIso2((r.entity?.code ?? "").toUpperCase());
    const score = r.scores?.overall;
    if (c && typeof score === "number" && score > 0) out.set(c.iso3, (out.get(c.iso3) ?? 0) + score);
  }
  return out;
}

/** Conflict fatalities (30d) by ISO-3, from the ACLED adapter (dormant → empty). */
async function acledConflictFactor(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const feats = await ACLED_SOURCE.fetch();
  for (const f of feats) {
    const iso3 = iso3ByName(f.props?.country as string | undefined);
    const fatalities = Number(f.props?.fatalities ?? 0);
    if (iso3 && fatalities > 0) out.set(iso3, (out.get(iso3) ?? 0) + fatalities);
  }
  return out;
}

/**
 * Conflict fallback: sums GDELT's already-normalised conflict layer (CAMEO
 * 18/19/20, QuadClass 4) per country, by article volume. Reuses
 * `CONFLICT_SOURCE.fetch()` — the same fetch, window cache and normaliser the
 * standalone `conflict` map layer uses — rather than a second GDELT fetcher.
 * Keyless, so this is what keeps the 0.40 conflict weight alive while ACLED's
 * account is not yet activated.
 */
async function gdeltConflictFactor(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const feats = await CONFLICT_SOURCE.fetch();
  for (const f of feats) {
    if (f.props?.status === "unavailable") continue; // the dormant-notice placeholder, not an event
    const iso3 = iso3FromGdeltPlace(String(f.props?.place ?? ""));
    const articles = Number(f.props?.articles ?? 0);
    if (iso3 && articles > 0) out.set(iso3, (out.get(iso3) ?? 0) + articles);
  }
  return out;
}

/**
 * Conflict raw values by ISO-3, plus which upstream produced them. ACLED is
 * tried first; when it returns ANY country data it is used for the WHOLE
 * cycle — mixing fatality-scaled ACLED numbers for some countries with
 * article-volume-scaled GDELT numbers for others in the same run would make
 * the ranking internally incomparable. Only when ACLED comes back completely
 * empty (no creds, or the account not yet activated — both resolve to a bare
 * `[]`, indistinguishable from "genuinely zero global conflict this cycle",
 * which does not happen) does GDELT stand in, for every country, this cycle.
 */
async function conflictFactor(): Promise<{ values: Map<string, number>; source: ConflictSource }> {
  const acled = await acledConflictFactor();
  if (acled.size > 0) return { values: acled, source: "acled" };
  return { values: await gdeltConflictFactor(), source: "gdelt" };
}

/** Merge the per-factor maps into one CountryInput list keyed by ISO-3. */
export function mergeFactors(
  maps: { key: FactorKey; values: Map<string, number> }[],
  conflictSource: ConflictSource = "acled",
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
  id: "instability",
  label: "Country Instability Index",
  group: "Synthesis",
  color: "#dc2626",
  refreshMs: 60 * 60 * 1000, // composite of slow-moving inputs; hourly is ample
  attribution: "Composite — ACLED (or GDELT article-volume fallback) · WFP HungerMap · UNHCR · IODA",
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
      return computeInstability(inputs);
    } catch {
      return [];
    }
  },
};

/** Resolve a country centroid from an ISO-3 (re-exported for any CII consumer). */
export function centroidForCii(iso3: string): CountryCentroid | undefined {
  return centroidByIso3(iso3.toUpperCase());
}
