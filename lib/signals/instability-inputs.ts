// Inputs of the Country Instability Index that arrived on 2026-10-16 (see the
// factor table in lib/signals/instability.ts). Each has a PURE parser, unit-tested
// against a captured fixture, and a thin keyless fetch that resolves to null on any
// failure, so the index loses one factor instead of failing.
//
//   UCDP Candidate GED  conflict fatalities, monthly CSV          CC BY 4.0
//   INFORM Severity     crisis severity 1-10, monthly XLSX        CC BY 4.0 (EC reuse notice)
//   INFORM Risk         structural risk 0-10, JSON API            CC BY 4.0 (EC reuse notice)
//   World Bank WGI      political stability, annual JSON API      CC BY 4.0
//   World Bank SP.POP   population, to turn displacement into a share
//   IODA alerts         critical connectivity alerts, 24 h        (no licence stated)

import { centroidByIso2, centroidByIso3, centroidByName } from "@/lib/signals/country-centroids.data";
import { parseCsv } from "@/lib/signals/airports";
import { readXlsxSheet } from "@/lib/signals/xlsx";

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

async function get(url: string, ms: number, tries = 1): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms), cache: "no-store" });
      if (res.ok) return res;
    } catch {
      // fall through to the next try
    }
  }
  return null;
}

async function getJson<T>(url: string, ms = 20_000, tries = 1): Promise<T | null> {
  const res = await get(url, ms, tries);
  if (!res) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getText(url: string, ms = 20_000): Promise<string | null> {
  const res = await get(url, ms);
  if (!res) return null;
  try {
    return await res.text();
  } catch {
    return null;
  }
}

// --- UCDP Candidate GED ------------------------------------------------------

export const UCDP_DOWNLOADS = "https://ucdp.uu.se/downloads/";

/**
 * Pure: the UCDP downloads page → URLs of the newest `count` MONTHLY candidate files,
 * newest first. Monthly files are `GEDEvent_v<YY>_0_<M>.csv`; the name changes every
 * month and the yearly rollover goes to `v<YY+1>_0_1`. Quarterly rollups such as
 * `GEDEvent_v26_01_26_06.csv` repeat months already counted and are skipped.
 */
export function ucdpMonthlyCsvUrls(html: string, count = 2): string[] {
  const seen = new Map<string, number>();
  for (const m of html.matchAll(/candidateged\/GEDEvent_v(\d+)_0_(\d+)\.csv/g)) {
    seen.set(m[0], Number(m[1]) * 100 + Number(m[2]));
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([path]) => `https://ucdp.uu.se/downloads/${path}`);
}

/** UCDP's Gleditsch-Ward style names that our centroid set does not know. */
const UCDP_ALIAS: Record<string, string> = {
  "dr congo": "COD",
  "congo": "COG",
  "ivory coast": "CIV",
  "united states of america": "USA",
  "myanmar": "MMR",
  "russia": "RUS",
  "syria": "SYR",
  "iran": "IRN",
  "libya": "LBY",
  "yemen": "YEM",
  "south sudan": "SSD",
  "laos": "LAO",
  "bosnia-herzegovina": "BIH",
  "cambodia": "KHM",
  "tanzania": "TZA",
  "vietnam": "VNM",
  "south korea": "KOR",
  "north korea": "PRK",
  "kingdom of eswatini": "SWZ",
  "madagascar": "MDG",
  "bolivia": "BOL",
  "venezuela": "VEN",
  "moldova": "MDA",
  "macedonia, fyr": "MKD",
  "serbia": "SRB",
};

/** UCDP country name → ISO-3. "Yemen (North Yemen)" → "Yemen" → YEM. */
export function iso3FromUcdpCountry(name: string): string | undefined {
  const base = (name ?? "").replace(/\s*\([^)]*\)\s*/g, " ").trim().toLowerCase();
  if (!base) return undefined;
  return UCDP_ALIAS[base] ?? centroidByName(base)?.iso3;
}

/** Pure: UCDP candidate CSV text(s) → fatalities ("best" estimate) per ISO-3. */
export function ucdpFatalitiesByIso3(csvs: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const text of csvs) {
    const rows = parseCsv(text);
    const head = rows[0] ?? [];
    const ci = head.indexOf("country");
    const bi = head.indexOf("best");
    if (ci < 0 || bi < 0) continue;
    for (const r of rows.slice(1)) {
      const iso3 = iso3FromUcdpCountry(r[ci] ?? "");
      const best = Number(r[bi]);
      if (iso3 && Number.isFinite(best) && best > 0) out.set(iso3, (out.get(iso3) ?? 0) + best);
    }
  }
  return out;
}

/** Fatalities in the newest two monthly releases (~60 days). Null when unreadable. */
export async function fetchUcdpFatalities(): Promise<Map<string, number> | null> {
  const page = await getText(UCDP_DOWNLOADS);
  const urls = page ? ucdpMonthlyCsvUrls(page, 2) : [];
  if (urls.length === 0) return null;
  const csvs = (await Promise.all(urls.map((u) => getText(u, 45_000)))).filter((t): t is string => !!t);
  return csvs.length ? ucdpFatalitiesByIso3(csvs) : null;
}

// --- INFORM Severity ---------------------------------------------------------
//
// Read from ACAPS's own copy on HDX first (ACAPS produces the index; CC BY 4.0; the
// September 2026 edition was there on 2026-10-15, a month ahead of the JRC page).
// The JRC page is the fallback. JRC's host sits behind an F5 filter that, measured from
// provenance-1 on 2026-10-16, reset 2 of every 4 to 5 requests from a Node client.

export const INFORM_SEVERITY_HDX = "https://data.humdata.org/api/3/action/package_show?id=inform-global-crisis-severity-index";

/** Pure: the HDX record → the newest monthly workbook's URL (highest leading YYYYMM). */
export function informSeverityHdxUrl(pkg: unknown): string | null {
  const res = (pkg as { result?: { resources?: { name?: string; url?: string; format?: string }[] } })?.result?.resources ?? [];
  let best: { key: number; url: string } | null = null;
  for (const r of res) {
    const m = /^(\d{6})[ _-]/.exec(r.name ?? "");
    if (!m || !/xlsx/i.test(r.format ?? "") || !/^https:\/\//.test(r.url ?? "")) continue;
    const key = Number(m[1]);
    if (!best || key > best.key) best = { key, url: r.url! };
  }
  return best?.url ?? null;
}

export const INFORM_SEVERITY_PAGE = "https://drmkc.jrc.ec.europa.eu/inform-index/INFORM-Severity/Results-and-data";
const INFORM_ORIGIN = "https://drmkc.jrc.ec.europa.eu";

/**
 * Pure: the INFORM Severity results page → the newest monthly workbook's URL. The file
 * names are irregular ("202608 INFORM Severity - August 2026.xlsx",
 * "202606_INFORM_Severity_-_June_2026__2_.xlsx"), so the newest is the highest leading
 * YYYYMM.
 */
export function informSeverityXlsxUrl(html: string): string | null {
  let best: { key: number; href: string } | null = null;
  for (const m of html.matchAll(/href="([^"]*\/Severity\/\d{4}\/(\d{6})[^"]*\.xlsx)"/gi)) {
    const key = Number(m[2]);
    if (!best || key > best.key) best = { key, href: m[1] };
  }
  if (!best) return null;
  const href = best.href.replace(/&amp;/g, "&");
  const abs = href.startsWith("http") ? href : `${INFORM_ORIGIN}${href.startsWith("/") ? "" : "/"}${href}`;
  return encodeURI(decodeURI(abs));
}

/**
 * Pure: rows of the "INFORM Severity - country" sheet → the highest severity index
 * (1-10) per ISO-3. The header row is found by its column names, not its position.
 */
export function informSeverityByIso3(rows: string[][]): Map<string, number> {
  const out = new Map<string, number>();
  const h = rows.findIndex((r) => r.includes("ISO3") && r.includes("INFORM Severity Index"));
  if (h < 0) return out;
  const ii = rows[h].indexOf("ISO3");
  const si = rows[h].indexOf("INFORM Severity Index");
  for (const r of rows.slice(h + 1)) {
    const iso3 = String(r[ii] ?? "").trim().toUpperCase();
    const v = Number(r[si]);
    if (!/^[A-Z]{3}$/.test(iso3) || !centroidByIso3(iso3) || !Number.isFinite(v) || v <= 0) continue;
    out.set(iso3, Math.max(out.get(iso3) ?? 0, Math.round(v * 10) / 10));
  }
  return out;
}

async function severityFrom(url: string | null, tries: number): Promise<Map<string, number> | null> {
  if (!url) return null;
  const res = await get(url, 45_000, tries);
  if (!res) return null;
  try {
    const rows = await readXlsxSheet(await res.arrayBuffer(), "INFORM Severity - country");
    const map = rows ? informSeverityByIso3(rows) : null;
    return map && map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

export async function fetchInformSeverity(): Promise<Map<string, number> | null> {
  const hdx = await severityFrom(informSeverityHdxUrl(await getJson<unknown>(INFORM_SEVERITY_HDX)), 1);
  if (hdx) return hdx;
  const page = await getText(INFORM_SEVERITY_PAGE);
  return severityFrom(page ? informSeverityXlsxUrl(page) : null, 2);
}

// --- INFORM Risk -------------------------------------------------------------

const INFORM_API = "https://drmkc.jrc.ec.europa.eu/Inform-Index/API/InformAPI";
/** INFORM Risk Mid 2026, used when discovery fails. */
export const INFORM_RISK_FALLBACK_WORKFLOW = 515;

/** Pure: the workflow-group list → the global INFORM Risk groups, newest first. */
export function informRiskGroups(groups: unknown): string[] {
  if (!Array.isArray(groups)) return [];
  const rank = (g: string) => {
    const m = /^INFORM(\d{4})(_?Mid|_2nd)?$/.exec(g);
    if (!m) return -1;
    return Number(m[1]) * 10 + (m[2] ? 5 : 0);
  };
  return groups
    .filter((g): g is string => typeof g === "string" && rank(g) >= 0)
    .sort((a, b) => rank(b) - rank(a));
}

/** Pure: INFORM `countries/Scores` rows → INFORM risk (0-10) per ISO-3. */
export function informRiskByIso3(rows: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(rows)) return out;
  for (const r of rows as { Iso3?: string; IndicatorId?: string; IndicatorScore?: number }[]) {
    const iso3 = String(r?.Iso3 ?? "").toUpperCase();
    const v = r?.IndicatorScore;
    if (r?.IndicatorId !== "INFORM" || !centroidByIso3(iso3) || typeof v !== "number" || !Number.isFinite(v)) continue;
    out.set(iso3, v);
  }
  return out;
}

export async function fetchInformRisk(): Promise<Map<string, number> | null> {
  let workflow = INFORM_RISK_FALLBACK_WORKFLOW;
  // Up to 3 tries per request: see the F5 note above the INFORM Severity section.
  const groups = informRiskGroups(await getJson<unknown>(`${INFORM_API}/Workflows/WorkflowGroups`, 30_000, 3));
  if (groups[0]) {
    const wfs = await getJson<{ WorkflowId?: number; FlagGnaPublished?: string | null }[]>(
      `${INFORM_API}/Workflows/GetByWorkflowGroup/${encodeURIComponent(groups[0])}`,
      30_000,
      3,
    );
    const published = (wfs ?? []).filter((w) => typeof w.WorkflowId === "number" && w.FlagGnaPublished);
    if (published.length) workflow = Math.max(...published.map((w) => w.WorkflowId as number));
  }
  const map = informRiskByIso3(
    await getJson<unknown>(`${INFORM_API}/countries/Scores/?WorkflowId=${workflow}&IndicatorId=INFORM`, 30_000, 3),
  );
  return map.size ? map : null;
}

// --- World Bank: WGI political stability, and population ----------------------

/** Pure: a World Bank v2 indicator response ([meta, rows]) → newest value per ISO-3. */
export function worldBankByIso3(json: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const rows = Array.isArray(json) && Array.isArray(json[1]) ? (json[1] as unknown[]) : [];
  for (const r of rows as { countryiso3code?: string; value?: number | null }[]) {
    const iso3 = String(r?.countryiso3code ?? "").toUpperCase();
    if (!centroidByIso3(iso3) || typeof r?.value !== "number" || !Number.isFinite(r.value)) continue;
    if (!out.has(iso3)) out.set(iso3, r.value);
  }
  return out;
}

const WB = "https://api.worldbank.org/v2/country/all/indicator";
export async function fetchWgiPoliticalStability(): Promise<Map<string, number> | null> {
  const m = worldBankByIso3(await getJson<unknown>(`${WB}/GOV_WGI_PV.EST?format=json&per_page=400&mrv=1&source=3`));
  return m.size ? m : null;
}
export async function fetchPopulation(): Promise<Map<string, number> | null> {
  const m = worldBankByIso3(await getJson<unknown>(`${WB}/SP.POP.TOTL?format=json&per_page=400&mrv=1`));
  return m.size ? m : null;
}

/**
 * Pure: the structural baseline, 0..1 per ISO-3, as the mean of what is available of
 * INFORM Risk (0-10, ramped 2 → 0 and 8 → 1) and WGI Political Stability (-2.5..+2.5,
 * ramped +0.5 → 0 and -2.0 → 1). Either alone counts.
 */
export function structuralBaseline(inform: Map<string, number> | null, wgi: Map<string, number> | null): Map<string, number> {
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const out = new Map<string, number>();
  const keys = new Set([...(inform?.keys() ?? []), ...(wgi?.keys() ?? [])]);
  for (const iso3 of keys) {
    const parts: number[] = [];
    const i = inform?.get(iso3);
    const w = wgi?.get(iso3);
    if (typeof i === "number") parts.push(clamp01((i - 2) / 6));
    if (typeof w === "number") parts.push(clamp01((0.5 - w) / 2.5));
    if (parts.length) out.set(iso3, parts.reduce((a, b) => a + b, 0) / parts.length);
  }
  return out;
}

// --- IODA critical alerts ----------------------------------------------------

/** Pure: IODA `/v2/outages/alerts` → count of CRITICAL country alerts per ISO-3. */
export function iodaCriticalAlertsByIso3(json: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const rows = (json as { data?: unknown[] })?.data;
  if (!Array.isArray(rows)) return out;
  for (const r of rows as { level?: string; entity?: { type?: string; code?: string } }[]) {
    if (r?.level !== "critical" || r?.entity?.type !== "country") continue;
    const c = centroidByIso2(String(r.entity.code ?? "").toUpperCase());
    if (c) out.set(c.iso3, (out.get(c.iso3) ?? 0) + 1);
  }
  return out;
}

export async function fetchIodaCriticalAlerts(): Promise<Map<string, number> | null> {
  const until = Math.floor(Date.now() / 1000);
  const from = until - 24 * 3600;
  const json = await getJson<unknown>(
    `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?from=${from}&until=${until}&entityType=country&limit=2000`,
  );
  return json && Array.isArray((json as { data?: unknown }).data) ? iodaCriticalAlertsByIso3(json) : null;
}
