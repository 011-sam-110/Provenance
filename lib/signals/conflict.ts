import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { markOutcome } from "@/lib/signals/outcome";
import { fetchUcdpEvents, type UcdpRead } from "@/lib/signals/ucdp";
import { fetchEmbassyAlerts, normalizeEmbassyAlerts, type EmbassyRead } from "@/lib/signals/embassy-alerts";
import { fetchTravelAdvice, normalizeAdvice, type AdviceRead } from "@/lib/signals/travel-advice";

// The `conflict` and `protests` layers, rebuilt on primary sources (2026-10-16).
//
// Until then both layers were GDELT's machine-coded news, aggregated per country. An
// audit that day labelled a random sample against the articles behind it: 86% of the
// conflict rows and 58% of the protest rows were not an event of that kind at that
// place (Japan's top "conflict" was a Zelda trailer, Italy's a Nürburgring lap record).
// No GDELT product fixes that, so the layers now read sources that say what they mean:
//
//   conflict  = UCDP verified lethal events (monthly, 3 to 7 weeks old)
//             + U.S. Embassy security alerts that name fighting, attacks or gunfire
//             + UK and Canadian travel-advice changes that name the same
//   protests  = U.S. Embassy demonstration alerts (city-named, often in advance)
//             + UK and Canadian travel-advice changes that name protests or strikes
//
// What was lost: GDELT's "news is talking about violence here in the last four hours".
// About three in four of the rows behind it were not real, so the loss is small.
// ACLED's weekly counts (published by ACLED on HDX) would add a second verified source
// and are waiting on a licence decision.
//
// Each feature says which source it came from in `props.source`, and sets its own
// precision: a UCDP event can be exact, an area or a whole country; an alert is a named
// city or the country; a travel-advice change is always the country.

const CONFLICT_COLOR = "#b91c1c";
const PROTEST_COLOR = "#7c3aed";
const ADVICE_CONFLICT_COLOR = "#b45309";
const ADVICE_PROTEST_COLOR = "#a78bfa";

export const CONFLICT_ATTRIBUTION =
  "Events: UCDP GED Candidate (CC BY 4.0) · Alerts: U.S. Department of State (public domain) · Travel advice: UK FCDO (OGL v3.0), Global Affairs Canada (OGL – Canada) · Places: GeoNames (CC BY 4.0)";
export const PROTESTS_ATTRIBUTION =
  "Alerts: U.S. Department of State (public domain) · Travel advice: UK FCDO (OGL v3.0), Global Affairs Canada (OGL – Canada) · Places: GeoNames (CC BY 4.0)";

/** Pure: the outcome of a read that joined several sources. Shared by both layers. */
export function joinOutcome(parts: { name: string; ok: boolean; reason?: string }[]): { ok: boolean; reason?: string } {
  const failed = parts.filter((p) => !p.ok);
  if (failed.length === 0) return { ok: true };
  // A reason is published and may be shown, so it stays short (the outcome test holds 80).
  const full = failed.map((p) => p.reason ?? `${p.name} failed`).join("; ");
  return { ok: false, reason: full.length <= 80 ? full : `${failed.map((p) => p.name).join(", ")} failed` };
}

function embassyPart(read: EmbassyRead): { name: string; ok: boolean; reason?: string } {
  // Most of 177 feeds is a read. Nothing held at all is not.
  if (read.held === 0) return { name: "embassy alerts", ok: false, reason: "embassy: no feed answered" };
  if (read.failed > read.total / 2) return { name: "embassy alerts", ok: false, reason: `embassy: ${read.failed} of ${read.total} feeds failed` };
  return { name: "embassy alerts", ok: true };
}

function advicePart(read: AdviceRead): { name: string; ok: boolean; reason?: string } {
  return read.failed.length
    ? { name: "travel advice", ok: false, reason: `advice: ${read.failed.join(", ")} failed` }
    : { name: "travel advice", ok: true };
}

/** Pure: the three reads → the conflict layer's features and outcome. */
export function composeConflict(
  ucdp: UcdpRead,
  embassy: EmbassyRead,
  advice: AdviceRead,
  now: number = Date.now(),
): { features: SignalFeature[]; ok: boolean; reason?: string } {
  const features = [
    ...ucdp.features,
    ...normalizeEmbassyAlerts(embassy.alerts, "conflict", "conflict", CONFLICT_COLOR),
    ...normalizeAdvice(advice.updates, "conflict", "conflict", ADVICE_CONFLICT_COLOR, now),
  ];
  const o = joinOutcome([{ name: "ucdp", ok: ucdp.ok, reason: ucdp.reason }, embassyPart(embassy), advicePart(advice)]);
  return { features, ...o };
}

/** Pure: the two reads → the protests layer's features and outcome. */
export function composeProtests(
  embassy: EmbassyRead,
  advice: AdviceRead,
  now: number = Date.now(),
): { features: SignalFeature[]; ok: boolean; reason?: string } {
  const features = [
    ...normalizeEmbassyAlerts(embassy.alerts, "protest", "protests", PROTEST_COLOR),
    ...normalizeAdvice(advice.updates, "protest", "protests", ADVICE_PROTEST_COLOR, now),
  ];
  return { features, ...joinOutcome([embassyPart(embassy), advicePart(advice)]) };
}

export const CONFLICT_SOURCE: SignalSource = {
  id: "conflict",
  // Mixed: a UCDP event is exact, an area or a country; an alert is a city or a country;
  // advice is a country. Each feature sets its own; this is the default for none.
  precision: "area",
  kind: "event",
  label: "Armed conflict",
  group: "Intel",
  color: CONFLICT_COLOR,
  refreshMs: 15 * 60 * 1000,
  attribution: CONFLICT_ATTRIBUTION,
  sourceUrl: "https://ucdp.uu.se/downloads/",
  // Real scalar: UCDP's best estimate of deaths in one event. Alerts and advice carry no
  // death count, so they draw a dot, not a bar.
  metric: { field: "deaths", domain: [1, 100], unit: " deaths" },
  async fetch() {
    const now = Date.now();
    const [ucdp, embassy, advice] = await Promise.all([fetchUcdpEvents(), fetchEmbassyAlerts(), fetchTravelAdvice()]);
    const { features, ok, reason } = composeConflict(ucdp, embassy, advice, now);
    if (features.length === 0 && !ok) return markOutcome([], { ok: false, at: now, reason });
    // No `sourceAt`: the layer mixes this week's alerts with a release weeks old, so no
    // one "as of" moment is true of all of it. Each feature carries its own date.
    return markOutcome(features, { ok, at: now, ...(reason ? { reason } : {}) });
  },
};

export const PROTESTS_SOURCE: SignalSource = {
  id: "protests",
  // An alert names a city, or only the country; advice is a country.
  precision: "area",
  kind: "event",
  label: "Protests",
  group: "Intel",
  color: PROTEST_COLOR,
  refreshMs: 15 * 60 * 1000,
  attribution: PROTESTS_ATTRIBUTION,
  sourceUrl: "https://www.usembassy.gov/",
  async fetch() {
    const now = Date.now();
    const [embassy, advice] = await Promise.all([fetchEmbassyAlerts(), fetchTravelAdvice()]);
    const { features, ok, reason } = composeProtests(embassy, advice, now);
    return markOutcome(features, { ok, at: now, ...(reason ? { reason } : {}) });
  },
};
