// lib/relay/read.ts
// Readers for the relayed feeds: held snapshot -> the shape the layer that owns the
// feed wants. Each `*From` function is PURE (snapshot and clock in, plain data out) and
// is what the tests exercise; each `read*` wrapper only adds the store lookup.
//
// A reader returns null when nothing usable is held: no push yet (every restart), or a
// snapshot older than the feed's maxAgeMs. Null means "no relay", never an error, and the
// layer decides what an absent relay looks like. Every result carries `fetchedAt` and
// `ageMs`, so a layer can say how late the data is rather than present it as live.
//
// WHICH LAYER READS WHICH FEED (none of these is wired into a layer by this change except
// CelesTrak, which lib/sources/celestrak.ts reads itself):
//   nrcan-magnetic          aurora (lib/signals/aurora.ts): a forecaster's verdict per zone
//   jma-volcam              the camera registry (lib/sources): operator-primary stills
//   sjofartsverket-navwarn  GPS jamming context: the official-warnings sub-layer
//   shadowserver-beacon     none: it was to replace Feodo Tracker in `cyber-c2`, a layer
//                           removed on 2026-10-17 before this feed was wired into it
//   shadowserver-sinkhole   none (infected hosts); never to be summed with the beacon count
//   eea-aqi                 air-quality-stations: EEA wins over OpenAQ's copy within ~100 m
//   hhs-ocr-breach          the breach disclosures sub-feed of the ransomware group
//   texas-ag-breach         the same
import type { Camera } from "@/lib/types";
import { RELAY_FEEDS, type RelayData, type RelayFeedId } from "@/lib/relay/feeds";
import { readRelay, type RelaySnapshot } from "@/lib/relay/store";

export interface Freshness {
  /** When provenance-1 read the upstream, ISO. */
  fetchedAt: string;
  ageMs: number;
}

function freshness(snap: RelaySnapshot, now: number): Freshness {
  return { fetchedAt: new Date(snap.fetchedAt).toISOString(), ageMs: Math.max(0, now - snap.fetchedAt) };
}

/** The snapshot if it is inside the feed's max age, else null. */
export function usable<F extends RelayFeedId>(
  feed: F,
  snap: RelaySnapshot<RelayData<F>> | null,
  now: number,
): RelaySnapshot<RelayData<F>> | null {
  if (!snap) return null;
  return now - snap.fetchedAt <= RELAY_FEEDS[feed].maxAgeMs ? snap : null;
}

// --- nrcan-magnetic ---------------------------------------------------------------

/** NRCan's words in order of severity. A word not listed here gets a null rank, not a guess. */
export const NRCAN_LEVELS = ["quiet", "unsettled", "active", "stormy", "major storm"] as const;

export function nrcanRank(level: string): number | null {
  const index = (NRCAN_LEVELS as readonly string[]).indexOf(level.trim().toLowerCase());
  return index < 0 ? null : index;
}

export type NrcanZone = "polar" | "auroral" | "subauroral";
export type NrcanWindow = "last24h" | "last6h" | "current" | "next6h" | "next24h";

export interface NrcanReading {
  level: string;
  rank: number | null;
  intervals: string | null;
}

export interface NrcanActivity extends Freshness {
  issuedAt: string;
  windows: Partial<Record<NrcanWindow, Record<NrcanZone, NrcanReading>>>;
  attribution: string;
}

export const NRCAN_ATTRIBUTION = "Magnetic activity: Natural Resources Canada (non-commercial reproduction)";

export function nrcanActivityFrom(snap: RelaySnapshot<RelayData<"nrcan-magnetic">>, now: number): NrcanActivity {
  const windows: NrcanActivity["windows"] = {};
  for (const [name, zones] of Object.entries(snap.data.windows)) {
    if (!zones) continue;
    const out = {} as Record<NrcanZone, NrcanReading>;
    for (const zone of ["polar", "auroral", "subauroral"] as const) {
      const r = zones[zone];
      out[zone] = { level: r.level, rank: nrcanRank(r.level), intervals: r.intervals };
    }
    windows[name as NrcanWindow] = out;
  }
  return { ...freshness(snap, now), issuedAt: snap.data.issuedAt, windows, attribution: NRCAN_ATTRIBUTION };
}

export function readNrcanActivity(now = Date.now()): NrcanActivity | null {
  const snap = usable("nrcan-magnetic", readRelay("nrcan-magnetic"), now);
  return snap ? nrcanActivityFrom(snap, now) : null;
}

// --- jma-volcam --------------------------------------------------------------------

/** A frame older than this reads as unavailable. JMA posts every 2 minutes. */
export const JMA_FRAME_STALE_MS = 60 * 60 * 1000;
export const JMA_ATTRIBUTION = "出典：気象庁ホームページ (Japan Meteorological Agency)";
export const JMA_LICENSE = "Public Data License v1.0 (CC BY 4.0 compatible), Japan Meteorological Agency";

/**
 * Relayed cameras -> registry Cameras. The pin is the camera SITE JMA publishes in its
 * own camera map (param/geojson/camicon.geojson), not the summit, and the name is JMA's
 * "<volcano> <site>", so every pin traces to a named place the operator itself published.
 */
export function jmaVolcamCamerasFrom(snap: RelaySnapshot<RelayData<"jma-volcam">>, now: number): Camera[] {
  return snap.data.cameras.map((c) => {
    const frameAt = Date.parse(c.frameAt);
    return {
      id: `jma-volcam:${c.code}`,
      source: "jma-volcam",
      country: "JP",
      region: c.volcano,
      name: c.site === c.volcano ? c.volcano : `${c.volcano} ${c.site}`,
      lat: c.lat,
      lon: c.lon,
      imageUrl: c.imageUrl,
      mediaType: "jpeg" as const,
      refreshSeconds: 120,
      license: JMA_LICENSE,
      attribution: JMA_ATTRIBUTION,
      available: Number.isFinite(frameAt) && now - frameAt <= JMA_FRAME_STALE_MS,
      lastSampledAt: c.frameAt,
    };
  });
}

export function readJmaVolcamCameras(now = Date.now()): Camera[] {
  const snap = usable("jma-volcam", readRelay("jma-volcam"), now);
  return snap ? jmaVolcamCamerasFrom(snap, now) : [];
}

// --- sjofartsverket-navwarn ----------------------------------------------------------

export const NAVWARN_LINK = "https://navvarn.sjofartsverket.se/en/Navigationsvarningar/";
export const NAVWARN_ATTRIBUTION = "Navigational warnings: Sjöfartsverket (Swedish Maritime Administration)";

/** GNSS / GPS / satellite-navigation interference, as the warnings word it. */
const GNSS_WORDS = /\b(GNSS|GPS|GLONASS|GALILEO|SATELLITE NAVIGATION)\b/i;

export interface NavWarning {
  id: string;
  issuedAt: string;
  areas: string[];
  text: string;
  link: string;
}

export interface NavWarnings extends Freshness {
  warnings: NavWarning[];
  attribution: string;
}

/** The warnings in force that are about satellite-navigation interference, newest first. */
export function gnssNavWarningsFrom(snap: RelaySnapshot<RelayData<"sjofartsverket-navwarn">>, now: number): NavWarnings {
  const warnings = snap.data.warnings
    .filter((w) => GNSS_WORDS.test(w.text))
    .map((w) => ({ id: w.id, issuedAt: w.issuedAt, areas: [...w.areas], text: w.text, link: NAVWARN_LINK }))
    .sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt));
  return { ...freshness(snap, now), warnings, attribution: NAVWARN_ATTRIBUTION };
}

export function readGnssNavWarnings(now = Date.now()): NavWarnings | null {
  const snap = usable("sjofartsverket-navwarn", readRelay("sjofartsverket-navwarn"), now);
  return snap ? gnssNavWarningsFrom(snap, now) : null;
}

// --- shadowserver ------------------------------------------------------------------

export const SHADOWSERVER_ATTRIBUTION = "© The Shadowserver Foundation (dashboard.shadowserver.org)";

export interface CountryCounts extends Freshness {
  source: "beacon" | "sinkhole";
  /** The UTC day the counts describe. Shadowserver runs a day behind. */
  day: string;
  total: number;
  /** Largest first. */
  countries: { iso2: string; count: number }[];
  attribution: string;
}

export function shadowserverCountsFrom(
  snap: RelaySnapshot<RelayData<"shadowserver-beacon">> | RelaySnapshot<RelayData<"shadowserver-sinkhole">>,
  now: number,
): CountryCounts {
  const countries = Object.entries(snap.data.counts)
    .filter(([, count]) => count > 0)
    .map(([iso2, count]) => ({ iso2, count }))
    .sort((a, b) => b.count - a.count || a.iso2.localeCompare(b.iso2));
  return {
    ...freshness(snap, now),
    source: snap.data.source,
    day: snap.data.day,
    total: countries.reduce((n, c) => n + c.count, 0),
    countries,
    attribution: SHADOWSERVER_ATTRIBUTION,
  };
}

export function readShadowserverCounts(source: "beacon" | "sinkhole", now = Date.now()): CountryCounts | null {
  const snap =
    source === "beacon"
      ? usable("shadowserver-beacon", readRelay("shadowserver-beacon"), now)
      : usable("shadowserver-sinkhole", readRelay("shadowserver-sinkhole"), now);
  return snap ? shadowserverCountsFrom(snap, now) : null;
}

// --- eea-aqi -----------------------------------------------------------------------

/** The European AQI's six bands, 1-based, as the EEA names them. */
export const EAQI_BANDS = ["Good", "Fair", "Moderate", "Poor", "Very poor", "Extremely poor"] as const;
export const EEA_ATTRIBUTION = "European Air Quality Index: European Environment Agency";

/**
 * The EEA map file's float -> its band, 1..6. The integer part is the band: a station
 * at 2.43 for O3 at 78 µg/m³ sits in "Fair" (50-100), the EEA's own second band.
 */
export function eaqiBand(aqi: number): number {
  return Math.min(6, Math.max(1, Math.floor(aqi)));
}

export interface EeaStation {
  code: string;
  name: string;
  lat: number;
  lon: number;
  municipality: string | null;
  aqi: number;
  band: number;
  bandLabel: (typeof EAQI_BANDS)[number];
}

export interface EeaStations extends Freshness {
  hour: string;
  stations: EeaStation[];
  attribution: string;
}

export function eeaStationsFrom(snap: RelaySnapshot<RelayData<"eea-aqi">>, now: number): EeaStations {
  const stations = snap.data.stations.map((s) => {
    const band = eaqiBand(s.aqi);
    return { ...s, band, bandLabel: EAQI_BANDS[band - 1] };
  });
  return { ...freshness(snap, now), hour: snap.data.hour, stations, attribution: EEA_ATTRIBUTION };
}

export function readEeaStations(now = Date.now()): EeaStations | null {
  const snap = usable("eea-aqi", readRelay("eea-aqi"), now);
  return snap ? eeaStationsFrom(snap, now) : null;
}

// --- breach disclosures ------------------------------------------------------------

export const HHS_ATTRIBUTION = "U.S. HHS Office for Civil Rights breach portal";
export const TEXAS_AG_ATTRIBUTION = "Texas Office of the Attorney General";

export interface HhsBreaches extends Freshness {
  rows: RelayData<"hhs-ocr-breach">["rows"];
  attribution: string;
}

/**
 * HHS rows, optionally only "Hacking/IT Incident" (the type that includes ransomware).
 * These are DISCLOSURES by the breached organisation. Nothing here says ransomware.
 */
export function hhsBreachesFrom(
  snap: RelaySnapshot<RelayData<"hhs-ocr-breach">>,
  now: number,
  opts: { hackingOnly?: boolean } = {},
): HhsBreaches {
  const rows = opts.hackingOnly ? snap.data.rows.filter((r) => /hacking/i.test(r.breachType)) : snap.data.rows;
  return { ...freshness(snap, now), rows, attribution: HHS_ATTRIBUTION };
}

export function readHhsBreaches(now = Date.now(), opts: { hackingOnly?: boolean } = {}): HhsBreaches | null {
  const snap = usable("hhs-ocr-breach", readRelay("hhs-ocr-breach"), now);
  return snap ? hhsBreachesFrom(snap, now, opts) : null;
}

export interface TexasBreaches extends Freshness {
  rows: RelayData<"texas-ag-breach">["rows"];
  attribution: string;
}

/** Texas AG rows published within `days` (default all), newest first. */
export function texasBreachesFrom(
  snap: RelaySnapshot<RelayData<"texas-ag-breach">>,
  now: number,
  opts: { days?: number } = {},
): TexasBreaches {
  const cutoff = opts.days ? now - opts.days * 24 * 60 * 60 * 1000 : -Infinity;
  const rows = snap.data.rows
    .filter((r) => Date.parse(`${r.publishedOn}T00:00:00Z`) >= cutoff)
    .sort((a, b) => b.publishedOn.localeCompare(a.publishedOn));
  return { ...freshness(snap, now), rows, attribution: TEXAS_AG_ATTRIBUTION };
}

export function readTexasBreaches(now = Date.now(), opts: { days?: number } = {}): TexasBreaches | null {
  const snap = usable("texas-ag-breach", readRelay("texas-ag-breach"), now);
  return snap ? texasBreachesFrom(snap, now, opts) : null;
}
