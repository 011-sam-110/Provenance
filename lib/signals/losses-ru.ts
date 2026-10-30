// lib/signals/losses-ru.ts
// Vehicle losses, Russian: WarSpotting's documented Russian losses, relayed from
// provenance-1 (feed `losses-ru`), and the General Staff of Ukraine's claimed totals
// (feed `loss-totals`) set beside them in the summary.
//
// WHAT IS DRAWN. Only a loss WarSpotting geolocated becomes a pin, and only for the last
// MAP_DAYS days. A loss with no geolocation (about two in three) is listed in the
// widget and never drawn: WarSpotting's `nearest_location` is a place NAME, and this
// layer never turns a name into a point. The relay holds 365 days; the console's time
// filter stops at 7 days and then "All", so the layer itself sets the map's default of
// 30 days, the one the approved plan states.
//
// PRECISION: "exact". WarSpotting's `geo` is its volunteers' geolocation of the photo
// or video of THIS vehicle, five to seven decimals (under a metre), one per loss: the
// coordinates of the thing itself, which is what "exact" means in types.ts. It is the
// source's claim of where the footage was taken, so the pin says WarSpotting, and the
// record link opens the footage it rests on.
//
// THE SUMMARY (lib/signals/summary.ts): WarSpotting's all-time totals, the last 30 days
// by type, the newest rows located or not, and the claimed-against-documented table.
// The table's category match is MADE BY HAND (CLAIM_MATCH), because the two sources
// group vehicles differently; the widget says so. A category with no fair match
// (drones, special equipment, personnel, missiles) is left out rather than forced.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import type { RelayData } from "@/lib/relay/feeds";
import { readRelay, type RelaySnapshot } from "@/lib/relay/store";
import { usable } from "@/lib/relay/read";
import { degraded, observed } from "@/lib/signals/outcome";
import { markSummary } from "@/lib/signals/summary";

/** Days of located losses drawn on the map. */
export const MAP_DAYS = 30;
/** Rows the summary lists, newest first, located or not. */
export const RECENT_ROWS = 60;
export const LOSSES_RU_COLOR = "#7a1f14";

export const WARSPOTTING_RECORD = (id: number) => `https://ukr.warspotting.net/view/${id}/`;

/**
 * General Staff category (russianwarship.rip's key) -> the WarSpotting types counted
 * against it. Hand-matched; the widget says so. Order is the table's order.
 */
export const CLAIM_MATCH: readonly { key: string; label: string; types: readonly string[] }[] = [
  { key: "tanks", label: "Tanks", types: ["Tanks"] },
  { key: "armoured_fighting_vehicles", label: "Armoured vehicles", types: ["Infantry fighting vehicles", "Infantry mobility vehicles"] },
  { key: "artillery_systems", label: "Artillery", types: ["Towed artillery", "Self-propelled artillery"] },
  { key: "mlrs", label: "Rocket artillery", types: ["Rocket and missile artillery"] },
  { key: "aa_warfare_systems", label: "Air defence", types: ["Anti-aircraft systems"] },
  { key: "planes", label: "Aircraft", types: ["Airplanes"] },
  { key: "helicopters", label: "Helicopters", types: ["Helicopters"] },
  { key: "vehicles_fuel_tanks", label: "Trucks and fuel tankers", types: ["Transport"] },
  { key: "warships_cutters", label: "Ships and boats", types: ["Vessels"] },
];

export interface LossRuRow {
  id: number;
  model: string;
  type: string;
  status: string;
  date: string;
  place: string | null;
  located: boolean;
  link: string;
}

export interface ClaimRow {
  key: string;
  label: string;
  claimed: number;
  /** The General Staff's change on its latest day. */
  claimedChange: number;
  /** WarSpotting's all-time losses for the matched types: destroyed, captured and abandoned, not damaged. */
  documented: number;
  documentedTypes: readonly string[];
  /** claimed ÷ documented, or null when nothing is documented. */
  ratio: number | null;
}

export interface LossesRuSummary {
  layer: "losses-ru";
  /** When provenance-1 read WarSpotting. */
  fetchedAt: string;
  /** The earliest day the relayed rows reach back to. */
  historyFrom: string;
  allTime: {
    total: number;
    byStatus: Record<string, number>;
    byType: { type: string; losses: number; damaged: number }[];
  };
  window: {
    days: number;
    /** First day counted (inclusive) and the day of the read. */
    from: string;
    to: string;
    total: number;
    located: number;
    byType: { type: string; count: number }[];
  };
  recent: LossRuRow[];
  /** Null until the `loss-totals` feed has a usable snapshot. */
  claims: null | {
    date: string;
    day: number;
    source: string;
    fetchedAt: string;
    crossCheck: { date: string; checked: string[] } | null;
    rows: ClaimRow[];
  };
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => dayOf(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000);

/** The claimed-against-documented rows. PURE. */
export function claimRows(
  claimed: { stats: Record<string, number>; increase: Record<string, number> },
  byType: readonly { type: string; losses: number }[],
): ClaimRow[] {
  const documentedOf = new Map(byType.map((t) => [t.type, t.losses]));
  const rows: ClaimRow[] = [];
  for (const match of CLAIM_MATCH) {
    const claimedCount = claimed.stats[match.key];
    if (typeof claimedCount !== "number") continue;
    // A WarSpotting type the stats no longer list is not counted as zero: the row goes.
    if (!match.types.every((t) => documentedOf.has(t))) continue;
    const documented = match.types.reduce((n, t) => n + (documentedOf.get(t) ?? 0), 0);
    rows.push({
      key: match.key,
      label: match.label,
      claimed: claimedCount,
      claimedChange: claimed.increase[match.key] ?? 0,
      documented,
      documentedTypes: match.types,
      ratio: documented > 0 ? Math.round((claimedCount / documented) * 10) / 10 : null,
    });
  }
  return rows;
}

/** Relay snapshots -> located features of the last MAP_DAYS days, and the summary. PURE. */
export function lossesRuFrom(
  snap: RelaySnapshot<RelayData<"losses-ru">>,
  totals: RelaySnapshot<RelayData<"loss-totals">> | null,
  now: number,
): { features: SignalFeature[]; summary: LossesRuSummary } {
  const today = dayOf(now);
  const historyFrom = snap.data.from;
  const windowFrom = [addDays(today, -(MAP_DAYS - 1)), historyFrom].sort().at(-1)!;
  const rows = [...snap.data.losses].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const inWindow = rows.filter((r) => r.date >= windowFrom && r.date <= today);

  const features: SignalFeature[] = [];
  for (const r of inWindow) {
    if (r.lat == null || r.lon == null) continue;
    features.push({
      id: `warspotting:${r.id}`,
      signalId: "losses-ru",
      lat: r.lat,
      lon: r.lon,
      title: `${r.model}, ${r.status.toLowerCase()}`,
      color: LOSSES_RU_COLOR,
      ts: `${r.date}T00:00:00Z`,
      link: WARSPOTTING_RECORD(r.id),
      props: {
        lostBy: "Russia",
        documentedBy: "WarSpotting, from a photo or video",
        type: r.type,
        status: r.status,
        date: r.date,
        nearest: r.place ?? "",
        unit: r.unit ?? "",
        catalogue: "WarSpotting",
      },
    });
  }

  const byTypeCount = new Map<string, number>();
  for (const r of inWindow) byTypeCount.set(r.type, (byTypeCount.get(r.type) ?? 0) + 1);

  const usableTotals = totals?.data ?? null;
  const summary: LossesRuSummary = {
    layer: "losses-ru",
    fetchedAt: new Date(snap.fetchedAt).toISOString(),
    historyFrom,
    allTime: {
      total: Object.values(snap.data.stats.byStatus).reduce((n, v) => n + v, 0),
      byStatus: { ...snap.data.stats.byStatus },
      byType: snap.data.stats.byType.map((t) => ({ ...t })),
    },
    window: {
      days: MAP_DAYS,
      from: windowFrom,
      to: today,
      total: inWindow.length,
      located: features.length,
      byType: [...byTypeCount.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    },
    recent: rows.slice(0, RECENT_ROWS).map((r) => ({
      id: r.id,
      model: r.model,
      type: r.type,
      status: r.status,
      date: r.date,
      place: r.place,
      located: r.lat != null && r.lon != null,
      link: WARSPOTTING_RECORD(r.id),
    })),
    claims:
      usableTotals && totals
        ? {
            date: usableTotals.claimed.date,
            day: usableTotals.claimed.day,
            source: usableTotals.claimed.source,
            fetchedAt: new Date(totals.fetchedAt).toISOString(),
            crossCheck: usableTotals.crossCheck
              ? { date: usableTotals.crossCheck.date, checked: [...usableTotals.crossCheck.checked] }
              : null,
            rows: claimRows(usableTotals.claimed, snap.data.stats.byType),
          }
        : null,
  };
  return { features, summary };
}

// ── The summary, read back on the client ────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** The summary if it has this layer's shape, else null. The client gets it as `unknown`. */
export function readLossesRuSummary(value: unknown): LossesRuSummary | null {
  if (!isObj(value) || value.layer !== "losses-ru") return null;
  const { allTime, window, recent, claims } = value;
  if (!isStr(value.fetchedAt) || !isStr(value.historyFrom)) return null;
  if (!isObj(allTime) || !isNum(allTime.total) || !isObj(allTime.byStatus) || !Array.isArray(allTime.byType)) return null;
  if (!isObj(window) || !isNum(window.total) || !isNum(window.located) || !isNum(window.days)) return null;
  if (!isStr(window.from) || !isStr(window.to) || !Array.isArray(window.byType)) return null;
  if (!window.byType.every((t) => isObj(t) && isStr(t.type) && isNum(t.count))) return null;
  if (!Array.isArray(recent) || !recent.every((r) => isObj(r) && isNum(r.id) && isStr(r.model) && isStr(r.date) && isStr(r.link) && typeof r.located === "boolean")) return null;
  if (claims !== null) {
    if (!isObj(claims) || !isStr(claims.date) || !isNum(claims.day) || !isStr(claims.source) || !Array.isArray(claims.rows)) return null;
    if (!claims.rows.every((r) => isObj(r) && isStr(r.label) && isNum(r.claimed) && isNum(r.documented) && isNum(r.claimedChange))) return null;
  }
  return value as unknown as LossesRuSummary;
}

export const LOSSES_RU_SOURCE: SignalSource = {
  id: "losses-ru",
  kind: "event",
  label: "Vehicle losses, Russian",
  group: "Conflict",
  color: LOSSES_RU_COLOR,
  precision: "exact",
  refreshMs: 60 * 60_000,
  attribution: "Documented: WarSpotting (ukr.warspotting.net). Claimed: General Staff of Ukraine",
  sourceUrl: "https://ukr.warspotting.net/",
  async fetch() {
    const now = Date.now();
    const snap = usable("losses-ru", readRelay("losses-ru"), now);
    if (!snap) return degraded<SignalFeature>("no recent WarSpotting snapshot from provenance-1");
    const totals = usable("loss-totals", readRelay("loss-totals"), now);
    const { features, summary } = lossesRuFrom(snap, totals, now);
    return markSummary(observed(features, snap.fetchedAt), summary);
  },
};
