import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { iodaRegion } from "@/lib/signals/ioda-regions.data";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { fetchPulse, normalizePulse, PULSE_CREDIT } from "@/lib/signals/pulse-shutdowns";

// Internet outages — IODA (Internet Outage Detection & Analysis, Georgia Tech /
// CAIDA). Detects connectivity drops from independent vantage points (BGP routing,
// active probing of /24 blocks, the Merit network telescope, Google traffic).
// Country-level internet shutdowns are a top-tier instability signal — governments
// cut connectivity during coups, contested elections and crackdowns. Keyless.
// Dormant-safe (→ [] on failure).
//
// WHY THE EVENTS ENDPOINT AND NOT THE SUMMARY (2026-10-16). This adapter used to read
// /v2/outages/summary and pin every country in it. Measured that day: 63 countries
// on the map, 59 of them outages that had ENDED 13 to 20 hours earlier (the summary
// has no "still going" flag, and IODA stretches its window back 14 days), and 52 of
// them from ONE ping-slash24 burst that started in 52 countries in the same 10
// minutes while BGP stayed quiet. Germany's raw probe series showed the cause: IODA's
// prober stopped reporting and restarted. That is not 52 outages. The events
// endpoint carries the start, the duration and the datasource of each event, which
// is what the two rules below need: keep only what is still in progress (or ended
// within RECOVERING_SEC), and drop a single-datasource burst no other datasource
// agrees with. On the same capture that leaves 4 countries, and all 4 were real.

const EVENTS_URL = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const IODA_ATTRIBUTION = "Internet-outage detection © IODA (CAIDA / Georgia Tech)";

/** One IODA outage event, as /v2/outages/events returns it (format "codf"). */
export interface IodaEvent {
  /** "country/PG", "region/1922". */
  location?: string;
  location_name?: string;
  /** Epoch seconds. */
  start?: number;
  /** Seconds. An event still in progress runs to the query's `until`. */
  duration?: number;
  /** "bgp", "ping-slash24", "merit-nt", "gtr". */
  datasource?: string;
  score?: number;
}

export interface IodaEventsPayload {
  data?: IodaEvent[];
  requestParameters?: { until?: string | number };
}

/**
 * The burst rule. When at least `minEntities` places start an event on `datasource`
 * inside the same `binSec` bin, the cause is IODA's prober, not the places. Measured
 * 2026-10-15 22:20 UTC: 52 countries and 602 regions in one ping-slash24 bin.
 */
export const BURST_RULE = { binSec: 600, minEntities: 10, datasource: "ping-slash24" } as const;
/** An event that ended this recently is shown as recovering, not dropped. */
export const RECOVERING_SEC = 2 * 3600;
/** An event whose end is this close to the query's `until` is still in progress. */
export const ONGOING_SLACK_SEC = 20 * 60;

const endOf = (e: IodaEvent) => (e.start ?? 0) + (e.duration ?? 0);

/**
 * Pure: remove the prober-artefact events. A `datasource` event is dropped when its
 * start bin holds `minEntities` or more places on that datasource AND no event from
 * another datasource overlaps it at the same place. Corroborated events stay.
 */
export function dropProberBursts(events: IodaEvent[], rule: typeof BURST_RULE = BURST_RULE): IodaEvent[] {
  const perBin = new Map<number, Set<string>>();
  for (const e of events) {
    if (e.datasource !== rule.datasource || typeof e.start !== "number" || !e.location) continue;
    const bin = Math.floor(e.start / rule.binSec);
    let s = perBin.get(bin);
    if (!s) perBin.set(bin, (s = new Set()));
    s.add(e.location);
  }
  const corroborated = (e: IodaEvent) =>
    events.some(
      (o) =>
        o !== e &&
        o.location === e.location &&
        o.datasource !== rule.datasource &&
        (o.start ?? 0) <= endOf(e) &&
        endOf(o) >= (e.start ?? 0),
    );
  return events.filter((e) => {
    if (e.datasource !== rule.datasource || typeof e.start !== "number") return true;
    const n = perBin.get(Math.floor(e.start / rule.binSec))?.size ?? 0;
    return n < rule.minEntities || corroborated(e);
  });
}

/** Pure: is this event still in progress at `until`, recently over, or old news? */
export function eventState(e: IodaEvent, until: number): "ongoing" | "recovering" | null {
  if (typeof e.start !== "number") return null;
  const end = endOf(e);
  if (end >= until - ONGOING_SLACK_SEC) return "ongoing";
  if (until - end <= RECOVERING_SEC) return "recovering";
  return null;
}

/** One place with at least one current event, after both rules. */
export interface OutageGroup {
  location: string;
  name: string;
  /** Distinct datasources with a current event here, sorted. More = stronger. */
  datasources: string[];
  /** Epoch seconds of the earliest current event. */
  startedAt: number;
  state: "ongoing" | "recovering";
  /** IODA's own score: the largest of the current events. Unitless. */
  score: number;
  events: number;
}

/** Pure: events → one group per place, keeping only current events. */
export function groupOutages(events: IodaEvent[], until: number): OutageGroup[] {
  const by = new Map<string, OutageGroup>();
  for (const e of dropProberBursts(events)) {
    const state = eventState(e, until);
    if (!state || !e.location) continue;
    let g = by.get(e.location);
    if (!g) {
      g = {
        location: e.location,
        name: (e.location_name ?? "").trim(),
        datasources: [],
        startedAt: e.start as number,
        state,
        score: 0,
        events: 0,
      };
      by.set(e.location, g);
    }
    if (e.datasource && !g.datasources.includes(e.datasource)) g.datasources.push(e.datasource);
    g.startedAt = Math.min(g.startedAt, e.start as number);
    if (state === "ongoing") g.state = "ongoing";
    if (typeof e.score === "number" && e.score > g.score) g.score = e.score;
    g.events += 1;
  }
  for (const g of by.values()) g.datasources.sort();
  return [...by.values()];
}

/**
 * IODA's overall score → a 0–10 marker magnitude, log-scaled.
 *
 * The raw score is an internal IODA quantity with no unit and no ceiling — live
 * values on 2026-08-10 were around 5.7e10, six orders of magnitude past the
 * "~1e3–1e6" this function was originally written for. It means nothing to a
 * reader, so it must never be the number on the face of a widget.
 */
export function outageMagnitude(score: number): number {
  if (!(score > 0)) return 3;
  // Calibrated on the range IODA ACTUALLY emits — roughly 1e3 to 1e11 — not the
  // 1e3–1e6 the first version assumed. With the old constant everything above
  // about 1e7 clamped to 10, so the three worst-hit countries in the world were
  // indistinguishable from each other and from a moderate regional outage. A
  // saturated scale is a scale that has stopped measuring.
  const decades = Math.log10(score + 1);
  const m = 3 + ((decades - 3) * 7) / 8; // 1e3 → 3, 1e11 → 10
  return Math.min(10, Math.max(3, Math.round(m * 10) / 10));
}

export type OutageSeverity = "severe" | "elevated" | "localised";

/**
 * The human-facing label for an outage: the SEVERITY BAND and the event count,
 * never the raw score.
 *
 * The anomaly widget renders the declared metric's value, and the declared metric
 * was `outageScore` — so the first row of the flagship "What's abnormal" widget
 * read "Internet outages (IODA) · 56780505874". Three separate auditors flagged
 * that same number independently. A quantity a reader cannot interpret is not a
 * measurement to them; it is noise wearing a measurement's clothes.
 */
export function outageBand(score: number): OutageSeverity {
  // Log thresholds, because the raw score has no ceiling and its practical scale
  // MOVES. The captured fixture's worst outage was 3.8e5; the live feed on
  // 2026-08-10 had Côte d'Ivoire at 5.8e10 with the next-worst country at 2.9e4 —
  // a six-order-of-magnitude gap inside a single snapshot. Absolute thresholds
  // calibrated on any one day are wrong on another, which is exactly how the
  // previous 100_000 constant came to call almost everything severe.
  if (score >= 1e9) return "severe";
  if (score >= 1e6) return "elevated";
  return "localised";
}

const RANK: Record<OutageSeverity, number> = { localised: 0, elevated: 1, severe: 2 };

/**
 * The severity of a group: the stronger of the score band and the AGREEMENT band.
 * Independent vantage points agreeing is the best evidence IODA offers that a drop
 * is real: three datasources is severe, two is elevated, one alone is localised.
 */
export function groupSeverity(g: Pick<OutageGroup, "score" | "datasources">): OutageSeverity {
  const n = g.datasources.length;
  const agreement: OutageSeverity = n >= 3 ? "severe" : n === 2 ? "elevated" : "localised";
  const band = outageBand(g.score);
  return RANK[agreement] >= RANK[band] ? agreement : band;
}

/** The query's `until` as epoch seconds, from the payload, else now. */
export function payloadUntil(json: IodaEventsPayload, nowSec: number = Math.floor(Date.now() / 1000)): number {
  const u = Number(json.requestParameters?.until);
  return Number.isFinite(u) && u > 0 ? u : nowSec;
}

function groupProps(g: OutageGroup, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...extra,
    state: g.state,
    severity: groupSeverity(g),
    // The datasources that agree, so a reader can weigh BGP + probing over probing alone.
    datasources: g.datasources.join(", "),
    agreeing: g.datasources.length,
    startedAt: new Date(g.startedAt * 1000).toISOString(),
    // Kept, because the dossier should still be able to show the upstream's own
    // number and link to it — but it is no longer what the widget prints.
    outageScore: Math.round(g.score),
    events: g.events,
    magnitude: outageMagnitude(g.score),
  };
}

/** Pure: IODA country events → one SignalFeature per country with a current outage. */
export function normalizeOutages(json: IodaEventsPayload, until: number = payloadUntil(json)): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const g of groupOutages(json.data ?? [], until)) {
    const m = /^country\/([A-Za-z]{2})$/.exec(g.location);
    if (!m) continue;
    const code = m[1].toUpperCase();
    const c = centroidByIso2(code);
    if (!c) continue; // unknown / non-country code (e.g. "ZZ") — skip
    const name = g.name || c.name;
    out.push({
      id: `ioda:${code}`,
      lat: c.lat,
      lon: c.lon,
      title: g.state === "recovering" ? `Internet outage (recovering) — ${name}` : `Internet outage — ${name}`,
      signalId: "internet-outages",
      countryIso3: c.iso3,
      color: "#b91c1c", // censorship/outage red
      ts: new Date(g.startedAt * 1000).toISOString(),
      props: groupProps(g, { country: name }),
    });
  }
  return out;
}

/**
 * Pure: IODA REGION events → one SignalFeature per region with a current outage.
 *
 * Sub-national, which the country view cannot be: on 2026-10-16 IODA had current
 * regional events in Baluchistan, Kotayk and Offaly that no country marker showed.
 * IODA names a region only by id ("region/3082"), so the place comes from the
 * committed admin-1 table (scripts/gen-ioda-regions.mjs). The mark is an area: the
 * anchor is inside the region, not the place of a fault. A region the table lacks
 * is skipped rather than placed on its country's centroid.
 */
export function normalizeRegionOutages(json: IodaEventsPayload, until: number = payloadUntil(json)): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const g of groupOutages(json.data ?? [], until)) {
    const row = iodaRegion(g.location);
    if (!row) continue;
    const [name, iso2, lat, lon] = row;
    const country = centroidByIso2(iso2)?.name ?? iso2;
    const id = g.location.slice("region/".length);
    out.push({
      id: `ioda-region:${id}`,
      lat,
      lon,
      precision: "area",
      title: `${g.state === "recovering" ? "Internet outage (recovering)" : "Internet outage"} — ${name}, ${country}`,
      signalId: "internet-outages",
      color: "#b91c1c",
      ts: new Date(g.startedAt * 1000).toISOString(),
      props: groupProps(g, { region: name, country }),
    });
  }
  return out;
}

async function fetchEvents(entityType: "country" | "region"): Promise<IodaEventsPayload | null> {
  // 24h back is enough: IODA extends the window server-side (14 days) to return any
  // event still in progress, which is exactly the set the rules above keep.
  const until = Math.floor(Date.now() / 1000);
  const from = until - 24 * 3600;
  try {
    const res = await fetch(
      `${EVENTS_URL}?from=${from}&until=${until}&entityType=${entityType}&includeAlerts=false&limit=5000`,
      { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) return null;
    return (await res.json()) as IodaEventsPayload;
  } catch {
    return null;
  }
}

export const INTERNET_OUTAGES_SOURCE: SignalSource = {
  id: "internet-outages",
  // One IODA figure for each country, placed on a centroid. Region events set their
  // own "area" precision.
  precision: "country",
  label: "Internet outages (IODA)",
  group: "Infrastructure",
  color: "#b91c1c",
  refreshMs: 15 * 60 * 1000,
  // Pulse's terms require its credit wherever its data is shown, so the layer names it.
  attribution: `${IODA_ATTRIBUTION} · Shutdowns: ${PULSE_CREDIT} (Pulse)`,
  sourceUrl: "https://ioda.inetintel.cc.gatech.edu/", // IODA dashboard (dossier source)

  // The metric drives the monitor bar AND the value the anomaly widget prints, so
  // it must be a number a person can read. `outageScore` was neither: unitless,
  // unbounded, and live values ~5.7e10 against a declared ceiling of 100,000 — so
  // every bar was pinned at full and the widget printed 56,780,505,874. The
  // log-scaled 0–10 magnitude is the same ordering, legibly.
  metric: { field: "magnitude", domain: [0, 10] },
  async fetch() {
    const [countries, regions, pulse] = await Promise.all([
      fetchEvents("country"),
      fetchEvents("region"),
      fetchPulse(), // null without ISOC_PULSE_API_KEY: the IODA part does not need it
    ]);
    const shutdowns = pulse ? normalizePulse({ data: pulse }) : [];
    // IODA is the measured backbone. With both of its views down the layer is
    // degraded, even if Pulse's verified shutdowns can still be shown.
    if (!countries && !regions) return shutdowns.length ? degradedWith(shutdowns, "fetch failed") : degraded("fetch failed");
    // An empty result here is a real reading: IODA answered, nothing is out now. One
    // of the two views failing keeps the other: a country marker is not lost because
    // the (larger, slower) region request timed out.
    return observed([
      ...(countries ? normalizeOutages(countries) : []),
      ...(regions ? normalizeRegionOutages(regions) : []),
      ...shutdowns,
    ]);
  },
};
