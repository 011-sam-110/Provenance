// lib/signals/quakeTwin.ts
// The same event in the other earthquake layer.
//
// USGS ("earthquakes") and EMSC ("emsc-quakes") list the same events, and nothing
// said so: the EMSC explainer admits "the same earthquake appears twice", and the
// panel for one never mentioned the other. This finds an event's entry in the other
// list, and says what it could not find only when the other list could have shown it.
//
// WHAT A MATCH IS NOT. Two catalogues listing one event is not two measurements.
// Measured 2026-10-08 on the live layers: of 36 EMSC entries that USGS also lists,
// 24 were credited by a US network (NEIC, AK, HV, SCSN, PR, TX, NN), the contributors
// USGS publishes itself, 11 by EMSC and 1 by INET (Nicaragua). So the result carries
// the twin's credited network and the words never say "confirmed" or "independent".
//
// THE RULE. Same moment (TWIN_MAX_SECONDS), same place (TWIN_MAX_KM), magnitudes
// within TWIN_MAX_MAG_DIFF. Chosen from that same snapshot: of 221 USGS events, the
// 38 pairs the rule joins sit within 90 s, 42 km and 0.8 magnitude, and USGS M>=4.5
// pairs 14 of 14. One day, one snapshot: widen it only with a measurement. A swarm
// puts several events seconds apart, so a candidate is accepted only if THIS event
// is also the twin's closest entry in its own list.
//
// WHAT AN ABSENCE MEANS. "None" is claimed only for a moment inside the span the
// other list shows (its oldest to newest row). EMSC is a single page of 500, and USGS
// lists from ~M4.5 outside the US, so being absent from a list says nothing about the
// event. Outside that span the answer is "outside", not "none".
//
// Pure, type-only imports: the client bundle and node tests can both import it.

import type { SignalFeature } from "@/lib/signals/types";

export const TWIN_MAX_SECONDS = 120;
export const TWIN_MAX_KM = 60;
export const TWIN_MAX_MAG_DIFF = 0.8;

/** What the layer is called in a sentence. */
export const QUAKE_LAYER_NAME = { earthquakes: "USGS", "emsc-quakes": "EMSC" } as const;
type QuakeLayerId = keyof typeof QUAKE_LAYER_NAME;

const TWIN_OF: Record<QuakeLayerId, QuakeLayerId> = {
  earthquakes: "emsc-quakes",
  "emsc-quakes": "earthquakes",
};

/** The layer that lists the same events, or undefined for any other layer. */
export function twinLayerOf(signalId: string | undefined): QuakeLayerId | undefined {
  return signalId !== undefined && Object.hasOwn(TWIN_OF, signalId) ? TWIN_OF[signalId as QuakeLayerId] : undefined;
}

/** The three things a comparison reads off an event. */
export interface QuakeFacts {
  /** The event's id in its own layer: the panel holds a copy from the click, the list is re-read. */
  id?: string;
  lat: number;
  lon: number;
  ts?: string;
  magnitude?: number;
}

export function quakeFacts(f: Pick<SignalFeature, "id" | "lat" | "lon" | "ts" | "props">): QuakeFacts {
  const m = f.props?.magnitude;
  return { id: f.id, lat: f.lat, lon: f.lon, ts: f.ts, magnitude: typeof m === "number" ? m : undefined };
}

/** Both adapters turn a missing magnitude into 0, so 0 means "not given" here. */
const knownMagnitude = (m: number | undefined): m is number => typeof m === "number" && Number.isFinite(m) && m !== 0;

interface Gap {
  seconds: number;
  km: number;
  magDiff: number | null;
  /** Each limit's share used, squared and summed. Lower is closer. */
  score: number;
}

function haversineKm(a: QuakeFacts, b: QuakeFacts): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The gap between two events when it is inside the rule; null when it is not (or cannot be read). */
function fitGap(a: QuakeFacts, b: QuakeFacts): Gap | null {
  const ta = a.ts ? Date.parse(a.ts) : Number.NaN;
  const tb = b.ts ? Date.parse(b.ts) : Number.NaN;
  if (![ta, tb, a.lat, a.lon, b.lat, b.lon].every(Number.isFinite)) return null;
  const seconds = Math.abs(ta - tb) / 1000;
  if (seconds > TWIN_MAX_SECONDS) return null;
  const km = haversineKm(a, b);
  if (km > TWIN_MAX_KM) return null;
  const magDiff = knownMagnitude(a.magnitude) && knownMagnitude(b.magnitude) ? Math.abs(a.magnitude - b.magnitude) : null;
  if (magDiff !== null && magDiff > TWIN_MAX_MAG_DIFF + 1e-9) return null;
  const score = (seconds / TWIN_MAX_SECONDS) ** 2 + (km / TWIN_MAX_KM) ** 2 + ((magDiff ?? 0) / TWIN_MAX_MAG_DIFF) ** 2;
  return { seconds, km, magDiff, score };
}

export type TwinVerdict =
  | { kind: "match"; twin: SignalFeature; seconds: number; km: number; magDiff: number | null }
  /** The other list covers this moment and holds nothing that fits. */
  | { kind: "none" }
  /** The moment is outside the span the other list shows: it cannot speak to it. */
  | { kind: "outside" }
  /** A candidate fits, but another entry of this layer fits it better. */
  | { kind: "ambiguous" }
  /** The event has no readable time or place. */
  | { kind: "unusable" };

/**
 * `subject` is the event on screen, `theirs` the other layer's list, `ours` the
 * subject's own layer (optional: it lets the match be checked from the twin's side).
 */
export function findQuakeTwin(subject: QuakeFacts, theirs: readonly SignalFeature[], ours: readonly SignalFeature[] = []): TwinVerdict {
  const t = subject.ts ? Date.parse(subject.ts) : Number.NaN;
  if (![t, subject.lat, subject.lon].every(Number.isFinite)) return { kind: "unusable" };

  let best: { f: SignalFeature; gap: Gap } | null = null;
  for (const f of theirs) {
    const gap = fitGap(subject, quakeFacts(f));
    if (gap && (!best || gap.score < best.gap.score)) best = { f, gap };
  }

  if (best) {
    const twinFacts = quakeFacts(best.f);
    for (const o of ours) {
      // The subject's own entry is not "another event": its copy here may be a later reading.
      if (subject.id !== undefined && o.id === subject.id) continue;
      const back = fitGap(twinFacts, quakeFacts(o));
      if (back && back.score < best.gap.score - 1e-9) return { kind: "ambiguous" };
    }
    return { kind: "match", twin: best.f, seconds: best.gap.seconds, km: best.gap.km, magDiff: best.gap.magDiff };
  }

  const times = theirs.map((f) => (f.ts ? Date.parse(f.ts) : Number.NaN)).filter(Number.isFinite);
  if (times.length === 0 || t < Math.min(...times) || t > Math.max(...times)) return { kind: "outside" };
  return { kind: "none" };
}

/** A list as `useSignalFeed` returns it (a structural subset of its SignalFeed). */
export interface FeedState {
  features: SignalFeature[];
  status: "idle" | "loading" | "error";
  /** Epoch ms of the last SUCCESSFUL read; null until one has happened. */
  updatedAt: number | null;
  /** Did the most recent read succeed? False while the rows held are from an earlier one. */
  ok: boolean;
}

export type TwinView = { kind: "hidden" | "checking" | "unavailable" } | TwinVerdict;

/**
 * What the panel may say. Nothing is claimed until BOTH lists have been read once,
 * and a failed read of either withdraws the claim even though the feed still holds
 * the rows it had (`ok` is false while it does): an absence read from stale rows
 * would be a guess. A 200 that declares its own failure counts as failed there.
 */
export function quakeTwinView(signalId: string | undefined, subject: QuakeFacts, theirs: FeedState, ours: FeedState): TwinView {
  if (!twinLayerOf(signalId)) return { kind: "hidden" };
  if (theirs.status === "error" || ours.status === "error" || !theirs.ok || !ours.ok) return { kind: "unavailable" };
  if (theirs.updatedAt === null || ours.updatedAt === null) return { kind: "checking" };
  return findQuakeTwin(subject, theirs.features, ours.features);
}

export interface TwinLines {
  headline: string;
  note?: string;
  caveat?: string;
}

/** The words for a view, or null when the panel should show nothing. */
export function twinLines(view: TwinView, signalId: string | undefined): TwinLines | null {
  const other = twinLayerOf(signalId);
  if (!other) return null;
  const name = QUAKE_LAYER_NAME[other];
  switch (view.kind) {
    case "match": {
      const m = view.twin.props?.magnitude;
      const mag = typeof m === "number" && knownMagnitude(m) ? `M${m.toFixed(1)}, ` : "";
      const km = view.km < 10 ? view.km.toFixed(1) : String(Math.round(view.km));
      const agency = view.twin.props?.agency;
      const note =
        other === "emsc-quakes"
          ? typeof agency === "string" && agency !== "—" && agency !== ""
            ? `${name} credits ${agency}.`
            : undefined
          : `${name} event ${view.twin.id.replace(/^usgs:/, "")}.`;
      return {
        headline: `Also listed by ${name}: ${mag}${Math.round(view.seconds)} s and ${km} km from this one.`,
        note,
        caveat: "Listed in both is not independent confirmation when the credited network is the same.",
      };
    }
    case "none":
      return {
        headline: `No matching event in the ${name} list (within ${TWIN_MAX_SECONDS / 60} min, ${TWIN_MAX_KM} km, ${TWIN_MAX_MAG_DIFF} magnitude).`,
      };
    case "outside":
      return { headline: `Outside the span of the ${name} list, so not compared.` };
    case "ambiguous":
      return { headline: `No single ${name} event can be matched to this one.` };
    case "unavailable":
      return { headline: `Could not read ${name} to compare.` };
    default:
      return null;
  }
}
