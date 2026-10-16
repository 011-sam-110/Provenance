import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";
import { laneFetch } from "@/lib/http/hostLane";

// Military and government aircraft worldwide, from two keyless community ADS-B
// networks' `/mil` feeds. Most ADS-B aggregators (and OpenSky's anonymous tier)
// FILTER OUT military traffic, which is exactly the traffic that matters for
// posture and movement. These two expose the unfiltered military set globally. One
// point per live aircraft, with type, callsign, registration, altitude and speed.
//
// TWO NETWORKS, MERGED, SINCE 2026-10-16. adsb.fi used to be a fallback, asked only
// when adsb.lol failed. The two are separate receiver networks, and each sees
// aircraft the other does not: in one pull that day adsb.lol had 246 positioned
// aircraft, adsb.fi 238, 225 in both, so the union was 259. As a fallback, the
// aircraft only adsb.fi saw were never shown. Now both are asked every cycle, in
// parallel (different hosts), and the rows are joined by ICAO hex; for an aircraft
// both saw, the fresher position wins (smaller `seen_pos`).
//
// TERMS. adsb.lol: ODbL 1.0 (https://api.adsb.lol/api/openapi.json `info.license`).
// adsb.fi: "for personal, non-commercial use only", and "You must cite adsb.fi and
// include a link" (https://github.com/adsbfi/opendata). So a row whose position came
// from adsb.fi links to adsb.fi's own map, and lib/signals/sourceLink.ts gives that
// link adsb.fi's name and home page. If Provenance ever charges money, adsb.fi must
// leave this layer.

export interface MilNetwork {
  id: "adsb.lol" | "adsb.fi";
  url: string;
  /** The network's own map, centred on one aircraft. */
  track: (hex: string) => string;
}

export const MIL_NETWORKS: readonly MilNetwork[] = [
  {
    id: "adsb.lol",
    url: "https://api.adsb.lol/v2/mil",
    track: (hex) => `https://globe.adsb.lol/?icao=${encodeURIComponent(hex)}`,
  },
  {
    id: "adsb.fi",
    url: "https://opendata.adsb.fi/api/v2/mil",
    track: (hex) => `https://globe.adsb.fi/?icao=${encodeURIComponent(hex)}`,
  },
];

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const ADSB_MIL_ATTRIBUTION =
  "Military ADS-B © adsb.lol contributors (ODbL) and adsb.fi (non-commercial use)";

interface AcRow {
  hex?: string;
  flight?: string; // callsign
  r?: string; // registration / tail
  t?: string; // ICAO type code, e.g. "C17"
  desc?: string; // full type description (adsb.fi only)
  ownOp?: string; // registered owner or operator, from adsb.fi's aircraft database
  alt_baro?: number | string; // feet, or "ground"
  gs?: number; // ground speed (kt)
  track?: number; // heading
  squawk?: string;
  lat?: number;
  lon?: number;
  seen_pos?: number; // seconds since this network last had a position
}

function altitude(a: AcRow["alt_baro"]): string {
  if (typeof a === "number" && Number.isFinite(a)) return `${a.toLocaleString()} ft`;
  if (typeof a === "string" && a.toLowerCase() === "ground") return "on ground";
  return "—";
}

/** Real barometric altitude in feet: a finite number, "ground" → 0, else undefined. */
function altitudeFt(a: AcRow["alt_baro"]): number | undefined {
  if (typeof a === "number" && Number.isFinite(a)) return a;
  if (typeof a === "string" && a.toLowerCase() === "ground") return 0;
  return undefined;
}

function positioned(a: AcRow): boolean {
  const { lat, lon } = a;
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    Boolean((a.hex ?? "").trim())
  );
}

/**
 * The database's owner field is sometimes a note, not an owner: "(Hex also used by
 * EC30 TG-LYA)", "Miscode - VARIOUS" (both seen 2026-10-16). Those are not shown.
 */
function ownerOf(a: AcRow): string | undefined {
  const v = a.ownOp?.trim();
  if (!v || v.startsWith("(") || /^miscode\b/i.test(v)) return undefined;
  return v;
}

/** One aircraft after the join: the row whose position is drawn, and who saw it. */
export interface MergedMilRow {
  row: AcRow;
  /** The network whose position is drawn. */
  from: MilNetwork["id"];
  /** Every network that reported the aircraft with a position, in MIL_NETWORKS order. */
  seenBy: MilNetwork["id"][];
}

/**
 * Pure: join the networks' positioned rows by ICAO hex. For an aircraft more than one
 * network saw, the row with the smaller `seen_pos` (fresher position) is drawn, the
 * earlier network winning a tie; a type description or owner only one network carries
 * is kept either way. Rows with no position are dropped, as before.
 */
export function mergeMilitaryNetworks(
  answers: readonly { network: MilNetwork["id"]; json: { ac?: AcRow[] } }[],
): MergedMilRow[] {
  const byHex = new Map<string, MergedMilRow>();
  for (const { network, json } of answers) {
    for (const a of json.ac ?? []) {
      if (!positioned(a)) continue;
      const hex = (a.hex ?? "").trim().toLowerCase();
      const prev = byHex.get(hex);
      if (!prev) {
        byHex.set(hex, { row: a, from: network, seenBy: [network] });
        continue;
      }
      if (!prev.seenBy.includes(network)) prev.seenBy.push(network);
      const fresher = (a.seen_pos ?? Number.POSITIVE_INFINITY) < (prev.row.seen_pos ?? Number.POSITIVE_INFINITY);
      const kept = fresher ? a : prev.row;
      const other = fresher ? prev.row : a;
      prev.row = {
        ...kept,
        ...(kept.desc?.trim() ? {} : other.desc?.trim() ? { desc: other.desc } : {}),
        ...(ownerOf(kept) ? {} : ownerOf(other) ? { ownOp: other.ownOp } : {}),
      };
      if (fresher) prev.from = network;
    }
  }
  return [...byHex.values()];
}

function toFeature({ row: a, from, seenBy }: MergedMilRow): SignalFeature {
  const hex = (a.hex ?? "").trim();
  const callsign = (a.flight ?? "").trim();
  const typeName = a.desc?.trim() || a.t?.trim() || "Military aircraft";
  const altFt = altitudeFt(a.alt_baro);
  const owner = ownerOf(a);
  const network = MIL_NETWORKS.find((n) => n.id === from);
  return {
    id: `mil:${hex}`,
    lat: a.lat as number,
    lon: a.lon as number,
    title: `${callsign || hex} — ${typeName}`,
    signalId: "military-air",
    color: "#3f6212", // military olive — distinct from civil plane amber
    // The aircraft on the map of the network whose position is drawn. For adsb.fi
    // this is also the link its terms require.
    ...(network ? { link: network.track(hex) } : {}),
    props: {
      callsign: callsign || "—",
      type: typeName,
      typeCode: a.t ?? "—",
      registration: a.r?.trim() || "—",
      ...(owner ? { owner } : {}),
      altitude: altitude(a.alt_baro), // display string (keeps "on ground" / "—")
      ...(altFt !== undefined ? { altitudeFt: altFt } : {}), // real scalar → metric bar
      speed: typeof a.gs === "number" ? `${Math.round(a.gs)} kt` : "—",
      heading: typeof a.track === "number" ? `${Math.round(a.track)}°` : "—",
      squawk: a.squawk ?? "—",
      network: seenBy.join(" + "),
      hex,
    },
  };
}

/** Pure: several networks' `/mil` payloads → one SignalFeature per aircraft. */
export function normalizeMilitaryNetworks(
  answers: readonly { network: MilNetwork["id"]; json: { ac?: AcRow[] } }[],
): SignalFeature[] {
  return mergeMilitaryNetworks(answers).map(toFeature);
}

/** Pure: one adsb.lol-shaped `/mil` payload → one SignalFeature per aircraft with a position. */
export function normalizeMilitaryAir(json: { ac?: AcRow[] }, network: MilNetwork["id"] = "adsb.lol"): SignalFeature[] {
  return normalizeMilitaryNetworks([{ network, json }]);
}

/** The seam the tests drive; production passes nothing. */
export interface MilDeps {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

/** Ask every network in parallel. Each answer is a parsed body, or the reason it failed. */
export async function fetchMilitaryNetworks(
  deps: MilDeps = {},
): Promise<{ network: MilNetwork["id"]; json?: { ac?: AcRow[] }; error?: string }[]> {
  // laneFetch, not fetch: adsb.lol's per-IP allowance is shared with the planes pull,
  // and adsb.fi allows one request per second; the lane spaces both.
  const fetchImpl = deps.fetchImpl ?? laneFetch;
  return Promise.all(
    MIL_NETWORKS.map(async (n) => {
      try {
        const res = await fetchImpl(n.url, {
          headers: { "User-Agent": UA, Accept: "application/json" },
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return { network: n.id, error: `${n.id} http ${res.status}` };
        return { network: n.id, json: (await res.json()) as { ac?: AcRow[] } };
      } catch (err) {
        return { network: n.id, error: `${n.id} ${err instanceof Error ? err.name : "error"}` };
      }
    }),
  );
}

/**
 * Pure: the outcome. Observed when at least one network answered (an empty answer is
 * a real "nothing is flying with a military flag", not a failure); degraded only when
 * none did, with each network's reason.
 */
export function militaryOutcome(
  answers: { network: MilNetwork["id"]; json?: { ac?: AcRow[] }; error?: string }[],
): SignalFeature[] {
  const ok = answers.filter((a): a is { network: MilNetwork["id"]; json: { ac?: AcRow[] } } => a.json != null);
  if (!ok.length) return degraded(answers.map((a) => a.error ?? `${a.network} no answer`).join("; "));
  return observed(normalizeMilitaryNetworks(ok));
}

export const MILITARY_AIR_SOURCE: SignalSource = {
  id: "military-air",
  // A reported ADS-B position.
  precision: "exact",
  label: "Military flights",
  group: "Military",
  color: "#3f6212",
  refreshMs: 20_000, // live aircraft — a short cache keeps positions current
  attribution: ADSB_MIL_ATTRIBUTION,
  sourceUrl: "https://adsb.lol/", // community military ADS-B feed (dossier source)
  // Barometric altitude is the real per-aircraft scalar: 0 (on ground) → ~45k ft ceiling.
  metric: { field: "altitudeFt", domain: [0, 45000], unit: " ft" },
  async fetch() {
    return militaryOutcome(await fetchMilitaryNetworks());
  },
};
