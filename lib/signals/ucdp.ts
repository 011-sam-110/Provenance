import type { SignalFeature, SignalPrecision } from "@/lib/signals/types";
import { centroidByName, type CountryCentroid } from "@/lib/signals/country-centroids.data";
import { countMagnitude } from "@/lib/signals/aggregate";

// UCDP Georeferenced Event Dataset — CANDIDATE events, the monthly release.
//
// WHAT IT IS. The Uppsala Conflict Data Program codes every lethal event of organised
// violence it can verify from news and NGO reporting: who fought whom, where (with a
// stated precision), when, and a best/low/high death count. The "candidate" release is
// the monthly, not-yet-final version: each file covers about one month and comes out
// around the 20th of the next. So this is VERIFIED history 3 to 7 weeks old, not a live
// feed, and the layer says so. Rows UCDP has not finished checking (`code_status` other
// than "Clear") are kept and labelled provisional.
//
// WHY IT REPLACED GDELT (audited 2026-10-16). A random sample of GDELT's conflict rows
// was 86% not a real event at the coded place (a Zelda trailer was Japan's top
// "conflict"). A sample of 10 UCDP rows was 10 real lethal events at the coded place.
//
// ACCESS. Keyless CSV from https://ucdp.uu.se/downloads/ (CC BY 4.0). The newest file
// name is read from that page once a day, so a new monthly release is picked up without
// a code change. The paged API needs a token and serves the same data.

export const UCDP_DOWNLOADS = "https://ucdp.uu.se/downloads/";
export const UCDP_ATTRIBUTION_SHORT = "UCDP GED Candidate (CC BY 4.0)";

/** One parsed row: only the columns the layer uses. */
export interface UcdpEvent {
  id: string;
  codeStatus: string;
  typeOfViolence: string;
  conflictName: string;
  dyadName: string;
  sideA: string;
  sideB: string;
  sources: number;
  headline: string;
  wherePrec: number;
  place: string;
  whereDescription: string;
  adm1: string;
  lat: number;
  lon: number;
  country: string;
  dateStart: string;
  dateEnd: string;
  best: number;
  low: number;
  high: number;
}

/**
 * Pure: the newest monthly candidate CSV linked from the downloads page.
 * Matches `candidateged/GEDEvent_v26_0_8.csv`; the quarterly cumulative file
 * (`GEDEvent_v26_01_26_06.csv`) has a different shape of name and is not matched.
 */
export function latestCandidateCsv(html: string): { url: string; version: string } | undefined {
  let best: { major: number; minor: number; path: string } | undefined;
  for (const m of html.matchAll(/candidateged\/GEDEvent_v(\d+)_0_(\d+)\.csv/gi)) {
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (!best || major > best.major || (major === best.major && minor > best.minor)) best = { major, minor, path: m[0] };
  }
  if (!best) return undefined;
  return { url: new URL(best.path, UCDP_DOWNLOADS).toString(), version: `v${best.major}.0.${best.minor}` };
}

/** Pure: RFC 4180 CSV → rows of cells (quoted cells, doubled quotes, newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const n = (v: string | undefined) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Pure: the candidate CSV → typed events. Rows with no usable coordinate are dropped. */
export function parseUcdpCsv(text: string): UcdpEvent[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const head = rows.shift();
  if (!head) return [];
  const col = (name: string) => head.indexOf(name);
  const c = {
    id: col("id"),
    codeStatus: col("code_status"),
    type: col("type_of_violence"),
    conflict: col("conflict_name"),
    dyad: col("dyad_name"),
    sideA: col("side_a"),
    sideB: col("side_b"),
    sources: col("number_of_sources"),
    headline: col("source_headline"),
    wherePrec: col("where_prec"),
    place: col("where_coordinates"),
    whereDesc: col("where_description"),
    adm1: col("adm_1"),
    lat: col("latitude"),
    lon: col("longitude"),
    country: col("country"),
    dateStart: col("date_start"),
    dateEnd: col("date_end"),
    best: col("best"),
    low: col("low"),
    high: col("high"),
  };
  if (c.id < 0 || c.lat < 0 || c.lon < 0 || c.country < 0) return [];
  const out: UcdpEvent[] = [];
  for (const r of rows) {
    const lat = Number(r[c.lat]);
    const lon = Number(r[c.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (lat === 0 && lon === 0) continue;
    out.push({
      id: (r[c.id] ?? "").trim(),
      codeStatus: (r[c.codeStatus] ?? "").trim(),
      typeOfViolence: (r[c.type] ?? "").trim(),
      conflictName: (r[c.conflict] ?? "").trim(),
      dyadName: (r[c.dyad] ?? "").trim(),
      sideA: (r[c.sideA] ?? "").trim(),
      sideB: (r[c.sideB] ?? "").trim(),
      sources: n(r[c.sources]),
      headline: (r[c.headline] ?? "").split(";")[0]!.trim(),
      wherePrec: n(r[c.wherePrec]),
      place: (r[c.place] ?? "").trim(),
      whereDescription: (r[c.whereDesc] ?? "").trim(),
      adm1: (r[c.adm1] ?? "").trim(),
      lat,
      lon,
      country: (r[c.country] ?? "").trim(),
      dateStart: (r[c.dateStart] ?? "").trim().slice(0, 10),
      dateEnd: (r[c.dateEnd] ?? "").trim().slice(0, 10),
      best: n(r[c.best]),
      low: n(r[c.low]),
      high: n(r[c.high]),
    });
  }
  return out;
}

/** UCDP country names carry a historical name in brackets: "Yemen (North Yemen)". */
const UCDP_COUNTRY_ALIAS: Record<string, string> = {
  "united states of america": "united states",
  "bosnia-herzegovina": "bosnia and herzegovina",
  "cambodia (kampuchea)": "cambodia",
};

/** Pure: a UCDP country name → our centroid record, or undefined. */
export function ucdpCountry(name: string): CountryCentroid | undefined {
  const lower = name.trim().toLowerCase();
  const aliased = UCDP_COUNTRY_ALIAS[lower] ?? lower;
  return centroidByName(aliased) ?? centroidByName(aliased.replace(/\s*\(.*\)\s*$/, ""));
}

/**
 * Pure: UCDP's `where_prec` → our precision.
 *   1 the exact place · 2 within about 25 km · 3 a second-order admin area ·
 *   4 a first-order admin area · 5 along a road, a river or between two places ·
 *   6 only the country · 7 international waters or airspace.
 */
export function ucdpPrecision(wherePrec: number): SignalPrecision {
  if (wherePrec === 1) return "exact";
  if (wherePrec === 6) return "country";
  return "area";
}

const VIOLENCE: Record<string, string> = {
  "1": "State-based armed conflict",
  "2": "Non-state armed conflict",
  "3": "One-sided violence against civilians",
};

/** Red ramp by UCDP's best estimate of deaths. A zero-death row is still a coded event. */
export function ucdpColor(deaths: number): string {
  if (deaths >= 100) return "#7f1d1d";
  if (deaths >= 25) return "#b91c1c";
  if (deaths >= 5) return "#dc2626";
  if (deaths >= 1) return "#ef4444";
  return "#f87171";
}

/** Pure: events → features of the `conflict` layer. `version` names the release. */
export function normalizeUcdp(events: UcdpEvent[], version: string): SignalFeature[] {
  const out: SignalFeature[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!e.id || seen.has(e.id)) continue;
    seen.add(e.id);
    const country = ucdpCountry(e.country);
    const precision = ucdpPrecision(e.wherePrec);
    // A country-level row names the country as its place ("Ukraine", "DR Congo (Zaire)");
    // say it once.
    const countryName = e.country.replace(/\s*\(.*\)\s*$/, "");
    const bare = (s: string) => s.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
    const place = e.place && bare(e.place) !== bare(e.country) ? e.place : "";
    const where = [place, countryName].filter(Boolean).join(", ");
    const provisional = e.codeStatus && e.codeStatus !== "Clear";
    out.push({
      id: `ucdp:${e.id}`,
      lat: e.lat,
      lon: e.lon,
      title: `${VIOLENCE[e.typeOfViolence] ?? "Organised violence"} — ${where}`,
      signalId: "conflict",
      precision,
      ...(country ? { countryIso3: country.iso3 } : {}),
      color: ucdpColor(e.best),
      ts: e.dateStart ? `${e.dateStart}T00:00:00Z` : undefined,
      props: {
        source: "UCDP",
        country: country?.name ?? e.country,
        sides: e.dyadName || [e.sideA, e.sideB].filter(Boolean).join(" vs "),
        conflict: e.conflictName || undefined,
        deaths: e.best,
        deathsRange: e.low !== e.high ? `${e.low}–${e.high}` : undefined,
        date: e.dateEnd && e.dateEnd !== e.dateStart ? `${e.dateStart} to ${e.dateEnd}` : e.dateStart,
        place: e.whereDescription || e.place || undefined,
        region: e.adm1 || undefined,
        headline: e.headline || undefined,
        reports: e.sources || undefined,
        status: provisional ? `Provisional: UCDP is still checking this event (${e.codeStatus})` : "Coded by UCDP",
        release: `UCDP GED Candidate ${version}`,
        magnitude: Math.max(2, countMagnitude(e.best)),
      },
    });
  }
  return out;
}

// --- fetch ------------------------------------------------------------------

const UA = "Provenance/2.0 (+https://github.com/011-sam-110/Provenance)";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // a monthly release; twice a day is ample

let cache: { features: SignalFeature[]; at: number; version: string; newest?: number } | null = null;
let inflight: Promise<UcdpRead> | null = null;

export interface UcdpRead {
  features: SignalFeature[];
  ok: boolean;
  reason?: string;
  /** When the release was READ. */
  at: number;
  /** The newest event date in the release, as epoch ms. */
  newest?: number;
  version?: string;
}

async function readRelease(): Promise<UcdpRead> {
  const page = await fetch(UCDP_DOWNLOADS, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!page.ok) throw new Error(`downloads page http ${page.status}`);
  const latest = latestCandidateCsv(await page.text());
  if (!latest) throw new Error("no candidate file linked");
  if (cache && cache.version === latest.version) {
    cache = { ...cache, at: Date.now() };
    return { features: cache.features, ok: true, at: cache.at, newest: cache.newest, version: cache.version };
  }
  const res = await fetch(latest.url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`csv http ${res.status}`);
  const events = parseUcdpCsv(await res.text());
  if (events.length === 0) throw new Error("empty release");
  const features = normalizeUcdp(events, latest.version);
  const newest = Math.max(...events.map((e) => Date.parse(`${e.dateStart}T00:00:00Z`)).filter(Number.isFinite));
  cache = { features, at: Date.now(), version: latest.version, newest: Number.isFinite(newest) ? newest : undefined };
  return { features, ok: true, at: cache.at, newest: cache.newest, version: cache.version };
}

/** The current release, cached. Never throws; on failure serves the last good copy. */
export async function fetchUcdpEvents(): Promise<UcdpRead> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { features: cache.features, ok: true, at: cache.at, newest: cache.newest, version: cache.version };
  }
  if (!inflight) {
    inflight = readRelease()
      .catch((e: unknown): UcdpRead => {
        const reason = `ucdp: ${(e as Error)?.message ?? "read failed"}`;
        return cache
          ? { features: cache.features, ok: false, reason, at: cache.at, newest: cache.newest, version: cache.version }
          : { features: [], ok: false, reason, at: Date.now() };
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
