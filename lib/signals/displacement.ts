import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso2, centroidByIso3 } from "@/lib/signals/country-centroids.data";
import { countMagnitude, toNum } from "@/lib/signals/aggregate";
import { markCoverage } from "@/lib/signals/coverage";
import { degraded, observed } from "@/lib/signals/outcome";

// Forced displacement by country — keyless UNHCR population statistics API. One
// marker per country of asylum (ISO-3), summing the people it hosts or holds:
// refugees + asylum-seekers + internally-displaced + "other people in need of
// international protection" (oip) + Palestine refugees under UNRWA's mandate.
// Country-level data (no precise location), so the marker sits at the country
// centroid, sized by total displaced, with crisis badges over 1M / 500K.
//
// Two gaps were measured on 2026-10-16 and are closed here, from the same keyless API:
//   - oip was in the payload and left out of the total: 7.18M people, mostly
//     Venezuelans (Colombia read 1,464 refugees with an oip of 2,810,778).
//   - Palestine refugees are counted by UNRWA, not in the `population` endpoint, so
//     the layer had no Palestine marker at all and Jordan, Lebanon and Syria were
//     short by 5.96M in total. The `unrwa` endpoint fills that.
// Eurostat's monthly figures ride along on the European markers as props: the stock of
// people under temporary protection and the month's first-time asylum applicants. They
// are fresher than UNHCR's annual stock but are NOT added to it (a different count).
//
// Attribution follows UNHCR's dataset terms (clauses 3 and 4): the wording "UNHCR
// Refugee Population Statistics Database" and a link to the terms.

const ENDPOINT = "https://api.unhcr.org/population/v1/population/";
const UNRWA_ENDPOINT = "https://api.unhcr.org/population/v1/unrwa/";
const EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
/** Month-end stock of people under temporary protection (mostly from Ukraine). */
export const EUROSTAT_TP_URL = `${EUROSTAT}/migr_asytpsm?citizen=TOTAL&sex=T&age=TOTAL&unit=PER&lastTimePeriod=3`;
/** First-time asylum applicants in the month (a flow, not a stock). */
export const EUROSTAT_FIRST_TIME_URL = `${EUROSTAT}/migr_asyappctzm?citizen=TOTAL&sex=T&age=TOTAL&applicant=FRST&unit=PER&lastTimePeriod=3`;
export const UNHCR_TERMS_URL =
  "https://www.unhcr.org/what-we-do/data-and-publications/data-and-statistics/terms-use-datasets";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/**
 * The `limit=` this adapter asks UNHCR for. There is no local render cap — every
 * country of asylum we can place is drawn — but the request is PAGED, so a full
 * page means there are countries we never saw and the map's count is a lower
 * bound rather than a total. Measured 2026-08-10: year 2025 returns 178 rows on
 * `page 1` of `maxPages 1`, so the page is nowhere near saturated today; this
 * records that fact instead of assuming it will hold.
 */
export const UNHCR_PAGE_LIMIT = 1000;

export const UNHCR_ATTRIBUTION =
  "UNHCR Refugee Population Statistics Database (CC BY 4.0; terms: unhcr.org/what-we-do/data-and-publications/data-and-statistics/terms-use-datasets) · Eurostat (CC BY 4.0)";

interface UnRow {
  coa_iso?: string; // ISO-3 country of asylum
  coa_name?: string;
  refugees?: number | string;
  asylum_seekers?: number | string;
  idps?: number | string;
  stateless?: number | string;
  /** Other people in need of international protection (mostly Venezuelans). */
  oip?: number | string;
  year?: number;
}

/** One row of the UNHCR `unrwa` endpoint: Palestine refugees by country of asylum. */
interface UnrwaRow {
  coa_iso?: string;
  total?: number | string;
  year?: number;
}

/**
 * UNHCR's population statistics are a year-end snapshot, not a live count — the
 * `year` field IS the data's age, whatever moment we happen to fetch it. Stamped
 * to the last instant of that year (UTC) so a chip reading it says "data from
 * 2025", not "live", regardless of how fresh the fetch itself was.
 */
export function sourceAtForYear(year: number): number {
  return Date.UTC(year, 11, 31, 23, 59, 59, 999);
}

/** Amber→red ramp by total displaced. */
export function displacementColor(total: number): string {
  if (total >= 2_000_000) return "#7f1d1d";
  if (total >= 1_000_000) return "#b91c1c";
  if (total >= 250_000) return "#ea580c";
  if (total >= 50_000) return "#f59e0b";
  return "#fbbf24";
}

/**
 * Pure: UNHCR rows → one SignalFeature per country of asylum (with a known centroid).
 *
 * Publishes upstream coverage: `rows` is one PAGE of the population API, so a
 * saturated page (`rows.length >= limit`) means the layer is a sample of the
 * displacement picture and its count must not read as "every country".
 */
export function normalizeDisplacement(
  rows: UnRow[],
  limit = UNHCR_PAGE_LIMIT,
  unrwa: UnrwaRow[] = [],
): SignalFeature[] {
  const out: SignalFeature[] = [];
  // UNRWA by country of asylum. "UNK" and other non-countries have no centroid and drop.
  const unrwaBy = new Map<string, number>();
  for (const u of unrwa) {
    const iso3 = (u.coa_iso ?? "").toUpperCase();
    if (centroidByIso3(iso3) && toNum(u.total) > 0) unrwaBy.set(iso3, (unrwaBy.get(iso3) ?? 0) + toNum(u.total));
  }
  // A country UNRWA counts but the population endpoint has no row for (Palestine).
  const year = rows.find((r) => typeof r.year === "number")?.year ?? unrwa.find((u) => typeof u.year === "number")?.year;
  const seen = new Set(rows.map((r) => (r.coa_iso ?? "").toUpperCase()));
  const all: UnRow[] = [...rows];
  for (const iso3 of unrwaBy.keys()) if (!seen.has(iso3)) all.push({ coa_iso: iso3, ...(year ? { year } : {}) });
  for (const r of all) {
    const iso3 = (r.coa_iso ?? "").toUpperCase();
    const ctr = centroidByIso3(iso3);
    if (!ctr) continue; // skip aggregate/unknown rows ("-", "ZZZ", …)
    const refugees = toNum(r.refugees);
    const asylum = toNum(r.asylum_seekers);
    const idps = toNum(r.idps);
    const stateless = toNum(r.stateless);
    const oip = toNum(r.oip);
    const unrwaRefugees = unrwaBy.get(iso3) ?? 0;
    // Stateless people stay out of the total: statelessness is not displacement.
    const total = refugees + asylum + idps + oip + unrwaRefugees;
    if (total <= 0) continue; // nothing to plot
    const crisis = total >= 1_000_000 ? "over 1M" : total >= 500_000 ? "over 500K" : undefined;
    out.push({
      id: `displacement:${iso3}`,
      lat: ctr.lat,
      lon: ctr.lon,
      // "In", because the count is who is in this country (hosted + its own IDPs), not whose.
      title: `In ${ctr.name} — ${total.toLocaleString()} displaced`,
      signalId: "displacement",
      countryIso3: iso3,
      color: displacementColor(total),
      props: {
        country: ctr.name,
        totalDisplaced: total.toLocaleString(),
        displacedCount: total, // real numeric scalar (people) for the monitor bar

        refugees: refugees.toLocaleString(),
        asylumSeekers: asylum.toLocaleString(),
        idps: idps.toLocaleString(),
        ...(oip > 0 ? { otherInNeedOfProtection: oip.toLocaleString() } : {}),
        ...(unrwaRefugees > 0 ? { palestineRefugeesUnrwa: unrwaRefugees.toLocaleString() } : {}),
        stateless: stateless.toLocaleString(),
        ...(crisis ? { crisis } : {}),
        year: r.year ?? "—",
        magnitude: countMagnitude(total / 1000), // scale: thousands → ~0–10 radius
      },
    });
  }
  return markCoverage(out, {
    noun: "countries of asylum",
    rule: "the first page the UNHCR population API returned",
    upstream: { limit, count: rows.length },
  });
}

/**
 * Pure: a Eurostat JSON-stat 2.0 dataset with `geo` and `time` dimensions → the newest
 * month that has a value, per ISO-3 country. Aggregates (EU27_2020) and codes we
 * cannot place are skipped. Eurostat writes Greece as EL and the UK as UK.
 */
export function eurostatLatestByIso3(ds: unknown): Map<string, { value: number; month: string }> {
  const out = new Map<string, { value: number; month: string }>();
  const d = ds as {
    id?: string[];
    size?: number[];
    value?: Record<string, number>;
    dimension?: Record<string, { category?: { index?: Record<string, number> } }>;
  } | null;
  const ids = d?.id ?? [];
  const size = d?.size ?? [];
  const gi = ids.indexOf("geo");
  const ti = ids.indexOf("time");
  if (!d || gi < 0 || ti < 0 || size.length !== ids.length || !d.value) return out;
  const stride = size.map((_, i) => size.slice(i + 1).reduce((a, b) => a * b, 1));
  const geos = Object.entries(d.dimension?.geo?.category?.index ?? {});
  const times = Object.entries(d.dimension?.time?.category?.index ?? {}).sort((a, b) => b[1] - a[1]);
  const fix: Record<string, string> = { EL: "GR", UK: "GB" };
  for (const [code, g] of geos) {
    const c = centroidByIso2(fix[code] ?? code);
    if (!c) continue;
    for (const [month, t] of times) {
      const v = d.value[String(g * stride[gi] + t * stride[ti])];
      if (typeof v === "number" && Number.isFinite(v)) {
        out.set(c.iso3, { value: v, month });
        break;
      }
    }
  }
  return out;
}

/** Pure: put Eurostat's monthly figures on the markers of the countries they cover. */
export function attachEurostat(
  feats: SignalFeature[],
  tp: Map<string, { value: number; month: string }>,
  firstTime: Map<string, { value: number; month: string }>,
): SignalFeature[] {
  for (const f of feats) {
    const iso3 = f.countryIso3 ?? "";
    const a = tp.get(iso3);
    const b = firstTime.get(iso3);
    if (!a && !b) continue;
    f.props = {
      ...f.props,
      ...(a ? { tempProtectionNow: a.value.toLocaleString(), tempProtectionMonth: a.month } : {}),
      ...(b ? { firstTimeAsylumApplicants: b.value.toLocaleString(), firstTimeApplicantsMonth: b.month } : {}),
    };
  }
  return feats;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The extras (UNRWA, Eurostat) never fail the layer: a missing one leaves its props off. */
async function fetchUnrwa(year: number): Promise<UnrwaRow[]> {
  const j = await getJson<{ items?: UnrwaRow[] }>(`${UNRWA_ENDPOINT}?limit=100&yearFrom=${year}&yearTo=${year}&coa_all=true`);
  return Array.isArray(j?.items) ? j.items : [];
}

export const DISPLACEMENT_SOURCE: SignalSource = {
  id: "displacement",
  // A UNHCR total for each country of asylum, placed on a centroid.
  precision: "country",
  label: "Forced displacement",
  group: "Human cost",
  color: "#ea580c",
  refreshMs: 24 * 60 * 60 * 1000, // annual statistics; a daily cache is ample
  attribution: UNHCR_ATTRIBUTION,
  sourceUrl: "https://www.unhcr.org/refugee-statistics/", // UNHCR Refugee Data Finder (dossier source)

  // Real UNHCR scalar: total forced-displaced people this country holds/hosts.
  // Calm ≈ a country with few displaced; extreme ≈ a multi-million crisis host.
  metric: { field: "displacedCount", domain: [0, 5_000_000] },
  async fetch() {
    try {
      const year = new Date().getUTCFullYear() - 1; // latest fully-published year
      const url = `${ENDPOINT}?limit=${UNHCR_PAGE_LIMIT}&yearFrom=${year}&yearTo=${year}&coa_all=true`;
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return degraded(`http ${res.status}`);
      const json = (await res.json()) as { items?: UnRow[] };
      const rows = Array.isArray(json.items) ? json.items : [];
      const [tpJson, ftJson] = await Promise.all([
        getJson<unknown>(EUROSTAT_TP_URL),
        getJson<unknown>(EUROSTAT_FIRST_TIME_URL),
      ]);
      const tp = eurostatLatestByIso3(tpJson);
      const ft = eurostatLatestByIso3(ftJson);
      const out = normalizeDisplacement(rows, UNHCR_PAGE_LIMIT, rows.length ? await fetchUnrwa(year) : []);
      // The most recent year may not be published yet → fall back one more year.
      if (out.length === 0) {
        const prev = year - 1;
        const res2 = await fetch(`${ENDPOINT}?limit=${UNHCR_PAGE_LIMIT}&yearFrom=${prev}&yearTo=${prev}&coa_all=true`, {
          headers: { "User-Agent": UA, Accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res2.ok) return degraded(`http ${res2.status}`);
        const json2 = (await res2.json()) as { items?: UnRow[] };
        const prevRows = normalizeDisplacement(Array.isArray(json2.items) ? json2.items : [], UNHCR_PAGE_LIMIT, await fetchUnrwa(prev));
        return observed(attachEurostat(prevRows, tp, ft), Date.now(), sourceAtForYear(prev));
      }
      return observed(attachEurostat(out, tp, ft), Date.now(), sourceAtForYear(year));
    } catch {
      return degraded("fetch failed");
    }
  },
};
