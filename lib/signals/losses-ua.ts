// lib/signals/losses-ua.ts
// Vehicle losses, Ukrainian: Ukrainian losses as LostArmour documents them. LostArmour
// (lostarmour.info) is a RUSSIAN-SIDE project, and every row, pin and widget line here
// says so. Creamy Caprice republishes its located records as a KML file, which
// provenance-1 reads and relays (feed `losses-ua`, NewsScraper `sources/losses.py`).
//
// WHAT IS DRAWN. Every relayed row is located, and the map shows the last MAP_DAYS days,
// the same window as the Russian layer, as a DIAMOND (`shape: "diamond"`), so the two
// sides differ in shape and not only in colour. The relay holds 365 days.
//
// PRECISION: "exact". The KML's coordinates are LostArmour's geolocation of the footage
// of each vehicle, to four decimals (about 11 m), one per record: the place of the thing
// itself, not a town. 608 of 7,715 placemarks share a point with another (a column hit
// in one place, a depot), which is what exact positions look like, not a sign of town
// centroids. The sender drops a record whose two copies of its place disagree.
//
// Names are LostArmour's, in Russian. `nameEn` is the sender's fixed-table English
// (transliterated designators, known names); where it is null the Russian name is shown,
// never a guess. There is no "claimed" column: no Russian claims source is in this plan.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import type { RelayData } from "@/lib/relay/feeds";
import { readRelay, type RelaySnapshot } from "@/lib/relay/store";
import { usable } from "@/lib/relay/read";
import { degraded, observed } from "@/lib/signals/outcome";
import { markSummary } from "@/lib/signals/summary";

export const MAP_DAYS = 30;
export const RECENT_ROWS = 60;
export const LOSSES_UA_COLOR = "#1f4f8a";
/** Said on every pin and row: who documented the loss. */
export const UA_DOCUMENTED_BY = "LostArmour, a Russian-side project";

export interface LossUaRow {
  id: string;
  /** English where the sender's tables could say it, else the Russian name. */
  name: string;
  /** The Russian name as LostArmour published it. */
  nameRu: string;
  translated: boolean;
  category: string;
  status: string | null;
  date: string;
  lat: number;
  lon: number;
  /** LostArmour's record. */
  link: string;
  /** How many other posts the record cites. */
  cited: number;
}

export interface LossesUaSummary {
  layer: "losses-ua";
  fetchedAt: string;
  historyFrom: string;
  /** Rows in the relay (365 days). */
  yearTotal: number;
  window: {
    days: number;
    from: string;
    to: string;
    total: number;
    byCategory: { category: string; count: number }[];
  };
  recent: LossUaRow[];
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => dayOf(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000);

type UaRelayRow = RelayData<"losses-ua">["losses"][number];

export function lossUaRow(r: UaRelayRow): LossUaRow {
  return {
    id: r.id,
    name: r.nameEn ?? r.name,
    nameRu: r.name,
    translated: r.nameEn != null && r.nameEn !== r.name,
    category: r.categoryEn,
    status: r.statusEn ?? r.status,
    date: r.date,
    lat: r.lat,
    lon: r.lon,
    link: r.links[0],
    cited: Math.max(0, r.links.length - 1),
  };
}

/** Relay snapshot -> diamond features of the last MAP_DAYS days, and the summary. PURE. */
export function lossesUaFrom(
  snap: RelaySnapshot<RelayData<"losses-ua">>,
  now: number,
): { features: SignalFeature[]; summary: LossesUaSummary } {
  const today = dayOf(now);
  const windowFrom = [addDays(today, -(MAP_DAYS - 1)), snap.data.from].sort().at(-1)!;
  const rows = [...snap.data.losses].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const inWindow = rows.filter((r) => r.date >= windowFrom && r.date <= today);

  const features: SignalFeature[] = inWindow.map((r) => {
    const row = lossUaRow(r);
    const status = row.status ? row.status.toLowerCase() : "lost";
    return {
      id: `lostarmour:${r.id}`,
      signalId: "losses-ua",
      lat: r.lat,
      lon: r.lon,
      title: `${row.name}, ${status} (Russian-side record)`,
      shape: "diamond",
      color: LOSSES_UA_COLOR,
      ts: `${r.date}T00:00:00Z`,
      link: row.link,
      props: {
        lostBy: "Ukraine",
        documentedBy: UA_DOCUMENTED_BY,
        name: r.name,
        category: r.categoryEn,
        status: row.status ?? "",
        date: r.date,
        nameTranslation: row.translated ? "English name from a fixed table, Russian kept above" : "",
        catalogue: "LostArmour",
      },
    };
  });

  const byCategory = new Map<string, number>();
  for (const r of inWindow) byCategory.set(r.categoryEn, (byCategory.get(r.categoryEn) ?? 0) + 1);

  const summary: LossesUaSummary = {
    layer: "losses-ua",
    fetchedAt: new Date(snap.fetchedAt).toISOString(),
    historyFrom: snap.data.from,
    yearTotal: rows.length,
    window: {
      days: MAP_DAYS,
      from: windowFrom,
      to: today,
      total: inWindow.length,
      byCategory: [...byCategory.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    },
    recent: rows.slice(0, RECENT_ROWS).map(lossUaRow),
  };
  return { features, summary };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** The summary if it has this layer's shape, else null. */
export function readLossesUaSummary(value: unknown): LossesUaSummary | null {
  if (!isObj(value) || value.layer !== "losses-ua") return null;
  const { window, recent } = value;
  if (!isStr(value.fetchedAt) || !isStr(value.historyFrom) || !isNum(value.yearTotal)) return null;
  if (!isObj(window) || !isNum(window.total) || !isNum(window.days) || !isStr(window.from) || !isStr(window.to)) return null;
  if (!Array.isArray(window.byCategory) || !window.byCategory.every((c) => isObj(c) && isStr(c.category) && isNum(c.count))) return null;
  if (!Array.isArray(recent) || !recent.every((r) => isObj(r) && isStr(r.id) && isStr(r.name) && isStr(r.date) && isStr(r.link) && isNum(r.lat) && isNum(r.lon))) return null;
  return value as unknown as LossesUaSummary;
}

export const LOSSES_UA_SOURCE: SignalSource = {
  id: "losses-ua",
  kind: "event",
  label: "Vehicle losses, Ukrainian",
  group: "Conflict",
  color: LOSSES_UA_COLOR,
  precision: "exact",
  refreshMs: 60 * 60_000,
  attribution: "Documented by the Russian side: LostArmour (lostarmour.info), via creamy-caprice.net",
  sourceUrl: "https://lostarmour.info/",
  async fetch() {
    const now = Date.now();
    const snap = usable("losses-ua", readRelay("losses-ua"), now);
    if (!snap) return degraded<SignalFeature>("no recent LostArmour snapshot from provenance-1");
    const { features, summary } = lossesUaFrom(snap, now);
    return markSummary(observed(features, snap.fetchedAt), summary);
  },
};
