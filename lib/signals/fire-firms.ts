import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { countMagnitude } from "@/lib/signals/aggregate";
import { applyCap, carryCoverage, groupDigits, withCoverage } from "@/lib/signals/coverage";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { readGeostationarySources } from "@/lib/signals/fire-geo";

// Active fire detections — NASA FIRMS near-real-time satellite thermal anomalies,
// each with a fire radiative power (FRP, MW) and a detection confidence. Complements
// the wildfire INCIDENTS layer with raw per-pixel detections. A whole-world day is
// tens of thousands of pixels, so we keep the most intense FIRMS_CAP by FRP.
//
// KEYLESS since 2026-10-16. Until then this read the keyed area API
// (`api/area/csv/{FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/world/1`), and prod served ZERO fires
// for at least five weeks: FIRMS answered HTTP 400 "Invalid MAP_KEY." to the key on
// the box. FIRMS publishes the same detections, with the same columns, as keyless
// global 24-hour CSV files, one per satellite. Reading those removes the secret that
// failed, and it also removes a daily gap: `world/1` means "the current UTC DATE", so
// just after 00:00 UTC the old layer was nearly empty every night (measured
// 2026-10-16: all 44,646 rows the API gave were dated that day).
//
// The "24h" file actually spans about 42 hours (measured 2026-10-16: 10-15 01:05 to
// 10-16 17:17), so the fetch keeps only detections from the last FIRMS_WINDOW_MS.

/** One keyless FIRMS global 24-hour file. */
export interface FirmsFile {
  /** Short instrument name, used in partial-failure reasons and the props. */
  key: string;
  url: string;
}

const FIRMS_DATA = "https://firms.modaps.eosdis.nasa.gov/data/active_fire";

/**
 * The keyless files read each refresh. One parser reads them all: the three VIIRS files
 * share their columns, and MODIS differs only in naming its brightness `brightness`
 * and giving confidence as 0–100.
 *
 * NOAA-20 and NOAA-21 carry the same VIIRS sensor as S-NPP about 50 min apart, so S-NPP
 * alone missed about two thirds of the VIIRS overpasses. MODIS (Terra/Aqua, 1 km) is
 * older and coarser but passes at different times again. Measured 2026-10-16: S-NPP
 * 94,182 rows, NOAA-20 102,207, NOAA-21 105,870, MODIS 15,076 (each ~42 h).
 *
 * Landsat (30 m, US only) is published the same way and was left out on purpose: its
 * file has no FRP column, so it could never rank into a layer capped by FRP, and it
 * flags every row "D" even on night passes.
 */
export const FIRMS_FILES: readonly FirmsFile[] = [
  { key: "VIIRS S-NPP", url: `${FIRMS_DATA}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv` },
  { key: "VIIRS NOAA-20", url: `${FIRMS_DATA}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv` },
  { key: "VIIRS NOAA-21", url: `${FIRMS_DATA}/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv` },
  { key: "MODIS", url: `${FIRMS_DATA}/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv` },
];

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** Most intense detections kept (by FRP), to keep the layer legible. */
export const FIRMS_CAP = 1500;

/** Detections older than this are dropped: the layer means "the last 24 hours". */
export const FIRMS_WINDOW_MS = 24 * 60 * 60 * 1000;

export const FIRMS_ATTRIBUTION =
  "Active fire data: NASA FIRMS (VIIRS S-NPP / NOAA-20 / NOAA-21 and MODIS NRT); " +
  "Himawari-9 hotspots © Commonwealth of Australia (Geoscience Australia), CC BY 4.0; " +
  "NOAA NESDIS Hazard Mapping System; INPE Programa Queimadas";

/** VIIRS confidence flag → label. MODIS confidence is numeric (0–100). */
function confidenceLabel(c: string): string {
  const v = c.trim().toLowerCase();
  if (v === "h" || v === "high") return "high";
  if (v === "n" || v === "nominal") return "nominal";
  if (v === "l" || v === "low") return "low";
  const n = Number(v);
  if (v !== "" && Number.isFinite(n)) return n >= 80 ? "high" : n >= 30 ? "nominal" : "low";
  return "—";
}

/** FIRMS satellite code → the name a reader knows. Unknown codes pass through. */
const SATELLITE_NAMES: Record<string, string> = {
  N: "Suomi NPP (VIIRS)",
  N20: "NOAA-20 (VIIRS)",
  N21: "NOAA-21 (VIIRS)",
  T: "Terra (MODIS)",
  A: "Aqua (MODIS)",
};
function satelliteName(code: string): string {
  return code ? SATELLITE_NAMES[code] ?? code : "—";
}

/** Red ramp by fire radiative power (MW). */
export function fireColor(frp: number): string {
  if (frp >= 100) return "#7f1d1d";
  if (frp >= 50) return "#b91c1c";
  if (frp >= 20) return "#dc2626";
  if (frp >= 5) return "#ea580c";
  return "#f97316";
}

/** FIRMS naive-UTC acq_date (YYYY-MM-DD) + acq_time (HHMM, no leading zeros) → epoch ms. */
function acqMs(date: string, time: string): number | null {
  if (!date) return null;
  const hhmm = (time || "0").padStart(4, "0");
  const t = Date.parse(`${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
  return Number.isFinite(t) ? t : null;
}

/** One detection, kept light: a world day is ~300k rows and only FIRMS_CAP become features. */
export interface FireDetection {
  lat: number;
  lon: number;
  /** Fire radiative power, MW. null when the source publishes none (INPE). */
  frp: number | null;
  confidence: string;
  /** Epoch ms of the detection, or null when the row's time cannot be read. */
  at: number | null;
  /** id suffix: the source's own date+time text, so ids stay stable across refreshes. */
  when: string;
  brightness: string;
  satellite: string;
  daynight: string;
  /**
   * Who published it, when not NASA FIRMS (the geostationary sources in
   * lib/signals/fire-geo.ts). Absent means NASA FIRMS.
   */
  source?: string;
  /** Short code for `source`, used in the feature id ("dea", "hms", "inpe"). */
  sourceCode?: string;
  /** Location accuracy the source states, e.g. "± 2 km". */
  accuracy?: string;
}

/**
 * "polar": a polar-orbiter pixel from FIRMS — ranked by FRP over 24 h.
 * "geo":   a geostationary detection (Himawari, GOES) — ranked newest first over 3 h.
 */
export type FireFamily = "polar" | "geo";

/**
 * Pure: one FIRMS CSV (VIIRS or MODIS columns) → detections. Skips rows with no or
 * impossible coordinates. VIIRS names its brightness `bright_ti4`, MODIS `brightness`.
 */
export function parseFirmsCsv(csv: string): FireDetection[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const cols = lines[0].split(",").map((c) => c.trim());
  const idx = (name: string) => cols.indexOf(name);
  const iLat = idx("latitude"), iLon = idx("longitude"), iFrp = idx("frp");
  const iConf = idx("confidence"), iDate = idx("acq_date"), iTime = idx("acq_time");
  const iBright = idx("bright_ti4") >= 0 ? idx("bright_ti4") : idx("brightness");
  const iSat = idx("satellite"), iDN = idx("daynight");

  const out: FireDetection[] = [];
  for (let r = 1; r < lines.length; r++) {
    const p = lines[r].split(",");
    const latRaw = (p[iLat] ?? "").trim();
    const lonRaw = (p[iLon] ?? "").trim();
    if (!latRaw || !lonRaw) continue; // empty cell — Number("") is 0, so guard first
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const frp = iFrp >= 0 ? Number(p[iFrp]) : Number.NaN;
    const date = (p[iDate] ?? "").trim();
    const time = (p[iTime] ?? "").trim();
    const bright = iBright >= 0 ? Number(p[iBright]) : Number.NaN;
    const dn = iDN >= 0 ? (p[iDN] ?? "").trim() : "";
    out.push({
      lat,
      lon,
      frp: Number.isFinite(frp) && frp >= 0 ? frp : null,
      confidence: confidenceLabel(iConf >= 0 ? (p[iConf] ?? "") : ""),
      at: acqMs(date, time),
      when: `${date}${time}`,
      brightness: Number.isFinite(bright) ? `${bright.toFixed(0)} K` : "—",
      satellite: satelliteName(iSat >= 0 ? (p[iSat] ?? "").trim() : ""),
      daynight: dn === "D" ? "day" : dn === "N" ? "night" : "—",
    });
  }
  return out;
}

/** The id of a detection: its place to 4 dp and its source's own time text. */
function detectionKey(d: FireDetection): string {
  return `${d.sourceCode ? `${d.sourceCode}:` : ""}${d.lat.toFixed(4)},${d.lon.toFixed(4)}@${d.when}`;
}

/** Pure: one detection → the map feature. */
export function detectionToFeature(d: FireDetection): SignalFeature {
  const iso = d.at != null ? new Date(d.at).toISOString() : undefined;
  const frp = d.frp;
  return {
    id: `fire:${detectionKey(d)}`,
    lat: d.lat,
    lon: d.lon,
    title:
      frp != null
        ? `Active fire — ${frp.toFixed(0)} MW (${d.confidence})`
        : `Active fire — ${d.satellite} (${d.confidence})`,
    signalId: "fire-active",
    color: fireColor(frp ?? 0),
    ts: iso,
    props: {
      frp: frp != null ? `${frp.toFixed(1)} MW` : "not published",
      confidence: d.confidence,
      brightness: d.brightness,
      satellite: d.satellite,
      daynight: d.daynight,
      detected: iso ?? "—",
      magnitude: countMagnitude(frp ?? 0),
      source: d.source ?? "NASA FIRMS",
      ...(d.accuracy ? { accuracy: d.accuracy } : {}),
    },
  };
}

/** Keep detections inside the window ending at `now`. Undated rows are kept. */
export function withinWindow(d: FireDetection, now: number, windowMs = FIRMS_WINDOW_MS): boolean {
  if (d.at == null) return true;
  return d.at >= now - windowMs && d.at <= now + 60 * 60 * 1000;
}

/**
 * Pure: detections → the top `cap` by FRP as features, with a coverage record saying
 * how many detections there were. Detections that share an id (the same pixel at the
 * same minute) count once.
 */
export function rankFireDetections(dets: readonly FireDetection[], cap = FIRMS_CAP): SignalFeature[] {
  const unique = uniqueBy(dets, detectionKey);
  unique.sort((a, b) => (b.frp ?? 0) - (a.frp ?? 0));
  const kept = applyCap(unique, cap, {
    noun: "fire detections",
    rule: "the most intense by fire radiative power",
  });
  return carryCoverage(kept, kept.map(detectionToFeature));
}

function uniqueBy<T>(items: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of items) {
    const k = key(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Geostationary detections kept, newest first, beside the FIRMS_CAP polar ones. */
export const GEO_FIRE_CAP = 500;

/** A geostationary detection older than this is dropped: it means "burning now". */
export const GEO_FIRE_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * A geostationary satellite sees the same fire every 10 minutes, so its rows repeat
 * one place many times. Rows in the same 0.02° cell (about the 2 km pixel) are one
 * fire, and the newest row stands for it.
 */
function geoCell(d: FireDetection): string {
  return `${Math.round(d.lat / 0.02)},${Math.round(d.lon / 0.02)}`;
}

/**
 * Pure: the fire-active layer from both families.
 *
 * Polar-orbiter pixels (FIRMS) are the 24 h picture, ranked by FRP and capped at
 * `polarCap`. Geostationary detections (Himawari-9 via Geoscience Australia, GOES
 * via NOAA HMS and INPE) are the "burning now" picture: one per 2 km cell, newest
 * first, capped at `geoCap`. They need their own share because they would never
 * rank into the FRP cut: INPE publishes no FRP at all, and a 10-minute scan does
 * not add up the way a 24 h pixel list does. One coverage record covers both.
 */
export function rankFireActive(
  polar: readonly FireDetection[],
  geo: readonly FireDetection[],
  polarCap = FIRMS_CAP,
  geoCap = GEO_FIRE_CAP,
): SignalFeature[] {
  const p = uniqueBy(polar, detectionKey).sort((a, b) => (b.frp ?? 0) - (a.frp ?? 0));
  const g = uniqueBy(
    [...geo].sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || (b.frp ?? 0) - (a.frp ?? 0)),
    geoCell,
  );
  const keptP = p.slice(0, polarCap);
  const keptG = g.slice(0, geoCap);
  const features = [...keptP, ...keptG].map(detectionToFeature);
  const capped = p.length > keptP.length || g.length > keptG.length;
  return withCoverage(features, {
    available: p.length + g.length,
    availableExact: true,
    capped,
    ...(capped ? { cap: polarCap + geoCap } : {}),
    noun: "fire detections",
    rule:
      g.length > 0
        ? `the ${groupDigits(polarCap)} most intense satellite detections of the last 24 h by fire radiative power, and the ${groupDigits(geoCap)} newest geostationary ones of the last 3 h`
        : "the most intense by fire radiative power",
  });
}

/**
 * Pure: FIRMS CSV → SignalFeature[], keeping the top `cap` by FRP.
 *
 * A whole-world VIIRS day runs to tens of thousands of pixels, so the returned
 * array carries a coverage record (lib/signals/coverage.ts) saying how many
 * detections the CSV actually held — otherwise "1,500 fires" reads as the number
 * of fires burning rather than the number we chose to draw. Pass `now` to keep
 * only the last FIRMS_WINDOW_MS (the fetch does).
 */
export function normalizeFirms(csv: string, cap = FIRMS_CAP, opts: { now?: number } = {}): SignalFeature[] {
  const now = opts.now;
  const dets = parseFirmsCsv(csv);
  return rankFireDetections(now == null ? dets : dets.filter((d) => withinWindow(d, now)), cap);
}

// --- fetch ------------------------------------------------------------------

/** Parsed rows of the last good read of each file, and its Last-Modified header. */
const fileCache = new Map<string, { dets: FireDetection[]; at: number; lastModified?: string }>();

/** One file's read, resolved — never thrown, so Promise.all cannot short-circuit. */
export interface FirmsFileResult {
  key: string;
  /** Which share of the layer these rows compete for. Absent means "polar". */
  family?: FireFamily;
  ok: boolean;
  dets: FireDetection[];
  /** Epoch ms these rows were read: now on success, the cached read on a fallback. */
  at: number | null;
  reason?: string;
}

async function readFirmsFile(f: FirmsFile, now: number): Promise<FirmsFileResult> {
  const hit = fileCache.get(f.url);
  try {
    const headers: Record<string, string> = { "User-Agent": UA };
    // The files are rewritten about hourly and the layer refreshes every 30 min, so
    // half the reads can be a 304 instead of 8 MB.
    if (hit?.lastModified) headers["If-Modified-Since"] = hit.lastModified;
    const res = await fetch(f.url, { headers, signal: AbortSignal.timeout(45_000) });
    if (res.status === 304 && hit) {
      hit.at = now;
      return { key: f.key, ok: true, dets: hit.dets, at: now };
    }
    if (!res.ok) {
      return { key: f.key, ok: false, dets: hit?.dets ?? [], at: hit?.at ?? null, reason: `http ${res.status}` };
    }
    // Only rows inside the window are kept: the files span ~42 h and four of them
    // parse to ~300k rows, so holding the expired half would double the memory.
    const dets = parseFirmsCsv(await res.text()).filter((d) => withinWindow(d, now));
    fileCache.set(f.url, { dets, at: now, lastModified: res.headers.get("last-modified") ?? undefined });
    return { key: f.key, ok: true, dets, at: now };
  } catch (e) {
    const reason = (e as Error)?.name === "TimeoutError" ? "timeout" : "upstream read failed";
    return { key: f.key, ok: false, dets: hit?.dets ?? [], at: hit?.at ?? null, reason };
  }
}

/**
 * Pure: fold the per-file reads into one outcome-tagged feature array.
 *
 * A file that fails does not empty the layer: its last good rows (if any) still
 * count, and the layer reports `degradedWith` naming what failed, stamped with the
 * OLDEST read it is serving. Only every file failing with nothing cached is `degraded`.
 */
export function mergeFirmsResults(
  results: readonly FirmsFileResult[],
  now: number,
  cap = FIRMS_CAP,
): SignalFeature[] {
  const failed = results.filter((r) => !r.ok);
  const isGeo = (r: FirmsFileResult) => r.family === "geo";
  const polar = results.filter((r) => !isGeo(r)).flatMap((r) => r.dets).filter((d) => withinWindow(d, now));
  const geo = results
    .filter(isGeo)
    .flatMap((r) => r.dets)
    .filter((d) => withinWindow(d, now, GEO_FIRE_WINDOW_MS));
  const features = rankFireActive(polar, geo, cap);
  if (failed.length === 0) return observed(features, now);
  const reason =
    failed.length === results.length
      ? failed[0]!.reason ?? "upstream read failed"
      : `partial: ${failed.map((f) => f.key).join(", ")} failed (${failed[0]!.reason})`;
  const ats = results.filter((r) => r.dets.length && r.at != null).map((r) => r.at as number);
  if (!features.length || !ats.length) return degraded(reason, now);
  return degradedWith(features, reason, Math.min(...ats));
}

export const FIRE_FIRMS_SOURCE: SignalSource = {
  id: "fire-active",
  // One satellite detection: the centre of a 375 m VIIRS pixel (1 km MODIS, ~2 km
  // geostationary). Each feature states its source, and DEA rows their own accuracy.
  precision: "exact",
  label: "Active fires (FIRMS)",
  group: "Natural hazards",
  color: "#dc2626",
  refreshMs: 30 * 60 * 1000, // the files are rewritten about hourly
  attribution: FIRMS_ATTRIBUTION,
  async fetch() {
    const now = Date.now();
    const results = await Promise.all([
      ...FIRMS_FILES.map((f) => readFirmsFile(f, now)),
      ...readGeostationarySources(now),
    ]);
    return mergeFirmsResults(results, now);
  },
};
