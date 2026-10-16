import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";

// Space weather — NOAA SWPC. A global "status" signal: the planetary K-index
// (geomagnetic activity, 0–9) plus the current NOAA storm scales — G (geomagnetic),
// R (radio blackout) and S (solar radiation). High activity degrades GPS, HF radio
// and power grids and pushes the aurora to lower latitudes, so it belongs in the
// intel picture. Rendered as a single status pin at the north geomagnetic pole,
// sized by Kp and coloured by the G-scale. Keyless; dormant-safe (→ [] on failure).

const KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
const SCALES_URL = "https://services.swpc.noaa.gov/products/noaa-scales.json";
const KP_1M_URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json";

// THE HEADLINE IS THE 1-MINUTE ESTIMATE (2026-10-16). The pin used to show the last
// 3-hour Kp block, which is up to ~3.5 h old when read: at 18:35 UTC that day it said
// "Kp 3.3" (the 15:00-18:00 block) while SWPC's own 1-minute estimate was 1.33. Its
// `updated` line printed the noaa-scales time (18:32), so the stale value also read as
// current. Now the headline is the 1-minute estimated Kp with ITS time, the last
// official block rides beside it with its own block time, and `updated` is the time
// of the Kp actually shown. The 1-minute feed is skipped when its newest row is over
// an hour old, so a frozen file cannot pose as now.
/** The newest 1-minute Kp row older than this (ms) is not used as the headline. */
export const KP_1M_MAX_AGE_MS = 60 * 60 * 1000;

// WHAT THE PIN MISSED (2026-10-16). GOES-18 X-ray flux peaked at 1.38e-5 W/m2 at
// 15:42 UTC, an M1.3 flare and an R1 radio blackout, and SWPC issued an ALTEF3
// electron alert at 14:19. At 18:35 the pin said `radioBlackout: none` (it read only
// the "current" scales block) and showed no alerts, although explain.ts said it did.
// These SWPC files close that gap. Each one is optional: on any failure its props
// are left out, never guessed.
const ALERTS_URL = "https://services.swpc.noaa.gov/products/alerts.json";
// 1-day GOES file (~650 KB) so the 24 h maximum is real; the 6-hour one would miss
// a morning flare by the evening.
const XRAY_URL = "https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json";
// The summary files are one row each. The 1-minute rtsw files are 1.5-2.5 MB, and
// the old products/solar-wind/*.json files answered 404 on 2026-10-16.
const WIND_URL = "https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json";
const MAG_URL = "https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json";
/** An alert issued within this window (ms) is "recent"; a warning stays while it is valid. */
export const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** GOES flux or solar-wind readings older than this (ms) are not shown as "now". */
export const READING_MAX_AGE_MS = 60 * 60 * 1000;

// SECOND, INDEPENDENT PRODUCER (2026-10-16). GFZ Potsdam computes the official Kp
// for IAGA, and its nowcast runs ahead of NOAA's: at 19:47Z on 2026-10-16 GFZ had
// the 18:00 block (4.333) while NOAA's newest was 15:00. Hp30 is GFZ's half-hourly
// Kp-like index, so it moves between Kp blocks. Both are CC BY 4.0, which requires
// the credit in SWPC_ATTRIBUTION below. Optional, like the SWPC extras.
const GFZ_BASE = "https://kp.gfz.de/app/json/";
/** GFZ's JSON API asks for an explicit window; 24 h back from now is plenty. */
export function gfzUrl(index: "Kp" | "Hp30", now: number): string {
  const iso = (t: number) => new Date(t).toISOString().slice(0, 19) + "Z";
  return `${GFZ_BASE}?start=${iso(now - 24 * 3_600_000)}&end=${iso(now)}&index=${index}`;
}

// North geomagnetic pole (≈2025) — the natural anchor for a geomagnetic-status pin.
const GEOMAG_NORTH: [number, number] = [80.7, -72.7];

// NOAA SWPC products are US Government works (no copyright), so no "©". GFZ's
// CC BY 4.0 licence requires its credit wherever its numbers are shown.
export const SWPC_ATTRIBUTION = "Space-weather data: NOAA SWPC · Kp/Hp30 cross-check: GFZ Potsdam, CC BY 4.0";

interface KpRow {
  time_tag?: string;
  Kp?: number;
  a_running?: number;
  station_count?: number;
}
interface ScaleBlock {
  DateStamp?: string;
  TimeStamp?: string;
  R?: { Scale?: string | null; Text?: string | null };
  S?: { Scale?: string | null; Text?: string | null };
  G?: { Scale?: string | null; Text?: string | null };
}
interface AlertRow {
  product_id?: string;
  issue_datetime?: string;
  message?: string;
}
interface XrayRow {
  time_tag?: string;
  flux?: number;
  energy?: string;
}
interface WindRow {
  proton_speed?: number | null;
  time_tag?: string;
}
interface MagRow {
  bt?: number | null;
  bz_gsm?: number | null;
  time_tag?: string;
}
/** GFZ JSON: parallel arrays of interval starts and values, keyed by the index name. */
export interface GfzSeries {
  datetime?: string[];
  Kp?: (number | null)[];
  Hp30?: (number | null)[];
  status?: string[];
}
interface Kp1mRow {
  time_tag?: string;
  kp_index?: number;
  estimated_kp?: number;
  kp?: string;
}
export interface SpaceWeatherInput {
  /** NOAA's official 3-hour Kp blocks, oldest first. */
  kp: KpRow[];
  scales0: ScaleBlock | undefined;
  /** SWPC 1-minute estimated Kp, oldest first. Optional: absent falls back to the block. */
  kp1m?: Kp1mRow[];
  /** SWPC alerts, watches and warnings, newest first (alerts.json). */
  alerts?: AlertRow[];
  /** GOES primary X-ray flux rows (xrays-1-day.json), both bands, oldest first. */
  xray?: XrayRow[];
  /** SWPC solar-wind speed summary (one row). */
  wind?: WindRow[];
  /** SWPC interplanetary magnetic field summary (one row). */
  mag?: MagRow[];
  /** GFZ Potsdam Kp series (3-hour blocks). */
  gfzKp?: GfzSeries;
  /** GFZ Potsdam Hp30 series (30-minute intervals). */
  gfzHp30?: GfzSeries;
  /** Clock for the staleness checks (default: no check). Tests pin it. */
  now?: number;
}

/**
 * GOES 0.1-0.8 nm flux (W/m2) → the standard flare class: A < 1e-7 ≤ B < 1e-6 ≤ C <
 * 1e-5 ≤ M < 1e-4 ≤ X, the number being the flux over the class base, to one
 * decimal ("M1.3" for 1.38e-5: SWPC truncates, it does not round). "" for a
 * non-positive or non-finite flux.
 */
export function flareClass(flux: number): string {
  if (!Number.isFinite(flux) || flux <= 0) return "";
  const bands: [string, number][] = [["X", 1e-4], ["M", 1e-5], ["C", 1e-6], ["B", 1e-7], ["A", 1e-8]];
  for (const [letter, base] of bands) {
    if (flux >= base || letter === "A") return `${letter}${(Math.floor((flux / base) * 10 + 1e-9) / 10).toFixed(1)}`;
  }
  return "";
}

/** NOAA R-scale reached by a peak GOES flux: R1 M1, R2 M5, R3 X1, R4 X10, R5 X20. 0 below M1. */
export function radioBlackoutScale(flux: number): number {
  if (!Number.isFinite(flux)) return 0;
  if (flux >= 2e-3) return 5;
  if (flux >= 1e-3) return 4;
  if (flux >= 1e-4) return 3;
  if (flux >= 5e-5) return 2;
  if (flux >= 1e-5) return 1;
  return 0;
}

export interface XraySummary {
  flareNow?: string;
  flareNowAt?: string;
  flareMax24h?: string;
  flareMax24hAt?: string;
  peakFlux?: number;
}

/** Pure: GOES rows → flare class now and the 24 h peak (long band, 0.1-0.8 nm, only). */
export function summarizeXray(rows: XrayRow[], now?: number): XraySummary {
  const long = rows
    .filter((r) => r?.energy === "0.1-0.8nm" && typeof r.flux === "number" && r.flux > 0 && swpcIso(r.time_tag))
    .map((r) => {
      const iso = swpcIso(r.time_tag) as string;
      return { t: Date.parse(iso), iso, flux: r.flux as number };
    })
    .sort((a, b) => a.t - b.t);
  if (!long.length) return {};
  const newest = long[long.length - 1];
  const ref = now ?? newest.t;
  const day = long.filter((r) => ref - r.t <= ALERT_WINDOW_MS);
  const fresh = now == null || now - newest.t <= READING_MAX_AGE_MS;
  const out: XraySummary = {};
  if (fresh) {
    out.flareNow = flareClass(newest.flux);
    out.flareNowAt = newest.iso;
  }
  if (day.length) {
    const peak = day.reduce((m, r) => (r.flux > m.flux ? r : m), day[0]);
    out.flareMax24h = flareClass(peak.flux);
    out.flareMax24hAt = peak.iso;
    out.peakFlux = peak.flux;
  }
  return out;
}

const MONTH_NUM: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** SWPC message time "2026 Oct 13 2100 UTC" → ISO, else undefined. */
function messageTime(text: string | undefined): string | undefined {
  const m = text?.match(/(\d{4}) ([A-Z][a-z]{2}) (\d{1,2}) (\d{2})(\d{2}) UTC/);
  if (!m || !MONTH_NUM[m[2]]) return undefined;
  return `${m[1]}-${MONTH_NUM[m[2]]}-${m[3].padStart(2, "0")}T${m[4]}:${m[5]}:00Z`;
}

export interface SwpcAlert {
  /** SWPC message code, e.g. "ALTEF3", "WARK04", "WATA20". */
  code: string;
  /** The message's own headline line, e.g. "ALERT: Electron 2MeV Integral Flux exceeded 1,000pfu". */
  headline: string;
  issued: string;
  /** When a warning or an extended warning stops being valid, if it says. */
  validUntil?: string;
}

/**
 * Pure: alerts.json → the messages that are current: issued within 24 h, or a
 * warning whose "Valid To" / "Now Valid Until" is still ahead. Newest first.
 * Cancellations are left out: they end a message, they are not one.
 */
export function activeAlerts(rows: AlertRow[], now: number): SwpcAlert[] {
  const out: SwpcAlert[] = [];
  for (const r of rows ?? []) {
    const lines = (r?.message ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim());
    const code = lines.join("\n").match(/Message Code:\s*(\w+)/)?.[1] ?? r?.product_id ?? "";
    const issued = swpcIso(r?.issue_datetime?.slice(0, 19));
    const headline = lines.find((l) => /^(ALERT|WARNING|WATCH|EXTENDED WARNING|SUMMARY|CONTINUED ALERT)\b/.test(l));
    if (!code || !issued || !headline) continue;
    const validUntil = messageTime(lines.find((l) => /^(Now Valid Until|Valid To):/i.test(l)));
    const issuedAt = Date.parse(issued);
    const recent = now - issuedAt <= ALERT_WINDOW_MS && issuedAt <= now + 60_000;
    const stillValid = validUntil != null && Date.parse(validUntil) > now;
    if (recent || stillValid) out.push({ code, headline, issued, ...(validUntil ? { validUntil } : {}) });
  }
  return out.sort((a, b) => Date.parse(b.issued) - Date.parse(a.issued));
}

/** Pure: the newest finite value of a GFZ series and the start of its interval. */
export function latestGfz(series: GfzSeries | undefined, index: "Kp" | "Hp30"): { value: number; start: string; status?: string } | undefined {
  const times = series?.datetime ?? [];
  const values = series?.[index] ?? [];
  for (let i = Math.min(times.length, values.length) - 1; i >= 0; i -= 1) {
    const v = values[i];
    const start = swpcIso(times[i]);
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && start) {
      const status = series?.status?.[i];
      return { value: Number(v.toFixed(2)), start, ...(status ? { status } : {}) };
    }
  }
  return undefined;
}

export interface SolarWindSummary {
  solarWindKms?: number;
  bzNt?: number;
  btNt?: number;
  solarWindAt?: string;
}

/** Pure: the two one-row summary files → solar wind now, when fresh. */
export function summarizeSolarWind(wind: WindRow[] | undefined, mag: MagRow[] | undefined, now?: number): SolarWindSummary {
  const fresh = (iso: string | undefined) => iso != null && (now == null || now - Date.parse(iso) <= READING_MAX_AGE_MS);
  const w = wind?.[0];
  const m = mag?.[0];
  const wAt = swpcIso(w?.time_tag);
  const mAt = swpcIso(m?.time_tag);
  const out: SolarWindSummary = {};
  if (typeof w?.proton_speed === "number" && Number.isFinite(w.proton_speed) && fresh(wAt)) {
    out.solarWindKms = w.proton_speed;
    out.solarWindAt = wAt;
  }
  if (typeof m?.bz_gsm === "number" && Number.isFinite(m.bz_gsm) && fresh(mAt)) {
    out.bzNt = m.bz_gsm;
    if (typeof m.bt === "number" && Number.isFinite(m.bt)) out.btNt = m.bt;
    out.solarWindAt ??= mAt;
  }
  return out;
}

/** SWPC time tags carry no zone ("2026-10-16T19:33:00") but are UTC. → ISO with Z. */
export function swpcIso(tag: string | undefined | null): string | undefined {
  if (!tag) return undefined;
  const t = tag.trim().replace(" ", "T");
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`;
  return Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso)).toISOString().replace(".000Z", "Z") : undefined;
}

/** "2026-10-16T19:33:00Z" → "2026-10-16 19:33 UTC". */
function utcLine(iso: string | undefined): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "—";
}

/** NOAA G-scale (0–5) → colour (quiet green → severe red). */
export function gScaleColor(scale: number): string {
  switch (scale) {
    case 0: return "#16a34a"; // quiet
    case 1: return "#eab308"; // minor
    case 2: return "#f59e0b"; // moderate
    case 3: return "#ea580c"; // strong
    case 4: return "#dc2626"; // severe
    default: return "#7f1d1d"; // 5+ extreme
  }
}

function scaleNum(s: string | null | undefined): number {
  const n = Number((s ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Pure: latest Kp + current NOAA scales → a single space-weather status feature. */
export function normalizeSpaceWeather(input: SpaceWeatherInput): SignalFeature[] {
  const rows = input.kp ?? [];
  const block = [...rows].reverse().find((r) => typeof r?.Kp === "number" && Number.isFinite(r.Kp));
  const blockKp = block?.Kp ?? Number.NaN;
  const blockTime = swpcIso(block?.time_tag);

  const minute = [...(input.kp1m ?? [])]
    .reverse()
    .find((r) => typeof r?.estimated_kp === "number" && Number.isFinite(r.estimated_kp) && swpcIso(r.time_tag));
  const minuteTime = swpcIso(minute?.time_tag);
  const minuteFresh =
    minute != null && minuteTime != null && (input.now == null || input.now - Date.parse(minuteTime) <= KP_1M_MAX_AGE_MS);

  const kp = minuteFresh ? (minute!.estimated_kp as number) : blockKp;
  const kpTime = minuteFresh ? minuteTime : blockTime;
  if (!Number.isFinite(kp)) return [];

  const sc = input.scales0;
  const xr = summarizeXray(input.xray ?? [], input.now);
  const alerts = input.alerts ? activeAlerts(input.alerts, input.now ?? Date.now()) : [];
  const wind = summarizeSolarWind(input.wind, input.mag, input.now);
  const r24 = xr.peakFlux != null ? radioBlackoutScale(xr.peakFlux) : null;
  const gfzKp = latestGfz(input.gfzKp, "Kp");
  const gfzHp30 = latestGfz(input.gfzHp30, "Hp30");
  const g = scaleNum(sc?.G?.Scale);
  const r = scaleNum(sc?.R?.Scale);
  const s = scaleNum(sc?.S?.Scale);
  const kpLabel = kp >= 7 ? "severe storm" : kp >= 5 ? "storm" : kp >= 4 ? "unsettled" : "quiet";

  return [
    {
      id: "swpc:status",
      lat: GEOMAG_NORTH[0],
      lon: GEOMAG_NORTH[1],
      title: `Space weather — Kp ${kp.toFixed(1)} (${kpLabel})`,
      signalId: "space-weather",
      color: gScaleColor(g),
      ...(kpTime ? { ts: kpTime } : {}),
      props: {
        kp: Number(kp.toFixed(2)),
        kpSource: minuteFresh ? "SWPC 1-minute estimate" : "SWPC 3-hour block",
        ...(Number.isFinite(blockKp) ? { kpBlock: Number(blockKp.toFixed(2)) } : {}),
        ...(blockTime ? { kpBlockStart: blockTime } : {}),
        condition: kpLabel,
        geomagneticStorm: g > 0 ? `G${g}` : "none",
        radioBlackout: r > 0 ? `R${r}` : "none",
        solarRadiation: s > 0 ? `S${s}` : "none",
        // GOES X-ray: the class now and the 24 h peak, and the R-scale that peak
        // reached. The scales block above is "current" only, so it says R0 hours
        // after an M flare; this is what shows the 2026-10-16 M1.3.
        ...(xr.flareNow ? { flareNow: xr.flareNow } : {}),
        ...(xr.flareMax24h ? { flareMax24h: xr.flareMax24h, flareMax24hAt: xr.flareMax24hAt } : {}),
        ...(r24 != null ? { radioBlackout24h: r24 > 0 ? `R${r24}` : "none" } : {}),
        ...(input.alerts ? { alertCount: alerts.length } : {}),
        ...(alerts.length
          ? { alerts: alerts.slice(0, 5).map((a) => `${a.code} ${utcLine(a.issued)}: ${a.headline}`).join(" · ") }
          : {}),
        ...(wind.solarWindKms != null ? { solarWindKms: wind.solarWindKms } : {}),
        ...(wind.bzNt != null ? { bzNt: wind.bzNt } : {}),
        ...(wind.btNt != null ? { btNt: wind.btNt } : {}),
        ...(wind.solarWindAt ? { solarWindAt: wind.solarWindAt } : {}),
        // GFZ Potsdam (CC BY 4.0): an independent Kp and the half-hourly Hp30.
        ...(gfzKp ? { gfzKp: gfzKp.value, gfzKpBlockStart: gfzKp.start } : {}),
        ...(gfzKp?.status ? { gfzKpStatus: gfzKp.status } : {}),
        ...(gfzHp30 ? { gfzHp30: gfzHp30.value, gfzHp30Start: gfzHp30.start } : {}),
        // The time of the Kp shown above, not the scales file's time.
        updated: utcLine(kpTime),
        scalesUpdated: sc?.DateStamp && sc?.TimeStamp ? `${sc.DateStamp} ${sc.TimeStamp} UTC` : "—",
        // Kp (0–9) maps almost directly onto our 0–10 marker scale.
        magnitude: Math.min(10, Math.max(2, kp)),
      },
    },
  ];
}

/** GET a JSON file; any failure (status, network, parse) resolves to undefined. */
async function optionalJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

export const SPACE_WEATHER_SOURCE: SignalSource = {
  id: "space-weather",
  // A planet-wide index. The mark is an anchor at the geomagnetic pole, not a place.
  precision: "area",
  label: "Space weather (NOAA Kp/storms)",
  group: "Space weather",
  color: "#16a34a",
  refreshMs: 15 * 60 * 1000,
  attribution: SWPC_ATTRIBUTION,
  kind: "forecast", // a single geomagnetic INDEX → the forecast focus view (gauge + scales)
  // Real scalar: the planetary K-index (geomagnetic activity), 0 (quiet) → 9 (max
  // storm) — not the rescaled `magnitude` radius proxy.
  metric: { field: "kp", domain: [0, 9] },
  forecast: {
    quietBelow: 4, // Kp < 4 = quiet → compact all-clear
    quietNote: "Quiet — no geomagnetic storm. GPS, HF radio and power grids nominal; no aurora at mid-latitudes.",
    scaleKeys: ["geomagneticStorm", "radioBlackout", "solarRadiation", "flareMax24h"],
    bands: [
      { min: 0, label: "Quiet", color: "#16a34a" },
      { min: 4, label: "Unsettled", color: "#eab308" },
      { min: 5, label: "Minor storm (G1)", color: "#f59e0b" },
      { min: 6, label: "Moderate storm (G2)", color: "#ea580c" },
      { min: 7, label: "Strong storm (G3+)", color: "#dc2626" },
    ],
  },
  async fetch() {
    try {
      const now = Date.now();
      const [kpRes, scRes, kp1m, alerts, xray, wind, mag, gfzKp, gfzHp30] = await Promise.all([
        fetch(KP_URL, { signal: AbortSignal.timeout(15_000) }),
        fetch(SCALES_URL, { signal: AbortSignal.timeout(15_000) }),
        // An extra feed falls back to "not there" on any failure: the 3-hour block
        // is still the official Kp, so it alone decides degraded.
        optionalJson<Kp1mRow[]>(KP_1M_URL),
        optionalJson<AlertRow[]>(ALERTS_URL),
        optionalJson<XrayRow[]>(XRAY_URL),
        optionalJson<WindRow[]>(WIND_URL),
        optionalJson<MagRow[]>(MAG_URL),
        optionalJson<GfzSeries>(gfzUrl("Kp", now)),
        optionalJson<GfzSeries>(gfzUrl("Hp30", now)),
      ]);
      if (!kpRes.ok) return degraded(`http ${kpRes.status}`);
      const kp = (await kpRes.json()) as KpRow[];
      const scales = scRes.ok ? ((await scRes.json()) as Record<string, ScaleBlock>) : {};
      return observed(
        normalizeSpaceWeather({
          kp: Array.isArray(kp) ? kp : [],
          scales0: scales["0"],
          kp1m: Array.isArray(kp1m) ? kp1m : undefined,
          alerts: Array.isArray(alerts) ? alerts : undefined,
          xray: Array.isArray(xray) ? xray : undefined,
          wind: Array.isArray(wind) ? wind : undefined,
          mag: Array.isArray(mag) ? mag : undefined,
          gfzKp: gfzKp && typeof gfzKp === "object" ? gfzKp : undefined,
          gfzHp30: gfzHp30 && typeof gfzHp30 === "object" ? gfzHp30 : undefined,
          now,
        }),
      );
    } catch {
      return degraded("fetch failed");
    }
  },
};
