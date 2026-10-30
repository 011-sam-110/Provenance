// lib/signals/frontline-changes.ts
// Front line changes: each spot DeepState's change log links, in DeepState's own words.
//
// Relay feed `frontline-changes` (lib/relay/schemas/frontline-changes.ts), sent by
// NewsScraper `sources/deepstate.py` on provenance-1 every 30 minutes. The relay holds 60
// days, one row for each map spot an entry links, with the side read from the sentence that
// holds the link ("The enemy has advanced near Maiske" is a Russian advance).
//
// THE MAP SHOWS 14 DAYS. One feature per spot logged in the last 14 days (WINDOW_DAYS),
// counted back from now: when DeepState stops logging, the map empties rather than keep old
// changes looking recent. The place is DeepState's map link, which is where DeepState
// centres its map, not a measured position: the precision is `area`, so the map draws a
// soft disc and never a pin. Colour by side: amber for a Russian advance, blue for a
// Ukrainian gain, grey where the sentence states no side.
//
// THE SUMMARY carries the whole 60 days for the widget: counts by side over the window, the
// spots per day, and the entries newest first with each spot and its link. An entry with no
// map link never reaches the relay, so nothing here is placed by a guess.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";
import { markSummary } from "@/lib/signals/summary";
import { readRelay } from "@/lib/relay/store";
import { usable } from "@/lib/relay/read";
import type { RelayData } from "@/lib/relay/feeds";

export type FrontlineSide = "ru" | "ua" | "unknown";

/** Days of changes on the map and in the card's counts. */
export const WINDOW_DAYS = 14;
/** Days the relay holds (the sender keeps 60). */
export const SPAN_DAYS = 60;

export const FRONTLINE_SIDE_COLORS: Readonly<Record<FrontlineSide, string>> = {
  ru: "#e0a020",
  ua: "#2b6cb0",
  unknown: "#8a8178",
};

/** What each side means, as a label: DeepState's sentence is the claim, this is our reading of it. */
export const FRONTLINE_SIDE_LABEL: Readonly<Record<FrontlineSide, string>> = {
  ru: "Russian advance",
  ua: "Ukrainian gain",
  unknown: "Side not stated",
};

export interface FrontlineSpot {
  place: string;
  side: FrontlineSide;
  lat: number;
  lon: number;
  link: string;
}

export interface FrontlineEntry {
  id: number;
  at: string;
  /** DeepState's English sentence, tags stripped. */
  text: string;
  textOriginal: string | null;
  spots: FrontlineSpot[];
}

export interface FrontlineDay {
  day: string;
  ru: number;
  ua: number;
  unknown: number;
}

export interface FrontlineSummary {
  windowDays: number;
  spanDays: number;
  /** The newest entry's time. Null when the relay holds none. */
  newestAt: string | null;
  /** The moment the window is counted back from (the read time), ISO. */
  windowEnd: string;
  /** Spots in the window, by side. */
  counts: Record<FrontlineSide, number>;
  /** DeepState entries in the window. */
  updates: number;
  /** Spots per UTC day over the span, oldest first, every day present: SPAN_DAYS + 1 days, so the
   *  partial day at the far end of the sender's 60 days is counted too. */
  perDay: FrontlineDay[];
  /** Every entry in the relay, newest first. */
  entries: FrontlineEntry[];
}

const DAY_MS = 86_400_000;

function dayOf(iso: string): string {
  return new Date(Date.parse(iso)).toISOString().slice(0, 10);
}

/**
 * The relay payload -> one feature per spot in the WINDOW_DAYS before `now`, and the
 * summary. PURE: the clock is an argument.
 */
export function frontlineChangesFrom(
  data: RelayData<"frontline-changes">,
  now: number,
): { features: SignalFeature[]; summary: FrontlineSummary } {
  const rows = [...data.changes].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id - a.id);
  const windowStart = now - WINDOW_DAYS * DAY_MS;

  const features: SignalFeature[] = [];
  const counts: Record<FrontlineSide, number> = { ru: 0, ua: 0, unknown: 0 };
  const windowEntries = new Set<number>();
  const entries = new Map<number, FrontlineEntry>();

  for (const r of rows) {
    const side = r.side as FrontlineSide;
    let entry = entries.get(r.id);
    if (!entry) {
      entry = { id: r.id, at: r.at, text: r.text, textOriginal: r.textOriginal, spots: [] };
      entries.set(r.id, entry);
    }
    const index = entry.spots.length;
    entry.spots.push({ place: r.place, side, lat: r.lat, lon: r.lon, link: r.link });

    const t = Date.parse(r.at);
    if (t < windowStart || t > now) continue;
    counts[side] += 1;
    windowEntries.add(r.id);
    features.push({
      id: `frontline-changes:${r.id}:${index}`,
      signalId: "frontline-changes",
      lat: r.lat,
      lon: r.lon,
      title: r.place,
      color: FRONTLINE_SIDE_COLORS[side],
      precision: "area",
      ts: r.at,
      link: r.link,
      props: {
        side: `${FRONTLINE_SIDE_LABEL[side]} (read from DeepState's sentence)`,
        deepState: r.text,
        ...(r.textOriginal ? { deepStateUkrainian: r.textOriginal } : {}),
        logged: r.at,
        spot: "Where DeepState's link centres its map, not a measured position",
      },
    });
  }

  const perDay: FrontlineDay[] = [];
  const byDay = new Map<string, FrontlineDay>();
  for (let i = SPAN_DAYS; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    const row = { day, ru: 0, ua: 0, unknown: 0 };
    byDay.set(day, row);
    perDay.push(row);
  }
  for (const r of rows) {
    const row = byDay.get(dayOf(r.at));
    if (row) row[r.side as FrontlineSide] += 1;
  }

  return {
    features,
    summary: {
      windowDays: WINDOW_DAYS,
      spanDays: SPAN_DAYS,
      newestAt: rows[0]?.at ?? null,
      windowEnd: new Date(now).toISOString(),
      counts,
      updates: windowEntries.size,
      perDay,
      entries: [...entries.values()],
    },
  };
}

// --- the reader the widget uses -------------------------------------------------------

const SIDES = new Set(["ru", "ua", "unknown"]);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** The summary as /api/signals/frontline-changes sent it, or null when its shape is not this one. */
export function readFrontlineSummary(value: unknown): FrontlineSummary | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isNum(v.windowDays) || !isNum(v.spanDays) || !isNum(v.updates) || !isStr(v.windowEnd)) return null;
  if (!(v.newestAt === null || isStr(v.newestAt))) return null;
  const c = v.counts as Record<string, unknown> | undefined;
  if (!c || ![c.ru, c.ua, c.unknown].every(isNum)) return null;
  if (!Array.isArray(v.perDay) || !v.perDay.every((d) => d && isStr(d.day) && isNum(d.ru) && isNum(d.ua) && isNum(d.unknown))) return null;
  if (!Array.isArray(v.entries)) return null;
  for (const e of v.entries) {
    if (!e || !isNum(e.id) || !isStr(e.at) || !isStr(e.text) || !Array.isArray(e.spots)) return null;
    const ok = e.spots.every(
      (s: Record<string, unknown>) => s && isStr(s.place) && SIDES.has(s.side as string) && isNum(s.lat) && isNum(s.lon) && isStr(s.link),
    );
    if (!ok) return null;
  }
  return value as FrontlineSummary;
}

/** An entry's sides, in the order its sentences give them, each once. */
export function entrySides(entry: FrontlineEntry): FrontlineSide[] {
  const out: FrontlineSide[] = [];
  for (const s of entry.spots) if (!out.includes(s.side)) out.push(s.side);
  return out;
}

// --- the source -------------------------------------------------------------------------

export const FRONTLINE_CHANGES_SOURCE: SignalSource = {
  id: "frontline-changes",
  kind: "event",
  label: "Front line changes",
  group: "Conflict",
  color: "#e0a020",
  precision: "area",
  refreshMs: 30 * 60_000,
  attribution: "Front line changes: DeepState (deepstatemap.live)",
  sourceUrl: "https://deepstatemap.live/en",
  async fetch() {
    const now = Date.now();
    const snap = usable("frontline-changes", readRelay("frontline-changes"), now);
    if (!snap) return degraded<SignalFeature>("no snapshot from provenance-1 yet");
    const { features, summary } = frontlineChangesFrom(snap.data, now);
    const newest = summary.newestAt ? Date.parse(summary.newestAt) : undefined;
    return markSummary(observed(features, snap.fetchedAt, newest), summary);
  },
};
