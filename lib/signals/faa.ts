import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { parseAirportsCsv } from "@/lib/signals/airports";

// US airport ground stops, closures and delay programmes — the FAA's own live
// national airspace status feed. Keyless, no signup.
//
// This is one of the few layers on the map that answers a question somebody is
// asking right now — "is my flight affected?" — rather than describing the state
// of the world in general. Neither competing monitor carries it.
//
// The feed is XML (an ancient Java-era endpoint), grouped into Delay_type blocks:
// Ground Stop Programs, Airport Closures, Ground Delay Programs, and General
// Arrival/Departure Delay Info. Airports are named by their 3-letter code only,
// so coordinates are resolved against the OurAirports CSV the airports layer
// already downloads and caches.
//
// COVERAGE, stated plainly here and in the layer explainer: this is the US
// National Airspace System. It is not global, and an empty map outside the US is
// coverage, not calm.

const ENDPOINT = "https://nasstatus.faa.gov/api/airport-status-information";
const AIRPORTS_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const UA = "OpenData/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const REFRESH_MS = 5 * 60_000;
const COORD_TTL_MS = 24 * 60 * 60 * 1000;

export const FAA_ATTRIBUTION = "Airport status © FAA National Airspace System status";

export type FaaKind = "closure" | "ground-stop" | "ground-delay" | "delay" | "restriction";

export interface FaaEvent {
  /** 3-letter airport code as the FAA publishes it. */
  code: string;
  kind: FaaKind;
  /** The FAA's stated cause, verbatim ("thunderstorms", "runway maintenance"). */
  reason: string;
  /** Free-text detail: an end time, an average delay, a trend. May be "". */
  detail: string;
}

interface KindSpec {
  label: string;
  color: string;
  magnitude: number;
}

/** Severity ordering: a closed airport outranks a stop, which outranks a delay. */
export const FAA_KINDS: Record<FaaKind, KindSpec> = {
  closure: { label: "Airport closed", color: "#7f1d1d", magnitude: 9 },
  "ground-stop": { label: "Ground stop", color: "#dc2626", magnitude: 7 },
  "ground-delay": { label: "Ground delay programme", color: "#ea580c", magnitude: 5 },
  delay: { label: "Delays", color: "#f59e0b", magnitude: 3 },
  restriction: { label: "Partial restriction", color: "#94a3b8", magnitude: 1 },
};

/**
 * Most entries in the FAA's "Airport Closures" block are NOT closures.
 *
 * The live feed lists LAX, LAS, PHL and SAN there with NOTAM text like
 * "AD AP CLSD TO NON SKED TRANSIENT GA ACFT" — closed to unscheduled general
 * aviation, while every scheduled airline flight operates normally. Rendering a
 * red "Airport closed" pin on LAX because of that would be one of the most
 * misleading things this map could do, and it is what a naive read of the block
 * name produces.
 *
 * So: "CLSD TO <someone>" is a RESTRICTION. A bare "CLSD", or "CLSD EXC
 * MEDEVAC", is a real closure. The raw NOTAM is carried through either way so a
 * reader can check the call.
 */
export function closureSeverity(reason: string): "closure" | "restriction" {
  return /\bCLSD\s+TO\b/i.test(reason) ? "restriction" : "closure";
}

/** Innermost text of the FIRST <tag> in a fragment, trimmed. "" when absent. */
export function tagText(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  if (!m) return "";
  return m[1]
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

/** Which Delay_type block is this? Null for a block we do not model. */
export function kindForDelayType(name: string): FaaKind | null {
  const n = name.toLowerCase();
  if (n.includes("closure")) return "closure";
  if (n.includes("ground stop")) return "ground-stop";
  if (n.includes("ground delay")) return "ground-delay";
  if (n.includes("delay")) return "delay";
  return null;
}

/**
 * Pure: the FAA XML → one event per affected airport.
 *
 * Each Delay_type block holds Program / Airport entries with an ARPT code. The
 * detail fields differ per block (End_Time on a ground stop, Reopen on a closure,
 * Avg / Max on a delay programme), so they are gathered generically rather than
 * per-shape — the FAA changes these without notice and a missing optional field
 * must never lose the event.
 */
export function parseFaaStatus(xml: string): FaaEvent[] {
  const out: FaaEvent[] = [];

  for (const block of tagBlocks(xml, "Delay_type")) {
    const kind = kindForDelayType(tagText(block, "Name"));
    if (!kind) continue;

    for (const entry of [...tagBlocks(block, "Program"), ...tagBlocks(block, "Airport")]) {
      const code = tagText(entry, "ARPT").toUpperCase();
      if (!/^[A-Z0-9]{3,4}$/.test(code)) continue;

      // Most severe wins: an airport with both a closure and a delay is closed.
      const key = code;
      const existing = out.find((e) => e.code === key);
      const candidate: FaaKind =
        kind === "closure" ? closureSeverity(tagText(entry, "Reason")) : kind;
      if (existing && FAA_KINDS[existing.kind].magnitude >= FAA_KINDS[candidate].magnitude) continue;

      const detail = [
        tagText(entry, "End_Time") && `until ${tagText(entry, "End_Time")}`,
        tagText(entry, "Reopen") && `reopens ${tagText(entry, "Reopen")}`,
        tagText(entry, "Avg") && `avg ${tagText(entry, "Avg")}`,
        tagText(entry, "Max") && `max ${tagText(entry, "Max")}`,
        tagText(entry, "Trend"),
        tagText(entry, "ArrivalDeparture"),
      ]
        .filter(Boolean)
        .join(" · ");

      const reason = tagText(entry, "Reason") || "not stated";
      // A "closure" that is really a partial NOTAM restriction is demoted here.
      const resolved: FaaKind = kind === "closure" ? closureSeverity(reason) : kind;
      const event: FaaEvent = { code, kind: resolved, reason, detail };
      if (existing) out.splice(out.indexOf(existing), 1, event);
      else out.push(event);
    }
  }
  return out;
}

/** Pure: events + an airport-code→position index → map features. */
export function faaFeatures(
  events: FaaEvent[],
  coords: Map<string, { lat: number; lon: number; name: string }>,
  updatedAt: string,
): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const e of events) {
    const at = coords.get(e.code);
    // No coordinates means no honest way to place it. Dropping is right — an
    // invented position on an aviation layer would be worse than an omission.
    if (!at) continue;
    const spec = FAA_KINDS[e.kind];
    out.push({
      id: `faa:${e.code}`,
      lat: at.lat,
      lon: at.lon,
      title: `${e.code} — ${spec.label}`,
      signalId: "faa-airports",
      color: spec.color,
      ts: updatedAt || undefined,
      link: "https://nasstatus.faa.gov/",
      props: {
        airport: at.name,
        code: e.code,
        status: spec.label,
        reason: e.reason,
        ...(e.detail ? { detail: e.detail } : {}),
        magnitude: spec.magnitude,
      },
    });
  }
  return out;
}

/** Pure: the OurAirports CSV → a 3-letter-code index. IATA first, then ident. */
export function airportCodeIndex(csv: string): Map<string, { lat: number; lon: number; name: string }> {
  const index = new Map<string, { lat: number; lon: number; name: string }>();
  for (const f of parseAirportsCsv(csv)) {
    const iata = String(f.props?.iata ?? "").trim().toUpperCase();
    if (iata.length === 3 && !index.has(iata)) {
      index.set(iata, { lat: f.lat, lon: f.lon, name: f.title });
    }
  }
  return index;
}

let coordCache: { index: Map<string, { lat: number; lon: number; name: string }>; at: number } | null = null;

async function coordIndex(): Promise<Map<string, { lat: number; lon: number; name: string }>> {
  if (coordCache && Date.now() - coordCache.at < COORD_TTL_MS) return coordCache.index;
  const res = await fetch(AIRPORTS_CSV, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(20_000),
    next: { revalidate: 86_400 },
  });
  if (!res.ok) throw new Error(`airports CSV HTTP ${res.status}`);
  const index = airportCodeIndex(await res.text());
  coordCache = { index, at: Date.now() };
  return index;
}

export const FAA_SOURCE: SignalSource = {
  id: "faa-airports",
  label: "US airport disruption (FAA)",
  group: "Infrastructure",
  color: "#dc2626",
  refreshMs: REFRESH_MS,
  attribution: FAA_ATTRIBUTION,
  sourceUrl: "https://nasstatus.faa.gov/",
  metric: { field: "magnitude", domain: [0, 10] },
  async fetch(): Promise<SignalFeature[]> {
    try {
      const [res, coords] = await Promise.all([
        fetch(ENDPOINT, {
          headers: { "user-agent": UA, accept: "application/xml,text/xml,*/*" },
          signal: AbortSignal.timeout(12_000),
          next: { revalidate: 120 },
        }),
        coordIndex(),
      ]);
      if (!res.ok) return [];
      const xml = await res.text();
      return faaFeatures(parseFaaStatus(xml), coords, tagText(xml, "Update_Time"));
    } catch {
      return [];
    }
  },
};
