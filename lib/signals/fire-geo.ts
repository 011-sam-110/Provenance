// Geostationary fire detections — the "burning now" share of the fire-active layer.
//
// FIRMS (lib/signals/fire-firms.ts) is polar orbiters: a few looks a day at any place.
// Geostationary satellites look every 10 minutes, and three operators publish their
// detections keylessly for the regions they cover:
//
//   • Geoscience Australia (DEA Hotspots) — Himawari-9 AHI, Australasia and East Asia.
//     CC BY 4.0, stated in the WFS AccessConstraints.
//   • NOAA NESDIS Hazard Mapping System — GOES-East/West, North America, every point
//     checked by an analyst. US federal; the page states no licence.
//   • INPE Programa Queimadas — GOES-19 (and some Meteosat MSG-03), South America. INPE labels the data "Dados
//     Abertos" (open data); no licence text beyond that.
//
// Each of them ALSO republishes polar-orbiter (VIIRS/MODIS) detections. Those rows are
// dropped here, because FIRMS already gives the same pixels from the operator: keeping
// them would draw one detection twice. Only the geostationary rows are taken.
//
// Audited 2026-10-16 (scratchpad sources-audit/firms.md), re-probed the same evening
// from provenance-1: DEA 739 Himawari rows in 3 h, HMS 10,745 GOES rows that day, INPE
// 70 GOES-19 rows in one 10-minute file.
//
// This module imports only TYPES from fire-firms.ts, which imports it, so the two
// cannot form a runtime cycle.

import type { FireDetection, FirmsFileResult } from "@/lib/signals/fire-firms";

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** How far back each geostationary read looks. Matches GEO_FIRE_WINDOW_MS. */
const LOOKBACK_MS = 3 * 60 * 60 * 1000;

/** Confidence 0–100 (DEA) → the label FIRMS rows use. */
function confidenceFromPercent(n: unknown): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  return v >= 80 ? "high" : v >= 30 ? "nominal" : "low";
}

function finiteOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function validPlace(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

// --- DEA Hotspots (Himawari-9) ------------------------------------------------

export const DEA_SOURCE = "Geoscience Australia (DEA Hotspots)";

/**
 * The DEA WFS query for every hotspot newer than `since`; the parser keeps the
 * Himawari rows. The product is NOT filtered on the server: measured 2026-10-16 from
 * provenance-1, `datetime>… AND product='BRIGHT AHI'` took 32 to 63 s for 240 KB,
 * while `datetime>…` alone took 3 s for 6.3 MB. GeoServer indexes the time, not the
 * product.
 */
export function deaHotspotsUrl(since: number): string {
  const iso = new Date(since).toISOString().replace(/\.\d{3}Z$/, "Z");
  const cql = `datetime>'${iso}'`;
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: "public:hotspots",
    outputFormat: "application/json",
    propertyName: "location,datetime,satellite,sensor,product,confidence,power,temp_kelvin,accuracy",
    CQL_FILTER: cql,
  });
  return `https://hotspots.dea.ga.gov.au/geoserver/public/wfs?${params.toString()}`;
}

interface DeaFeature {
  geometry?: { coordinates?: unknown } | null;
  properties?: {
    satellite?: string;
    sensor?: string;
    product?: string;
    confidence?: number | string;
    power?: number | string;
    temp_kelvin?: number | string;
    datetime?: string;
    accuracy?: string;
  } | null;
}

/** Pure: DEA WFS GeoJSON → Himawari detections. Other products (VIIRS/MODIS relays) are dropped. */
export function parseDeaHotspots(json: { features?: DeaFeature[] }): FireDetection[] {
  const out: FireDetection[] = [];
  for (const f of json.features ?? []) {
    const p = f.properties ?? {};
    if ((p.product ?? "").trim().toUpperCase() !== "BRIGHT AHI") continue;
    const c = f.geometry?.coordinates;
    if (!Array.isArray(c)) continue;
    const lon = Number(c[0]);
    const lat = Number(c[1]);
    if (!validPlace(lat, lon)) continue;
    const at = p.datetime ? Date.parse(p.datetime) : Number.NaN;
    const temp = finiteOrNull(p.temp_kelvin);
    const frp = finiteOrNull(p.power);
    out.push({
      lat,
      lon,
      frp: frp != null && frp >= 0 ? frp : null,
      confidence: confidenceFromPercent(p.confidence),
      at: Number.isFinite(at) ? at : null,
      when: p.datetime ?? "",
      brightness: temp != null ? `${temp.toFixed(0)} K` : "—",
      satellite: `${(p.satellite ?? "Himawari-9").trim()} (${(p.sensor ?? "AHI").trim()})`,
      daynight: "—",
      source: DEA_SOURCE,
      sourceCode: "dea",
      ...(p.accuracy ? { accuracy: p.accuracy.trim() } : {}),
    });
  }
  return out;
}

// --- NOAA HMS (GOES) -----------------------------------------------------------

export const HMS_SOURCE = "NOAA Hazard Mapping System";

/** The HMS daily fire-point text file for the UTC day containing `t`. */
export function hmsFileUrl(t: number): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Fire_Points/Text/${y}/${m}/hms_fire${y}${m}${day}.txt`;
}

/** "2026289" + "1856" → epoch ms (day-of-year, UTC). */
function yearDayMs(yd: string, hhmm: string): number | null {
  const m = /^(\d{4})(\d{3})$/.exec(yd.trim());
  const t = /^(\d{1,4})$/.exec(hhmm.trim());
  if (!m || !t) return null;
  const pad = t[1].padStart(4, "0");
  const ms = Date.UTC(Number(m[1]), 0, Number(m[2]), Number(pad.slice(0, 2)), Number(pad.slice(2)));
  return Number.isFinite(ms) ? ms : null;
}

/** "GOES-EAST" → "GOES-East (ABI)". */
function goesName(s: string): string {
  const v = s.trim().toUpperCase();
  if (v === "GOES-EAST") return "GOES-East (ABI)";
  if (v === "GOES-WEST") return "GOES-West (ABI)";
  return `${s.trim()} (ABI)`;
}

/**
 * Pure: HMS text (`Lon, Lat, YearDay, Time, Satellite, Method, Ecosystem, FRP`, padded
 * with spaces) → the GOES detections. Its VIIRS rows are dropped: FIRMS has them.
 * Note the column order: LONGITUDE first.
 */
export function parseHmsText(txt: string): FireDetection[] {
  const lines = txt.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const cols = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const i = (n: string) => cols.indexOf(n);
  const iLon = i("lon"), iLat = i("lat"), iYd = i("yearday"), iTime = i("time");
  const iSat = i("satellite"), iFrp = i("frp");
  if (iLon < 0 || iLat < 0) return [];
  const out: FireDetection[] = [];
  for (let r = 1; r < lines.length; r++) {
    const p = lines[r].split(",").map((x) => x.trim());
    const sat = p[iSat] ?? "";
    if (!/^GOES/i.test(sat)) continue;
    if (!p[iLat] || !p[iLon]) continue;
    const lat = Number(p[iLat]);
    const lon = Number(p[iLon]);
    if (!validPlace(lat, lon)) continue;
    const frp = finiteOrNull(p[iFrp]);
    const at = yearDayMs(p[iYd] ?? "", p[iTime] ?? "");
    out.push({
      lat,
      lon,
      // HMS writes -999 where a detection has no FRP.
      frp: frp != null && frp >= 0 ? frp : null,
      confidence: "analyst-checked",
      at,
      when: `${p[iYd] ?? ""}${p[iTime] ?? ""}`,
      brightness: "—",
      satellite: goesName(sat),
      daynight: "—",
      source: HMS_SOURCE,
      sourceCode: "hms",
    });
  }
  return out;
}

// --- INPE Queimadas (GOES-19) --------------------------------------------------

export const INPE_SOURCE = "INPE Programa Queimadas";
export const INPE_10MIN_DIR = "https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/10min/";

/** Newest 10-minute files read per refresh: one hour of GOES-19 scans. */
export const INPE_FILES_PER_READ = 6;

/** Pure: the directory listing → the newest file names, oldest first. */
export function inpeNewestFiles(listingHtml: string, n = INPE_FILES_PER_READ): string[] {
  const names = new Set(listingHtml.match(/focos_10min_\d{8}_\d{4}\.csv/g) ?? []);
  return [...names].sort().slice(-n);
}

/**
 * INPE satellite names that are geostationary. INPE also lists polar orbiters
 * (AQUA_M-T, NPP-375, NOAA-20…), which FIRMS already serves from the operator.
 * MSG-03 is EUMETSAT's Meteosat, seen in INPE's 19:40 file on 2026-10-16.
 */
const INPE_GEOSTATIONARY = /^(GOES|MSG|METEOSAT|HIMAWARI)/i;

/** "GOES-19" → "GOES-19 (ABI)", "MSG-03" → "MSG-03 (SEVIRI)". */
function inpeSatelliteName(sat: string): string {
  if (/^GOES/i.test(sat)) return `${sat} (ABI)`;
  if (/^(MSG|METEOSAT)/i.test(sat)) return `${sat} (SEVIRI)`;
  if (/^HIMAWARI/i.test(sat)) return `${sat} (AHI)`;
  return sat;
}

/** Pure: one INPE 10-minute CSV (`lat,lon,satelite,data`) → its geostationary detections. */
export function parseInpeCsv(csv: string): FireDetection[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const cols = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const iLat = cols.indexOf("lat"), iLon = cols.indexOf("lon");
  const iSat = cols.indexOf("satelite"), iDate = cols.indexOf("data");
  if (iLat < 0 || iLon < 0) return [];
  const out: FireDetection[] = [];
  for (let r = 1; r < lines.length; r++) {
    const p = lines[r].split(",").map((x) => x.trim());
    const sat = p[iSat] ?? "";
    if (!INPE_GEOSTATIONARY.test(sat)) continue;
    if (!p[iLat] || !p[iLon]) continue;
    const lat = Number(p[iLat]);
    const lon = Number(p[iLon]);
    if (!validPlace(lat, lon)) continue;
    const when = p[iDate] ?? "";
    // INPE writes "2026-10-16 19:10:00" in UTC (the 19:10 file was listed at 19:36 UTC).
    const at = when ? Date.parse(`${when.replace(" ", "T")}Z`) : Number.NaN;
    out.push({
      lat,
      lon,
      frp: null, // INPE publishes no fire radiative power
      confidence: "—",
      at: Number.isFinite(at) ? at : null,
      when,
      brightness: "—",
      satellite: inpeSatelliteName(sat),
      daynight: "—",
      source: INPE_SOURCE,
      sourceCode: "inpe",
    });
  }
  return out;
}

// --- fetch ----------------------------------------------------------------------

const lastGood = new Map<string, { dets: FireDetection[]; at: number }>();

async function getText(url: string, timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, reason: `http ${res.status}` };
    return { ok: true, text: await res.text() };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.name === "TimeoutError" ? "timeout" : "upstream read failed" };
  }
}

function settle(key: string, dets: FireDetection[] | null, reason: string | undefined, now: number): FirmsFileResult {
  if (dets) {
    lastGood.set(key, { dets, at: now });
    return { key, family: "geo", ok: true, dets, at: now };
  }
  const hit = lastGood.get(key);
  return { key, family: "geo", ok: false, dets: hit?.dets ?? [], at: hit?.at ?? null, reason: reason ?? "upstream read failed" };
}

async function readDea(now: number): Promise<FirmsFileResult> {
  const r = await getText(deaHotspotsUrl(now - LOOKBACK_MS), 45_000);
  if (!r.ok) return settle("Himawari (DEA)", null, r.reason, now);
  try {
    return settle("Himawari (DEA)", parseDeaHotspots(JSON.parse(r.text) as { features?: DeaFeature[] }), undefined, now);
  } catch {
    return settle("Himawari (DEA)", null, "unreadable body", now);
  }
}

async function readHms(now: number): Promise<FirmsFileResult> {
  // Early in a UTC day today's file holds little, so yesterday's is read as well.
  const days = [now];
  if (new Date(now).getUTCHours() < 4) days.unshift(now - 24 * 60 * 60 * 1000);
  const reads = await Promise.all(days.map((d) => getText(hmsFileUrl(d), 30_000)));
  const good = reads.filter((r): r is { ok: true; text: string } => r.ok);
  if (!good.length) {
    const first = reads[0] as { ok: false; reason: string };
    return settle("GOES (NOAA HMS)", null, first.reason, now);
  }
  return settle("GOES (NOAA HMS)", good.flatMap((r) => parseHmsText(r.text)), undefined, now);
}

async function readInpe(now: number): Promise<FirmsFileResult> {
  const listing = await getText(INPE_10MIN_DIR, 20_000);
  if (!listing.ok) return settle("GOES-19 (INPE)", null, listing.reason, now);
  const names = inpeNewestFiles(listing.text);
  if (!names.length) return settle("GOES-19 (INPE)", null, "no files listed", now);
  const reads = await Promise.all(names.map((n) => getText(`${INPE_10MIN_DIR}${n}`, 20_000)));
  const good = reads.filter((r): r is { ok: true; text: string } => r.ok);
  if (!good.length) {
    const first = reads[0] as { ok: false; reason: string };
    return settle("GOES-19 (INPE)", null, first.reason, now);
  }
  return settle("GOES-19 (INPE)", good.flatMap((r) => parseInpeCsv(r.text)), undefined, now);
}

/** One promise per geostationary operator. Each resolves; none throws. */
export function readGeostationarySources(now: number): Promise<FirmsFileResult>[] {
  return [readDea(now), readHms(now), readInpe(now)];
}
