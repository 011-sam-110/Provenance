// The tropical-cyclone warning centres outside NOAA NHC's basins.
//
// WHY. Measured 2026-10-16 (the source audit): the layer showed 2 of the 4 warned
// systems on Earth. NHC covers only the Atlantic and the East and Central Pacific; it
// missed Tropical Storm 29W Champi (West Pacific, 60 kt, forecast to become a super
// typhoon) and Tropical Cyclone 01P (South Pacific, a warning in force for Suwarrow).
//
//   JTWC (US Navy / Air Force)  every other basin, 1-minute winds like NHC, so the
//                               Saffir-Simpson colours stay valid. US federal work,
//                               public domain. The plotted storm outside NHC's basins.
//   JMA (RSMC Tokyo)            the WMO centre for the West Pacific. 10-minute winds.
//                               Public Data License 1.0 (CC BY 4.0 compatible); credit
//                               "Source: Japan Meteorological Agency".
//   CMA (NMC Beijing)           a second West Pacific opinion. 2-minute winds, m/s.
//                               No stated licence; shown as a labelled reading only.
//
// WIND AVERAGING IS NOT A DETAIL. 10-minute winds are about 0.88 to 0.93 of 1-minute
// winds, so a JMA or CMA value must never be fed into the Saffir-Simpson colours. They
// are added to a JTWC storm as labelled fields ("JMA 10-min wind: 65 kt"). A storm only
// JMA or CMA reports is plotted in a neutral colour with its averaging named.
//
// All parsers here are PURE; lib/signals/tropical-cyclones.ts does the fetching.

import type { SignalFeature } from "@/lib/signals/types";
import { cycloneCategory } from "@/lib/signals/cycloneCategory";

/** The colour of a storm whose wind is not on the 1-minute scale. */
export const NON_SAFFIR_COLOR = "#64748b";

// --- JTWC -----------------------------------------------------------------------

/** One warned system as the JTWC RSS lists it. */
export interface JtwcListing {
  /** File stem, e.g. "wp2926": basin letters + number + year. */
  file: string;
  /** "Tropical Storm", "Typhoon", "Tropical Cyclone"… */
  classification: string;
  /** ATCF short id, e.g. "29W". */
  atcf: string;
  name: string;
  warning: number;
}

/**
 * Pure: the JTWC RSS → the warned systems in JTWC's own basins. EP and CP files
 * (JTWC also issues those for military users) are skipped: NHC is the authority there.
 */
export function parseJtwcRss(xml: string): JtwcListing[] {
  const out: JtwcListing[] = [];
  const seen = new Set<string>();
  // Each system: "<b>Tropical Storm  29W (Champi) Warning #09 </b>" then its links.
  const heads = [...xml.matchAll(/<b>\s*([A-Za-z][A-Za-z -]*?)\s+(\d{2}[A-Z])\s+\(([^)]*)\)\s+Warning\s+#?(\d+)/g)];
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1]!.index! : xml.length;
    const block = xml.slice(h.index!, end);
    const file = /products\/((?:wp|io|sh)\d{4})\.tcw/i.exec(block)?.[1]?.toLowerCase();
    if (!file || seen.has(file)) return;
    seen.add(file);
    out.push({
      file,
      classification: h[1]!.replace(/\s+/g, " ").trim(),
      atcf: h[2]!,
      name: h[3]!.trim(),
      warning: Number(h[4]),
    });
  });
  return out;
}

/** The current position and intensity a JTWC `.tcw` warning carries. */
export interface JtwcFix {
  validTime: string;
  atcf: string;
  name: string;
  warning: number;
  lat: number;
  lon: number;
  windKt: number;
  /** Direction of motion, degrees, and speed in kt. */
  dir: number | null;
  speedKt: number | null;
}

/** Pure: "114N" / "1633W" → signed degrees (tenths). */
export function jtwcCoord(s: string): number {
  const m = /^(\d+)([NSEW])$/.exec(s.trim());
  if (!m) return Number.NaN;
  const v = Number(m[1]) / 10;
  return m[2] === "S" || m[2] === "W" ? -v : v;
}

/**
 * Pure: a JTWC `.tcw` (JMV 3.0) warning → the storm now.
 *
 *   line 3  "2026101612 29W CHAMPI     009  01 275 13 SATL 030"
 *           valid time (YYYYMMDDHH, UTC), id, name, warning no., ?, direction, speed
 *   T000    "T000 114N 1514E 060 R050 …"  lat, lon, max wind (kt, 1-minute)
 */
export function parseJtwcTcw(text: string): JtwcFix | null {
  const lines = text.split(/\r?\n/);
  const head = lines.find((l) => /^\d{10}\s+\d{2}[A-Z]\s/.test(l.trim()))?.trim();
  const t0 = lines.find((l) => l.trim().startsWith("T000"))?.trim();
  if (!head || !t0) return null;
  const h = head.split(/\s+/);
  const t = t0.split(/\s+/);
  const lat = jtwcCoord(t[1] ?? "");
  const lon = jtwcCoord(t[2] ?? "");
  const windKt = Number(t[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(windKt)) return null;
  const v = h[0]!;
  const validTime = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(8, 10)}:00:00.000Z`;
  if (!Number.isFinite(Date.parse(validTime))) return null;
  const dir = Number(h[5]);
  const speed = Number(h[6]);
  return {
    validTime,
    atcf: h[1]!,
    name: h[2]!,
    warning: Number(h[3]),
    lat,
    lon,
    windKt,
    dir: Number.isFinite(dir) ? dir : null,
    speedKt: Number.isFinite(speed) ? speed : null,
  };
}

/**
 * Pure: the label of a JTWC storm. The colour is Saffir-Simpson (valid: JTWC winds
 * are 1-minute), the word is the basin's: a typhoon in the West Pacific (super
 * typhoon from 130 kt, JTWC's own threshold), a tropical cyclone elsewhere.
 */
export function jtwcCategory(file: string, windKt: number): { label: string; color: string } {
  const ss = cycloneCategory("", windKt);
  if (windKt < 64) return ss;
  const cat = /Cat (\d)/.exec(ss.label)?.[1];
  const strength = cat ? ` (Cat ${cat} strength)` : "";
  if (file.startsWith("wp")) return { label: `${windKt >= 130 ? "super typhoon" : "typhoon"}${strength}`, color: ss.color };
  return { label: `tropical cyclone${strength}`, color: ss.color };
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Pure: one JTWC listing + its warning → a storm feature. */
export function jtwcFeature(listing: JtwcListing, fix: JtwcFix): SignalFeature {
  const cat = jtwcCategory(listing.file, fix.windKt);
  const named = listing.name && !/^(one|two|three|four|five|six|seven|eight|nine|ten|invest)$/i.test(listing.name);
  const name = named ? titleCase(listing.name) : listing.atcf;
  return {
    id: `cyclone:jtwc:${listing.file}`,
    lat: fix.lat,
    lon: fix.lon,
    title: `${name === listing.atcf ? name : `${name} (${listing.atcf})`} — ${cat.label}`,
    signalId: "tropical-cyclones",
    precision: "exact",
    color: cat.color,
    link: `https://www.metoc.navy.mil/jtwc/products/${listing.file}web.txt`,
    ts: fix.validTime,
    props: {
      storm: name,
      category: cat.label,
      maxWind: `${fix.windKt} kt (1-min, JTWC)`,
      windKt: fix.windKt,
      movement: fix.dir != null && fix.speedKt != null ? `${fix.dir}° at ${fix.speedKt} kt` : "—",
      warning: `JTWC ${listing.atcf} warning #${listing.warning}`,
      agency: "JTWC",
      updated: fix.validTime,
      magnitude: Math.min(10, Math.max(3, fix.windKt / 15)),
    },
  };
}

// --- JMA (RSMC Tokyo) ---------------------------------------------------------------

/** A West Pacific storm as JMA analyses it now. */
export interface AgencyStorm {
  agency: "JMA" | "CMA";
  name: string;
  lat: number;
  lon: number;
  /** Sustained wind in kt on the agency's own averaging. */
  windKt: number | null;
  averaging: "10-min" | "2-min";
  pressureHpa: number | null;
  classification: string;
  validTime: string;
  link: string;
}

interface JmaSpecPart {
  part?: unknown;
  advancedHours?: number;
  name?: { en?: string };
  typhoonNumber?: string;
  category?: { en?: string };
  maximumWind?: { sustained?: { kt?: string } };
  position?: { deg?: [number, number] };
  pressure?: string;
  validtime?: { UTC?: string };
}

/**
 * Pure: one storm's JMA `specifications.json` → its analysis now. The first part is
 * the title (name, number); the part with `advancedHours: 0` is the analysis.
 */
export function parseJmaTyphoon(spec: JmaSpecPart[]): AgencyStorm | null {
  if (!Array.isArray(spec)) return null;
  const title = spec.find((p) => p.part === "title");
  const now = spec.find((p) => p.advancedHours === 0);
  const deg = now?.position?.deg;
  if (!now || !deg || !Number.isFinite(deg[0]) || !Number.isFinite(deg[1])) return null;
  const wind = Number(now.maximumWind?.sustained?.kt);
  const p = Number(now.pressure);
  const num = title?.typhoonNumber ?? "";
  return {
    agency: "JMA",
    name: title?.name?.en?.trim() || `TC${num}`,
    lat: deg[0],
    lon: deg[1],
    windKt: Number.isFinite(wind) ? wind : null,
    averaging: "10-min",
    pressureHpa: Number.isFinite(p) ? p : null,
    classification: now.category?.en ?? title?.category?.en ?? "—",
    validTime: now.validtime?.UTC ?? "",
    link: "https://www.jma.go.jp/bosai/map.html#contents=typhoon&lang=en",
  };
}

// --- CMA (NMC Beijing) --------------------------------------------------------------

/** Pure: strip a JSONP wrapper `name((…))` or `name(…)` and parse the JSON inside. */
export function unwrapJsonp(text: string): unknown {
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end <= start) return null;
  let inner = text.slice(start + 1, end).trim();
  while (inner.startsWith("(") && inner.endsWith(")")) inner = inner.slice(1, -1).trim();
  try {
    return JSON.parse(inner);
  } catch {
    return null;
  }
}

/** Pure: the CMA storm list → the ids of the storms it marks active ("start"). */
export function cmaActiveIds(list: unknown): { id: number; name: string }[] {
  const rows = (list as { typhoonList?: unknown[][] } | null)?.typhoonList;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => Array.isArray(r) && r[7] === "start" && typeof r[0] === "number")
    .map((r) => ({ id: r[0] as number, name: String(r[1] ?? "") }));
}

/**
 * Pure: one CMA storm view → its newest analysed point. A point is
 * `[id, "YYYYMMDDHHmm" (UTC), epochMs, class, LON, LAT, hPa, m/s, dir, km/h, …]`;
 * note the longitude comes first.
 */
export function parseCmaView(view: unknown, id: number): AgencyStorm | null {
  const t = (view as { typhoon?: unknown[] } | null)?.typhoon;
  if (!Array.isArray(t)) return null;
  const pts = t[8];
  if (!Array.isArray(pts) || pts.length === 0) return null;
  const last = pts[pts.length - 1] as unknown[];
  const lon = Number(last[4]);
  const lat = Number(last[5]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ms = Number(last[7]);
  const hpa = Number(last[6]);
  const epoch = Number(last[2]);
  return {
    agency: "CMA",
    name: String(t[1] ?? "").trim() || String(id),
    lat,
    lon,
    windKt: Number.isFinite(ms) ? Math.round(ms * 1.943844) : null,
    averaging: "2-min",
    pressureHpa: Number.isFinite(hpa) ? hpa : null,
    classification: String(last[3] ?? "—"),
    validTime: Number.isFinite(epoch) ? new Date(epoch).toISOString() : "",
    link: "http://typhoon.nmc.cn/web.html",
  };
}

// --- joining them -----------------------------------------------------------------------

const near = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const dLon = Math.abs(((a.lon - b.lon + 540) % 360) - 180);
  return Math.abs(a.lat - b.lat) <= 1.5 && dLon <= 1.5;
};
const sameName = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * Pure: add each JMA / CMA reading to the JTWC storm it describes (same name, or
 * within 1.5°), as labelled fields. A reading no JTWC storm matches becomes its own
 * storm, coloured neutral and labelled with its averaging, so a West Pacific storm is
 * not lost when JTWC is down. Two agency readings of one such storm join each other.
 */
export function joinAgencyReadings(jtwc: SignalFeature[], readings: AgencyStorm[]): SignalFeature[] {
  const out = jtwc.map((f) => ({ ...f, props: { ...f.props } }));
  for (const r of readings) {
    const label = `${r.agency} ${r.averaging} wind`;
    const value = r.windKt != null ? `${r.windKt} kt` : "—";
    const host = out.find(
      (f) => sameName(String(f.props?.storm ?? ""), r.name) || (f.signalId === "tropical-cyclones" && near(f, r)),
    );
    if (host) {
      host.props![label] = value;
      host.props![`${r.agency} class`] = r.classification;
      if (r.pressureHpa != null) host.props![`${r.agency} pressure`] = `${r.pressureHpa} hPa`;
      continue;
    }
    out.push({
      id: `cyclone:${r.agency.toLowerCase()}:${r.name.toUpperCase()}`,
      lat: r.lat,
      lon: r.lon,
      title: `${titleCase(r.name)} — ${r.classification} (${r.agency})`,
      signalId: "tropical-cyclones",
      precision: "exact",
      color: NON_SAFFIR_COLOR,
      link: r.link,
      ts: r.validTime || undefined,
      props: {
        storm: titleCase(r.name),
        category: `${r.classification} (${r.agency} scale, not Saffir-Simpson)`,
        [label]: value,
        ...(r.pressureHpa != null ? { [`${r.agency} pressure`]: `${r.pressureHpa} hPa` } : {}),
        agency: r.agency,
        updated: r.validTime || "—",
        // Sized from the agency's own wind, which reads low against a 1-minute scale.
        magnitude: Math.min(10, Math.max(3, (r.windKt ?? 0) / 15)),
      },
    });
  }
  return out;
}
