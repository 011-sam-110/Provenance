import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { cycloneCategory } from "@/lib/signals/cycloneCategory";
import {
  cmaActiveIds,
  joinAgencyReadings,
  jtwcFeature,
  parseCmaView,
  parseJmaTyphoon,
  parseJtwcRss,
  parseJtwcTcw,
  unwrapJsonp,
  type AgencyStorm,
} from "@/lib/signals/cycloneAgencies";

export { cycloneCategory };

// Tropical cyclones — every warned storm on Earth, at its current centre.
//
//   NOAA NHC  CurrentStorms.json: the Atlantic, East and Central Pacific storms, each
//             plotted at its current centre, coloured by Saffir–Simpson category and
//             sized by max wind. NHC's forecast cones and outlook areas are FORECASTS,
//             not storms, so they are their own layer (lib/signals/cyclone-forecasts.ts)
//             and do not turn up as storms in the event lists that read this one.
//   JTWC      every other basin (West Pacific, North Indian Ocean, Southern
//             Hemisphere), on the same 1-minute wind scale. See
//             lib/signals/cycloneAgencies.ts for why, and for JMA and CMA, whose
//             10-minute and 2-minute readings are added to a storm as labelled fields.
//
// Until 2026-10-16 this layer read NHC alone and was labelled "Tropical cyclones
// (NHC)"; that day it showed 2 of the 4 warned systems on Earth.
//
// FAILURE. NHC and JTWC are the storm sources: if either fails the other's storms are
// still shown and the layer says which failed (`degradedWith`). JMA and CMA add to
// those storms; one of them failing loses that addition only, and does not mark the
// storms degraded.
//
// The feed is `{ activeStorms: [] }` when NHC has nothing active, so the layer renders
// empty and lights up the moment a storm forms — no dead feed, no stale dot.

export const NHC_CURRENT_STORMS = "https://www.nhc.noaa.gov/CurrentStorms.json";
const JTWC_RSS = "https://www.metoc.navy.mil/jtwc/rss/jtwc.rss";
const JTWC_PRODUCTS = "https://www.metoc.navy.mil/jtwc/products";
const JMA_TARGET = "https://www.jma.go.jp/bosai/typhoon/data/targetTc.json";
const CMA_LIST = "http://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const NHC_ATTRIBUTION =
  "Tropical-cyclone data © NOAA NHC; JTWC (US Navy / Air Force); Source: Japan Meteorological Agency; China Meteorological Administration";

export interface NhcStorm {
  id?: string;
  name?: string;
  classification?: string; // TD, TS, HU, MH, STD, STS, …
  intensity?: string | number; // max sustained wind, kt
  pressure?: string | number; // mb
  latitude?: string; // "22.5N"
  longitude?: string; // "95.3W"
  latitudeNumeric?: number;
  longitudeNumeric?: number;
  movementDir?: number | string;
  movementSpeed?: number | string;
  lastUpdate?: string;
  trackCone?: { kmzFile?: string; advNum?: string; issuance?: string } | null;
  publicAdvisory?: { url?: string } | null;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : Number.NaN;
  const s = (v ?? "").toString().trim();
  if (s === "") return Number.NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Parse "22.5N" / "95.3W" → signed decimal degrees. */
function parseCoord(s: string | undefined): number {
  if (!s) return Number.NaN;
  const m = s.trim().match(/^([\d.]+)\s*([NSEW])$/i);
  if (!m) return Number.NaN;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return Number.NaN;
  const hemi = m[2].toUpperCase();
  return hemi === "S" || hemi === "W" ? -v : v;
}

/** Pure: NHC active-storms payload → SignalFeature[] (one point per storm). */
export function normalizeCyclones(json: { activeStorms?: NhcStorm[] }): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const s of json.activeStorms ?? []) {
    let lat = typeof s.latitudeNumeric === "number" ? s.latitudeNumeric : parseCoord(s.latitude);
    let lon = typeof s.longitudeNumeric === "number" ? s.longitudeNumeric : parseCoord(s.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    lat = Math.round(lat * 1000) / 1000;
    lon = Math.round(lon * 1000) / 1000;
    const wind = Math.max(0, toNum(s.intensity) || 0);
    const cat = cycloneCategory(s.classification ?? "", wind);
    const name = s.name?.trim() || s.id?.trim() || "Tropical system";
    const dir = toNum(s.movementDir);
    const spd = toNum(s.movementSpeed);
    const pressure = toNum(s.pressure);
    out.push({
      id: `cyclone:${s.id?.trim() || name}`,
      lat,
      lon,
      title: `${name} — ${cat.label}`,
      signalId: "tropical-cyclones",
      color: cat.color,
      ...(s.publicAdvisory?.url ? { link: s.publicAdvisory.url } : {}),
      ts: s.lastUpdate ?? undefined,
      props: {
        storm: name,
        category: cat.label,
        maxWind: wind > 0 ? `${wind} kt` : "—",
        // Real scalar behind the metric bar: max sustained wind in knots.
        windKt: wind,
        pressure: Number.isFinite(pressure) ? `${pressure} mb` : "—",
        movement:
          Number.isFinite(dir) && Number.isFinite(spd) ? `${dir}° at ${spd} kt` : "—",
        updated: s.lastUpdate ?? "—",
        // Wind 137 kt (Cat 5) ≈ max radius.
        magnitude: Math.min(10, Math.max(3, wind / 15)),
      },
    });
  }
  return out;
}

// --- fetching ----------------------------------------------------------------------

async function get(url: string, accept: string): Promise<Response> {
  return fetch(url, { headers: { "User-Agent": UA, Accept: accept }, signal: AbortSignal.timeout(15_000) });
}

const why = (e: unknown) => ((e as Error)?.name === "TimeoutError" ? "timeout" : "fetch failed");

interface Part {
  ok: boolean;
  rows: SignalFeature[];
  reason?: string;
}

async function readNhc(): Promise<Part> {
  try {
    const res = await get(NHC_CURRENT_STORMS, "application/json");
    if (!res.ok) return { ok: false, rows: [], reason: `http ${res.status}` };
    return { ok: true, rows: normalizeCyclones((await res.json()) as { activeStorms?: NhcStorm[] }) };
  } catch (e) {
    return { ok: false, rows: [], reason: why(e) };
  }
}

async function readJtwc(): Promise<Part> {
  try {
    const res = await get(JTWC_RSS, "application/rss+xml");
    if (!res.ok) return { ok: false, rows: [], reason: `http ${res.status}` };
    const listings = parseJtwcRss(await res.text()).slice(0, 10);
    const rows: SignalFeature[] = [];
    let failed = 0;
    // One at a time: a handful of small files, and the site is one host.
    for (const l of listings) {
      try {
        const r = await get(`${JTWC_PRODUCTS}/${l.file}.tcw`, "text/plain");
        const fix = r.ok ? parseJtwcTcw(await r.text()) : null;
        if (fix) rows.push(jtwcFeature(l, fix));
        else failed++;
      } catch {
        failed++;
      }
    }
    return failed > 0
      ? { ok: false, rows, reason: `${failed} of ${listings.length} JTWC warnings unreadable` }
      : { ok: true, rows };
  } catch (e) {
    return { ok: false, rows: [], reason: why(e) };
  }
}

async function readJma(): Promise<AgencyStorm[]> {
  try {
    const res = await get(JMA_TARGET, "application/json");
    if (!res.ok) return [];
    const target = (await res.json()) as { tropicalCyclone?: string }[];
    const ids = (Array.isArray(target) ? target : [])
      .map((t) => t.tropicalCyclone)
      .filter((id): id is string => typeof id === "string" && /^TC\d+$/.test(id))
      .slice(0, 6);
    const out: AgencyStorm[] = [];
    for (const id of ids) {
      const r = await get(`https://www.jma.go.jp/bosai/typhoon/data/${id}/specifications.json`, "application/json");
      const s = r.ok ? parseJmaTyphoon(await r.json()) : null;
      if (s) out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}

async function readCma(): Promise<AgencyStorm[]> {
  try {
    const res = await get(CMA_LIST, "application/javascript");
    if (!res.ok) return [];
    const out: AgencyStorm[] = [];
    for (const { id } of cmaActiveIds(unwrapJsonp(await res.text())).slice(0, 6)) {
      const r = await get(`http://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_${id}`, "application/javascript");
      const s = r.ok ? parseCmaView(unwrapJsonp(await r.text()), id) : null;
      if (s) out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}

/** Pure: fold the storm sources and the additions into the outcome-tagged layer. */
export function cycloneLayerFrom(
  parts: { nhc: Part; jtwc: Part; agencies: AgencyStorm[] },
  at: number,
): SignalFeature[] {
  const { nhc, jtwc } = parts;
  if (!nhc.ok && !jtwc.ok && nhc.rows.length === 0 && jtwc.rows.length === 0) {
    return degraded(nhc.reason ?? jtwc.reason ?? "upstream read failed", at);
  }
  const rows = [...nhc.rows, ...joinAgencyReadings(jtwc.rows, parts.agencies)];
  const failed = [!nhc.ok ? `NHC (${nhc.reason})` : null, !jtwc.ok ? `JTWC (${jtwc.reason})` : null].filter(Boolean);
  return failed.length ? degradedWith(rows, `partial: ${failed.join(", ")} failed`, at) : observed(rows, at);
}

export const TROPICAL_CYCLONES_SOURCE: SignalSource = {
  id: "tropical-cyclones",
  // The storm centre from the current advisory or warning.
  precision: "exact",
  label: "Tropical cyclones (NHC + JTWC)",
  group: "Natural hazards",
  color: "#dc2626",
  refreshMs: 30 * 60 * 1000,
  attribution: NHC_ATTRIBUTION,
  // Max sustained wind (kt): calm ≈ tropical-storm threshold (34 kt),
  // extreme ≈ a strong Cat 5 (≥160 kt).
  metric: { field: "windKt", domain: [34, 160], unit: " kt" },
  async fetch() {
    const at = Date.now();
    const [nhc, jtwc, jma, cma] = await Promise.all([readNhc(), readJtwc(), readJma(), readCma()]);
    return cycloneLayerFrom({ nhc, jtwc, agencies: [...jma, ...cma] }, at);
  },
};
