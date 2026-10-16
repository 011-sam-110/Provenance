import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// Ukraine air-raid alert state, from the alerts.in.ua API (`/v1/alerts/active.json`).
// Dormant until ALERTS_IN_UA_TOKEN is set: the token is free (name and email), and the
// API answers 401 without it.
//
// WHY THE SOURCE CHANGED (audited 2026-10-16). The layer used to read alerts.com.ua,
// which reports ONE flag per oblast and sets it only when the alert covers the WHOLE
// oblast. Ukraine now declares nearly every alert per raion or per hromada, so that
// flag almost never moves: during an alert that covered 64 to 85 areas in about 18
// oblasts, prod showed one row (Luhansk's standing alert) and so read as "all clear".
// The scraper behind it has not been maintained since 2023. It is not used as a
// fallback either, because a fallback that says "all clear" during an alert is the
// most dangerous wrong answer this layer can give: with no token the layer is
// unavailable and says so.
//
// WHY THIS SOURCE AND NOT A CAMERA. Ukraine restricts publishing footage of strikes and
// air-defence work, because a public feed showing where something landed is targeting and
// damage-assessment help for whoever fired it. So this project does not go looking for
// live cameras inside the active conflict zone. The alert state is the opposite kind of
// data: it is published so that civilians see it, it is already on every phone in the
// country, and it says only "shelter is advised here" — no outcome, no target.
//
// WHAT A MARKER IS. One marker per oblast with any active air-raid alert, on the oblast's
// main city. "Whole oblast" when the alert covers the oblast; "partial" with the named
// raions and hromadas when only part of it is under alert. The marker is an anchor, never
// a location: the dossier lists the areas by name. Raion-level markers need a raion anchor
// table this repo does not have yet.
//
// TERMS (alerts.in.ua/terms-of-usage): a visible link to alerts.in.ua is required (8.4),
// the token stays on the server, and the limit is 8 to 12 requests a minute per IP.

const CACHE_TTL_MS = 60_000; // an alert is time-critical; a minute is the rate limit's floor
const REQUEST_TIMEOUT_MS = 15_000;
const ENDPOINT = "https://api.alerts.in.ua/v1/alerts/active.json";
const SITE = "https://alerts.in.ua/";

export const UKRAINE_ALERTS_ATTRIBUTION = "Air-raid alert state © alerts.in.ua";

/** One alert as `/v1/alerts/active.json` publishes it (devs.alerts.in.ua). */
export interface AlertsInUaRow {
  id?: number;
  location_title?: string;
  location_title_en?: string;
  location_type?: string; // "oblast" | "raion" | "hromada" | "city"
  started_at?: string;
  finished_at?: string | null;
  updated_at?: string;
  alert_type?: string; // "air_raid" | "artillery_shelling" | "urban_fights" | "chemical" | "nuclear"
  location_uid?: string | number;
  location_oblast?: string;
  location_oblast_uid?: string | number;
  location_raion?: string;
  alert_level?: string; // "red" | "yellow"
}

/**
 * Oblast anchor points, keyed by alerts.in.ua's `location_oblast_uid` (its "Location
 * UID" table: 27 regions, the 24 oblasts, Crimea, Sevastopol and Kyiv city).
 *
 * Each is the administrative centre of the oblast (the city it is named for), NOT a
 * geometric centroid, because an alert is a civil-defence instruction to the people in
 * it and the population is where the city is. An oblast is up to ~300 km across, so the
 * dot is an ANCHOR and never a location.
 *
 * Keyed by the stable uid rather than by name, so a rename or a transliteration change
 * cannot silently drop an oblast off the map.
 */
export const OBLAST_ANCHORS: Readonly<Record<number, { en: string; lat: number; lon: number }>> = {
  3: { en: "Khmelnytskyi", lat: 49.4229, lon: 26.9871 },
  4: { en: "Vinnytsia", lat: 49.2331, lon: 28.4682 },
  5: { en: "Rivne", lat: 50.6199, lon: 26.2516 },
  8: { en: "Volyn", lat: 50.7472, lon: 25.3254 },
  9: { en: "Dnipropetrovsk", lat: 48.4647, lon: 35.0462 },
  10: { en: "Zhytomyr", lat: 50.2547, lon: 28.6587 },
  11: { en: "Zakarpattia", lat: 48.6208, lon: 22.2879 },
  12: { en: "Zaporizhzhia", lat: 47.8388, lon: 35.1396 },
  13: { en: "Ivano-Frankivsk", lat: 48.9226, lon: 24.7111 },
  // Kyiv oblast is the one place the "administrative centre" rule breaks: its centre is
  // Kyiv, which the API carries SEPARATELY as uid 31, so both would land on the same
  // pixel and one alert would hide the other. Anchored on Bila Tserkva, the oblast's
  // largest city, which keeps the two dots distinguishable.
  14: { en: "Kyiv oblast", lat: 49.795, lon: 30.131 },
  15: { en: "Kirovohrad", lat: 48.5079, lon: 32.2623 },
  16: { en: "Luhansk", lat: 48.574, lon: 39.3078 },
  17: { en: "Mykolaiv", lat: 46.975, lon: 31.9946 },
  18: { en: "Odesa", lat: 46.4825, lon: 30.7233 },
  19: { en: "Poltava", lat: 49.5883, lon: 34.5514 },
  20: { en: "Sumy", lat: 50.9077, lon: 34.7981 },
  21: { en: "Ternopil", lat: 49.5535, lon: 25.5948 },
  22: { en: "Kharkiv", lat: 49.9935, lon: 36.2304 },
  23: { en: "Kherson", lat: 46.6354, lon: 32.6169 },
  24: { en: "Cherkasy", lat: 49.4444, lon: 32.0598 },
  25: { en: "Chernihiv", lat: 51.4982, lon: 31.2893 },
  26: { en: "Chernivtsi", lat: 48.2921, lon: 25.9358 },
  27: { en: "Lviv", lat: 49.8397, lon: 24.0297 },
  28: { en: "Donetsk", lat: 48.0159, lon: 37.8029 },
  29: { en: "Crimea", lat: 44.9521, lon: 34.1024 },
  30: { en: "Sevastopol", lat: 44.6166, lon: 33.5254 },
  31: { en: "Kyiv city", lat: 50.4501, lon: 30.5234 },
};

/**
 * Above this, an "alert" is reporting a standing condition rather than a live warning.
 * Occupied regions (Luhansk since 2022, Crimea) keep their siren state on permanently.
 * Dropping the row would be worse than keeping it — the source genuinely says the alert
 * is active — so it is kept and LABELLED. A real air-raid alert is minutes to hours.
 */
export const STANDING_ALERT_HOURS = 24;

/** Hours an alert has been active, or undefined when the upstream gave no timestamp. */
export function activeHours(since: string | undefined, now: number): number | undefined {
  if (!since) return undefined;
  const at = Date.parse(since);
  if (!Number.isFinite(at)) return undefined;
  const hours = (now - at) / 3_600_000;
  // A future timestamp means clock skew, not a negative-duration alert.
  return hours < 0 ? 0 : hours;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Pure: `/v1/alerts/active.json` → one feature per oblast under an air-raid alert.
 *
 * Only active (`finished_at` empty) `air_raid` rows count; the other alert types
 * (artillery shelling, urban fighting) are a different warning from the one this layer
 * names. A row whose `location_uid` IS its oblast's uid covers the whole oblast; any
 * other row is a raion, hromada or city inside it, and the oblast is "partial".
 *
 * An oblast uid the table does not know is skipped and returned in `unknownIds`, never
 * placed at 0,0.
 */
export function normalizeUkraineAlerts(
  payload: unknown,
  now: number = Date.now(),
): { features: SignalFeature[]; unknownIds: number[] } {
  const alerts = (payload as { alerts?: unknown })?.alerts;
  if (!Array.isArray(alerts)) return { features: [], unknownIds: [] };

  interface Group {
    uid: number;
    whole?: AlertsInUaRow;
    parts: AlertsInUaRow[];
    since?: string;
    red: boolean;
  }
  const groups = new Map<number, Group>();
  const unknown = new Set<number>();

  for (const raw of alerts as AlertsInUaRow[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.alert_type !== "air_raid") continue;
    if (raw.finished_at) continue;
    const uid = num(raw.location_oblast_uid) ?? num(raw.location_uid);
    if (uid === undefined) continue;
    if (!OBLAST_ANCHORS[uid]) {
      unknown.add(uid);
      continue;
    }
    let g = groups.get(uid);
    if (!g) {
      g = { uid, parts: [], red: false };
      groups.set(uid, g);
    }
    if (num(raw.location_uid) === uid) g.whole = raw;
    else g.parts.push(raw);
    const started = typeof raw.started_at === "string" ? raw.started_at : undefined;
    if (started && (!g.since || Date.parse(started) < Date.parse(g.since))) g.since = started;
    if (raw.alert_level === "red") g.red = true;
  }

  const features: SignalFeature[] = [];
  for (const g of [...groups.values()].sort((a, b) => a.uid - b.uid)) {
    const anchor = OBLAST_ANCHORS[g.uid]!;
    const whole = Boolean(g.whole);
    const since = whole ? (g.whole!.started_at ?? g.since) : g.since;
    const hours = activeHours(since, now);
    const standing = whole && hours !== undefined && hours >= STANDING_ALERT_HOURS;
    const name = g.whole?.location_title_en?.trim() || anchor.en;
    const areas = [...new Set(g.parts.map((r) => (r.location_title_en || r.location_title || "").trim()).filter(Boolean))];

    const title = standing
      ? `Standing alert — ${name}`
      : whole
        ? `Air-raid alert — ${name} (whole oblast)`
        : `Air-raid alert in part of ${anchor.en} — ${areas.length} area${areas.length === 1 ? "" : "s"}`;

    features.push({
      id: `ukraine-alerts:${g.uid}`,
      lat: anchor.lat,
      lon: anchor.lon,
      title,
      signalId: "ukraineAlerts",
      // A years-old alert is not a fresh warning and must not compete visually with one;
      // a partial alert is a real warning for fewer people than a whole-oblast one.
      color: standing ? "#a16207" : whole ? "#dc2626" : "#ea580c",
      ts: since,
      link: SITE,
      props: {
        oblast: anchor.en,
        status: standing ? "Alert continuously active" : whole ? "Alert active in the whole oblast" : "Alert active in part of the oblast",
        extent: whole ? "Whole oblast" : "Partial",
        areasUnderAlert: areas.length ? areas.slice(0, 12).join(", ") + (areas.length > 12 ? ` and ${areas.length - 12} more` : "") : undefined,
        areaCount: whole ? undefined : areas.length,
        level: g.red ? "red" : "yellow",
        since,
        activeForHours: hours !== undefined ? Math.round(hours) : undefined,
        standing: standing || undefined,
        scope: "The marker is the oblast's main city, not a location. The alert covers the areas named.",
        // Said in the data and not only in a comment, because the dossier is where a
        // reader decides what a red dot means.
        meaning: standing
          ? "This oblast's alert has not cleared in a very long time, so it reports a standing condition rather than a new warning. NOT a report that anything was struck."
          : "A warning to take shelter. NOT a report that anything was struck.",
      },
    });
  }

  return { features, unknownIds: [...unknown].sort((a, b) => a - b) };
}

let cache: { features: SignalFeature[]; at: number; lastModified?: string } | null = null;

export const UKRAINE_ALERTS_SOURCE: SignalSource = {
  id: "ukraineAlerts",
  // An oblast. The anchor is its main city, not the place of a strike.
  precision: "area",
  kind: "event",
  label: "Ukraine air-raid alerts",
  group: "Conflict",
  color: "#dc2626",
  refreshMs: CACHE_TTL_MS,
  attribution: UKRAINE_ALERTS_ATTRIBUTION,
  sourceUrl: SITE,

  async fetch() {
    const token = (process.env.ALERTS_IN_UA_TOKEN ?? "").trim();
    if (!token) return degraded("no key"); // dormant until the free alerts.in.ua token is set
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return observed(cache.features, cache.at);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Provenance/2.0 (+https://github.com/011-sam-110/Provenance)",
      };
      if (cache?.lastModified) headers["If-Modified-Since"] = cache.lastModified;
      const res = await fetch(ENDPOINT, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.status === 304 && cache) {
        cache = { ...cache, at: Date.now() };
        return observed(cache.features, cache.at);
      }
      if (!res.ok) {
        // Last-good rather than nothing: an alert layer that empties on one blip reads
        // as "all clear", which is the most dangerous wrong answer this source can give.
        if (cache) return degradedWith(cache.features, `alerts.in.ua HTTP ${res.status}`, cache.at);
        return degraded(`alerts.in.ua HTTP ${res.status}`);
      }
      const body = (await res.json()) as unknown;
      if (!Array.isArray((body as { alerts?: unknown })?.alerts)) {
        if (cache) return degradedWith(cache.features, "alerts.in.ua bad body", cache.at);
        return degraded("alerts.in.ua bad body");
      }
      const { features } = normalizeUkraineAlerts(body);
      // An uid outside the anchor table is skipped, not degraded: the API also carries
      // regions this layer does not cover, and one of those must not mark the whole read
      // as failed. The 27 regions it does cover are all in the table, and a test holds that.
      cache = { features, at: Date.now(), lastModified: res.headers.get("last-modified") ?? undefined };
      return observed(features, cache.at);
    } catch (err) {
      const reason = (err as Error)?.name === "TimeoutError" ? "alerts.in.ua timeout" : "alerts.in.ua unreachable";
      if (cache) return degradedWith(cache.features, reason, cache.at);
      return degraded(reason);
    }
  },
};
