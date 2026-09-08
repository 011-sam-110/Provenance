import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// alerts.com.ua — Ukraine's oblast-level air-raid alert state. Keyless JSON,
// `GET /api/states` → 25 oblasts + Kyiv city, each with a boolean `alert` and the
// timestamp it last changed. Verified live 2026-09-08: two oblasts under alert, most
// recent state change the previous afternoon.
//
// WHY THIS SOURCE AND NOT A CAMERA. Ukraine restricts publishing footage of strikes and
// air-defence work, because a public feed showing where something landed is targeting and
// damage-assessment help for whoever fired it. So this project does not go looking for
// live cameras inside the active conflict zone. The air-raid alert state is the opposite
// kind of data: it is published BY the authorities so that civilians see it, it is already
// on every phone in the country, and it says only "shelter is advised in this oblast" —
// no location, no outcome, no target. It is the honest thing to put on a situational map.
//
// WHAT THE FEED IS AND IS NOT. It is the ALERT STATE, not an event log: `alert: true`
// means an alert is active in that oblast right now. It is not a strike, not a
// casualty count, and not evidence that anything was hit — an alert is a warning, and
// most warnings end with nothing happening where you are standing. `title` and the
// dossier props say so, because a red dot on a map invites exactly the wrong reading.
//
// OFFICIAL vs THIS ONE. The Ukrainian government's own api.ukrainealarm.com answers 403
// without an issued key, and alerts.in.ua answers 401 — both measured 2026-09-08. This
// endpoint is keyless and is the same data those serve. If a key is ever obtained,
// switching upstream is a change to `fetch()` alone; `normalizeUkraineAlerts` is the part
// with the rules in it and does not care where the rows came from.

const CACHE_TTL_MS = 60_000; // an alert is time-critical; a minute is already generous
const REQUEST_TIMEOUT_MS = 15_000;
const ENDPOINT = "https://alerts.com.ua/api/states";

export const UKRAINE_ALERTS_ATTRIBUTION = "Air-raid alert state © alerts.com.ua";

/** One row as the upstream publishes it. */
export interface UaStateRow {
  id?: number;
  name?: string;
  name_en?: string;
  alert?: boolean;
  changed?: string;
}

/**
 * Oblast anchor points.
 *
 * The feed carries no geometry at all — only a name and a boolean — so a coordinate has
 * to come from somewhere, and this is that somewhere. Each is the administrative centre
 * of the oblast (the city the oblast is named for), NOT a geometric centroid of its area,
 * because an alert is a civil-defence instruction to the people in it and the population
 * is where the city is.
 *
 * That choice has a consequence worth stating: the dot marks the oblast's main city, and
 * an oblast is up to ~300 km across, so the dot is an ANCHOR and never a location. The
 * dossier says "oblast-wide" for the same reason.
 *
 * Keyed by the upstream's `id`, which is stable, rather than by name — the names arrive in
 * Ukrainian and a rename or a transliteration change must not silently drop an oblast off
 * the map. An id the table does not know is reported, not guessed.
 */
export const OBLAST_ANCHORS: Readonly<Record<number, { en: string; lat: number; lon: number }>> = {
  1: { en: "Vinnytsia", lat: 49.2331, lon: 28.4682 },
  2: { en: "Volyn", lat: 50.7472, lon: 25.3254 },
  3: { en: "Dnipropetrovsk", lat: 48.4647, lon: 35.0462 },
  4: { en: "Donetsk", lat: 48.0159, lon: 37.8029 },
  5: { en: "Zhytomyr", lat: 50.2547, lon: 28.6587 },
  6: { en: "Zakarpattia", lat: 48.6208, lon: 22.2879 },
  7: { en: "Zaporizhzhia", lat: 47.8388, lon: 35.1396 },
  8: { en: "Ivano-Frankivsk", lat: 48.9226, lon: 24.7111 },
  // Kyiv oblast is the one place the "administrative centre" rule breaks: its centre is
  // Kyiv, which the feed carries SEPARATELY as id 25, so both would land on the same
  // pixel and one alert would hide the other. Anchored on Bila Tserkva, the oblast's
  // largest city, which keeps the two dots distinguishable and still puts the marker
  // where the oblast's people are.
  9: { en: "Kyiv oblast", lat: 49.7950, lon: 30.1310 },
  10: { en: "Kirovohrad", lat: 48.5079, lon: 32.2623 },
  11: { en: "Luhansk", lat: 48.5740, lon: 39.3078 },
  12: { en: "Lviv", lat: 49.8397, lon: 24.0297 },
  13: { en: "Mykolaiv", lat: 46.9750, lon: 31.9946 },
  14: { en: "Odesa", lat: 46.4825, lon: 30.7233 },
  15: { en: "Poltava", lat: 49.5883, lon: 34.5514 },
  16: { en: "Rivne", lat: 50.6199, lon: 26.2516 },
  17: { en: "Sumy", lat: 50.9077, lon: 34.7981 },
  18: { en: "Ternopil", lat: 49.5535, lon: 25.5948 },
  19: { en: "Kharkiv", lat: 49.9935, lon: 36.2304 },
  20: { en: "Kherson", lat: 46.6354, lon: 32.6169 },
  21: { en: "Khmelnytskyi", lat: 49.4229, lon: 26.9871 },
  22: { en: "Cherkasy", lat: 49.4444, lon: 32.0598 },
  23: { en: "Chernivtsi", lat: 48.2921, lon: 25.9358 },
  24: { en: "Chernihiv", lat: 51.4982, lon: 31.2893 },
  25: { en: "Kyiv city", lat: 50.4501, lon: 30.5234 },
};

/**
 * Above this, an "alert" is reporting a standing condition rather than a live warning.
 *
 * FOUND BY RUNNING IT, NOT BY READING IT. The live feed on 2026-09-08 returned Luhansk
 * with `changed: "2023-10-29"` — an alert that has not cleared in nearly three years,
 * because the oblast is occupied and its siren state simply stays on. A fixture would
 * never have shown this; only calling the real endpoint did.
 *
 * Dropping the row would be worse than keeping it: the feed genuinely says the alert is
 * active, and deleting inconvenient data is how a source stops being trustworthy. So it
 * is kept, and it is LABELLED — different title, different colour, and an explicit
 * "how long" so a reader cannot mistake a three-year condition for tonight's warning.
 *
 * A day is the threshold because a real air-raid alert is minutes to hours. Anything
 * running past a full day is not the thing this layer is for.
 */
export const STANDING_ALERT_HOURS = 24;

/** Hours an alert has been active, or undefined when the upstream gave no timestamp. */
export function activeHours(changed: string | undefined, now: number): number | undefined {
  if (!changed) return undefined;
  const at = Date.parse(changed);
  if (!Number.isFinite(at)) return undefined;
  const hours = (now - at) / 3_600_000;
  // A future timestamp means clock skew, not a negative-duration alert.
  return hours < 0 ? 0 : hours;
}

/**
 * Pure: upstream rows → the oblasts currently under alert.
 *
 * ONLY oblasts with `alert === true` become features. A quiet oblast is not a signal, and
 * drawing 25 dots of which 23 mean "nothing is happening" would make the layer read as
 * activity everywhere. `=== true` and not truthiness, so a string or a 1 from a changed
 * upstream cannot quietly turn every oblast red.
 *
 * An unknown oblast id is skipped and counted rather than placed at 0,0 — the Gulf of
 * Guinea is where every un-geocoded row in every product goes to be believed.
 */
export function normalizeUkraineAlerts(
  payload: unknown,
  now: number = Date.now(),
): { features: SignalFeature[]; unknownIds: number[] } {
  const states = (payload as { states?: unknown })?.states;
  if (!Array.isArray(states)) return { features: [], unknownIds: [] };

  const features: SignalFeature[] = [];
  const unknownIds: number[] = [];

  for (const raw of states as UaStateRow[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.alert !== true) continue;

    const id = Number(raw.id);
    if (!Number.isFinite(id)) continue;
    const anchor = OBLAST_ANCHORS[id];
    if (!anchor) {
      unknownIds.push(id);
      continue;
    }

    const name = raw.name_en?.trim() || anchor.en;
    const changed = typeof raw.changed === "string" ? raw.changed : undefined;
    const hours = activeHours(changed, now);
    const standing = hours !== undefined && hours >= STANDING_ALERT_HOURS;

    features.push({
      id: `ukraine-alerts:${id}`,
      lat: anchor.lat,
      lon: anchor.lon,
      title: standing ? `Standing alert — ${name}` : `Air-raid alert — ${name}`,
      signalId: "ukraineAlerts",
      // A years-old alert is not a fresh warning and must not compete visually with one.
      color: standing ? "#a16207" : "#dc2626",
      ts: changed,
      link: "https://alerts.com.ua/",
      props: {
        oblast: name,
        oblastLocal: raw.name?.trim() || undefined,
        status: standing ? "Alert continuously active" : "Alert active",
        since: changed,
        activeForHours: hours !== undefined ? Math.round(hours) : undefined,
        standing: standing || undefined,
        scope: "Oblast-wide — the marker is the administrative centre, not a location",
        // Said in the data and not only in a comment, because the dossier is where a
        // reader decides what a red dot means.
        meaning: standing
          ? "This oblast's alert has not cleared in a very long time, so it reports a standing condition rather than a new warning. NOT a report that anything was struck."
          : "A warning to take shelter. NOT a report that anything was struck.",
      },
    });
  }

  return { features, unknownIds };
}

let cache: { features: SignalFeature[]; at: number } | null = null;

export const UKRAINE_ALERTS_SOURCE: SignalSource = {
  id: "ukraineAlerts",
  kind: "event",
  label: "Ukraine air-raid alerts",
  group: "Conflict",
  color: "#dc2626",
  refreshMs: CACHE_TTL_MS,
  attribution: UKRAINE_ALERTS_ATTRIBUTION,
  sourceUrl: "https://alerts.com.ua/",

  async fetch() {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return observed(cache.features, cache.at);
    try {
      const res = await fetch(ENDPOINT, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Provenance/2.0 (+https://github.com/011-sam-110/Provenance)",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Last-good rather than nothing: an alert layer that empties on one blip reads
        // as "all clear", which is the most dangerous wrong answer this source can give.
        if (cache) return degradedWith(cache.features, `alerts.com.ua HTTP ${res.status}`, cache.at);
        return degraded(`alerts.com.ua HTTP ${res.status}`);
      }
      const { features, unknownIds } = normalizeUkraineAlerts(await res.json());
      cache = { features, at: Date.now() };
      if (unknownIds.length) {
        // An oblast we cannot place is a GAP, not an all-clear, and the layer says so
        // rather than quietly serving a shorter list.
        return degradedWith(features, `unmapped oblast ids: ${unknownIds.join(", ")}`, cache.at);
      }
      return observed(features, cache.at);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "alerts.com.ua unreachable";
      if (cache) return degradedWith(cache.features, reason, cache.at);
      return degraded(reason);
    }
  },
};
