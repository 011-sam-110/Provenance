// Volcanoes — a pin means an observatory has an alert raised NOW.
//
// Until 2026-10-16 this was NASA EONET's curated "continuing eruptions" list, whose
// curation stopped on 2026-06-15: every pin was dated when the event was created
// (the oldest 2002), and Great Sitkin at ORANGE/WATCH was missing while it erupted
// (sources-audit/eonet.md). The primaries replace it, highest priority first:
//
//   • USGS Volcano Hazards Program, elevated volcanoes — US and CNMI, colour code and
//     alert level. Public domain.
//   • Japan Meteorological Agency — every volcano at eruption alert level 2 or above
//     gets a scheduled ash-fall forecast every 3 hours, and each one states the level.
//     The JMA XML feed (eqvol.xml) carries them; the volcano's coordinates come from
//     the forecast's own XML. Government of Japan Standard Terms of Use (CC BY 4.0
//     compatible), credit JMA.
//   • GDACS SEARCH VO, 90 days — eruptions alerted from VAAC advisories, worldwide.
//   • NASA EONET's open volcano list, kept as a dimmed background and labelled with
//     the date it was listed, never as current activity.
//
// The same volcano from two sources (within 15 km) is drawn once, by the higher one.

import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { fetchGdacsSearch, gdacsToLayerFeatures } from "@/lib/signals/gdacs";
import { CATEGORIES, readEonetLayer } from "@/lib/signals/eonet";
import {
  distanceKm,
  fromOutcome,
  getJson,
  getText,
  readInput,
  withInputsOutcome,
  type InputResult,
} from "@/lib/signals/multiInput";

export const VOLCANO_COLOR = "#dc2626";
export const GDACS_VOLCANO_WINDOW_DAYS = 90;
/** Two pins this close are the same volcano. Summit-to-vent offsets are a few km. */
export const SAME_VOLCANO_KM = 15;

export const VOLCANOES_ATTRIBUTION =
  "USGS Volcano Hazards Program; Japan Meteorological Agency; " +
  "Global Disaster Alert and Coordination System, GDACS; NASA EONET (listed eruptions)";

// --- USGS ------------------------------------------------------------------------

export const USGS_ELEVATED_URL = "https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated";

interface UsgsElevated {
  vName?: string;
  vnum?: string;
  volcanoCd?: string;
  lat?: number;
  long?: number;
  alertLevel?: string;
  colorCode?: string;
  sentUtc?: string;
  noticeUrl?: string;
  noticeSynopsis?: string;
  obs?: string;
}

const USGS_COLOR: Record<string, string> = {
  GREEN: "#16a34a",
  YELLOW: "#eab308",
  ORANGE: "#f97316",
  RED: "#dc2626",
};

/** Pure: USGS elevated list → features. `sentUtc` is "YYYY-MM-DD HH:MM:SS" in UTC. */
export function normalizeUsgsElevated(list: UsgsElevated[] | null): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const v of list ?? []) {
    const lat = Number(v.lat);
    const lon = Number(v.long);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const id = (v.vnum ?? v.volcanoCd ?? "").trim();
    if (!id) continue;
    const color = (v.colorCode ?? "").toUpperCase();
    const level = (v.alertLevel ?? "").toUpperCase();
    const t = v.sentUtc ? Date.parse(`${v.sentUtc.replace(" ", "T")}Z`) : Number.NaN;
    out.push({
      id: `volcanoes:usgs:${id}`,
      lat,
      lon,
      title: `${(v.vName ?? id).trim()} — ${[color, level].filter(Boolean).join(" / ") || "elevated"}`,
      signalId: "volcanoes",
      color: USGS_COLOR[color] ?? VOLCANO_COLOR,
      link: v.noticeUrl || undefined,
      ts: Number.isFinite(t) ? new Date(t).toISOString() : undefined,
      props: {
        source: `USGS ${(v.obs ?? "").toUpperCase() || "VHP"}`,
        aviationColour: color || "—",
        alertLevel: level || "—",
        notice: (v.noticeSynopsis ?? "").trim() || "—",
      },
    });
  }
  return out;
}

// --- JMA -------------------------------------------------------------------------

export const JMA_FEED_URL = "https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml";

/** The JMA titles that state a volcano's current eruption alert level. */
const JMA_TITLES = new Set(["降灰予報（定時）", "噴火警報・予報", "噴火速報", "火山の状況に関する解説情報"]);

/** JMA's English wording of each eruption alert level. */
export const JMA_LEVEL_MEANING: Record<number, string> = {
  1: "potentially active volcano",
  2: "do not approach the crater",
  3: "do not approach the volcano",
  4: "prepare to evacuate",
  5: "evacuate",
};

const JMA_LEVEL_COLOR: Record<number, string> = { 2: "#eab308", 3: "#f97316", 4: "#dc2626", 5: "#7f1d1d" };

export interface JmaVolcanoEntry {
  name: string;
  level: number | null;
  updated: string;
  xmlUrl: string;
}

const FULLWIDTH_DIGITS = "０１２３４５６７８９";
function toAsciiDigit(ch: string): string {
  const i = FULLWIDTH_DIGITS.indexOf(ch);
  return i >= 0 ? String(i) : ch;
}

/**
 * Pure: the JMA Atom feed → the newest entry per volcano that states a level of 2 or
 * more. The volcano name is the one between 【火山名 and the report title.
 */
export function parseJmaFeed(xml: string): JmaVolcanoEntry[] {
  const newest = new Map<string, JmaVolcanoEntry>();
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const title = /<title>([\s\S]*?)<\/title>/.exec(e)?.[1]?.trim() ?? "";
    if (!JMA_TITLES.has(title)) continue;
    const updated = /<updated>([\s\S]*?)<\/updated>/.exec(e)?.[1]?.trim() ?? "";
    const href = /<link[^>]*href="([^"]+)"/.exec(e)?.[1] ?? "";
    const content = /<content[^>]*>([\s\S]*?)<\/content>/.exec(e)?.[1] ?? "";
    const name = /【火山名[\s　]+(.+?)[\s　]+[^【】]*】/.exec(content)?.[1]?.trim();
    if (!name || !href) continue;
    const lv = /噴火警戒レベル([0-9０-９])/.exec(content)?.[1];
    const level = lv ? Number(toAsciiDigit(lv)) : null;
    const prev = newest.get(name);
    if (prev && prev.updated >= updated) continue;
    newest.set(name, { name, level, updated, xmlUrl: href });
  }
  return [...newest.values()].filter((v) => v.level != null && v.level >= 2);
}

/**
 * Pure: a JMA volcano XML → the volcano's coordinates. JMA writes them as
 * "+3154.57+13053.18+1421/": degrees and decimal minutes, then the height.
 */
export function parseJmaCoordinate(xml: string): { lat: number; lon: number } | null {
  const m = /<Coordinate[^>]*>\s*([+-])(\d{2})(\d{2}(?:\.\d+)?)([+-])(\d{3})(\d{2}(?:\.\d+)?)/.exec(xml);
  if (!m) return null;
  const lat = (Number(m[2]) + Number(m[3]) / 60) * (m[1] === "-" ? -1 : 1);
  const lon = (Number(m[5]) + Number(m[6]) / 60) * (m[4] === "-" ? -1 : 1);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** Pure: one JMA volcano with its place → a feature. */
export function jmaToFeature(v: JmaVolcanoEntry, at: { lat: number; lon: number }): SignalFeature {
  const level = v.level ?? 0;
  const t = Date.parse(v.updated);
  return {
    id: `volcanoes:jma:${v.name}`,
    lat: at.lat,
    lon: at.lon,
    title: `${v.name} — JMA alert level ${level} (${JMA_LEVEL_MEANING[level] ?? "raised"})`,
    signalId: "volcanoes",
    color: JMA_LEVEL_COLOR[level] ?? VOLCANO_COLOR,
    link: v.xmlUrl,
    ts: Number.isFinite(t) ? new Date(t).toISOString() : undefined,
    props: {
      source: "Japan Meteorological Agency",
      alertLevel: `level ${level}`,
      meaning: JMA_LEVEL_MEANING[level] ?? "—",
    },
  };
}

/** Volcano coordinates by name. A volcano does not move, so each is read once. */
const jmaPlaces = new Map<string, { lat: number; lon: number }>();

async function readJma(): Promise<SignalFeature[]> {
  const entries = parseJmaFeed(await getText(JMA_FEED_URL, 20_000));
  const missing = entries.filter((v) => !jmaPlaces.has(v.name)).slice(0, 20);
  await Promise.all(
    missing.map(async (v) => {
      try {
        const place = parseJmaCoordinate(await getText(v.xmlUrl, 20_000));
        if (place) jmaPlaces.set(v.name, place);
      } catch {
        // No place, no pin: the volcano waits for the next refresh.
      }
    }),
  );
  return entries.flatMap((v) => {
    const place = jmaPlaces.get(v.name);
    return place ? [jmaToFeature(v, place)] : [];
  });
}

// --- EONET background ------------------------------------------------------------

/** Pure: EONET's open volcano events → dimmed background pins, dated as "listed". */
export function eonetAsBackground(features: SignalFeature[]): SignalFeature[] {
  return features.map((f) => ({
    ...f,
    color: "#a8a29e",
    props: {
      ...f.props,
      source: "NASA EONET",
      status: "on EONET's open-eruption list; not a current alert",
      listedSince: f.ts ?? "—",
    },
  }));
}

/**
 * Pure: drop a pin when a higher-priority source already has a volcano within
 * SAME_VOLCANO_KM. `groups` is in priority order.
 */
export function dedupeVolcanoes(groups: SignalFeature[][]): SignalFeature[] {
  const kept: SignalFeature[] = [];
  for (const group of groups) {
    const higher = kept.slice();
    for (const f of group) {
      if (higher.some((k) => distanceKm(k, f) <= SAME_VOLCANO_KM)) continue;
      kept.push(f);
    }
  }
  return kept;
}

export const VOLCANOES_SOURCE: SignalSource = {
  id: "volcanoes",
  precision: "exact",
  label: "Volcanoes",
  group: "Natural hazards",
  color: VOLCANO_COLOR,
  refreshMs: 10 * 60 * 1000,
  attribution: VOLCANOES_ATTRIBUTION,
  async fetch() {
    const now = Date.now();
    const [usgs, jma, gdacs, eonet]: InputResult[] = await Promise.all([
      readInput("volcanoes:usgs", "USGS", async () => normalizeUsgsElevated(await getJson(USGS_ELEVATED_URL, 20_000)), now),
      readInput("volcanoes:jma", "JMA", readJma, now),
      readInput("volcanoes:gdacs", "GDACS", async () =>
        gdacsToLayerFeatures(
          await fetchGdacsSearch("VO", GDACS_VOLCANO_WINDOW_DAYS, now, (u) => getJson(u, 20_000)),
          { signalId: "volcanoes", idPrefix: "volcanoes:gdacs", sourceLabel: "GDACS (VAAC advisories)" },
        ),
      now),
      // The outcome rides on the array readEonetLayer returns, so read it before mapping.
      readEonetLayer(CATEGORIES.volcanoes).then((f) => {
        const r = fromOutcome("NASA EONET", f);
        return { ...r, features: eonetAsBackground(r.features) };
      }),
    ]);
    const features = dedupeVolcanoes([usgs.features, jma.features, gdacs.features, eonet.features]);
    return withInputsOutcome([usgs, jma, gdacs, eonet], features, now);
  },
};
