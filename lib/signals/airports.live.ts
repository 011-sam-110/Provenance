import type { SignalFeature } from "@/lib/signals/types";

// Live state on the major-airport pins. The directory (OurAirports, airports.ts) says
// WHERE the airports are; these five keyless feeds say what is happening there now.
// Each one is optional and fails on its own: a dead feed leaves the pins it would
// have touched exactly as the directory drew them, and never empties the layer.
//
//   AWC METAR cache   flight category (VFR/MVFR/IFR/LIFR) + the raw report, worldwide.
//                     NOAA / NWS Aviation Weather Center, public domain. Measured
//                     2026-10-16: joins 1,014 of 1,176 large airports by ICAO.
//   AWC TAF cache     the raw terminal forecast, for the detail panel. Same operator.
//   FAA NAS status    ground stops, ground delay programmes, closures, delays. US
//                     (and a few Canadian airports). FAA ATCSCC, public domain.
//   Avinor            per-flight delayed / cancelled flags at Avinor's airports
//                     (Norway). Terms: no limits on use within Norwegian law; poll
//                     no faster than every 3 minutes.
//   HKIA              departures and arrivals at Hong Kong with their status
//                     (Airport Authority Hong Kong, DATA.GOV.HK terms).
//
// A pin with no live field means NO FEED covers it — not normal operations.

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR";

export interface MetarReading {
  category?: FlightCategory;
  /** ISO observation time of the report itself (not our read). */
  at: string;
  raw: string;
}

export interface TafReading {
  raw: string;
  /** ISO issue time. */
  issued: string;
}

export type FaaKind = "closure" | "ground-stop" | "ground-delay" | "delay" | "restriction";

export interface FaaEvent {
  /** 3-letter code as the FAA publishes it (an FAA LID, equal to the IATA code for
   *  airline airports). */
  code: string;
  kind: FaaKind;
  /** The FAA's stated cause, verbatim. */
  reason: string;
  /** End time / reopening / average and maximum delay. May be "". */
  detail: string;
}

export interface FlightBoard {
  /** Who published it, for the dossier. */
  source: string;
  /** What "delayed" means on this board, in words. */
  delayRule: string;
  /** Flights in the window that carry a status. */
  tracked: number;
  delayed: number;
  cancelled: number;
  /** ISO time the publisher last updated the board. */
  at?: string;
}

export interface AirportLive {
  metar?: Map<string, MetarReading>;
  taf?: Map<string, TafReading>;
  faa?: FaaEvent[];
  /** IATA → board. */
  boards?: Map<string, FlightBoard>;
}

// --- shared XML helpers (the feeds are flat, well-formed XML) -------------------

/** Innermost text of the FIRST <tag> in a fragment, trimmed and unescaped. "" when absent. */
export function tagText(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  if (!m) return "";
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every <tag>…</tag> block in a fragment, as raw inner XML. */
export function tagBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** Same as tagBlocks but keeps the opening tag's attributes: [attrs, inner][]. */
function tagBlocksWithAttrs(xml: string, tag: string): [string, string][] {
  const out: [string, string][] = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push([m[1], m[2]]);
  return out;
}

// --- METAR -----------------------------------------------------------------------

const CATEGORIES = new Set(["VFR", "MVFR", "IFR", "LIFR"]);

/**
 * Pure: the AWC METAR cache CSV (`metars.cache.csv`, already gunzipped and split into
 * rows) → station → newest reading. Columns are found by name, because the file
 * repeats `sky_cover` and `cloud_base_ft_agl` and its column order is not promised.
 */
export function parseMetarRows(rows: string[][]): Map<string, MetarReading> {
  const out = new Map<string, MetarReading>();
  const hi = rows.findIndex((r) => r.includes("station_id") && r.includes("raw_text"));
  if (hi < 0) return out;
  const h = rows[hi];
  const iRaw = h.indexOf("raw_text");
  const iId = h.indexOf("station_id");
  const iAt = h.indexOf("observation_time");
  const iCat = h.indexOf("flight_category");
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const id = (row[iId] ?? "").trim().toUpperCase();
    const at = (row[iAt] ?? "").trim();
    if (!id || !at) continue;
    const prev = out.get(id);
    if (prev && prev.at >= at) continue; // keep the newest report per station
    const cat = (iCat >= 0 ? row[iCat] ?? "" : "").trim().toUpperCase();
    out.set(id, {
      at,
      raw: (row[iRaw] ?? "").trim(),
      ...(CATEGORIES.has(cat) ? { category: cat as FlightCategory } : {}),
    });
  }
  return out;
}

// --- TAF -------------------------------------------------------------------------

/** Pure: the AWC TAF cache XML → station → newest raw forecast. */
export function parseTafXml(xml: string): Map<string, TafReading> {
  const out = new Map<string, TafReading>();
  for (const block of tagBlocks(xml, "TAF")) {
    const id = tagText(block, "station_id").toUpperCase();
    const raw = tagText(block, "raw_text");
    const issued = tagText(block, "issue_time");
    if (!id || !raw) continue;
    const prev = out.get(id);
    if (prev && prev.issued >= issued) continue;
    out.set(id, { raw, issued });
  }
  return out;
}

// --- FAA NAS status (parser from the retired faa.ts, bbe9651^) --------------------

/** Severity ordering: a closed airport outranks a stop, which outranks a delay. */
export const FAA_KINDS: Record<FaaKind, { label: string; color: string; rank: number }> = {
  closure: { label: "Airport closed", color: "#7f1d1d", rank: 9 },
  "ground-stop": { label: "Ground stop", color: "#dc2626", rank: 7 },
  "ground-delay": { label: "Ground delay programme", color: "#ea580c", rank: 5 },
  delay: { label: "Delays", color: "#f59e0b", rank: 3 },
  restriction: { label: "Partial restriction", color: "#94a3b8", rank: 1 },
};

/**
 * Most entries in the FAA's "Airport Closures" block are NOT closures. LAX and SAN are
 * listed there with "AD AP CLSD TO NON SKED TRANSIENT GA ACFT" (closed to unscheduled
 * general aviation while every airline flight operates), and SNA with "AD AP CLSD DLY
 * 0630-1315" (its nightly curfew window, in UTC). Both are restrictions. A bare "CLSD"
 * is a real closure. The raw NOTAM is carried either way so a reader can check the call.
 */
export function closureSeverity(reason: string): "closure" | "restriction" {
  return /\bCLSD\s+(TO|DLY)\b/i.test(reason) ? "restriction" : "closure";
}

/** Which Delay_type block is this? Null for a block we do not model. */
export function kindForDelayType(name: string): FaaKind | null {
  const n = name.toLowerCase();
  if (n.includes("closure")) return "closure";
  if (n.includes("ground stop")) return "ground-stop";
  if (n.includes("ground delay")) return "ground-delay";
  if (n.includes("delay")) return "delay";
  return null;
}

/** Pure: the FAA XML → one event per affected airport, the most severe one winning. */
export function parseFaaStatus(xml: string): FaaEvent[] {
  const byCode = new Map<string, FaaEvent>();
  for (const block of tagBlocks(xml, "Delay_type")) {
    const kind = kindForDelayType(tagText(block, "Name"));
    if (!kind) continue;
    const entries = [
      ...tagBlocks(block, "Program"),
      ...tagBlocks(block, "Ground_Delay"),
      ...tagBlocks(block, "Delay"),
      ...tagBlocks(block, "Airport"),
    ];
    for (const entry of entries) {
      const code = tagText(entry, "ARPT").toUpperCase();
      if (!/^[A-Z0-9]{3,4}$/.test(code)) continue;
      const reason = tagText(entry, "Reason") || "not stated";
      const resolved: FaaKind = kind === "closure" ? closureSeverity(reason) : kind;
      const existing = byCode.get(code);
      if (existing && FAA_KINDS[existing.kind].rank >= FAA_KINDS[resolved].rank) continue;
      const min = tagText(entry, "Min");
      const max = tagText(entry, "Max");
      const detail = [
        tagText(entry, "End_Time") && `until ${tagText(entry, "End_Time")}`,
        tagText(entry, "Reopen") && `reopens ${tagText(entry, "Reopen")}`,
        tagText(entry, "Avg") && `avg ${tagText(entry, "Avg")}`,
        min && max ? `${min} to ${max}` : max && `max ${max}`,
        tagText(entry, "Trend").toLowerCase(),
      ]
        .filter(Boolean)
        .join(", ");
      byCode.set(code, { code, kind: resolved, reason, detail });
    }
  }
  return [...byCode.values()];
}

// --- Avinor -------------------------------------------------------------------------

/** The Avinor airports that OurAirports can class as large (TRF is private, not Avinor). */
export const AVINOR_AIRPORTS = ["OSL", "BGO", "TRD", "SVG", "BOO", "TOS", "AES", "EVE", "KRS"] as const;

/** Pure: one Avinor XmlFeed answer → a board (delayed flag Y, status code C = cancelled). */
export function parseAvinorXml(xml: string): FlightBoard {
  const at = /<flights\b[^>]*\blastUpdate="([^"]+)"/i.exec(xml)?.[1];
  let tracked = 0;
  let delayed = 0;
  let cancelled = 0;
  for (const [, inner] of tagBlocksWithAttrs(xml, "flight")) {
    tracked++;
    if (/<delayed>\s*Y\s*<\/delayed>/i.test(inner)) delayed++;
    if (/<status\b[^>]*\bcode="C"/i.test(inner)) cancelled++;
  }
  return { source: "Avinor", delayRule: "flagged delayed by Avinor", tracked, delayed, cancelled, ...(at ? { at } : {}) };
}

// --- Hong Kong International Airport ----------------------------------------------------

export interface HkiaDay {
  date?: string;
  list?: { time?: string; status?: string }[];
  lastUpdatedTime?: string;
}

/** Minutes since a local "YYYY-MM-DD" + "HH:MM", for comparing two local times. */
function localMinutes(date: string, hhmm: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!d || !t) return null;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) / 60_000;
}

/** A delay this long or longer counts as delayed (the usual on-time threshold). */
export const DELAY_THRESHOLD_MIN = 15;

/**
 * Pure: HKIA flight-information days (departures or arrivals) → a board. A flight is
 * counted only when it carries a status. Its delay is the stated time ("Dep 00:24
 * (17/10/2026)", "Dep 00:04", "At gate 00:12 (…)", "Est at 05:59 (…)") minus the
 * scheduled time, both Hong Kong local.
 */
export function parseHkiaBoard(days: HkiaDay[]): FlightBoard {
  let tracked = 0;
  let delayed = 0;
  let cancelled = 0;
  let at: string | undefined;
  for (const day of days ?? []) {
    if (day.lastUpdatedTime) at = day.lastUpdatedTime;
    for (const f of day.list ?? []) {
      const status = (f.status ?? "").trim();
      if (!status) continue;
      tracked++;
      if (/cancel/i.test(status)) {
        cancelled++;
        continue;
      }
      // "Dep 00:24 (17/10/2026)" names its day when it differs from the list's day;
      // "Dep 00:04" is on the list's own day.
      const m = /(\d{1,2}:\d{2})(?:\s*\((\d{2})\/(\d{2})\/(\d{4})\))?/.exec(status);
      if (!m || !day.date || !f.time) continue;
      const actual = localMinutes(m[4] ? `${m[4]}-${m[3]}-${m[2]}` : day.date, m[1]);
      const sched = localMinutes(day.date, f.time);
      if (actual != null && sched != null && actual - sched >= DELAY_THRESHOLD_MIN) delayed++;
    }
  }
  return {
    source: "Airport Authority Hong Kong",
    delayRule: `${DELAY_THRESHOLD_MIN}+ min after schedule`,
    tracked, delayed, cancelled, ...(at ? { at } : {}) };
}

/** Today's date in Hong Kong (UTC+8, no DST), for the HKIA query. */
export function hongKongDate(now: number): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

// --- applying it to the pins ------------------------------------------------------------

const CATEGORY_COLOR: Partial<Record<FlightCategory, string>> = {
  IFR: "#7c3aed",
  LIFR: "#7c3aed",
};

/**
 * Pure: the directory features + whatever live state was read → new features with
 * the live props. Never drops or adds a pin. A pin keeps the directory colour unless
 * the FAA reports a disruption or the weather is IFR/LIFR.
 */
export function applyAirportLive(features: SignalFeature[], live: AirportLive): SignalFeature[] {
  const faaByCode = new Map((live.faa ?? []).map((e) => [e.code, e]));
  return features.map((f) => {
    const p = f.props ?? {};
    const icao = typeof p.icao === "string" ? p.icao : "";
    const iata = typeof p.iata === "string" ? p.iata : "";
    const extra: Record<string, unknown> = {};
    let color = f.color;

    const metar = icao ? live.metar?.get(icao) : undefined;
    if (metar) {
      if (metar.category) extra.flightCategory = metar.category;
      extra.metar = metar.raw;
      extra.metarAt = metar.at;
      if (metar.category && CATEGORY_COLOR[metar.category]) color = CATEGORY_COLOR[metar.category];
    }
    const taf = icao ? live.taf?.get(icao) : undefined;
    if (taf) {
      extra.taf = taf.raw;
      extra.tafIssued = taf.issued;
    }
    // The FAA names airports by a 3-letter code: the IATA code for airline airports,
    // and the ICAO code without its "K" in the contiguous US.
    const faa =
      (iata ? faaByCode.get(iata) : undefined) ??
      (icao.length === 4 && icao.startsWith("K") ? faaByCode.get(icao.slice(1)) : undefined);
    if (faa) {
      extra.faaStatus = FAA_KINDS[faa.kind].label;
      extra.faaReason = faa.reason;
      if (faa.detail) extra.faaDetail = faa.detail;
      if (faa.kind !== "restriction") color = FAA_KINDS[faa.kind].color;
    }
    const board = iata ? live.boards?.get(iata) : undefined;
    if (board && board.tracked > 0) {
      extra.flights = `${board.delayed} of ${board.tracked} delayed (${board.delayRule}), ${board.cancelled} cancelled`;
      extra.flightsDelayed = board.delayed;
      extra.flightsCancelled = board.cancelled;
      extra.flightsTracked = board.tracked;
      extra.flightSource = board.source;
      if (board.at) extra.flightsAt = board.at;
    }
    if (!Object.keys(extra).length) return f;
    return { ...f, ...(color ? { color } : {}), props: { ...p, ...extra } };
  });
}
